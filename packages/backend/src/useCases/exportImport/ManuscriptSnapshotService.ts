import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { JsonValue } from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { LocalAssetStorage } from '../../repositories/AssetStorage.js';
import { bodyOf } from '../ai/tools/shared.js';
import { stableHash } from '../novelBuild/schemas.js';
import {
  safeArchivePath,
  type ManuscriptChapterSnapshot,
  type ManuscriptSnapshot,
  type ProjectArchivePayload
} from './exportFormats.js';

const MAX_ARCHIVE_ASSET_BYTES = 100 * 1024 * 1024;

export class ManuscriptSnapshotService {
  private readonly storage = new LocalAssetStorage();

  constructor(private readonly prisma: PrismaClient) {}

  async main(projectId: string, authorName?: string): Promise<ManuscriptSnapshot> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        org: { select: { name: true } },
        chapters: {
          where: { deletedAt: null },
          orderBy: { number: 'asc' },
          include: {
            bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            scenes: {
              orderBy: { order: 'asc' },
              include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
            }
          }
        }
      }
    });
    if (!project) throw new HttpError(404, 'Project not found');
    const chapters: ManuscriptChapterSnapshot[] = project.chapters.map((chapter) => {
      const branch = chapter.bodyWriting.defaultBranch;
      if (!branch?.headVersion) throw new HttpError(409, `Chapter ${chapter.number} has no main writing version`);
      const chapterBody = branch.headVersion.body ?? '';
      const sceneBody = chapter.scenes.map((scene) => bodyOf(scene.bodyWriting)).filter((body) => body.trim()).join('\n\n***\n\n');
      const body = chapterBody.trim() ? chapterBody : sceneBody;
      return {
        sourceId: chapter.id,
        key: `chapter-${chapter.number}`,
        number: chapter.number,
        title: chapter.title,
        summary: chapter.summary,
        body,
        wordCount: wordCount(body),
        writingId: chapter.bodyWritingId,
        branchId: branch.id,
        versionId: branch.headVersion.id,
        contentHash: stableHash(body)
      };
    });
    if (!chapters.length) throw new HttpError(409, 'Project has no chapters to export');
    return snapshot({
      projectId,
      projectTitle: project.title,
      description: project.description,
      genre: project.genre,
      authorName: authorName?.trim() || project.org.name || 'OpenTales Author',
      target: 'main',
      buildRunId: null,
      compilationId: null,
      branchName: 'main',
      chapters
    });
  }

  async build(projectId: string, buildRunId: string, compilationId: string, authorName?: string): Promise<ManuscriptSnapshot> {
    const [project, compilation] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, include: { org: { select: { name: true } } } }),
      this.prisma.buildCompilation.findFirst({
        where: { id: compilationId, projectId, buildRunId },
        include: {
          buildRun: { select: { branchName: true } },
          units: {
            include: { unit: true, writingVersion: true },
            orderBy: { order: 'asc' }
          }
        }
      })
    ]);
    if (!project) throw new HttpError(404, 'Project not found');
    if (!compilation) throw new HttpError(404, 'Build compilation not found');
    const chapters = compilation.units
      .filter((row) => row.unit.kind === 'CHAPTER')
      .sort((a, b) => (a.unit.chapterNumber ?? a.unit.order) - (b.unit.chapterNumber ?? b.unit.order))
      .map((row): ManuscriptChapterSnapshot => {
        const body = row.writingVersion.body ?? '';
        if (stableHash(body) !== row.contentHash) throw new HttpError(409, `Compilation content hash drifted for unit '${row.unit.key}'`);
        return {
          sourceId: row.unit.id,
          key: row.unit.key,
          number: row.unit.chapterNumber ?? row.unit.order + 1,
          title: row.unit.title,
          summary: textValue(jsonObject(row.unit.metadata).summary),
          body,
          wordCount: row.wordCount,
          writingId: row.unit.writingId,
          branchId: row.unit.branchId,
          versionId: row.writingVersionId,
          contentHash: row.contentHash
        };
      });
    if (!chapters.length) throw new HttpError(409, 'Compilation has no chapter units');
    const result = snapshot({
      projectId,
      projectTitle: project.title,
      description: project.description,
      genre: project.genre,
      authorName: authorName?.trim() || project.org.name || 'OpenTales Author',
      target: 'build',
      buildRunId,
      compilationId,
      branchName: compilation.buildRun.branchName,
      chapters
    });
    if (result.contentHash !== compilation.contentHash) {
      // Compilation hashes include scene rows as well as the compiled chapter rows.
      result.contentHash = compilation.contentHash;
    }
    return result;
  }

  async projectArchive(
    snapshotValue: ManuscriptSnapshot,
    includeAssets: boolean
  ): Promise<{ payload: ProjectArchivePayload; assetFiles: Array<{ path: string; data: Buffer }> }> {
    const project = await this.prisma.project.findUnique({
      where: { id: snapshotValue.projectId },
      include: {
        storyStructure: {
          include: {
            loglineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            outlineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            climaxWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        },
        chapters: {
          where: { deletedAt: null }, orderBy: { number: 'asc' },
          include: {
            bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            scenes: { orderBy: { order: 'asc' }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }
          }
        },
        characters: {
          orderBy: { name: 'asc' },
          include: {
            descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            appearanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        },
        locations: {
          orderBy: { name: 'asc' },
          include: {
            descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            atmosphereWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            significanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            sensoryWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        },
        acts: { orderBy: { order: 'asc' } },
        obstacles: {
          orderBy: { order: 'asc' },
          include: {
            descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
            resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
          }
        },
        characterRelationships: true,
        docs: { orderBy: [{ order: 'asc' }, { title: 'asc' }], include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } },
        assets: { where: { isPublic: true }, orderBy: { createdAt: 'asc' } }
      }
    });
    if (!project) throw new HttpError(404, 'Project not found');
    const build = snapshotValue.buildRunId ? await this.buildArchiveState(snapshotValue.projectId, snapshotValue.buildRunId) : null;
    const assetFiles: Array<{ path: string; data: Buffer }> = [];
    const assets: Array<Record<string, JsonValue>> = [];
    let totalAssetBytes = 0;
    for (const asset of project.assets) {
      const archivePath = safeArchivePath(`assets/${asset.id}${path.extname(asset.s3Key) || ''}`);
      let included = false;
      if (includeAssets && asset.s3Bucket === LocalAssetStorage.bucket) {
        const chunks: Buffer[] = [];
        for await (const chunk of await this.storage.readStream(asset.s3Key)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const data = Buffer.concat(chunks);
        totalAssetBytes += data.length;
        if (totalAssetBytes > MAX_ARCHIVE_ASSET_BYTES) throw new HttpError(413, 'Project assets exceed the 100 MB archive limit');
        assetFiles.push({ path: archivePath, data });
        included = true;
      }
      assets.push(jsonRecord({ id: asset.id, name: asset.name, kind: asset.kind, mimeType: asset.mimeType, sizeBytes: Number(asset.sizeBytes), checksum: asset.checksum, archivePath: included ? archivePath : null }));
    }
    const payload: ProjectArchivePayload = {
      schema: 'opentales.project-archive.v1',
      exportedAt: new Date().toISOString(),
      source: { projectId: project.id, target: snapshotValue.target, buildRunId: snapshotValue.buildRunId },
      project: jsonRecord({ title: project.title, slug: project.slug, description: project.description, genre: project.genre, perspective: project.perspective, pov: project.pov, voice: project.voice, tone: project.tone, themes: project.themes }),
      chapters: project.chapters.map((chapter) => jsonRecord({
        id: chapter.id, number: chapter.number, title: chapter.title, summary: chapter.summary, status: chapter.status,
        povCharacterId: chapter.povCharacterId, locationId: chapter.locationId, actId: chapter.actId,
        body: bodyOf(chapter.bodyWriting),
        scenes: chapter.scenes.map((scene) => ({ ...serializable(scene, ['bodyWriting']), body: bodyOf(scene.bodyWriting) }))
      })),
      characters: project.characters.map((character) => jsonRecord({
        ...serializable(character, ['descriptionWriting', 'appearanceWriting', 'motivationWriting', 'arcWriting']),
        description: bodyOf(character.descriptionWriting), appearance: bodyOf(character.appearanceWriting),
        motivation: bodyOf(character.motivationWriting), arc: bodyOf(character.arcWriting)
      })),
      locations: project.locations.map((location) => jsonRecord({
        ...serializable(location, ['descriptionWriting', 'atmosphereWriting', 'significanceWriting', 'sensoryWriting']),
        description: bodyOf(location.descriptionWriting), atmosphere: bodyOf(location.atmosphereWriting),
        significance: bodyOf(location.significanceWriting), sensoryDetails: bodyOf(location.sensoryWriting)
      })),
      acts: project.acts.map((act) => jsonRecord(serializable(act))),
      obstacles: project.obstacles.map((obstacle) => jsonRecord({ ...serializable(obstacle, ['descriptionWriting', 'resolutionWriting']), description: bodyOf(obstacle.descriptionWriting), resolution: bodyOf(obstacle.resolutionWriting) })),
      relationships: project.characterRelationships.map((relationship) => jsonRecord(serializable(relationship))),
      docs: project.docs.map((doc) => jsonRecord({ ...serializable(doc, ['bodyWriting']), body: bodyOf(doc.bodyWriting) })),
      storyStructure: project.storyStructure ? jsonRecord({ ...serializable(project.storyStructure, ['loglineWriting', 'outlineWriting', 'climaxWriting']), logline: bodyOf(project.storyStructure.loglineWriting), outline: bodyOf(project.storyStructure.outlineWriting), climax: bodyOf(project.storyStructure.climaxWriting) }) : null,
      build,
      assets
    };
    return { payload, assetFiles };
  }

  private async buildArchiveState(projectId: string, buildRunId: string): Promise<Record<string, JsonValue>> {
    const [run, artifacts, facts, states, events, loops, setups, threads, units] = await Promise.all([
      this.prisma.buildRun.findFirst({ where: { id: buildRunId, projectId } }),
      this.prisma.storyArtifact.findMany({ where: { projectId, buildRunId, invalidatedAt: null } }),
      this.prisma.canonFact.findMany({ where: { projectId, buildRunId, invalidatedAt: null } }),
      this.prisma.entityState.findMany({ where: { projectId, buildRunId, invalidatedAt: null } }),
      this.prisma.timelineEvent.findMany({ where: { projectId, buildRunId, invalidatedAt: null } }),
      this.prisma.openLoop.findMany({ where: { projectId, buildRunId, invalidatedAt: null } }),
      this.prisma.setupPayoffLink.findMany({ where: { projectId, buildRunId, invalidatedAt: null } }),
      this.prisma.plotThread.findMany({ where: { projectId, buildRunId, invalidatedAt: null } }),
      this.prisma.buildManuscriptUnit.findMany({ where: { projectId, buildRunId, invalidatedAt: null }, include: { branch: { include: { headVersion: true } } } })
    ]);
    if (!run) throw new HttpError(404, 'Build run not found');
    return jsonRecord({
      run: serializable(run, ['authorizationScope']),
      artifacts: artifacts.map((item) => serializable(item)), canonFacts: facts.map((item) => serializable(item)), entityStates: states.map((item) => serializable(item)),
      timelineEvents: events.map((item) => serializable(item)), openLoops: loops.map((item) => serializable(item)), setupPayoffs: setups.map((item) => serializable(item)),
      plotThreads: threads.map((item) => serializable(item)),
      manuscriptUnits: units.map((unit) => ({ ...serializable(unit, ['branch']), body: unit.branch.headVersion?.body ?? '', headVersionId: unit.branch.headVersionId }))
    });
  }
}

function snapshot(input: Omit<ManuscriptSnapshot, 'contentHash' | 'totalWordCount' | 'branchHeads'>): ManuscriptSnapshot {
  const branchHeads = input.chapters.map((chapter) => ({ sourceId: chapter.sourceId, writingId: chapter.writingId, branchId: chapter.branchId, versionId: chapter.versionId, contentHash: chapter.contentHash }));
  return {
    ...input,
    totalWordCount: input.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    contentHash: stableHash({ target: input.target, buildRunId: input.buildRunId, chapters: branchHeads }),
    branchHeads
  };
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function serializable<T extends object>(value: T, omit: string[] = []): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value, (key, child) => omit.includes(key) ? undefined : typeof child === 'bigint' ? Number(child) : child)) as Record<string, JsonValue>;
}

function jsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value, (_key, child) => typeof child === 'bigint' ? Number(child) : child)) as Record<string, JsonValue>;
}
