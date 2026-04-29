import { promises as fs } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { tool } from 'ai';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { HttpError } from '../../../http/HttpError.js';
import { LocalAssetStorage } from '../../../repositories/AssetStorage.js';
import { GetProjectStatsUseCase } from '../../stats/GetProjectStatsUseCase.js';
import { submissionDetailInclude, submissionInclude, toSubmissionDetail, toSubmissionSummary, toStatus } from '../../submissions/submissionMapper.js';
import { getProjectInclude, toManuscriptProject } from '../../projects/projectMapper.js';
import { bodyOf, emptyInputSchema, pagination, paginatedResult, paginationInputSchema, readRangeInputSchema, readTextRange, type ToolContext } from './shared.js';

const assetStorage = new LocalAssetStorage();

export function readProjectTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read the full manuscript project surface: project metadata, characters, locations, chapters, docs, acts, and structure.',
    inputSchema: emptyInputSchema,
    execute: async () => {
      const project = await prisma.project.findUnique({ where: { id: context.projectId }, include: getProjectInclude() });
      if (!project) throw new HttpError(404, 'Project not found');
      return toManuscriptProject(project);
    }
  });
}

export function listActsTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List acts with chapter ids in order.',
    inputSchema: paginationInputSchema,
    execute: async (input) => {
      const page = pagination(input);
      const where = { projectId: context.projectId };
      const [total, items] = await prisma.$transaction([
        prisma.act.count({ where }),
        prisma.act.findMany({
          where,
          orderBy: { order: 'asc' },
          skip: page.offset,
          take: page.limit,
          include: { chapters: { where: { deletedAt: null }, orderBy: { order: 'asc' }, select: { id: true, number: true, title: true } } }
        })
      ]);
      return paginatedResult(items.map((act) => ({ id: act.id, title: act.title, order: act.order, chapters: act.chapters })), total, page.page, page.limit);
    }
  });
}

export function readActTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read one act with ordered chapter metadata.',
    inputSchema: z.object({ actId: z.string() }),
    execute: async ({ actId }) => {
      const act = await prisma.act.findFirst({
        where: { id: actId, projectId: context.projectId },
        include: { chapters: { where: { deletedAt: null }, orderBy: { order: 'asc' }, select: { id: true, number: true, title: true, summary: true, status: true, povCharacterId: true, locationId: true } } }
      });
      if (!act) throw new HttpError(404, 'Act not found');
      return act;
    }
  });
}

export function listScenesTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List scenes for a chapter or for the project with metadata only.',
    inputSchema: paginationInputSchema.extend({ chapterId: z.string().optional() }),
    execute: async (input) => {
      const page = pagination(input);
      const where = { chapter: { projectId: context.projectId, deletedAt: null }, ...(input.chapterId ? { chapterId: input.chapterId } : {}) };
      const [total, items] = await prisma.$transaction([
        prisma.scene.count({ where }),
        prisma.scene.findMany({
          where,
          orderBy: [{ chapter: { number: 'asc' } }, { order: 'asc' }],
          skip: page.offset,
          take: page.limit,
          select: { id: true, chapterId: true, order: true, title: true, povCharacterId: true, locationId: true }
        })
      ]);
      return paginatedResult(items, total, page.page, page.limit);
    }
  });
}

export function readSceneTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read a bounded scene body range.',
    inputSchema: readRangeInputSchema.extend({ sceneId: z.string() }),
    execute: async (input) => {
      const scene = await prisma.scene.findFirst({
        where: { id: input.sceneId, chapter: { projectId: context.projectId, deletedAt: null } },
        include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
      });
      if (!scene) throw new HttpError(404, 'Scene not found');
      const range = readTextRange(bodyOf(scene.bodyWriting), input);
      return { id: scene.id, chapterId: scene.chapterId, order: scene.order, title: scene.title, povCharacterId: scene.povCharacterId, locationId: scene.locationId, range: range.range, content: range.content };
    }
  });
}

export function listObstaclesTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List project obstacles with metadata and prose.',
    inputSchema: paginationInputSchema,
    execute: async (input) => {
      const page = pagination(input);
      const where = { projectId: context.projectId };
      const [total, items] = await prisma.$transaction([
        prisma.obstacle.count({ where }),
        prisma.obstacle.findMany({
          where,
          orderBy: { order: 'asc' },
          skip: page.offset,
          take: page.limit,
          include: {
            descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        })
      ]);
      return paginatedResult(items.map(toObstacle), total, page.page, page.limit);
    }
  });
}

export function readObstacleTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read one obstacle.',
    inputSchema: z.object({ obstacleId: z.string() }),
    execute: async ({ obstacleId }) => {
      const obstacle = await prisma.obstacle.findFirst({
        where: { id: obstacleId, projectId: context.projectId },
        include: {
          descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
        }
      });
      if (!obstacle) throw new HttpError(404, 'Obstacle not found');
      return toObstacle(obstacle);
    }
  });
}

export function listCharacterRelationshipsTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List character relationships, optionally for one character.',
    inputSchema: paginationInputSchema.extend({ characterId: z.string().optional() }),
    execute: async (input) => {
      const page = pagination(input);
      const where = { projectId: context.projectId, ...(input.characterId ? { OR: [{ fromCharacterId: input.characterId }, { toCharacterId: input.characterId }] } : {}) };
      const [total, items] = await prisma.$transaction([
        prisma.characterRelationship.count({ where }),
        prisma.characterRelationship.findMany({
          where,
          orderBy: { id: 'asc' },
          skip: page.offset,
          take: page.limit,
          include: { fromCharacter: { select: { id: true, name: true } }, toCharacter: { select: { id: true, name: true } } }
        })
      ]);
      return paginatedResult(items.map((relationship) => ({ id: relationship.id, fromCharacter: relationship.fromCharacter, toCharacter: relationship.toCharacter, type: relationship.type, note: relationship.note })), total, page.page, page.limit);
    }
  });
}

export function listSubmissionsTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List project draft submissions and their status.',
    inputSchema: z.object({ status: z.enum(['open', 'merged', 'declined']).optional() }),
    execute: async (input) => {
      const submissions = await prisma.submission.findMany({
        where: { projectId: context.projectId, status: input.status ? toStatus(input.status) : undefined },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: submissionInclude
      });
      return submissions.map(toSubmissionSummary);
    }
  });
}

export function readSubmissionTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read a submission, including base/head body snapshots and activity.',
    inputSchema: z.object({ submissionId: z.string() }),
    execute: async ({ submissionId }) => {
      const submission = await prisma.submission.findFirst({ where: { id: submissionId, projectId: context.projectId }, include: submissionDetailInclude });
      if (!submission) throw new HttpError(404, 'Submission not found');
      return toSubmissionDetail(submission);
    }
  });
}

export function listTrashTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List trashed chapters.',
    inputSchema: emptyInputSchema,
    execute: async () => {
      const chapters = await prisma.chapter.findMany({
        where: { projectId: context.projectId, deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
      });
      return chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, number: chapter.number, wordCount: chapter.bodyWriting.defaultBranch?.headVersion?.wordCount ?? 0, deletedAt: chapter.deletedAt?.toISOString() ?? null }));
    }
  });
}

export function readTrashedChapterTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read a bounded body range from a trashed chapter.',
    inputSchema: readRangeInputSchema.extend({ chapterId: z.string() }),
    execute: async (input) => {
      const chapter = await prisma.chapter.findFirst({
        where: { id: input.chapterId, projectId: context.projectId, deletedAt: { not: null } },
        include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
      });
      if (!chapter) throw new HttpError(404, 'Trashed chapter not found');
      const range = readTextRange(bodyOf(chapter.bodyWriting), input);
      return { id: chapter.id, number: chapter.number, title: chapter.title, summary: chapter.summary, deletedAt: chapter.deletedAt?.toISOString() ?? null, range: range.range, content: range.content };
    }
  });
}

export function listAssetsTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List project assets and attachment metadata.',
    inputSchema: paginationInputSchema.extend({ kind: z.enum(['IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEXT_BLOB']).optional() }),
    execute: async (input) => {
      const page = pagination(input);
      const where = { projectId: context.projectId, ...(input.kind ? { kind: input.kind } : {}) };
      const [total, items] = await prisma.$transaction([
        prisma.asset.count({ where }),
        prisma.asset.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.offset, take: page.limit, include: { attachments: true } })
      ]);
      return paginatedResult(items.map(assetSummary), total, page.page, page.limit);
    }
  });
}

export function readAssetMetadataTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read one asset metadata record and attachments.',
    inputSchema: z.object({ assetId: z.string() }),
    execute: async ({ assetId }) => {
      const asset = await prisma.asset.findFirst({ where: { id: assetId, projectId: context.projectId }, include: { attachments: true } });
      if (!asset) throw new HttpError(404, 'Asset not found');
      return assetSummary(asset);
    }
  });
}

export function readAssetContentTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read text-like asset content. Binary assets return metadata and a note instead of bytes.',
    inputSchema: readRangeInputSchema.extend({ assetId: z.string() }),
    execute: async (input) => {
      const asset = await prisma.asset.findFirst({ where: { id: input.assetId, projectId: context.projectId }, include: { attachments: true } });
      if (!asset) throw new HttpError(404, 'Asset not found');
      if (!isTextAsset(asset.mimeType, asset.kind)) return { ...assetSummary(asset), readable: false, content: null, note: 'Asset is not text-like.' };
      const content = await fs.readFile(assetStorage.pathForKey(asset.s3Key), 'utf8');
      const range = readTextRange(content, input);
      return { ...assetSummary(asset), readable: true, range: range.range, content: range.content };
    }
  });
}

export function getProjectStatsTool(prisma: PrismaClient, context: ToolContext & { userId: string }) {
  return tool({
    description: 'Read project writing stats, word-count history, and streaks.',
    inputSchema: z.object({ days: z.number().int().min(1).max(365).optional() }),
    execute: async ({ days }) => new GetProjectStatsUseCase(prisma).execute(context.userId, context.projectId, days)
  });
}

export function listMembersTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List workspace members and pending invites for this project.',
    inputSchema: emptyInputSchema,
    execute: async () => {
      const project = await prisma.project.findUnique({ where: { id: context.projectId }, select: { orgId: true } });
      if (!project) throw new HttpError(404, 'Project not found');
      const [memberships, invites] = await Promise.all([
        prisma.membership.findMany({ where: { orgId: project.orgId }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }], include: { user: { select: { id: true, username: true, email: true, name: true } } } }),
        prisma.invite.findMany({ where: { orgId: project.orgId, acceptedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' }, include: { invitedBy: { select: { username: true } } } })
      ]);
      return {
        members: memberships.map((m) => ({ userId: m.userId, username: m.user.username, email: m.user.email, name: m.user.name, role: m.role, joinedAt: m.createdAt.toISOString() })),
        invites: invites.map((invite) => ({ id: invite.id, username: invite.username, email: invite.email, role: invite.role, token: invite.token, expiresAt: invite.expiresAt.toISOString(), invitedById: invite.invitedById, invitedByUsername: invite.invitedBy.username, createdAt: invite.createdAt.toISOString() }))
      };
    }
  });
}

export function listBetaShareLinksTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List beta-reader share links for the project.',
    inputSchema: emptyInputSchema,
    execute: async () => prisma.betaShareLink.findMany({ where: { projectId: context.projectId }, orderBy: { createdAt: 'desc' } })
  });
}

export function readBetaShareLinkTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read one beta-reader share link and comments.',
    inputSchema: z.object({ shareLinkId: z.string() }),
    execute: async ({ shareLinkId }) => {
      const link = await prisma.betaShareLink.findFirst({ where: { id: shareLinkId, projectId: context.projectId }, include: { comments: { orderBy: { createdAt: 'asc' } } } });
      if (!link) throw new HttpError(404, 'Share link not found');
      return link;
    }
  });
}

export function readPublicProjectTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read the public reader-view data for this project if published.',
    inputSchema: emptyInputSchema,
    execute: async () => {
      const project = await prisma.project.findFirst({
        where: { id: context.projectId, visibility: 'PUBLIC', deletedAt: null },
        include: { org: true, chapters: { where: { deletedAt: null, publishedAt: { not: null } }, orderBy: { number: 'asc' }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } } }
      });
      if (!project) throw new HttpError(404, 'Public project not found');
      return { id: project.id, slug: project.slug, title: project.title, description: project.description ?? '', genre: project.genre ?? '', orgSlug: project.org.slug, orgName: project.org.name, publishedAt: project.publishedAt?.toISOString() ?? null, chapters: project.chapters.map((chapter) => ({ id: chapter.id, number: chapter.number, title: chapter.title, summary: chapter.summary ?? '', wordCount: chapter.bodyWriting.defaultBranch?.headVersion?.wordCount ?? 0, content: bodyOf(chapter.bodyWriting), publishedAt: chapter.publishedAt?.toISOString() ?? null })) };
    }
  });
}

export function readProjectAiSettingsTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read project AI settings without exposing raw API keys.',
    inputSchema: emptyInputSchema,
    execute: async () => {
      const settings = await prisma.projectAiSettings.findUnique({ where: { projectId: context.projectId } });
      return settings ? { projectId: context.projectId, enabled: settings.enabled, providerKind: settings.providerKind, model: settings.model, baseUrl: settings.baseUrl, hasApiKey: Boolean(settings.apiKey), updatedAt: settings.updatedAt.toISOString() } : { projectId: context.projectId, enabled: false, providerKind: 'GATEWAY', model: 'openai/gpt-5.4', baseUrl: null, hasApiKey: false, updatedAt: null };
    }
  });
}

export function listWritingVersionsTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'List writing versions for a writing, branch, or project writing kind.',
    inputSchema: paginationInputSchema.extend({ writingId: z.string().optional(), branchId: z.string().optional(), kind: z.string().optional() }),
    execute: async (input) => {
      const page = pagination(input);
      const where = input.branchId
        ? { branchId: input.branchId, branch: { writing: { projectId: context.projectId } } }
        : { branch: { writing: { projectId: context.projectId, ...(input.writingId ? { id: input.writingId } : {}), ...(input.kind ? { kind: input.kind as never } : {}) } } };
      const [total, items] = await prisma.$transaction([
        prisma.writingVersion.count({ where }),
        prisma.writingVersion.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.offset, take: page.limit, select: { id: true, branchId: true, parentVersionId: true, wordCount: true, authorId: true, message: true, createdAt: true } })
      ]);
      return paginatedResult(items.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })), total, page.page, page.limit);
    }
  });
}

export function readWritingVersionTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Read a bounded body range from a writing version.',
    inputSchema: readRangeInputSchema.extend({ versionId: z.string() }),
    execute: async (input) => {
      const version = await prisma.writingVersion.findFirst({ where: { id: input.versionId, branch: { writing: { projectId: context.projectId } } } });
      if (!version) throw new HttpError(404, 'Writing version not found');
      const range = readTextRange(version.body ?? '', input);
      return { id: version.id, branchId: version.branchId, parentVersionId: version.parentVersionId, wordCount: version.wordCount, authorId: version.authorId, message: version.message, createdAt: version.createdAt.toISOString(), range: range.range, content: range.content };
    }
  });
}

export function grepProjectTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description: 'Search project docs, characters, locations, structure, obstacles, and submissions for text or regex matches.',
    inputSchema: z.object({ query: z.string(), surfaces: z.array(z.enum(['docs', 'characters', 'locations', 'structure', 'obstacles', 'submissions'])).optional(), regex: z.boolean().optional(), caseSensitive: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional() }),
    execute: async (input) => grepProject(prisma, context, input)
  });
}

async function grepProject(prisma: PrismaClient, context: ToolContext, input: { query: string; surfaces?: Array<'docs' | 'characters' | 'locations' | 'structure' | 'obstacles' | 'submissions'>; regex?: boolean; caseSensitive?: boolean; limit?: number }) {
  const query = input.query.trim();
  if (!query) throw new HttpError(400, 'grep query is required');
  const matcher = makeMatcher(query, Boolean(input.regex), Boolean(input.caseSensitive));
  const limit = Math.min(input.limit ?? 50, 100);
  const surfaces = new Set(input.surfaces ?? ['docs', 'characters', 'locations', 'structure', 'obstacles', 'submissions']);
  const matches: Array<{ surface: string; id: string; label: string; field: string; line: number; text: string }> = [];
  const add = (surface: string, id: string, label: string, field: string, content: string) => {
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (matcher(line)) matches.push({ surface, id, label, field, line: index + 1, text: line });
      if (matches.length >= limit) return;
    }
  };

  if (surfaces.has('docs')) {
    const docs = await prisma.projectDoc.findMany({ where: { projectId: context.projectId }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } });
    for (const doc of docs) add('doc', doc.id, doc.title, 'content', bodyOf(doc.bodyWriting));
  }
  if (surfaces.has('characters')) {
    const characters = await prisma.character.findMany({ where: { projectId: context.projectId }, include: { descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, appearanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } });
    for (const c of characters) for (const [field, writing] of Object.entries({ description: c.descriptionWriting, appearance: c.appearanceWriting, motivation: c.motivationWriting, arc: c.arcWriting })) add('character', c.id, c.name, field, bodyOf(writing));
  }
  if (surfaces.has('locations')) {
    const locations = await prisma.location.findMany({ where: { projectId: context.projectId }, include: { descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, atmosphereWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, significanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, sensoryWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } });
    for (const l of locations) for (const [field, writing] of Object.entries({ description: l.descriptionWriting, atmosphere: l.atmosphereWriting, significance: l.significanceWriting, sensory: l.sensoryWriting })) add('location', l.id, l.name, field, bodyOf(writing));
  }
  if (surfaces.has('structure') || surfaces.has('obstacles')) {
    const project = await prisma.project.findUnique({ where: { id: context.projectId }, include: { storyStructure: { include: { loglineWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, outlineWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, climaxWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }, obstacles: { include: { descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } } } });
    if (project?.storyStructure && surfaces.has('structure')) for (const [field, writing] of Object.entries({ logline: project.storyStructure.loglineWriting, outline: project.storyStructure.outlineWriting, climax: project.storyStructure.climaxWriting })) add('structure', project.id, project.title, field, bodyOf(writing));
    if (project && surfaces.has('obstacles')) for (const o of project.obstacles) for (const [field, writing] of Object.entries({ description: o.descriptionWriting, resolution: o.resolutionWriting })) add('obstacle', o.id, o.title, field, bodyOf(writing));
  }
  if (surfaces.has('submissions')) {
    const submissions = await prisma.submission.findMany({ where: { projectId: context.projectId }, include: submissionDetailInclude });
    for (const s of submissions) { add('submission', s.id, s.title, 'baseBody', s.baseVersion?.body ?? ''); add('submission', s.id, s.title, 'headBody', s.branch.headVersion?.body ?? ''); }
  }
  return { query, matches, truncated: matches.length >= limit };
}

function makeMatcher(query: string, regex: boolean, caseSensitive: boolean): (line: string) => boolean {
  if (regex) {
    const expression = new RegExp(query, caseSensitive ? '' : 'i');
    return (line) => expression.test(line);
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  return (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
}

function toObstacle(obstacle: { id: string; title: string; type: string; order: number; descriptionWriting: { defaultBranch: { headVersion: { body: string | null } | null } | null }; resolutionWriting: { defaultBranch: { headVersion: { body: string | null } | null } | null } }) {
  return { id: obstacle.id, title: obstacle.title, type: obstacle.type, order: obstacle.order, description: bodyOf(obstacle.descriptionWriting), resolution: bodyOf(obstacle.resolutionWriting) };
}

function assetSummary(asset: { id: string; projectId: string | null; kind: string; mimeType: string; sizeBytes: bigint; s3Bucket: string; s3Key: string; checksum: string | null; width: number | null; height: number | null; durationMs: number | null; uploadedById: string | null; createdAt: Date; attachments?: Array<{ id: string; entityType: string; entityId: string; role: string; order: number | null }> }) {
  return { id: asset.id, projectId: asset.projectId, kind: asset.kind, mimeType: asset.mimeType, sizeBytes: Number(asset.sizeBytes), url: `${env.publicBaseUrl}/assets/${asset.id}`, s3Bucket: asset.s3Bucket, s3Key: asset.s3Key, checksum: asset.checksum, width: asset.width, height: asset.height, durationMs: asset.durationMs, uploadedById: asset.uploadedById, createdAt: asset.createdAt.toISOString(), attachments: asset.attachments ?? [] };
}

function isTextAsset(mimeType: string, kind: string): boolean {
  return kind === 'TEXT_BLOB' || mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType.endsWith('+json') || mimeType === 'application/xml' || mimeType.endsWith('+xml') || mimeType === 'text/markdown';
}
