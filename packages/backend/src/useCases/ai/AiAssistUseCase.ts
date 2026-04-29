import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AiCharacterDialogueSuggestion,
  AiContinuityReview,
  AiOutlineExpansion,
  AiRewriteSuggestion,
  AiToolManifest,
  CreateAiCharacterDialogueInput,
  CreateAiOutlineExpansionInput,
  CreateAiRewriteSuggestionInput
} from '@opentales/sdk';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { submissionDetailInclude } from '../submissions/submissionMapper.js';
import { loadAiModelForProject } from './aiModel.js';

const continuitySchema = z.object({
  summary: z.string(),
  issues: z.array(
    z.object({
      severity: z.enum(['info', 'warning', 'error']),
      title: z.string(),
      evidence: z.string(),
      earlierContext: z.string(),
      suggestion: z.string()
    })
  )
});

const rewriteSchema = z.object({
  original: z.string(),
  suggested: z.string(),
  mode: z.enum(['tighter', 'softer', 'more-visceral', 'more-lyrical']),
  rationale: z.string()
});

const dialogueSchema = z.object({
  lines: z.array(z.string()).min(1),
  notes: z.string()
});

const outlineSchema = z.object({
  draft: z.string(),
  notes: z.string()
});

export class AiAssistUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async runContinuityReview(
    userId: string,
    projectId: string,
    submissionId: string
  ): Promise<AiContinuityReview> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const model = await loadAiModelForProject(this.prisma, projectId);

    const submission = await this.prisma.submission.findFirst({
      where: { id: submissionId, projectId },
      include: submissionDetailInclude
    });
    if (!submission) throw new HttpError(404, 'Submission not found');

    const chapter = submission.chapterId
      ? await this.prisma.chapter.findFirst({
          where: { id: submission.chapterId, projectId, deletedAt: null },
          select: { id: true, number: true, title: true }
        })
      : null;
    const proposedNumber = submission.proposedNumber ?? chapter?.number ?? null;
    const priorSummaries = await this.prisma.chapter.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(proposedNumber === null ? {} : { number: { lt: proposedNumber } })
      },
      orderBy: { number: 'asc' },
      select: { number: true, title: true, summary: true }
    });

    const { output } = await generateText({
      model,
      output: Output.object({ schema: continuitySchema }),
      system:
        'You are a continuity editor for long-form fiction. Flag only contradictions that are grounded in the supplied prior-chapter summaries.',
      prompt: [
        `Submission title: ${submission.title}`,
        `Target chapter: ${chapter ? `${chapter.number}. ${chapter.title}` : submission.proposedTitle ?? 'new chapter'}`,
        '',
        'Prior chapter summaries:',
        priorSummaries.length
          ? priorSummaries
              .map((item) => `- Chapter ${item.number}, ${item.title}: ${item.summary ?? '(no summary)'}`)
              .join('\n')
          : '(none)',
        '',
        'Current chapter draft:',
        submission.branch.headVersion?.body ?? ''
      ].join('\n')
    });

    const content: Prisma.JsonObject = {
      summary: output.summary,
      issues: output.issues,
      submissionId
    };

    const activity = await this.prisma.activity.create({
      data: {
        submissionId,
        type: 'AI_REVIEW_POSTED',
        authorId: userId,
        content
      },
      select: { id: true }
    });

    return {
      ...output,
      postedActivityId: activity.id
    };
  }

  async createRewriteSuggestion(
    userId: string,
    projectId: string,
    input: CreateAiRewriteSuggestionInput
  ): Promise<AiRewriteSuggestion> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const model = await loadAiModelForProject(this.prisma, projectId);
    const text = input.text?.trim();
    if (!text) throw new HttpError(400, 'Text is required');
    if (!rewriteModes.has(input.mode)) throw new HttpError(400, 'Unsupported rewrite mode');

    const { output } = await generateText({
      model,
      output: Output.object({ schema: rewriteSchema }),
      system:
        'You are an assistive prose editor. Suggest a replacement for the selected passage, but do not continue the scene.',
      prompt: [
        `Rewrite mode: ${input.mode}`,
        input.context ? `Scene context: ${input.context}` : '',
        'Selected passage:',
        text,
        '',
        'Return the original passage unchanged in original, one suggested replacement in suggested, and a short rationale.'
      ].join('\n')
    });

    return output;
  }

  async createCharacterDialogue(
    userId: string,
    projectId: string,
    input: CreateAiCharacterDialogueInput
  ): Promise<AiCharacterDialogueSuggestion> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const model = await loadAiModelForProject(this.prisma, projectId);
    const situation = input.situation?.trim();
    if (!situation) throw new HttpError(400, 'Situation is required');

    const character = await this.loadCharacter(projectId, input.characterId);
    const count = Number.isInteger(input.count) ? Math.min(Math.max(input.count ?? 1, 1), 5) : 1;

    const { output } = await generateText({
      model,
      output: Output.object({ schema: dialogueSchema }),
      system:
        'You write dialogue samples for a fiction author. Generate options only; do not narrate around them.',
      prompt: [
        `Character: ${character.name}`,
        `Role: ${character.role ?? ''}`,
        `Traits: ${character.traits.join(', ')}`,
        `Description: ${character.descriptionWriting.defaultBranch?.headVersion?.body ?? ''}`,
        `Motivation: ${character.motivationWriting.defaultBranch?.headVersion?.body ?? ''}`,
        `Arc: ${character.arcWriting.defaultBranch?.headVersion?.body ?? ''}`,
        `Situation: ${situation}`,
        `Number of dialogue lines to generate: ${count}`
      ].join('\n')
    });

    return {
      characterId: character.id,
      characterName: character.name,
      lines: output.lines.slice(0, count),
      notes: output.notes
    };
  }

  async createOutlineExpansion(
    userId: string,
    projectId: string,
    input: CreateAiOutlineExpansionInput
  ): Promise<AiOutlineExpansion> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const model = await loadAiModelForProject(this.prisma, projectId);
    const synopsis = input.synopsis?.trim();
    if (!synopsis) throw new HttpError(400, 'Synopsis is required');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { title: true, genre: true, voice: true, tone: true, pov: true }
    });
    if (!project) throw new HttpError(404, 'Project not found');

    const { output } = await generateText({
      model,
      output: Output.object({ schema: outlineSchema }),
      system:
        'You expand outlines into first-draft fiction scenes. Mark the result as draft-quality; leave room for the author to edit.',
      prompt: [
        `Project: ${project.title}`,
        `Genre: ${project.genre ?? ''}`,
        `Voice: ${project.voice ?? ''}`,
        `Tone: ${project.tone ?? ''}`,
        `POV: ${project.pov ?? ''}`,
        `Target length: ${input.targetLength ?? 'medium'}`,
        input.povCharacterId ? `POV character id: ${input.povCharacterId}` : '',
        input.locationId ? `Location id: ${input.locationId}` : '',
        '',
        'Bullet synopsis:',
        synopsis
      ].join('\n')
    });

    return {
      draft: output.draft,
      label: 'AI draft',
      acceptRequiresEdits: true,
      notes: output.notes
    };
  }

  async listTools(userId: string, projectId: string): Promise<AiToolManifest> {
    await this.access.assertProjectAccess(userId, projectId);
    const readToolNames = [
      'readProject',
      'listCharacters',
      'readCharacter',
      'listCharacterRelationships',
      'listChapters',
      'readChapter',
      'grepChapter',
      'grepChapters',
      'listActs',
      'readAct',
      'listScenes',
      'readScene',
      'listLocations',
      'readLocation',
      'listObstacles',
      'readObstacle',
      'listProjectDocs',
      'readProjectDoc',
      'readStoryStructure',
      'listSubmissions',
      'readSubmission',
      'listTrash',
      'readTrashedChapter',
      'listAssets',
      'readAssetMetadata',
      'readAssetContent',
      'getProjectStats',
      'listMembers',
      'listBetaShareLinks',
      'readBetaShareLink',
      'readPublicProject',
      'readProjectAiSettings',
      'listWritingVersions',
      'readWritingVersion',
      'grepProject'
    ];
    const mutationToolNames = [
      'updateProject',
      'updateProjectAiSettings',
      'createAct',
      'updateAct',
      'deleteAct',
      'createCharacter',
      'updateCharacter',
      'deleteCharacter',
      'createCharacterRelationship',
      'deleteCharacterRelationship',
      'createLocation',
      'updateLocation',
      'deleteLocation',
      'createChapter',
      'updateChapter',
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
    ];
    return {
      tools: [
        ...readToolNames.map((name) => ({ name, description: `${name} read-only agent tool.`, requiresApproval: false, inputSchema: genericSchema })),
        ...mutationToolNames.map((name) => ({ name, description: `${name} approval-gated mutation tool.`, requiresApproval: true, inputSchema: genericSchema }))
      ]
    };

    /* legacy explicit manifest kept below for reference; unreachable after generic coverage above */
    return {
      tools: [
        {
          name: 'listCharacters',
          description: 'Lists characters in the project.',
          requiresApproval: false,
          inputSchema: emptySchema
        },
        {
          name: 'readCharacter',
          description: 'Reads one character profile.',
          requiresApproval: false,
          inputSchema: { type: 'object', properties: { characterId: { type: 'string' } }, required: ['characterId'] }
        },
        {
          name: 'listChapters',
          description: 'Lists chapters in the project.',
          requiresApproval: false,
          inputSchema: emptySchema
        },
        {
          name: 'readChapter',
          description:
            'Reads one chapter body and metadata. Prefer bounded startLine/endLine or offset/length ranges; use full only when explicitly requested or when a bounded read is insufficient.',
          requiresApproval: false,
          inputSchema: chapterReadSchema
        },
        {
          name: 'grepChapter',
          description: 'Searches one chapter body for matching line snippets.',
          requiresApproval: false,
          inputSchema: chapterGrepSchema
        },
        {
          name: 'grepChapters',
          description: 'Searches all or selected chapter bodies for matching line snippets.',
          requiresApproval: false,
          inputSchema: chaptersGrepSchema
        },
        {
          name: 'listLocations',
          description: 'Lists locations in the project.',
          requiresApproval: false,
          inputSchema: emptySchema
        },
        {
          name: 'readLocation',
          description: 'Reads one location profile.',
          requiresApproval: false,
          inputSchema: { type: 'object', properties: { locationId: { type: 'string' } }, required: ['locationId'] }
        },
        {
          name: 'listProjectDocs',
          description: 'Lists project notes, brainstorms, instructions, and references with pagination.',
          requiresApproval: false,
          inputSchema: projectDocListSchema
        },
        {
          name: 'readProjectDoc',
          description: 'Reads one project document.',
          requiresApproval: false,
          inputSchema: { type: 'object', properties: { docId: { type: 'string' } }, required: ['docId'] }
        },
        {
          name: 'readStoryStructure',
          description: 'Reads the project structure, outline, themes, climax, and obstacles.',
          requiresApproval: false,
          inputSchema: emptySchema
        },
        {
          name: 'updateCharacter',
          description: 'Suggests updates to an existing character profile.',
          requiresApproval: true,
          inputSchema: characterMutationSchema
        },
        {
          name: 'createCharacter',
          description: 'Suggests a new character to add to the project.',
          requiresApproval: true,
          inputSchema: characterMutationSchema
        },
        {
          name: 'updateChapter',
          description: 'Suggests chapter metadata or body changes.',
          requiresApproval: true,
          inputSchema: chapterMutationSchema
        },
        {
          name: 'createProjectDoc',
          description: 'Suggests a new project note, brainstorm, instruction, or reference doc.',
          requiresApproval: true,
          inputSchema: projectDocMutationSchema
        },
        {
          name: 'updateProjectDoc',
          description: 'Suggests changes to a project note, brainstorm, instruction, or reference doc.',
          requiresApproval: true,
          inputSchema: projectDocMutationSchema
        }
      ]
    };
  }

  private async loadCharacter(projectId: string, characterId: string) {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, projectId },
      include: {
        descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    });
    if (!character) throw new HttpError(404, 'Character not found');
    return character;
  }
}

const rewriteModes = new Set(['tighter', 'softer', 'more-visceral', 'more-lyrical']);

const emptySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {}
} satisfies Record<string, unknown>;

const genericSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {}
} satisfies Record<string, unknown>;

const characterMutationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    characterId: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    age: { type: 'string' },
    occupation: { type: 'string' },
    traits: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    appearance: { type: 'string' },
    motivation: { type: 'string' },
    arc: { type: 'string' }
  }
} satisfies Record<string, unknown>;

const chapterReadSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapterId: { type: 'string' },
    startLine: { type: 'integer', minimum: 1 },
    endLine: { type: 'integer', minimum: 1 },
    offset: { type: 'integer', minimum: 0 },
    length: { type: 'integer', minimum: 1, maximum: 20000 },
    full: { type: 'boolean' }
  },
  required: ['chapterId']
} satisfies Record<string, unknown>;

const chapterGrepSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapterId: { type: 'string' },
    query: { type: 'string' },
    regex: { type: 'boolean' },
    caseSensitive: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 50 }
  },
  required: ['chapterId', 'query']
} satisfies Record<string, unknown>;

const chaptersGrepSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    chapterIds: { type: 'array', items: { type: 'string' } },
    regex: { type: 'boolean' },
    caseSensitive: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 100 }
  },
  required: ['query']
} satisfies Record<string, unknown>;

const projectDocListSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0 },
    kind: { type: 'string', enum: ['note', 'brainstorm', 'instructions', 'reference', 'other'] }
  }
} satisfies Record<string, unknown>;

const chapterMutationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapterId: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    content: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'in-progress', 'review', 'final'] },
    povCharacterId: { type: 'string' },
    locationId: { type: 'string' }
  }
} satisfies Record<string, unknown>;

const projectDocMutationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    docId: { type: 'string' },
    title: { type: 'string' },
    kind: { type: 'string', enum: ['note', 'brainstorm', 'instructions', 'reference', 'other'] },
    content: { type: 'string' }
  }
} satisfies Record<string, unknown>;
