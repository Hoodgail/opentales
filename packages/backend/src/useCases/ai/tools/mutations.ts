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
  CreateSceneInput,
  ReorderScenesInput,
  UpdateActInput,
  UpdateBetaShareLinkInput,
  UpdateChapterInput,
  UpdateCharacterInput,
  UpdateCharacterRelationshipInput,
  UpdateLocationInput,
  UpdateObstacleInput,
  UpdateProjectAiSettingsInput,
  UpdateProjectInput,
  UpdateStructureInput,
  UpdateSceneInput,
  UpdateSubmissionInput
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
import { CompileChapterScenesUseCase } from '../../projects/CompileChapterScenesUseCase.js';
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
import { UpdateSubmissionUseCase } from '../../submissions/UpdateSubmissionUseCase.js';
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
import { UpdateCharacterRelationshipUseCase } from '../../projects/UpdateCharacterRelationshipUseCase.js';
import { UpdateLocationUseCase } from '../../projects/UpdateLocationUseCase.js';
import { UpdateMemberRoleUseCase } from '../../members/UpdateMemberRoleUseCase.js';
import { UpdateObstacleUseCase } from '../../projects/UpdateObstacleUseCase.js';
import { UpdateProjectUseCase } from '../../projects/UpdateProjectUseCase.js';
import { UpdateStructureUseCase } from '../../projects/UpdateStructureUseCase.js';
import { SceneUseCase } from '../../projects/SceneUseCase.js';
import { UploadAssetUseCase } from '../../assets/UploadAssetUseCase.js';
import { ProjectAssetUseCase } from '../../assets/ProjectAssetUseCase.js';
import { ProjectFolderUseCase } from '../../projectFiles/ProjectFolderUseCase.js';
import { WritingUseCase } from '../../writings/WritingUseCase.js';
import { ApplyStoryPatchUseCase } from '../../writings/ApplyStoryPatchUseCase.js';
import { applyContentPatch, bodyOf, contentPatchInputSchema, countWords, editContentInputSchema, invocationToolCallId, toPrismaDocKind, type AgentToolInvocationContext, type ToolContext } from './shared.js';

type ApprovalToolConfig = Tool<any, any>;

const nonEmptyString = z.string().trim().min(1);
const optionalString = z.string().optional();
const nullableString = z.string().nullable().optional();
const stringArray = z.array(z.string());
const chapterStatusSchema = z.enum(['draft', 'in-progress', 'review', 'final']);
const docKindSchema = z.enum(['note', 'brainstorm', 'instructions', 'reference', 'other']);
const roleSchema = z.enum(['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']);
const obstacleTypeSchema = z.enum(['internal', 'external', 'interpersonal']);
const assetKindSchema = z.enum(['image', 'audio', 'video', 'document']);
const attachmentEntitySchema = z.enum(['CHARACTER', 'LOCATION', 'CHAPTER', 'SCENE', 'PROJECT', 'WRITING_VERSION', 'USER']);
const questionOptionSchema = z.object({
  label: nonEmptyString.describe('Display text for this answer choice, ideally 1-5 words'),
  description: optionalString.describe('Short explanation of this choice'),
  recommended: z.boolean().optional().describe('Set true when this is the recommended answer')
});
const questionPromptSchema = z.object({
  question: nonEmptyString.describe('The complete question to ask the user'),
  header: nonEmptyString.max(30).describe('Very short label for the question, max 30 characters'),
  options: z.array(questionOptionSchema).min(1).describe('Available answer choices'),
  multiple: z.boolean().optional().describe('Allow selecting multiple choices'),
  custom: z.boolean().optional().describe('Allow typing a custom answer; defaults to true in the UI')
});
const contentEditSchema = editContentInputSchema;
const manuscriptContentSchema = z.string().max(2_000_000);
const expectedHeadVersionIdSchema = z.string().trim().min(1).nullable();
const sceneStatusSchema = z.enum(['planned', 'draft', 'in-progress', 'review', 'revised', 'final']);
const sceneJsonSchema = z.unknown().nullable().optional();
const sceneMetadataShape = {
  status: sceneStatusSchema.optional(),
  storyDate: nullableString,
  storyTime: nullableString,
  estimatedWordCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  tension: z.number().min(0).max(1).nullable().optional(),
  sceneFunction: optionalString,
  goal: optionalString,
  obstacle: optionalString,
  stakes: optionalString,
  conflict: optionalString,
  turn: optionalString,
  revelation: optionalString,
  outcome: optionalString,
  emotionalValueShift: optionalString,
  characterPresentIds: stringArray.optional(),
  characterReferencedIds: stringArray.optional(),
  plotThreadIds: stringArray.optional(),
  setupPayoffIds: stringArray.optional(),
  knowledgeDeltas: sceneJsonSchema,
  objectTransfers: sceneJsonSchema,
  injuryStateChanges: sceneJsonSchema,
  worldRuleRefs: sceneJsonSchema,
  entryState: sceneJsonSchema,
  exitState: sceneJsonSchema,
  summary: optionalString,
  writerNotes: optionalString,
  aiNotes: optionalString
} as const;

function withAtLeastOne<T extends z.ZodRawShape>(schema: z.ZodObject<T>, fields: Array<keyof T>) {
  return schema.refine((input) => fields.some((field) => (input as Record<PropertyKey, unknown>)[field] !== undefined), {
    message: `At least one of ${fields.map(String).join(', ')} is required`
  });
}

function validateContentMutation(
  input: Record<string, unknown>,
  ctx: z.RefinementCtx
): void {
  const supplied = [input.content !== undefined, input.contentEdit !== undefined, input.contentEdits !== undefined]
    .filter(Boolean).length;
  if (supplied > 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'content, contentEdit, and contentEdits are mutually exclusive',
      path: ['content']
    });
  }
  if (supplied > 0 && !Object.prototype.hasOwnProperty.call(input, 'expectedHeadVersionId')) {
    ctx.addIssue({
      code: 'custom',
      message: 'expectedHeadVersionId is required for content changes; read the target first and copy its current headVersionId',
      path: ['expectedHeadVersionId']
    });
  }
}

export const mutatingToolNames = [
  'askUser',
  'updateProject',
  'updateProjectAiSettings',
  'applyStoryPatch',
  'createAct',
  'updateAct',
  'deleteAct',
  'updateCharacter',
  'createCharacter',
  'deleteCharacter',
  'createCharacterRelationship',
  'updateCharacterRelationship',
  'deleteCharacterRelationship',
  'createLocation',
  'updateLocation',
  'deleteLocation',
  'updateChapter',
  'createChapter',
  'compileChapterFromScenes',
  'deleteChapter',
  'restoreTrashChapter',
  'purgeTrashChapter',
  'createScene',
  'updateScene',
  'reorderScenes',
  'deleteScene',
  'updateStoryStructure',
  'createObstacle',
  'updateObstacle',
  'deleteObstacle',
  'createProjectDoc',
  'updateProjectDoc',
  'deleteProjectDoc',
  'createFolder',
  'updateFolder',
  'deleteFolder',
  'createSubmission',
  'updateSubmission',
  'mergeSubmission',
  'declineSubmission',
  'commentSubmission',
  'uploadAsset',
  'updateAsset',
  'deleteAsset',
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

export const mutationToolSchemas = {
  askUser: z.object({
    questions: z.array(questionPromptSchema).min(1).max(5).describe('Questions to ask the user before continuing')
  }),
  updateProject: withAtLeastOne(z.object({
    title: optionalString,
    slug: optionalString,
    description: nullableString,
    genre: nullableString,
    perspective: nullableString,
    pov: nullableString,
    voice: nullableString,
    tone: nullableString,
    themes: stringArray.optional(),
    visibility: z.enum(['private', 'public']).optional(),
    coverAssetId: nullableString,
    coverOrientation: z.enum(['landscape', 'portrait']).optional()
  }), ['title', 'slug', 'description', 'genre', 'perspective', 'pov', 'voice', 'tone', 'themes', 'visibility', 'coverAssetId', 'coverOrientation']),
  updateProjectAiSettings: withAtLeastOne(z.object({
    enabled: z.boolean().optional(),
    providerKind: z.enum(['gateway', 'openai-compatible', 'github-copilot', 'codex']).optional(),
    model: optionalString,
    baseUrl: nullableString,
    apiKey: nullableString
  }), ['enabled', 'providerKind', 'model', 'baseUrl', 'apiKey']),
  applyStoryPatch: z.object({
    idempotencyKey: nonEmptyString.describe('Unique key for this logical patch. Reusing it with identical input safely replays the receipt.'),
    operations: z.array(z.object({
      target: z.enum(['chapter', 'scene', 'project-doc', 'submission']),
      id: nonEmptyString,
      expectedHeadVersionId: expectedHeadVersionIdSchema,
      expectedRevision: z.number().int().nonnegative().optional(),
      patch: contentPatchInputSchema,
      message: z.string().trim().min(1).max(1_000).optional()
    }).strict().superRefine((operation, ctx) => {
      if (operation.target === 'scene' && operation.expectedRevision === undefined) {
        ctx.addIssue({ code: 'custom', message: 'expectedRevision is required for scene patches', path: ['expectedRevision'] });
      }
      if (operation.target !== 'scene' && operation.expectedRevision !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'expectedRevision applies only to scene patches', path: ['expectedRevision'] });
      }
    })).min(1).max(50)
  }).strict(),
  createAct: z.object({ title: nonEmptyString }),
  updateAct: withAtLeastOne(z.object({ actId: nonEmptyString, title: optionalString, chapterIds: stringArray.optional() }), ['title', 'chapterIds']),
  deleteAct: z.object({ actId: nonEmptyString }),
  updateCharacter: withAtLeastOne(z.object({
    characterId: nonEmptyString,
    name: optionalString,
    role: optionalString,
    age: optionalString,
    occupation: optionalString,
    traits: stringArray.optional(),
    aliases: stringArray.optional(),
    description: optionalString,
    appearance: optionalString,
    motivation: optionalString,
    arc: optionalString
  }), ['name', 'role', 'age', 'occupation', 'traits', 'aliases', 'description', 'appearance', 'motivation', 'arc']),
  createCharacter: z.object({
    name: nonEmptyString,
    role: optionalString,
    age: optionalString,
    occupation: optionalString,
    traits: stringArray.optional(),
    aliases: stringArray.optional(),
    description: optionalString,
    appearance: optionalString,
    motivation: optionalString,
    arc: optionalString
  }),
  deleteCharacter: z.object({ characterId: nonEmptyString }),
  createCharacterRelationship: z.object({
    fromCharacterId: nonEmptyString.describe('ID of the source character whose relationship list receives this entry'),
    toCharacterId: nonEmptyString.describe('ID of the related character'),
    type: nonEmptyString.describe('Relationship label, such as "creator / creation", "mentor", or "operator / asset"'),
    note: optionalString.describe('Short explanation of the relationship')
  }),
  updateCharacterRelationship: withAtLeastOne(z.object({
    fromCharacterId: nonEmptyString,
    relationshipId: nonEmptyString,
    toCharacterId: nonEmptyString.optional(),
    type: nonEmptyString.optional(),
    note: nullableString
  }), ['toCharacterId', 'type', 'note']),
  deleteCharacterRelationship: z.object({ fromCharacterId: nonEmptyString, relationshipId: nonEmptyString }),
  createLocation: z.object({ name: nonEmptyString, aliases: stringArray.optional(), type: optionalString, description: optionalString, atmosphere: optionalString, significance: optionalString, sensoryDetails: optionalString }),
  updateLocation: withAtLeastOne(z.object({ locationId: nonEmptyString, name: optionalString, aliases: stringArray.optional(), type: optionalString, imageAssetId: nullableString, description: optionalString, atmosphere: optionalString, significance: optionalString, sensoryDetails: optionalString }), ['name', 'aliases', 'type', 'imageAssetId', 'description', 'atmosphere', 'significance', 'sensoryDetails']),
  deleteLocation: z.object({ locationId: nonEmptyString }),
  updateChapter: withAtLeastOne(z.object({
    chapterId: nonEmptyString,
    title: optionalString,
    summary: optionalString,
    status: chapterStatusSchema.optional(),
    povCharacterId: nullableString,
    locationId: nullableString,
    publishedAt: z.string().datetime().nullable().optional(),
    expectedHeadVersionId: expectedHeadVersionIdSchema.optional(),
    content: manuscriptContentSchema.optional(),
    contentEdit: contentEditSchema.optional(),
    contentEdits: z.array(contentEditSchema).min(1).max(100).optional()
  }).strict(), ['title', 'summary', 'status', 'povCharacterId', 'locationId', 'publishedAt', 'content', 'contentEdit', 'contentEdits']).superRefine(validateContentMutation),
  createChapter: z.object({ title: nonEmptyString, actId: optionalString, summary: optionalString, content: manuscriptContentSchema.optional(), status: chapterStatusSchema.optional(), povCharacterId: optionalString, locationId: optionalString }),
  compileChapterFromScenes: z.object({
    chapterId: nonEmptyString,
    idempotencyKey: nonEmptyString,
    expectedChapterHeadVersionId: expectedHeadVersionIdSchema,
    expectedSceneRevisions: z.record(z.string(), z.number().int().nonnegative()),
    separator: z.string().max(1_000).optional(),
    message: z.string().trim().min(1).max(1_000).optional()
  }).strict(),
  deleteChapter: z.object({ chapterId: nonEmptyString }),
  restoreTrashChapter: z.object({ chapterId: nonEmptyString }),
  purgeTrashChapter: z.object({ chapterId: nonEmptyString }),
  createScene: z.object({ chapterId: nonEmptyString, title: optionalString, content: manuscriptContentSchema.optional(), order: z.number().int().min(0).optional(), povCharacterId: nullableString, locationId: nullableString, ...sceneMetadataShape }),
  updateScene: withAtLeastOne(z.object({
    sceneId: nonEmptyString,
    expectedRevision: z.number().int().nonnegative(),
    expectedHeadVersionId: expectedHeadVersionIdSchema.optional(),
    title: nullableString,
    content: manuscriptContentSchema.optional(),
    contentEdit: contentEditSchema.optional(),
    contentEdits: z.array(contentEditSchema).min(1).max(100).optional(),
    order: z.number().int().min(0).optional(),
    povCharacterId: nullableString,
    locationId: nullableString,
    ...sceneMetadataShape
  }).strict(), ['title', 'content', 'contentEdit', 'contentEdits', 'order', 'povCharacterId', 'locationId', ...Object.keys(sceneMetadataShape) as Array<keyof typeof sceneMetadataShape>]).superRefine(validateContentMutation),
  reorderScenes: z.object({
    chapterId: nonEmptyString,
    sceneIds: z.array(nonEmptyString).min(1),
    expectedRevisions: z.record(z.string(), z.number().int().nonnegative()),
    buildRunId: nonEmptyString.optional()
  }).strict(),
  deleteScene: z.object({ sceneId: nonEmptyString, expectedRevision: z.number().int().nonnegative() }).strict(),
  updateStoryStructure: withAtLeastOne(z.object({ title: optionalString, genre: optionalString, perspective: optionalString, pov: optionalString, voice: optionalString, tone: optionalString, themes: stringArray.optional(), logline: optionalString, outline: optionalString, climax: optionalString }), ['title', 'genre', 'perspective', 'pov', 'voice', 'tone', 'themes', 'logline', 'outline', 'climax']),
  createObstacle: z.object({ title: nonEmptyString, type: obstacleTypeSchema, description: optionalString, resolution: optionalString }),
  updateObstacle: withAtLeastOne(z.object({ obstacleId: nonEmptyString, title: optionalString, type: obstacleTypeSchema.optional(), description: optionalString, resolution: optionalString, order: z.number().optional() }), ['title', 'type', 'description', 'resolution', 'order']),
  deleteObstacle: z.object({ obstacleId: nonEmptyString }),
  createProjectDoc: z.object({ title: nonEmptyString, folderId: nullableString, kind: docKindSchema.optional(), content: manuscriptContentSchema.optional() }),
  updateProjectDoc: withAtLeastOne(z.object({
    docId: nonEmptyString,
    title: optionalString,
    folderId: nullableString,
    kind: docKindSchema.optional(),
    expectedHeadVersionId: expectedHeadVersionIdSchema.optional(),
    content: manuscriptContentSchema.optional(),
    contentEdit: contentEditSchema.optional(),
    contentEdits: z.array(contentEditSchema).min(1).max(100).optional()
  }).strict(), ['title', 'folderId', 'kind', 'content', 'contentEdit', 'contentEdits']).superRefine(validateContentMutation),
  deleteProjectDoc: z.object({ docId: nonEmptyString }),
  createFolder: z.object({ name: nonEmptyString, parentFolderId: nullableString }),
  updateFolder: withAtLeastOne(z.object({ folderId: nonEmptyString, name: optionalString, parentFolderId: nullableString }), ['name', 'parentFolderId']),
  deleteFolder: z.object({ folderId: nonEmptyString }),
  createSubmission: z.object({ kind: z.enum(['chapter-edit', 'new-chapter']).optional(), title: nonEmptyString, message: optionalString, chapterId: optionalString, body: z.string().max(2_000_000), proposedTitle: optionalString, proposedNumber: z.number().optional(), proposedActId: nullableString }),
  updateSubmission: withAtLeastOne(z.object({
    submissionId: nonEmptyString,
    expectedHeadVersionId: expectedHeadVersionIdSchema,
    title: optionalString,
    message: nullableString,
    proposedTitle: optionalString,
    proposedNumber: z.number().int().positive().nullable().optional(),
    proposedActId: nullableString,
    content: manuscriptContentSchema.optional(),
    contentEdit: contentEditSchema.optional(),
    contentEdits: z.array(contentEditSchema).min(1).max(100).optional()
  }).strict(), ['title', 'message', 'proposedTitle', 'proposedNumber', 'proposedActId', 'content', 'contentEdit', 'contentEdits']).superRefine(validateContentMutation),
  mergeSubmission: z.object({
    submissionId: nonEmptyString,
    expectedMainHeadVersionId: expectedHeadVersionIdSchema,
    confirm: z.literal(true)
  }).strict(),
  declineSubmission: z.object({ submissionId: nonEmptyString }),
  commentSubmission: z.object({ submissionId: nonEmptyString, body: nonEmptyString, anchor: z.object({ side: z.enum(['base', 'head']), lineStart: z.number(), lineEnd: z.number() }).optional() }),
  uploadAsset: z.object({ kind: assetKindSchema, filename: nonEmptyString, mimeType: nonEmptyString, base64: nonEmptyString, folderId: nullableString, name: optionalString }),
  updateAsset: withAtLeastOne(z.object({ assetId: nonEmptyString, name: optionalString, folderId: nullableString }), ['name', 'folderId']),
  deleteAsset: z.object({ assetId: nonEmptyString }).strict(),
  attachAsset: z.object({ assetId: nonEmptyString, entityType: attachmentEntitySchema, entityId: nonEmptyString, role: nonEmptyString, order: z.number().optional() }),
  detachAsset: z.object({ attachmentId: nonEmptyString }),
  updateMemberRole: z.object({ userId: nonEmptyString, role: roleSchema }),
  removeMember: z.object({ userId: nonEmptyString }),
  createInvite: z.object({ username: optionalString, email: optionalString, role: roleSchema.default('VIEWER') }).refine((input) => Boolean(input.username || input.email), { message: 'username or email is required' }),
  revokeInvite: z.object({ inviteId: nonEmptyString }),
  acceptInvite: z.object({ token: nonEmptyString }),
  createBetaShareLink: z.object({ label: optionalString, expiresAt: nullableString, allowComments: z.boolean().optional(), chapterIds: stringArray.optional() }),
  updateBetaShareLink: withAtLeastOne(z.object({ shareLinkId: nonEmptyString, label: nullableString, expiresAt: nullableString, allowComments: z.boolean().optional(), chapterIds: stringArray.optional() }), ['label', 'expiresAt', 'allowComments', 'chapterIds']),
  revokeBetaShareLink: z.object({ shareLinkId: nonEmptyString }),
  postBetaShareComment: z.object({ token: nonEmptyString, visitorName: nonEmptyString, body: nonEmptyString, chapterId: nullableString, lineStart: z.number().optional(), lineEnd: z.number().optional() })
} satisfies Record<MutatingToolName, z.ZodTypeAny>;

const mutationToolDescriptions = {
  askUser: 'Ask the user one or more multiple-choice questions and wait for their answers before continuing. Include concise options; mark recommended choices with recommended:true when appropriate. The UI also allows custom answers.',
  updateProject: 'Update project metadata. Include at least one metadata field to change.',
  updateProjectAiSettings: 'Update project AI settings. Include at least one setting to change.',
  applyStoryPatch: 'Atomically patch up to 50 chapter, scene, project-doc, or open-submission bodies. Read every target first, pass its headVersionId (and scene revision), then use mode=replace for a complete body including empty text or mode=edit for ordered exact replacements. The idempotency key makes retries safe.',
  createAct: 'Create an act. Requires title.',
  updateAct: 'Update an act. Requires actId and at least title or chapterIds.',
  deleteAct: 'Delete an act. Requires actId.',
  updateCharacter: 'Update a character. Requires characterId and at least one character field to change.',
  createCharacter: 'Create a character. Requires name.',
  deleteCharacter: 'Delete a character. Requires characterId.',
  createCharacterRelationship: 'Create a relationship between two existing characters. Requires fromCharacterId, toCharacterId, and type; note is optional.',
  updateCharacterRelationship: 'Update the target, type, or note of an existing character relationship.',
  deleteCharacterRelationship: 'Delete a character relationship. Requires fromCharacterId and relationshipId.',
  createLocation: 'Create a location. Requires name.',
  updateLocation: 'Update a location. Requires locationId and at least one location field to change.',
  deleteLocation: 'Delete a location. Requires locationId.',
  updateChapter: 'Update chapter metadata or prose. For prose, readChapter first, pass its headVersionId as expectedHeadVersionId, then use content for a full replacement (including an empty draft) or contentEdit/contentEdits for exact replacements.',
  createChapter: 'Create a chapter. Requires title.',
  compileChapterFromScenes: 'Deterministically replace one chapter body with all of its ordered scene bodies. Read the chapter and list/read every scene first, then provide the chapter head and complete scene revision map. Identical retries are idempotent.',
  deleteChapter: 'Delete a chapter. Requires chapterId.',
  restoreTrashChapter: 'Restore a trashed chapter. Requires chapterId.',
  purgeTrashChapter: 'Permanently delete a trashed chapter. Requires chapterId.',
  createScene: 'Create a scene in a chapter. Requires chapterId.',
  updateScene: 'Update scene metadata or prose with optimistic concurrency. Requires sceneId and the revision from readScene; prose also requires its headVersionId.',
  reorderScenes: 'Atomically reorder every scene in a chapter. Requires the complete ordered sceneIds list and each revision returned by listScenes/readScene.',
  deleteScene: 'Delete a scene using the revision returned by readScene.',
  updateStoryStructure: 'Update story structure fields. Include at least one field to change.',
  createObstacle: 'Create an obstacle. Requires title and type.',
  updateObstacle: 'Update an obstacle. Requires obstacleId and at least one obstacle field to change.',
  deleteObstacle: 'Delete an obstacle. Requires obstacleId.',
  createProjectDoc: 'Create a project document. Requires title.',
  updateProjectDoc: 'Update document metadata or prose. For prose, readProjectDoc first and use its headVersionId with a full content replacement or exact contentEdit/contentEdits.',
  deleteProjectDoc: 'Delete a project document. Requires docId.',
  createFolder: 'Create a folder. Requires name; parentFolderId is optional.',
  updateFolder: 'Rename or move a folder. Requires folderId and at least name or parentFolderId.',
  deleteFolder: 'Delete a folder and its child folders. Requires folderId.',
  createSubmission: 'Create a draft submission. Requires title and body.',
  updateSubmission: 'Edit an existing open submission in place instead of opening a duplicate. Read it first, pass headVersionId as expectedHeadVersionId, then update metadata and/or its proposed body.',
  mergeSubmission: 'Merge an open submission into canonical main with confirm=true and the current chapter head from readChapter/listChapters. Use null for a new-chapter proposal. Stale canonical heads fail without writing.',
  declineSubmission: 'Decline a submission. Requires submissionId.',
  commentSubmission: 'Comment on a submission. Requires submissionId and body.',
  uploadAsset: 'Upload an asset from base64 data. Requires kind, filename, mimeType, and base64.',
  updateAsset: 'Rename or move an asset in the project file tree. Requires assetId and name or folderId.',
  deleteAsset: 'Delete a project asset and its stored bytes. Requires assetId.',
  attachAsset: 'Attach an existing asset. Requires assetId, entityType, entityId, and role.',
  detachAsset: 'Detach an asset attachment. Requires attachmentId.',
  updateMemberRole: 'Update a project member role. Requires userId and role.',
  removeMember: 'Remove a project member. Requires userId.',
  createInvite: 'Create a project invite. Requires username or email; role defaults to VIEWER.',
  revokeInvite: 'Revoke an invite. Requires inviteId.',
  acceptInvite: 'Accept an invite. Requires token.',
  createBetaShareLink: 'Create a beta share link. All fields are optional.',
  updateBetaShareLink: 'Update a beta share link. Requires shareLinkId and at least one field to change.',
  revokeBetaShareLink: 'Revoke a beta share link. Requires shareLinkId.',
  postBetaShareComment: 'Post a beta-reader comment. Requires token, visitorName, and body.'
} satisfies Record<MutatingToolName, string>;

export interface ApprovalHandler {
  handleApproval(toolName: MutatingToolName, input: unknown, execute: () => Promise<unknown>, toolCallId: string, abortSignal?: AbortSignal): Promise<unknown>;
}

export interface QuestionHandler {
  handleQuestion(toolName: 'askUser', input: unknown, toolCallId: string, abortSignal?: AbortSignal): Promise<unknown>;
}

export function mutationTools(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  approval: ApprovalHandler,
  question: QuestionHandler
) {
  return {
    ...genericMutationTools(prisma, context, approval),
    askUser: approvalTool({
      description:
        'Ask the user one or more questions and wait for answers before continuing. Provide answer choices, mark recommended answers when useful, and rely on the UI for custom answers.',
      inputSchema: mutationToolSchemas.askUser,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = validateMutationInput('askUser', input);
        return question.handleQuestion('askUser', validated, invocationToolCallId(options), options?.abortSignal);
      }
    }),
    updateCharacter: approvalTool({
      description:
        'Update an existing character. Only `characterId` is required; include only fields to change. The user will approve/reject the proposal in the UI.',
      inputSchema: mutationToolSchemas.updateCharacter,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = validateMutationInput('updateCharacter', input);
        return approval.handleApproval('updateCharacter', validated, () => executeMutationTool(prisma, context, 'updateCharacter', validated), invocationToolCallId(options), options?.abortSignal);
      }
    }),
    createCharacter: approvalTool({
      description:
        'Create a new character. Only `name` is required. The user will approve/reject the proposal in the UI.',
      inputSchema: mutationToolSchemas.createCharacter,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = validateMutationInput('createCharacter', input);
        return approval.handleApproval('createCharacter', validated, () => executeMutationTool(prisma, context, 'createCharacter', validated), invocationToolCallId(options), options?.abortSignal);
      }
    }),
    updateChapter: approvalTool({
      description:
        'Update chapter metadata or prose. Read the chapter first. For prose, pass its headVersionId and either exact contentEdit/contentEdits or a full content replacement; full replacement works when the current body is empty.',
      inputSchema: mutationToolSchemas.updateChapter,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = validateMutationInput('updateChapter', input);
        return approval.handleApproval('updateChapter', validated, () => executeMutationTool(prisma, context, 'updateChapter', validated), invocationToolCallId(options), options?.abortSignal);
      }
    }),
    createChapter: approvalTool({
      description:
        'Create a new chapter. Only `title` is required; everything else is optional. The user will approve/reject the proposal in the UI.',
      inputSchema: mutationToolSchemas.createChapter,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = validateMutationInput('createChapter', input);
        return approval.handleApproval('createChapter', validated, () => executeMutationTool(prisma, context, 'createChapter', validated), invocationToolCallId(options), options?.abortSignal);
      }
    }),
    createProjectDoc: approvalTool({
      description:
        'Create a new project document (note, brainstorm, instruction, or reference). Only `title` is required. The user will approve/reject the proposal in the UI.',
      inputSchema: mutationToolSchemas.createProjectDoc,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = validateMutationInput('createProjectDoc', input);
        return approval.handleApproval('createProjectDoc', validated, () => executeMutationTool(prisma, context, 'createProjectDoc', validated), invocationToolCallId(options), options?.abortSignal);
      }
    }),
    updateProjectDoc: approvalTool({
      description:
        'Update document metadata or prose. Read the document first. For prose, pass its headVersionId and either exact contentEdit/contentEdits or a full content replacement; full replacement works when the body is empty.',
      inputSchema: mutationToolSchemas.updateProjectDoc,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = validateMutationInput('updateProjectDoc', input);
        return approval.handleApproval('updateProjectDoc', validated, () => executeMutationTool(prisma, context, 'updateProjectDoc', validated), invocationToolCallId(options), options?.abortSignal);
      }
    }),
    createFolder: approvalTool({
      description: 'Create a new project folder. Folder names are unique among folders, docs, and assets in the same parent folder.',
      inputSchema: mutationToolSchemas.createFolder,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = validateMutationInput('createFolder', input);
        return approval.handleApproval('createFolder', validated, () => executeMutationTool(prisma, context, 'createFolder', validated), invocationToolCallId(options), options?.abortSignal);
      }
    }),
    updateFolder: approvalTool({
      description: 'Rename or move a project folder. The user will approve/reject the proposal in the UI.',
      inputSchema: mutationToolSchemas.updateFolder,
      execute: async (input, options?: AgentToolInvocationContext) => {
        const validated = validateMutationInput('updateFolder', input);
        return approval.handleApproval('updateFolder', validated, () => executeMutationTool(prisma, context, 'updateFolder', validated), invocationToolCallId(options), options?.abortSignal);
      }
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
        description: `${name}: ${mutationToolDescriptions[name]} The user will approve/reject the proposal in the UI.`,
        inputSchema: mutationToolSchemas[name],
        execute: async (input, options?: AgentToolInvocationContext) => {
          const validated = validateMutationInput(name, input);
          return approval.handleApproval(name, validated, () => executeMutationTool(prisma, context, name, validated), invocationToolCallId(options), options?.abortSignal);
        }
      })
    ])
  ) as Record<MutatingToolName, Tool<any, any>>;
}

function validateMutationInput(toolName: MutatingToolName, input: unknown): Record<string, unknown> {
  if (toolName === 'createBetaShareLink' && (input === undefined || input === null)) return {};
  const parsed = mutationToolSchemas[toolName].safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => {
      const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    }).join('; ');
    throw new HttpError(400, `${toolName} input is invalid: ${message}`);
  }
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) return {};
  return parsed.data as Record<string, unknown>;
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
  if (toolName === 'updateProject') return compactToolResult(toolName, input, await updateProject(prisma, context, input));
  if (toolName === 'updateProjectAiSettings') return compactToolResult(toolName, input, await updateProjectAiSettings(prisma, context, input));
  if (toolName === 'applyStoryPatch') return new ApplyStoryPatchUseCase(prisma).execute(
    context.userId,
    context.projectId,
    mutationToolSchemas.applyStoryPatch.parse(input)
  );
  if (toolName === 'createAct') return compactToolResult(toolName, input, await createAct(prisma, context, input));
  if (toolName === 'updateAct') return compactToolResult(toolName, input, await updateAct(prisma, context, input));
  if (toolName === 'deleteAct') return compactToolResult(toolName, input, await deleteAct(prisma, context, input));
  if (toolName === 'createProjectDoc') return compactToolResult(toolName, input, await createProjectDoc(prisma, context, input));
  if (toolName === 'updateProjectDoc') return compactToolResult(toolName, input, await updateProjectDoc(prisma, context, input));
  if (toolName === 'deleteProjectDoc') return compactToolResult(toolName, input, await deleteProjectDoc(prisma, context, input));
  if (toolName === 'createFolder') return compactToolResult(toolName, input, await createFolder(prisma, context, input));
  if (toolName === 'updateFolder') return compactToolResult(toolName, input, await updateFolder(prisma, context, input));
  if (toolName === 'deleteFolder') return compactToolResult(toolName, input, await deleteFolder(prisma, context, input));
  if (toolName === 'updateChapter') return compactToolResult(toolName, input, await updateChapter(prisma, context, input));
  if (toolName === 'createChapter') return compactToolResult(toolName, input, await createChapter(prisma, context, input));
  if (toolName === 'compileChapterFromScenes') return new CompileChapterScenesUseCase(prisma).execute(
    context.userId,
    context.projectId,
    requiredString(input.chapterId, 'chapterId'),
    {
      idempotencyKey: requiredString(input.idempotencyKey, 'idempotencyKey'),
      expectedChapterHeadVersionId: expectedHeadVersionIdFrom(input, 'expectedChapterHeadVersionId'),
      expectedSceneRevisions: numberRecord(input.expectedSceneRevisions),
      separator: typeof input.separator === 'string' ? input.separator : undefined,
      message: stringOrUndefined(input.message)
    }
  );
  if (toolName === 'deleteChapter') return compactToolResult(toolName, input, await deleteChapter(prisma, context, input));
  if (toolName === 'restoreTrashChapter') return compactToolResult(toolName, input, await restoreTrashChapter(prisma, context, input));
  if (toolName === 'purgeTrashChapter') return compactToolResult(toolName, input, await purgeTrashChapter(prisma, context, input));
  if (toolName === 'createScene') return compactToolResult(toolName, input, await createScene(prisma, context, input));
  if (toolName === 'updateScene') return compactToolResult(toolName, input, await updateScene(prisma, context, input));
  if (toolName === 'reorderScenes') return compactToolResult(toolName, input, await reorderScenes(prisma, context, input));
  if (toolName === 'deleteScene') return compactToolResult(toolName, input, await deleteScene(prisma, context, input));
  if (toolName === 'createCharacter') return compactToolResult(toolName, input, await createCharacter(prisma, context, input));
  if (toolName === 'updateCharacter') return compactToolResult(toolName, input, await updateCharacter(prisma, context, input));
  if (toolName === 'deleteCharacter') return compactToolResult(toolName, input, await deleteCharacter(prisma, context, input));
  if (toolName === 'createCharacterRelationship') return compactToolResult(toolName, input, await createCharacterRelationship(prisma, context, input));
  if (toolName === 'updateCharacterRelationship') return compactToolResult(toolName, input, await updateCharacterRelationship(prisma, context, input));
  if (toolName === 'deleteCharacterRelationship') return compactToolResult(toolName, input, await deleteCharacterRelationship(prisma, context, input));
  if (toolName === 'createLocation') return compactToolResult(toolName, input, await createLocation(prisma, context, input));
  if (toolName === 'updateLocation') return compactToolResult(toolName, input, await updateLocation(prisma, context, input));
  if (toolName === 'deleteLocation') return compactToolResult(toolName, input, await deleteLocation(prisma, context, input));
  if (toolName === 'updateStoryStructure') return compactToolResult(toolName, input, await updateStoryStructure(prisma, context, input));
  if (toolName === 'createObstacle') return compactToolResult(toolName, input, await createObstacle(prisma, context, input));
  if (toolName === 'updateObstacle') return compactToolResult(toolName, input, await updateObstacle(prisma, context, input));
  if (toolName === 'deleteObstacle') return compactToolResult(toolName, input, await deleteObstacle(prisma, context, input));
  if (toolName === 'createSubmission') return compactToolResult(toolName, input, await createSubmission(prisma, context, input));
  if (toolName === 'updateSubmission') return compactToolResult(toolName, input, await updateSubmission(prisma, context, input));
  if (toolName === 'mergeSubmission') return compactToolResult(toolName, input, await mergeSubmission(prisma, context, input));
  if (toolName === 'declineSubmission') return compactToolResult(toolName, input, await declineSubmission(prisma, context, input));
  if (toolName === 'commentSubmission') return compactToolResult(toolName, input, await commentSubmission(prisma, context, input));
  if (toolName === 'uploadAsset') return compactToolResult(toolName, input, await uploadAsset(prisma, context, input));
  if (toolName === 'updateAsset') return compactToolResult(toolName, input, await updateAsset(prisma, context, input));
  if (toolName === 'deleteAsset') return compactToolResult(toolName, input, await deleteAsset(prisma, context, input));
  if (toolName === 'attachAsset') return compactToolResult(toolName, input, await attachAsset(prisma, context, input));
  if (toolName === 'detachAsset') return compactToolResult(toolName, input, await detachAsset(prisma, context, input));
  if (toolName === 'updateMemberRole') return compactToolResult(toolName, input, await updateMemberRole(prisma, context, input));
  if (toolName === 'removeMember') return compactToolResult(toolName, input, await removeMember(prisma, context, input));
  if (toolName === 'createInvite') return compactToolResult(toolName, input, await createInvite(prisma, context, input));
  if (toolName === 'revokeInvite') return compactToolResult(toolName, input, await revokeInvite(prisma, context, input));
  if (toolName === 'acceptInvite') return compactToolResult(toolName, input, await acceptInvite(prisma, context, input));
  if (toolName === 'createBetaShareLink') return compactToolResult(toolName, input, await createBetaShareLink(prisma, context, input));
  if (toolName === 'updateBetaShareLink') return compactToolResult(toolName, input, await updateBetaShareLink(prisma, context, input));
  if (toolName === 'revokeBetaShareLink') return compactToolResult(toolName, input, await revokeBetaShareLink(prisma, context, input));
  if (toolName === 'postBetaShareComment') return compactToolResult(toolName, input, await postBetaShareComment(prisma, context, input));
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
          folderId: nullableStringOrUndefined(input.folderId),
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
  await new ProjectAccessRepository(prisma).assertPermission(context.userId, context.projectId, 'project:write');
  const docId = String(input.docId ?? '');
  if (!docId) throw new HttpError(400, 'docId is required');
  const doc = await prisma.projectDoc.findFirst({
    where: { id: docId, projectId: context.projectId },
    include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
  });
  if (!doc) throw new HttpError(404, 'Project document not found');
  const content = contentMutationBody(bodyOf(doc.bodyWriting), input);
  await prisma.$transaction(async (tx) => {
    await tx.projectDoc.update({
      where: { id: docId },
      data: {
        title: typeof input.title === 'string' ? input.title : undefined,
        folderId: input.folderId === undefined ? undefined : nullableStringOrUndefined(input.folderId),
        kind: typeof input.kind === 'string' ? toPrismaDocKind(input.kind) : undefined
      }
    });
    if (content !== undefined) {
      await new WritingUseCase().updateDefaultBranch(tx, {
        writingId: doc.bodyWritingId,
        body: content,
        authorId: context.userId,
        message: 'Update project document from AI approval',
        expectedHeadVersionId: expectedHeadVersionId(input)
      });
    }
  });
  const updated = await prisma.projectDoc.findUniqueOrThrow({
    where: { id: docId },
    include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
  });
  return {
    id: updated.id,
    title: updated.title,
    kind: updated.kind,
    headVersionId: updated.bodyWriting.defaultBranch?.headVersionId ?? null,
    wordCount: updated.bodyWriting.defaultBranch?.headVersion?.wordCount ?? 0
  };
}

async function updateChapter(
  prisma: PrismaClient,
  context: ToolContext & { userId: string },
  input: Record<string, unknown>
) {
  const chapterId = String(input.chapterId ?? '');
  if (!chapterId) throw new HttpError(400, 'chapterId is required');
  let content: string | undefined;
  if (hasContentMutation(input)) {
    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, projectId: context.projectId, deletedAt: null },
      include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
    });
    if (!chapter) throw new HttpError(404, 'Chapter not found');
    content = contentMutationBody(bodyOf(chapter.bodyWriting), input);
  }
  const data: UpdateChapterInput = {
    title: stringOrUndefined(input.title),
    summary: stringOrUndefined(input.summary),
    content,
    status: chapterStatusOrUndefined(input.status),
    povCharacterId: nullableStringOrUndefined(input.povCharacterId),
    locationId: nullableStringOrUndefined(input.locationId),
    publishedAt: input.publishedAt === undefined ? undefined : nullableStringOrUndefined(input.publishedAt),
    expectedHeadVersionId: expectedHeadVersionId(input)
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
    aliases: stringArrayOrUndefined(input.aliases),
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
    aliases: stringArrayOrUndefined(input.aliases),
    description: stringOrUndefined(input.description),
    appearance: stringOrUndefined(input.appearance),
    motivation: stringOrUndefined(input.motivation),
    arc: stringOrUndefined(input.arc)
  };
  return new UpdateCharacterUseCase(prisma).execute(context.userId, context.projectId, characterId, data);
}

async function createFolder(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new ProjectFolderUseCase(prisma).create(context.userId, context.projectId, {
    name: requiredString(input.name, 'name'),
    parentFolderId: nullableStringOrUndefined(input.parentFolderId) ?? null
  });
}

async function updateFolder(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new ProjectFolderUseCase(prisma).update(context.userId, context.projectId, requiredString(input.folderId, 'folderId'), {
    name: stringOrUndefined(input.name),
    parentFolderId: input.parentFolderId === undefined ? undefined : nullableStringOrUndefined(input.parentFolderId)
  });
}

async function deleteFolder(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new ProjectFolderUseCase(prisma).delete(context.userId, context.projectId, requiredString(input.folderId, 'folderId'));
}

function compactToolResult(toolName: string, input: Record<string, unknown>, result: unknown) {
  if (Array.isArray(result)) {
    const ids = result.flatMap((item) => {
      const id = stringField(resultRecord(item), 'id');
      return id ? [id] : [];
    });
    return {
      ok: true,
      tool: toolName,
      action: compactAction(toolName),
      count: ids.length,
      ids,
      message: `${toolNoun(toolName)} reordered`
    };
  }
  const record = resultRecord(result);
  const id = stringField(record, 'id') ?? stringField(input, idInputKey(toolName));
  const label = labelForToolResult(toolName, input, record) ?? id;
  return {
    ok: true,
    tool: toolName,
    action: compactAction(toolName),
    id,
    label,
    ...(record?.headVersionId !== undefined ? { headVersionId: record.headVersionId } : {}),
    ...(typeof record?.revision === 'number' ? { revision: record.revision } : {}),
    ...(typeof record?.wordCount === 'number'
      ? { wordCount: record.wordCount }
      : typeof record?.actualWordCount === 'number' ? { wordCount: record.actualWordCount } : {}),
    ...(typeof record?.status === 'string' ? { status: record.status } : {}),
    message: compactMessage(toolName, label ?? id)
  };
}

function compactAction(toolName: string): string {
  if (toolName.startsWith('create')) return 'created';
  if (toolName.startsWith('update')) return 'updated';
  if (toolName.startsWith('reorder')) return 'reordered';
  if (toolName.startsWith('delete') || toolName.startsWith('purge') || toolName.startsWith('remove')) return 'deleted';
  if (toolName.startsWith('restore')) return 'restored';
  if (toolName.startsWith('merge')) return 'merged';
  if (toolName.startsWith('decline')) return 'declined';
  if (toolName.startsWith('revoke')) return 'revoked';
  if (toolName.startsWith('attach')) return 'attached';
  if (toolName.startsWith('detach')) return 'detached';
  if (toolName.startsWith('upload')) return 'uploaded';
  if (toolName.startsWith('comment') || toolName.startsWith('post')) return 'posted';
  if (toolName.startsWith('accept')) return 'accepted';
  return 'executed';
}

function compactMessage(toolName: string, label: string | undefined): string {
  const noun = toolNoun(toolName);
  const action = compactAction(toolName);
  return label ? `${noun} ${label} ${action}` : `${noun} ${action}`;
}

function toolNoun(toolName: string): string {
  const map: Record<string, string> = {
    updateProject: 'Project',
    updateProjectAiSettings: 'AI settings',
    createAct: 'Act',
    updateAct: 'Act',
    deleteAct: 'Act',
    createProjectDoc: 'Document',
    updateProjectDoc: 'Document',
    deleteProjectDoc: 'Document',
    createFolder: 'Folder',
    updateFolder: 'Folder',
    deleteFolder: 'Folder',
    createChapter: 'Chapter',
    compileChapterFromScenes: 'Chapter',
    updateChapter: 'Chapter',
    deleteChapter: 'Chapter',
    restoreTrashChapter: 'Chapter',
    purgeTrashChapter: 'Chapter',
    createScene: 'Scene',
    updateScene: 'Scene',
    reorderScenes: 'Scenes',
    deleteScene: 'Scene',
    createCharacter: 'Character',
    updateCharacter: 'Character',
    deleteCharacter: 'Character',
    createCharacterRelationship: 'Relationship',
    updateCharacterRelationship: 'Relationship',
    deleteCharacterRelationship: 'Relationship',
    createLocation: 'Location',
    updateLocation: 'Location',
    deleteLocation: 'Location',
    updateStoryStructure: 'Story structure',
    createObstacle: 'Obstacle',
    updateObstacle: 'Obstacle',
    deleteObstacle: 'Obstacle',
    createSubmission: 'Submission',
    updateSubmission: 'Submission',
    mergeSubmission: 'Submission',
    declineSubmission: 'Submission',
    commentSubmission: 'Submission comment',
    uploadAsset: 'Asset',
    updateAsset: 'Asset',
    deleteAsset: 'Asset',
    attachAsset: 'Asset',
    detachAsset: 'Asset',
    updateMemberRole: 'Member role',
    removeMember: 'Member',
    createInvite: 'Invite',
    revokeInvite: 'Invite',
    acceptInvite: 'Invite',
    createBetaShareLink: 'Share link',
    updateBetaShareLink: 'Share link',
    revokeBetaShareLink: 'Share link',
    postBetaShareComment: 'Share comment'
  };
  return map[toolName] ?? toolName;
}

function labelForToolResult(toolName: string, input: Record<string, unknown>, result: Record<string, unknown> | null): string | undefined {
  return stringField(result, 'title')
    ?? stringField(result, 'name')
    ?? stringField(result, 'label')
    ?? stringField(resultRecord(result?.project), 'title')
    ?? stringField(input, 'title')
    ?? stringField(input, 'name')
    ?? stringField(input, 'label')
    ?? stringField(input, idInputKey(toolName));
}

function idInputKey(toolName: string): string {
  const map: Record<string, string> = {
    updateAct: 'actId',
    deleteAct: 'actId',
    updateProjectDoc: 'docId',
    deleteProjectDoc: 'docId',
    updateFolder: 'folderId',
    deleteFolder: 'folderId',
    updateChapter: 'chapterId',
    compileChapterFromScenes: 'chapterId',
    deleteChapter: 'chapterId',
    restoreTrashChapter: 'chapterId',
    purgeTrashChapter: 'chapterId',
    updateScene: 'sceneId',
    reorderScenes: 'chapterId',
    deleteScene: 'sceneId',
    updateCharacter: 'characterId',
    deleteCharacter: 'characterId',
    deleteCharacterRelationship: 'relationshipId',
    updateCharacterRelationship: 'relationshipId',
    updateLocation: 'locationId',
    deleteLocation: 'locationId',
    updateObstacle: 'obstacleId',
    deleteObstacle: 'obstacleId',
    mergeSubmission: 'submissionId',
    updateSubmission: 'submissionId',
    declineSubmission: 'submissionId',
    commentSubmission: 'submissionId',
    attachAsset: 'assetId',
    updateAsset: 'assetId',
    deleteAsset: 'assetId',
    detachAsset: 'attachmentId',
    updateMemberRole: 'userId',
    removeMember: 'userId',
    revokeInvite: 'inviteId',
    updateBetaShareLink: 'shareLinkId',
    revokeBetaShareLink: 'shareLinkId'
  };
  return map[toolName] ?? 'id';
}

function resultRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function hasContentMutation(input: Record<string, unknown>): boolean {
  return input.content !== undefined || input.contentEdit !== undefined || input.contentEdits !== undefined;
}

function contentMutationBody(current: string, input: Record<string, unknown>): string | undefined {
  if (typeof input.content === 'string') return input.content;
  const edits = input.contentEdits !== undefined
    ? input.contentEdits
    : input.contentEdit !== undefined ? [input.contentEdit] : undefined;
  if (!Array.isArray(edits)) return undefined;
  return applyContentPatch(current, {
    mode: 'edit',
    edits: edits.map((edit) => {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) throw new HttpError(400, 'Each content edit must be an object');
      const value = edit as Record<string, unknown>;
      if (typeof value.oldString !== 'string' || typeof value.newString !== 'string') throw new HttpError(400, 'Each content edit requires oldString and newString');
      return {
        oldString: value.oldString,
        newString: value.newString,
        replaceAll: value.replaceAll === true
      };
    })
  });
}

function expectedHeadVersionId(input: Record<string, unknown>): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(input, 'expectedHeadVersionId')) return undefined;
  return expectedHeadVersionIdFrom(input, 'expectedHeadVersionId');
}

function expectedHeadVersionIdFrom(input: Record<string, unknown>, key: string): string | null {
  return input[key] === null ? null : requiredString(input[key], key);
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
    typeof item === 'number' && Number.isInteger(item) && item >= 0 ? [[key, item]] : []
  ));
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
    providerKind: input.providerKind === 'gateway' || input.providerKind === 'openai-compatible' || input.providerKind === 'github-copilot' || input.providerKind === 'codex' ? input.providerKind : undefined,
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
    aliases: stringArrayOrUndefined(input.aliases),
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
    aliases: stringArrayOrUndefined(input.aliases),
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

async function updateCharacterRelationship(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new UpdateCharacterRelationshipUseCase(prisma).execute(
    context.userId,
    context.projectId,
    requiredString(input.fromCharacterId, 'fromCharacterId'),
    requiredString(input.relationshipId, 'relationshipId'),
    {
      toCharacterId: stringOrUndefined(input.toCharacterId),
      type: stringOrUndefined(input.type),
      note: input.note === undefined ? undefined : nullableStringOrUndefined(input.note) ?? null
    } satisfies UpdateCharacterRelationshipInput
  );
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

async function updateSubmission(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  const submissionId = requiredString(input.submissionId, 'submissionId');
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, projectId: context.projectId },
    include: { branch: { include: { headVersion: true } } }
  });
  if (!submission) throw new HttpError(404, 'Submission not found');
  const body = contentMutationBody(submission.branch.headVersion?.body ?? '', input);
  return new UpdateSubmissionUseCase(prisma).execute(context.userId, context.projectId, submissionId, {
    expectedHeadVersionId: expectedHeadVersionId(input) ?? null,
    title: stringOrUndefined(input.title),
    message: input.message === undefined ? undefined : nullableStringOrUndefined(input.message) ?? null,
    body,
    proposedTitle: stringOrUndefined(input.proposedTitle),
    proposedNumber: input.proposedNumber === null ? null : numberOrUndefined(input.proposedNumber),
    proposedActId: input.proposedActId === undefined ? undefined : nullableStringOrUndefined(input.proposedActId) ?? null
  } satisfies UpdateSubmissionInput);
}

async function mergeSubmission(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new MergeSubmissionUseCase(prisma).execute(context.userId, requiredString(input.submissionId, 'submissionId'), {
    expectedMainHeadVersionId: expectedHeadVersionIdFrom(input, 'expectedMainHeadVersionId'),
    confirm: true
  });
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
  const chapterId = requiredString(input.chapterId, 'chapterId');
  return new SceneUseCase(prisma).create(context.userId, context.projectId, chapterId, sceneMutationInput(input));
}

async function updateScene(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  const sceneId = requiredString(input.sceneId, 'sceneId');
  const scene = await prisma.scene.findFirst({ where: { id: sceneId, chapter: { projectId: context.projectId, deletedAt: null } }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } });
  if (!scene) throw new HttpError(404, 'Scene not found');
  const content = contentMutationBody(bodyOf(scene.bodyWriting), input);
  return new SceneUseCase(prisma).update(
    context.userId,
    context.projectId,
    scene.chapterId,
    sceneId,
    sceneMutationInput({ ...input, content }) as UpdateSceneInput
  );
}

async function deleteScene(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  const sceneId = requiredString(input.sceneId, 'sceneId');
  const scene = await prisma.scene.findFirst({ where: { id: sceneId, chapter: { projectId: context.projectId, deletedAt: null } }, select: { chapterId: true } });
  if (!scene) throw new HttpError(404, 'Scene not found');
  return new SceneUseCase(prisma).delete(context.userId, context.projectId, scene.chapterId, sceneId, {
    expectedRevision: numberOrUndefined(input.expectedRevision)
  });
}

async function reorderScenes(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new SceneUseCase(prisma).reorder(
    context.userId,
    context.projectId,
    requiredString(input.chapterId, 'chapterId'),
    {
      sceneIds: stringArrayOrUndefined(input.sceneIds) ?? [],
      expectedRevisions: numberRecord(input.expectedRevisions),
      buildRunId: stringOrUndefined(input.buildRunId)
    } satisfies ReorderScenesInput
  );
}

function sceneMutationInput(input: Record<string, unknown>): CreateSceneInput {
  const fields = [
    'status', 'storyDate', 'storyTime', 'estimatedWordCount', 'tension', 'sceneFunction', 'goal', 'obstacle', 'stakes',
    'conflict', 'turn', 'revelation', 'outcome', 'emotionalValueShift', 'characterPresentIds',
    'characterReferencedIds', 'plotThreadIds', 'setupPayoffIds', 'knowledgeDeltas', 'objectTransfers',
    'injuryStateChanges', 'worldRuleRefs', 'entryState', 'exitState', 'summary', 'writerNotes', 'aiNotes'
  ];
  const data: Record<string, unknown> = {
    expectedRevision: input.expectedRevision,
    expectedHeadVersionId: input.expectedHeadVersionId,
    title: input.title,
    order: input.order,
    povCharacterId: input.povCharacterId,
    locationId: input.locationId,
    content: input.content
  };
  for (const field of fields) if (input[field] !== undefined) data[field] = input[field];
  return data as CreateSceneInput;
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
    buffer: Buffer.from(requiredString(input.base64, 'base64'), 'base64'),
    folderId: nullableStringOrUndefined(input.folderId),
    name: stringOrUndefined(input.name)
  });
}

async function updateAsset(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new ProjectAssetUseCase(prisma).update(context.userId, context.projectId, requiredString(input.assetId, 'assetId'), {
    name: stringOrUndefined(input.name),
    folderId: input.folderId === undefined ? undefined : nullableStringOrUndefined(input.folderId)
  });
}

async function deleteAsset(prisma: PrismaClient, context: ToolContext & { userId: string }, input: Record<string, unknown>) {
  return new ProjectAssetUseCase(prisma).delete(context.userId, context.projectId, requiredString(input.assetId, 'assetId'));
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
