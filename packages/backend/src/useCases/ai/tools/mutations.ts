import type { PrismaClient } from '@prisma/client';
import type { CreateChapterInput, CreateCharacterInput, UpdateChapterInput, UpdateCharacterInput } from '@opentales/sdk';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { CreateChapterUseCase } from '../../projects/CreateChapterUseCase.js';
import { CreateCharacterUseCase } from '../../projects/CreateCharacterUseCase.js';
import { UpdateChapterUseCase } from '../../projects/UpdateChapterUseCase.js';
import { UpdateCharacterUseCase } from '../../projects/UpdateCharacterUseCase.js';
import { applyContentEdit, bodyOf, countWords, editContentInputSchema, toPrismaDocKind, type ToolContext } from './shared.js';

type ApprovalToolConfig = Tool<any, any>;

export const mutatingToolNames = [
  'updateCharacter',
  'createCharacter',
  'updateChapter',
  'createChapter',
  'createProjectDoc',
  'updateProjectDoc'
] as const;

export type MutatingToolName = (typeof mutatingToolNames)[number];

export interface ApprovalHandler {
  handleApproval(toolName: MutatingToolName, input: unknown, execute: () => Promise<unknown>): Promise<unknown>;
}

export function mutationTools(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  approval: ApprovalHandler
) {
  return {
    updateCharacter: approvalTool({
      description:
        'Update an existing character. Only `characterId` is required; include only fields to change. The user will approve/reject the proposal in the UI.',
      inputSchema: z.object({
        characterId: z.string().describe('ID of the character to update'),
        name: z.string().optional().describe('New name for the character'),
        role: z.string().optional().describe('Character role'),
        age: z.string().optional().describe('Character age'),
        occupation: z.string().optional().describe('Character occupation'),
        traits: z.array(z.string()).optional().describe('List of personality traits'),
        description: z.string().optional().describe('Character description/backstory'),
        appearance: z.string().optional().describe('Physical appearance'),
        motivation: z.string().optional().describe('What drives this character'),
        arc: z.string().optional().describe('Character arc across the story')
      }),
      execute: async (input) => approval.handleApproval('updateCharacter', input, () => updateCharacter(prisma, context, input))
    }),
    createCharacter: approvalTool({
      description:
        'Create a new character. Only `name` is required. The user will approve/reject the proposal in the UI.',
      inputSchema: z.object({
        name: z.string().describe('Character name (required)'),
        role: z.string().optional().describe('Character role'),
        age: z.string().optional().describe('Character age'),
        occupation: z.string().optional().describe('Character occupation'),
        traits: z.array(z.string()).optional().describe('List of personality traits'),
        description: z.string().optional().describe('Character description/backstory'),
        appearance: z.string().optional().describe('Physical appearance'),
        motivation: z.string().optional().describe('What drives this character'),
        arc: z.string().optional().describe('Character arc across the story')
      }),
      execute: async (input) => approval.handleApproval('createCharacter', input, () => createCharacter(prisma, context, input))
    }),
    updateChapter: approvalTool({
      description:
        'Update chapter metadata and/or content by exact replacement. Use oldString/newString for manuscript edits instead of sending full content.',
      inputSchema: z.object({
        chapterId: z.string().describe('ID of the chapter to update'),
        title: z.string().optional().describe('New chapter title'),
        summary: z.string().optional().describe('Chapter summary'),
        status: z.enum(['draft', 'in-progress', 'review', 'final']).optional().describe('Chapter status'),
        povCharacterId: z.string().optional().describe('ID of the POV character'),
        locationId: z.string().optional().describe('ID of the primary location'),
        contentEdit: editContentInputSchema.optional().describe('Exact manuscript content replacement')
      }),
      execute: async (input) => approval.handleApproval('updateChapter', input, () => updateChapter(prisma, context, input))
    }),
    createChapter: approvalTool({
      description:
        'Create a new chapter. Only `title` is required; everything else is optional. The user will approve/reject the proposal in the UI.',
      inputSchema: z.object({
        title: z.string().describe('Chapter title (required)'),
        actId: z.string().optional().describe('ID of the act this chapter belongs to'),
        summary: z.string().optional().describe('Chapter summary'),
        content: z.string().optional().describe('Chapter manuscript content in markdown'),
        status: z.enum(['draft', 'in-progress', 'review', 'final']).optional().describe('Chapter status'),
        povCharacterId: z.string().optional().describe('ID of the POV character'),
        locationId: z.string().optional().describe('ID of the primary location')
      }),
      execute: async (input) => approval.handleApproval('createChapter', input, () => createChapter(prisma, context, input))
    }),
    createProjectDoc: approvalTool({
      description:
        'Create a new project document (note, brainstorm, instruction, or reference). Only `title` is required. The user will approve/reject the proposal in the UI.',
      inputSchema: z.object({
        title: z.string().describe('Document title (required)'),
        kind: z.enum(['note', 'brainstorm', 'instructions', 'reference', 'other']).optional().describe('Document kind'),
        content: z.string().optional().describe('Document body in markdown')
      }),
      execute: async (input) => approval.handleApproval('createProjectDoc', input, () => createProjectDoc(prisma, context, input))
    }),
    updateProjectDoc: approvalTool({
      description:
        'Update document metadata and/or content by exact replacement. Use oldString/newString for body edits instead of sending full content.',
      inputSchema: z.object({
        docId: z.string().describe('ID of the document to update'),
        title: z.string().optional().describe('New document title'),
        kind: z.enum(['note', 'brainstorm', 'instructions', 'reference', 'other']).optional().describe('Document kind'),
        contentEdit: editContentInputSchema.optional().describe('Exact document body replacement')
      }),
      execute: async (input) => approval.handleApproval('updateProjectDoc', input, () => updateProjectDoc(prisma, context, input))
    })
  } satisfies Record<MutatingToolName, Tool<any, any>>;
}

function approvalTool(config: ApprovalToolConfig): Tool<any, any> {
  return tool(config) as Tool<any, any>;
}

export async function executeMutationTool(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  toolName: string,
  input: Record<string, unknown>
) {
  if (toolName === 'createProjectDoc') return createProjectDoc(prisma, context, input);
  if (toolName === 'updateProjectDoc') return updateProjectDoc(prisma, context, input);
  if (toolName === 'updateChapter') return updateChapter(prisma, context, input);
  if (toolName === 'createChapter') return createChapter(prisma, context, input);
  if (toolName === 'createCharacter') return createCharacter(prisma, context, input);
  if (toolName === 'updateCharacter') return updateCharacter(prisma, context, input);
  throw new HttpError(400, `Approval execution for ${toolName} is not implemented yet`);
}

async function createProjectDoc(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  input: Record<string, unknown>
) {
  const title = String(input.title ?? '').trim();
  if (!title) throw new HttpError(400, 'Document title is required');
  const content = typeof input.content === 'string' ? input.content : '';
  const last = await prisma.projectDoc.findFirst({
    where: { projectId: context.projectId },
    orderBy: { order: 'desc' },
    select: { order: true }
  });
  return prisma.$transaction(async (tx) => {
    const writing = await tx.writing.create({ data: { projectId: context.projectId, kind: 'NOTE' } });
    const branch = await tx.writingBranch.create({ data: { writingId: writing.id, name: 'main' } });
    const version = await tx.writingVersion.create({
      data: {
        branchId: branch.id,
        body: content,
        wordCount: countWords(content),
        authorId: context.userId,
        message: 'Create project document from AI approval'
      }
    });
    await tx.writingBranch.update({ where: { id: branch.id }, data: { headVersionId: version.id } });
    await tx.writing.update({ where: { id: writing.id }, data: { defaultBranchId: branch.id } });
    return tx.projectDoc.create({
      data: {
        projectId: context.projectId,
        title,
        kind: typeof input.kind === 'string' ? toPrismaDocKind(input.kind) : 'NOTE',
        bodyWritingId: writing.id,
        order: (last?.order ?? -1) + 1
      },
      select: { id: true, title: true, kind: true }
    });
  });
}

async function updateProjectDoc(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  input: Record<string, unknown>
) {
  const docId = String(input.docId ?? '');
  if (!docId) throw new HttpError(400, 'docId is required');
  const doc = await prisma.projectDoc.findFirst({
    where: { id: docId, projectId: context.projectId },
    include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
  });
  if (!doc) throw new HttpError(404, 'Project document not found');
  return prisma.$transaction(async (tx) => {
    await tx.projectDoc.update({
      where: { id: docId },
      data: {
        title: typeof input.title === 'string' ? input.title : undefined,
        kind: typeof input.kind === 'string' ? toPrismaDocKind(input.kind) : undefined
      }
    });
    if (isContentEdit(input.contentEdit)) {
      const writing = await tx.writing.findUniqueOrThrow({
        where: { id: doc.bodyWritingId },
        include: { defaultBranch: true }
      });
      if (!writing.defaultBranch) throw new Error(`Writing ${doc.bodyWritingId} has no default branch`);
      const body = applyContentEdit(bodyOf(doc.bodyWriting), input.contentEdit);
      const version = await tx.writingVersion.create({
        data: {
          branchId: writing.defaultBranch.id,
          parentVersionId: writing.defaultBranch.headVersionId,
          body,
          wordCount: countWords(body),
          authorId: context.userId,
          message: 'Update project document from AI approval'
        }
      });
      await tx.writingBranch.update({ where: { id: writing.defaultBranch.id }, data: { headVersionId: version.id } });
    }
    return tx.projectDoc.findUnique({ where: { id: docId }, select: { id: true, title: true, kind: true } });
  });
}

async function updateChapter(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  input: Record<string, unknown>
) {
  const chapterId = String(input.chapterId ?? '');
  if (!chapterId) throw new HttpError(400, 'chapterId is required');
  let content: string | undefined;
  if (isContentEdit(input.contentEdit)) {
    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, projectId: context.projectId, deletedAt: null },
      include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
    });
    if (!chapter) throw new HttpError(404, 'Chapter not found');
    content = applyContentEdit(bodyOf(chapter.bodyWriting), input.contentEdit);
  }
  const data: UpdateChapterInput = {
    title: stringOrUndefined(input.title),
    summary: stringOrUndefined(input.summary),
    content,
    status: chapterStatusOrUndefined(input.status),
    povCharacterId: stringOrUndefined(input.povCharacterId),
    locationId: stringOrUndefined(input.locationId)
  };
  return new UpdateChapterUseCase(prisma).execute(context.userId, context.projectId, chapterId, data);
}

async function createChapter(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  input: Record<string, unknown>
) {
  const title = String(input.title ?? '').trim();
  if (!title) throw new HttpError(400, 'Chapter title is required');
  const data: CreateChapterInput = {
    title,
    actId: stringOrUndefined(input.actId),
    status: chapterStatusOrUndefined(input.status),
    povCharacterId: stringOrUndefined(input.povCharacterId),
    locationId: stringOrUndefined(input.locationId),
    summary: stringOrUndefined(input.summary),
    content: manuscriptContentOrUndefined(input.content)
  };
  return new CreateChapterUseCase(prisma).execute(context.userId, context.projectId, data);
}

async function createCharacter(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  input: Record<string, unknown>
) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Character name is required');
  const data: CreateCharacterInput = {
    name,
    role: stringOrUndefined(input.role),
    age: stringOrUndefined(input.age),
    occupation: stringOrUndefined(input.occupation),
    traits: stringArrayOrUndefined(input.traits),
    description: stringOrUndefined(input.description),
    appearance: stringOrUndefined(input.appearance),
    motivation: stringOrUndefined(input.motivation),
    arc: stringOrUndefined(input.arc)
  };
  return new CreateCharacterUseCase(prisma).execute(context.userId, context.projectId, data);
}

async function updateCharacter(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  input: Record<string, unknown>
) {
  const characterId = String(input.characterId ?? '');
  if (!characterId) throw new HttpError(400, 'characterId is required');
  const data: UpdateCharacterInput = {
    name: stringOrUndefined(input.name),
    role: stringOrUndefined(input.role),
    age: stringOrUndefined(input.age),
    occupation: stringOrUndefined(input.occupation),
    traits: stringArrayOrUndefined(input.traits),
    description: stringOrUndefined(input.description),
    appearance: stringOrUndefined(input.appearance),
    motivation: stringOrUndefined(input.motivation),
    arc: stringOrUndefined(input.arc)
  };
  return new UpdateCharacterUseCase(prisma).execute(context.userId, context.projectId, characterId, data);
}

function isContentEdit(value: unknown): value is { oldString: string; newString: string; replaceAll?: boolean } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { oldString?: unknown }).oldString === 'string' &&
    typeof (value as { newString?: unknown }).newString === 'string'
  );
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function manuscriptContentOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() ? value : undefined;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function chapterStatusOrUndefined(value: unknown): UpdateChapterInput['status'] {
  if (value === 'draft' || value === 'in-progress' || value === 'review' || value === 'final') return value;
  return undefined;
}
