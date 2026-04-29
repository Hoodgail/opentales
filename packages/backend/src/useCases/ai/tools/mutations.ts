import type { AttachmentEntity, Prisma, PrismaClient, Role } from '@prisma/client';
import type {
  AddSubmissionCommentInput,
  CreateActInput,
  CreateBetaShareCommentInput,
  CreateBetaShareLinkInput,
  CreateChapterInput,
  CreateCharacterInput,
  CreateCharacterRelationshipInput,
  CreateInviteInput,
  CreateLocationInput,
  CreateObstacleInput,
  CreateSubmissionInput,
  UpdateActInput,
  UpdateBetaShareLinkInput,
  UpdateChapterInput,
  UpdateCharacterInput,
  UpdateLocationInput,
  UpdateObstacleInput,
  UpdateProjectAiSettingsInput,
  UpdateProjectInput,
  UpdateStructureInput
} from '@opentales/sdk';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../../http/HttpError.js';
import { ProjectAccessRepository } from '../../../repositories/ProjectAccessRepository.js';
import { AcceptInviteUseCase } from '../../members/AcceptInviteUseCase.js';
import { AddBetaShareCommentUseCase } from '../../shareLinks/AddBetaShareCommentUseCase.js';
import { AddCommentUseCase } from '../../submissions/AddCommentUseCase.js';
import { CreateActUseCase } from '../../projects/CreateActUseCase.js';
import { CreateBetaShareLinkUseCase } from '../../shareLinks/CreateBetaShareLinkUseCase.js';
import { CreateChapterUseCase } from '../../projects/CreateChapterUseCase.js';
import { CreateCharacterUseCase } from '../../projects/CreateCharacterUseCase.js';
import { CreateCharacterRelationshipUseCase } from '../../projects/CreateCharacterRelationshipUseCase.js';
import { CreateInviteUseCase } from '../../members/CreateInviteUseCase.js';
import { CreateLocationUseCase } from '../../projects/CreateLocationUseCase.js';
import { CreateObstacleUseCase } from '../../projects/CreateObstacleUseCase.js';
import { CreateSubmissionUseCase } from '../../submissions/CreateSubmissionUseCase.js';
import { DeclineSubmissionUseCase } from '../../submissions/DeclineSubmissionUseCase.js';
import { DeleteActUseCase } from '../../projects/DeleteActUseCase.js';
import { DeleteChapterUseCase } from '../../projects/DeleteChapterUseCase.js';
import { DeleteCharacterRelationshipUseCase } from '../../projects/DeleteCharacterRelationshipUseCase.js';
import { DeleteCharacterUseCase } from '../../projects/DeleteCharacterUseCase.js';
import { DeleteLocationUseCase } from '../../projects/DeleteLocationUseCase.js';
import { DeleteObstacleUseCase } from '../../projects/DeleteObstacleUseCase.js';
import { MergeSubmissionUseCase } from '../../submissions/MergeSubmissionUseCase.js';
import { ProjectAiSettingsUseCase } from '../ProjectAiSettingsUseCase.js';
import { ProjectDocUseCase } from '../../projectDocs/ProjectDocUseCase.js';
import { PurgeChapterUseCase } from '../../trash/PurgeChapterUseCase.js';
import { RemoveMemberUseCase } from '../../members/RemoveMemberUseCase.js';
import { RestoreChapterUseCase } from '../../trash/RestoreChapterUseCase.js';
import { RevokeBetaShareLinkUseCase } from '../../shareLinks/RevokeBetaShareLinkUseCase.js';
import { RevokeInviteUseCase } from '../../members/RevokeInviteUseCase.js';
import { UpdateActUseCase } from '../../projects/UpdateActUseCase.js';
import { UpdateBetaShareLinkUseCase } from '../../shareLinks/UpdateBetaShareLinkUseCase.js';
import { UpdateChapterUseCase } from '../../projects/UpdateChapterUseCase.js';
import { UpdateCharacterUseCase } from '../../projects/UpdateCharacterUseCase.js';
import { UpdateLocationUseCase } from '../../projects/UpdateLocationUseCase.js';
import { UpdateMemberRoleUseCase } from '../../members/UpdateMemberRoleUseCase.js';
import { UpdateObstacleUseCase } from '../../projects/UpdateObstacleUseCase.js';
import { UpdateProjectUseCase } from '../../projects/UpdateProjectUseCase.js';
import { UpdateStructureUseCase } from '../../projects/UpdateStructureUseCase.js';
import { UploadAssetUseCase } from '../../assets/UploadAssetUseCase.js';
import { WritingUseCase } from '../../writings/WritingUseCase.js';
import { applyContentEdit, bodyOf, countWords, editContentInputSchema, toPrismaDocKind, type ToolContext } from './shared.js';

type ApprovalToolConfig = Tool<any, any>;

export const mutatingToolNames = [
  'updateProject',
  'updateProjectAiSettings',
  'createAct',
  'updateAct',
  'deleteAct',
  'updateCharacter',
  'createCharacter',
  'deleteCharacter',
  'createCharacterRelationship',
  'deleteCharacterRelationship',
  'createLocation',
  'updateLocation',
  'deleteLocation',
  'updateChapter',
  'createChapter',
  'deleteChapter',
  'restoreTrashChapter',
  'purgeTrashChapter',
  'createScene',
  'updateScene',
  'deleteScene',
  'updateStoryStructure',
  'createObstacle',
  'updateObstacle',
  'deleteObstacle',
  'createProjectDoc',
  'updateProjectDoc',
  'deleteProjectDoc',
  'createSubmission',
  'mergeSubmission',
  'declineSubmission',
  'commentSubmission',
  'uploadAsset',
  'attachAsset',
  'detachAsset',
  'updateMemberRole',
  'removeMember',
  'createInvite',
  'revokeInvite',
  'acceptInvite',
  'createBetaShareLink',
  'updateBetaShareLink',
  'revokeBetaShareLink',
  'postBetaShareComment'
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
    ...genericMutationTools(prisma, context, approval),
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
  } as Record<MutatingToolName, Tool<any, any>>;
}

function genericMutationTools(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  approval: ApprovalHandler
): Record<MutatingToolName, Tool<any, any>> {
  return Object.fromEntries(
    mutatingToolNames.map((name) => [
      name,
      approvalTool({
        description: `${name}: approval-gated project mutation. Include the ids and fields required by the matching backend operation.`,
        inputSchema: z.object({}).passthrough(),
        execute: async (input) => approval.handleApproval(name, input, () => executeMutationTool(prisma, context, name, input))
      })
    ])
  ) as Record<MutatingToolName, Tool<any, any>>;
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
  if (toolName === 'updateProject') return updateProject(prisma, context, input);
  if (toolName === 'updateProjectAiSettings') return updateProjectAiSettings(prisma, context, input);
  if (toolName === 'createAct') return createAct(prisma, context, input);
  if (toolName === 'updateAct') return updateAct(prisma, context, input);
  if (toolName === 'deleteAct') return deleteAct(prisma, context, input);
  if (toolName === 'createProjectDoc') return createProjectDoc(prisma, context, input);
  if (toolName === 'updateProjectDoc') return updateProjectDoc(prisma, context, input);
  if (toolName === 'deleteProjectDoc') return deleteProjectDoc(prisma, context, input);
  if (toolName === 'updateChapter') return updateChapter(prisma, context, input);
  if (toolName === 'createChapter') return createChapter(prisma, context, input);
  if (toolName === 'deleteChapter') return deleteChapter(prisma, context, input);
  if (toolName === 'restoreTrashChapter') return restoreTrashChapter(prisma, context, input);
  if (toolName === 'purgeTrashChapter') return purgeTrashChapter(prisma, context, input);
  if (toolName === 'createScene') return createScene(prisma, context, input);
  if (toolName === 'updateScene') return updateScene(prisma, context, input);
  if (toolName === 'deleteScene') return deleteScene(prisma, context, input);
  if (toolName === 'createCharacter') return createCharacter(prisma, context, input);
  if (toolName === 'updateCharacter') return updateCharacter(prisma, context, input);
  if (toolName === 'deleteCharacter') return deleteCharacter(prisma, context, input);
  if (toolName === 'createCharacterRelationship') return createCharacterRelationship(prisma, context, input);
  if (toolName === 'deleteCharacterRelationship') return deleteCharacterRelationship(prisma, context, input);
  if (toolName === 'createLocation') return createLocation(prisma, context, input);
  if (toolName === 'updateLocation') return updateLocation(prisma, context, input);
  if (toolName === 'deleteLocation') return deleteLocation(prisma, context, input);
  if (toolName === 'updateStoryStructure') return updateStoryStructure(prisma, context, input);
  if (toolName === 'createObstacle') return createObstacle(prisma, context, input);
  if (toolName === 'updateObstacle') return updateObstacle(prisma, context, input);
  if (toolName === 'deleteObstacle') return deleteObstacle(prisma, context, input);
  if (toolName === 'createSubmission') return createSubmission(prisma, context, input);
  if (toolName === 'mergeSubmission') return mergeSubmission(prisma, context, input);
  if (toolName === 'declineSubmission') return declineSubmission(prisma, context, input);
  if (toolName === 'commentSubmission') return commentSubmission(prisma, context, input);
  if (toolName === 'uploadAsset') return uploadAsset(prisma, context, input);
  if (toolName === 'attachAsset') return attachAsset(prisma, context, input);
  if (toolName === 'detachAsset') return detachAsset(prisma, context, input);
  if (toolName === 'updateMemberRole') return updateMemberRole(prisma, context, input);
  if (toolName === 'removeMember') return removeMember(prisma, context, input);
  if (toolName === 'createInvite') return createInvite(prisma, context, input);
  if (toolName === 'revokeInvite') return revokeInvite(prisma, context, input);
  if (toolName === 'acceptInvite') return acceptInvite(prisma, context, input);
  if (toolName === 'createBetaShareLink') return createBetaShareLink(prisma, context, input);
  if (toolName === 'updateBetaShareLink') return updateBetaShareLink(prisma, context, input);
  if (toolName === 'revokeBetaShareLink') return revokeBetaShareLink(prisma, context, input);
  if (toolName === 'postBetaShareComment') return postBetaShareComment(prisma, context, input);
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

async function updateProject(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new UpdateProjectUseCase(prisma).execute(context.userId, context.projectId, {
    title: stringOrUndefined(input.title),
    slug: stringOrUndefined(input.slug),
    description: nullableStringOrUndefined(input.description),
    genre: nullableStringOrUndefined(input.genre),
    perspective: nullableStringOrUndefined(input.perspective),
    pov: nullableStringOrUndefined(input.pov),
    voice: nullableStringOrUndefined(input.voice),
    tone: nullableStringOrUndefined(input.tone),
    themes: stringArrayOrUndefined(input.themes),
    visibility: input.visibility === 'public' || input.visibility === 'private' ? input.visibility : undefined,
    coverAssetId: nullableStringOrUndefined(input.coverAssetId),
    coverOrientation: input.coverOrientation === 'portrait' || input.coverOrientation === 'landscape' ? input.coverOrientation : undefined
  } satisfies UpdateProjectInput);
}

async function updateProjectAiSettings(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new ProjectAiSettingsUseCase(prisma).update(context.userId, context.projectId, {
    enabled: booleanOrUndefined(input.enabled),
    providerKind: input.providerKind === 'gateway' || input.providerKind === 'openai-compatible' ? input.providerKind : undefined,
    model: stringOrUndefined(input.model),
    baseUrl: nullableStringOrUndefined(input.baseUrl),
    apiKey: nullableStringOrUndefined(input.apiKey)
  } satisfies UpdateProjectAiSettingsInput);
}

async function createAct(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new CreateActUseCase(prisma).execute(context.userId, context.projectId, { title: requiredString(input.title, 'title') } satisfies CreateActInput);
}

async function updateAct(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new UpdateActUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.actId, 'actId'), {
    title: stringOrUndefined(input.title),
    chapterIds: stringArrayOrUndefined(input.chapterIds)
  } satisfies UpdateActInput);
}

async function deleteAct(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new DeleteActUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.actId, 'actId'));
}

async function deleteProjectDoc(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new ProjectDocUseCase(prisma).delete(context.userId, context.projectId, requiredString(input.docId, 'docId'));
}

async function deleteChapter(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new DeleteChapterUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.chapterId, 'chapterId'));
}

async function restoreTrashChapter(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new RestoreChapterUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.chapterId, 'chapterId'));
}

async function purgeTrashChapter(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new PurgeChapterUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.chapterId, 'chapterId'));
}

async function createLocation(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new CreateLocationUseCase(prisma).execute(context.userId, context.projectId, {
    name: requiredString(input.name, 'name'),
    type: stringOrUndefined(input.type),
    description: stringOrUndefined(input.description),
    atmosphere: stringOrUndefined(input.atmosphere),
    significance: stringOrUndefined(input.significance),
    sensoryDetails: stringOrUndefined(input.sensoryDetails)
  } satisfies CreateLocationInput);
}

async function updateLocation(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new UpdateLocationUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.locationId, 'locationId'), {
    name: stringOrUndefined(input.name),
    type: stringOrUndefined(input.type),
    imageAssetId: nullableStringOrUndefined(input.imageAssetId) as UpdateLocationInput['imageAssetId'],
    description: stringOrUndefined(input.description),
    atmosphere: stringOrUndefined(input.atmosphere),
    significance: stringOrUndefined(input.significance),
    sensoryDetails: stringOrUndefined(input.sensoryDetails)
  } satisfies UpdateLocationInput);
}

async function deleteLocation(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new DeleteLocationUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.locationId, 'locationId'));
}

async function deleteCharacter(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new DeleteCharacterUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.characterId, 'characterId'));
}

async function createCharacterRelationship(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new CreateCharacterRelationshipUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.fromCharacterId, 'fromCharacterId'), {
    toCharacterId: requiredString(input.toCharacterId, 'toCharacterId'),
    type: requiredString(input.type, 'type'),
    note: stringOrUndefined(input.note)
  } satisfies CreateCharacterRelationshipInput);
}

async function deleteCharacterRelationship(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new DeleteCharacterRelationshipUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.fromCharacterId, 'fromCharacterId'), requiredString(input.relationshipId, 'relationshipId'));
}

async function updateStoryStructure(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new UpdateStructureUseCase(prisma).execute(context.userId, context.projectId, {
    title: stringOrUndefined(input.title),
    genre: stringOrUndefined(input.genre),
    perspective: stringOrUndefined(input.perspective),
    pov: stringOrUndefined(input.pov),
    voice: stringOrUndefined(input.voice),
    tone: stringOrUndefined(input.tone),
    themes: stringArrayOrUndefined(input.themes),
    logline: stringOrUndefined(input.logline),
    outline: stringOrUndefined(input.outline),
    climax: stringOrUndefined(input.climax)
  } satisfies UpdateStructureInput);
}

async function createObstacle(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new CreateObstacleUseCase(prisma).execute(context.userId, context.projectId, {
    title: requiredString(input.title, 'title'),
    type: obstacleType(input.type),
    description: stringOrUndefined(input.description),
    resolution: stringOrUndefined(input.resolution)
  } satisfies CreateObstacleInput);
}

async function updateObstacle(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new UpdateObstacleUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.obstacleId, 'obstacleId'), {
    title: stringOrUndefined(input.title),
    type: input.type === undefined ? undefined : obstacleType(input.type),
    description: stringOrUndefined(input.description),
    resolution: stringOrUndefined(input.resolution),
    order: numberOrUndefined(input.order)
  } satisfies UpdateObstacleInput);
}

async function deleteObstacle(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new DeleteObstacleUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.obstacleId, 'obstacleId'));
}

async function createSubmission(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new CreateSubmissionUseCase(prisma).execute(context.userId, context.projectId, {
    kind: input.kind === 'new-chapter' ? 'new-chapter' : 'chapter-edit',
    title: requiredString(input.title, 'title'),
    message: stringOrUndefined(input.message),
    chapterId: stringOrUndefined(input.chapterId),
    body: typeof input.body === 'string' ? input.body : '',
    proposedTitle: stringOrUndefined(input.proposedTitle),
    proposedNumber: numberOrUndefined(input.proposedNumber),
    proposedActId: nullableStringOrUndefined(input.proposedActId)
  } satisfies CreateSubmissionInput);
}

async function mergeSubmission(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new MergeSubmissionUseCase(prisma).execute(context.userId, requiredString(input.submissionId, 'submissionId'));
}

async function declineSubmission(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new DeclineSubmissionUseCase(prisma).execute(context.userId, requiredString(input.submissionId, 'submissionId'));
}

async function commentSubmission(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new AddCommentUseCase(prisma).execute(context.userId, requiredString(input.submissionId, 'submissionId'), {
    body: requiredString(input.body, 'body'),
    anchor: anchorOrUndefined(input.anchor)
  } satisfies AddSubmissionCommentInput);
}

async function createScene(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  await new ProjectAccessRepository(prisma).assertPermission(context.userId, context.projectId, 'project:write');
  const chapterId = requiredString(input.chapterId, 'chapterId');
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, projectId: context.projectId, deletedAt: null }, select: { id: true } });
  if (!chapter) throw new HttpError(404, 'Chapter not found');
  const last = await prisma.scene.findFirst({ where: { chapterId }, orderBy: { order: 'desc' }, select: { order: true } });
  return prisma.$transaction(async (tx) => {
    const bodyWritingId = await new WritingUseCase().createWriting(tx, { projectId: context.projectId, kind: 'SCENE_BODY', body: typeof input.content === 'string' ? input.content : '', authorId: context.userId, message: 'Create scene from AI approval' });
    return tx.scene.create({ data: { chapterId, order: numberOrUndefined(input.order) ?? (last?.order ?? -1) + 1, title: stringOrUndefined(input.title), povCharacterId: stringOrUndefined(input.povCharacterId), locationId: stringOrUndefined(input.locationId), bodyWritingId } });
  });
}

async function updateScene(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  await new ProjectAccessRepository(prisma).assertPermission(context.userId, context.projectId, 'project:write');
  const sceneId = requiredString(input.sceneId, 'sceneId');
  const scene = await prisma.scene.findFirst({ where: { id: sceneId, chapter: { projectId: context.projectId, deletedAt: null } }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } });
  if (!scene) throw new HttpError(404, 'Scene not found');
  return prisma.$transaction(async (tx) => {
    await tx.scene.update({ where: { id: sceneId }, data: { title: nullableStringOrUndefined(input.title) as string | null | undefined, order: numberOrUndefined(input.order), povCharacterId: nullableStringOrUndefined(input.povCharacterId) as string | null | undefined, locationId: nullableStringOrUndefined(input.locationId) as string | null | undefined } });
    const body = isContentEdit(input.contentEdit) ? applyContentEdit(bodyOf(scene.bodyWriting), input.contentEdit) : typeof input.content === 'string' ? input.content : undefined;
    if (body !== undefined) await new WritingUseCase().updateDefaultBranch(tx, { writingId: scene.bodyWritingId, body, authorId: context.userId, message: 'Update scene from AI approval' });
    return tx.scene.findUnique({ where: { id: sceneId } });
  });
}

async function deleteScene(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  await new ProjectAccessRepository(prisma).assertPermission(context.userId, context.projectId, 'project:write');
  const sceneId = requiredString(input.sceneId, 'sceneId');
  return prisma.$transaction(async (tx) => {
    const scene = await tx.scene.findFirst({ where: { id: sceneId, chapter: { projectId: context.projectId } }, select: { id: true, bodyWritingId: true } });
    if (!scene) throw new HttpError(404, 'Scene not found');
    await tx.scene.delete({ where: { id: sceneId } });
    await tx.writing.delete({ where: { id: scene.bodyWritingId } });
    return { id: sceneId, deleted: true };
  });
}

async function attachAsset(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  await new ProjectAccessRepository(prisma).assertPermission(context.userId, context.projectId, 'project:write');
  const assetId = requiredString(input.assetId, 'assetId');
  const asset = await prisma.asset.findFirst({ where: { id: assetId, OR: [{ projectId: context.projectId }, { projectId: null }] }, select: { id: true } });
  if (!asset) throw new HttpError(404, 'Asset not found');
  const entityType = attachmentEntity(input.entityType);
  const entityId = requiredString(input.entityId, 'entityId');
  await assertAttachmentTarget(prisma, context.projectId, entityType, entityId);
  return prisma.assetAttachment.upsert({
    where: { entityType_entityId_role_assetId: { entityType, entityId, role: requiredString(input.role, 'role'), assetId } },
    update: { order: numberOrNull(input.order) },
    create: { assetId, entityType, entityId, role: requiredString(input.role, 'role'), order: numberOrNull(input.order) }
  });
}

async function uploadAsset(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new UploadAssetUseCase(prisma).execute(context.userId, context.projectId, {
    kind: assetKind(input.kind),
    filename: requiredString(input.filename, 'filename'),
    mimeType: requiredString(input.mimeType, 'mimeType'),
    buffer: Buffer.from(requiredString(input.base64, 'base64'), 'base64')
  });
}

async function detachAsset(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  await new ProjectAccessRepository(prisma).assertPermission(context.userId, context.projectId, 'project:write');
  const attachmentId = requiredString(input.attachmentId, 'attachmentId');
  const attachment = await prisma.assetAttachment.findFirst({ where: { id: attachmentId, asset: { OR: [{ projectId: context.projectId }, { projectId: null }] } } });
  if (!attachment) throw new HttpError(404, 'Asset attachment not found');
  await prisma.assetAttachment.delete({ where: { id: attachmentId } });
  return { id: attachmentId, deleted: true };
}

async function updateMemberRole(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  await new UpdateMemberRoleUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.userId, 'userId'), role(input.role));
  return { userId: requiredString(input.userId, 'userId'), role: role(input.role) };
}

async function removeMember(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  await new RemoveMemberUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.userId, 'userId'));
  return { userId: requiredString(input.userId, 'userId'), removed: true };
}

async function createInvite(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new CreateInviteUseCase(prisma).execute(context.userId, context.projectId, { username: stringOrUndefined(input.username), email: stringOrUndefined(input.email), role: role(input.role) } satisfies CreateInviteInput);
}

async function revokeInvite(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  await new RevokeInviteUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.inviteId, 'inviteId'));
  return { inviteId: requiredString(input.inviteId, 'inviteId'), revoked: true };
}

async function acceptInvite(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new AcceptInviteUseCase(prisma).execute(context.userId, requiredString(input.token, 'token'));
}

async function createBetaShareLink(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new CreateBetaShareLinkUseCase(prisma).execute(context.userId, context.projectId, { label: stringOrUndefined(input.label), expiresAt: nullableStringOrUndefined(input.expiresAt), allowComments: booleanOrUndefined(input.allowComments), chapterIds: stringArrayOrUndefined(input.chapterIds) } satisfies CreateBetaShareLinkInput);
}

async function updateBetaShareLink(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new UpdateBetaShareLinkUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.shareLinkId, 'shareLinkId'), { label: nullableStringOrUndefined(input.label), expiresAt: nullableStringOrUndefined(input.expiresAt), allowComments: booleanOrUndefined(input.allowComments), chapterIds: stringArrayOrUndefined(input.chapterIds) } satisfies UpdateBetaShareLinkInput);
}

async function revokeBetaShareLink(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new RevokeBetaShareLinkUseCase(prisma).execute(context.userId, context.projectId, requiredString(input.shareLinkId, 'shareLinkId'));
}

async function postBetaShareComment(prisma: PrismaClient, _context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new AddBetaShareCommentUseCase(prisma).execute(requiredString(input.token, 'token'), { visitorName: requiredString(input.visitorName, 'visitorName'), body: requiredString(input.body, 'body'), chapterId: nullableStringOrUndefined(input.chapterId), lineStart: numberOrNull(input.lineStart), lineEnd: numberOrNull(input.lineEnd) } satisfies CreateBetaShareCommentInput);
}

function requiredString(value: unknown, name: string): string {
  const string = stringOrUndefined(value);
  if (!string) throw new HttpError(400, `${name} is required`);
  return string;
}

function nullableStringOrUndefined(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function obstacleType(value: unknown): 'internal' | 'external' | 'interpersonal' {
  if (value === 'internal' || value === 'external' || value === 'interpersonal') return value;
  throw new HttpError(400, 'type must be internal, external, or interpersonal');
}

function role(value: unknown): Role {
  if (value === 'OWNER' || value === 'ADMIN' || value === 'EDITOR' || value === 'VIEWER') return value;
  throw new HttpError(400, 'role must be OWNER, ADMIN, EDITOR, or VIEWER');
}

function attachmentEntity(value: unknown): AttachmentEntity {
  if (value === 'CHARACTER' || value === 'LOCATION' || value === 'CHAPTER' || value === 'SCENE' || value === 'PROJECT' || value === 'WRITING_VERSION' || value === 'USER') return value;
  throw new HttpError(400, 'Unsupported attachment entity type');
}

function assetKind(value: unknown): 'image' | 'audio' | 'video' | 'document' {
  if (value === 'image' || value === 'audio' || value === 'video' || value === 'document') return value;
  throw new HttpError(400, 'kind must be image, audio, video, or document');
}

function anchorOrUndefined(value: unknown): AddSubmissionCommentInput['anchor'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const side = input.side;
  if (side !== 'base' && side !== 'head') return undefined;
  const lineStart = numberOrUndefined(input.lineStart);
  const lineEnd = numberOrUndefined(input.lineEnd);
  if (!lineStart || !lineEnd) return undefined;
  return { side, lineStart, lineEnd };
}

async function assertAttachmentTarget(prisma: PrismaClient, projectId: string, entityType: AttachmentEntity, entityId: string) {
  const exists =
    entityType === 'PROJECT' ? await prisma.project.findFirst({ where: { id: entityId, AND: { id: projectId } }, select: { id: true } }) :
    entityType === 'CHARACTER' ? await prisma.character.findFirst({ where: { id: entityId, projectId }, select: { id: true } }) :
    entityType === 'LOCATION' ? await prisma.location.findFirst({ where: { id: entityId, projectId }, select: { id: true } }) :
    entityType === 'CHAPTER' ? await prisma.chapter.findFirst({ where: { id: entityId, projectId }, select: { id: true } }) :
    entityType === 'SCENE' ? await prisma.scene.findFirst({ where: { id: entityId, chapter: { projectId } }, select: { id: true } }) :
    entityType === 'WRITING_VERSION' ? await prisma.writingVersion.findFirst({ where: { id: entityId, branch: { writing: { projectId } } }, select: { id: true } }) :
    await prisma.user.findFirst({ where: { id: entityId }, select: { id: true } });
  if (!exists) throw new HttpError(404, 'Attachment target not found');
}
