import type { Prisma } from '@prisma/client';
import type {
  Act,
  Chapter,
  ChapterStatus,
  Character,
  CoverOrientation,
  Location,
  ManuscriptProject,
  ObstacleType,
  ProjectDoc,
  ProjectSummary,
  ProjectVisibility,
  Scene,
  StoryStructure
} from '@opentales/sdk';
import { env } from '../../config/env.js';

function assetUrl(assetId: string | null | undefined): string | undefined {
  if (!assetId) return undefined;
  return `${env.publicBaseUrl}/assets/${assetId}`;
}

function assetUrlOrNull(assetId: string | null | undefined): string | null {
  return assetUrl(assetId) ?? null;
}

export function toCoverOrientation(
  value: 'LANDSCAPE' | 'PORTRAIT'
): CoverOrientation {
  return value === 'PORTRAIT' ? 'portrait' : 'landscape';
}

export function fromCoverOrientation(value: CoverOrientation): 'LANDSCAPE' | 'PORTRAIT' {
  return value === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE';
}

export function toProjectVisibility(
  value: 'PRIVATE' | 'PUBLIC'
): ProjectVisibility {
  return value === 'PUBLIC' ? 'public' : 'private';
}

export function fromProjectVisibility(value: ProjectVisibility): 'PRIVATE' | 'PUBLIC' {
  return value === 'public' ? 'PUBLIC' : 'PRIVATE';
}

const projectInclude = {
  org: { select: { slug: true } },
  storyStructure: {
    include: {
      loglineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      outlineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      climaxWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
    }
  },
  obstacles: {
    orderBy: { order: 'asc' },
    include: {
      descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
    }
  },
  characters: {
    orderBy: { createdAt: 'asc' },
    include: {
      descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      appearanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      outgoingRelationships: true
    }
  },
  assets: {
    where: { attachments: { some: { entityType: 'CHARACTER' } } },
    include: { attachments: true }
  },
  locations: {
    orderBy: { createdAt: 'asc' },
    include: {
      descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      atmosphereWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      significanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      sensoryWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
    }
  },
  acts: {
    orderBy: { order: 'asc' },
    include: {
      chapters: {
        where: { deletedAt: null },
        orderBy: { order: 'asc' },
        select: { id: true }
      }
    }
  },
  chapters: {
    where: { deletedAt: null },
    orderBy: [{ number: 'asc' }],
    include: {
      bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
      scenes: {
        orderBy: { order: 'asc' },
        include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
      }
    }
  },
  docs: {
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: {
      folder: true,
      bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
    }
  }
} satisfies Prisma.ProjectInclude;

export type ProjectWithManuscript = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;
type WritingWithHead = ProjectWithManuscript['chapters'][number]['bodyWriting'];
export type SceneWithBody = ProjectWithManuscript['chapters'][number]['scenes'][number];
type CharacterAssetWithAttachments = ProjectWithManuscript['assets'][number];

export function getProjectInclude() {
  return projectInclude;
}

export function toProjectSummary(project: {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  genre: string | null;
  updatedAt: Date;
  visibility: 'PRIVATE' | 'PUBLIC';
  coverAssetId: string | null;
  coverOrientation: 'LANDSCAPE' | 'PORTRAIT';
}): ProjectSummary {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    description: project.description ?? '',
    genre: project.genre ?? '',
    updatedAt: project.updatedAt.toISOString(),
    visibility: toProjectVisibility(project.visibility),
    coverUrl: assetUrlOrNull(project.coverAssetId),
    coverOrientation: toCoverOrientation(project.coverOrientation)
  };
}

export function toManuscriptProject(project: ProjectWithManuscript): ManuscriptProject {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    description: project.description ?? '',
    visibility: toProjectVisibility(project.visibility),
    coverUrl: assetUrlOrNull(project.coverAssetId),
    coverAssetId: project.coverAssetId ?? null,
    coverOrientation: toCoverOrientation(project.coverOrientation),
    orgSlug: project.org.slug,
    characters: project.characters.map((character) => toCharacter(character, project.assets)),
    locations: project.locations.map(toLocation),
    chapters: project.chapters.map(toChapter),
    docs: project.docs.map(toProjectDoc),
    acts: project.acts.map(toAct),
    structure: toStoryStructure(project)
  };
}

export function toCharacter(
  character: ProjectWithManuscript['characters'][number],
  characterAssets: CharacterAssetWithAttachments[] = []
): Character {
  const assets = characterAssets
    .flatMap((asset) =>
      asset.attachments
        .filter((attachment) => attachment.entityType === 'CHARACTER' && attachment.entityId === character.id)
        .map((attachment) => ({ asset, attachment }))
    )
    .sort((left, right) => (left.attachment.order ?? 0) - (right.attachment.order ?? 0));

  return {
    id: character.id,
    name: character.name,
    role: character.role ?? '',
    age: character.age ?? '',
    occupation: character.occupation ?? '',
    avatar: assetUrl(character.avatarAssetId),
    avatarAssetId: character.avatarAssetId ?? undefined,
    description: currentBody(character.descriptionWriting),
    appearance: currentBody(character.appearanceWriting),
    motivation: currentBody(character.motivationWriting),
    arc: currentBody(character.arcWriting),
    traits: character.traits,
    aliases: character.aliases,
    relationships: character.outgoingRelationships.map((relationship) => ({
      id: relationship.id,
      characterId: relationship.toCharacterId,
      type: relationship.type,
      note: relationship.note ?? ''
    })),
    assets: assets.map(({ asset, attachment }) => ({
      id: attachment.id,
      assetId: asset.id,
      role: attachment.role,
      order: attachment.order,
      kind: asset.kind === 'IMAGE' ? 'image' : asset.kind === 'AUDIO' ? 'audio' : asset.kind === 'VIDEO' ? 'video' : 'document',
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      url: assetUrl(asset.id) ?? '',
      createdAt: asset.createdAt.toISOString()
    }))
  };
}

export function toLocation(location: ProjectWithManuscript['locations'][number]): Location {
  return {
    id: location.id,
    name: location.name,
    aliases: location.aliases,
    type: location.type ?? '',
    image: assetUrl(location.imageAssetId),
    imageAssetId: location.imageAssetId ?? undefined,
    description: currentBody(location.descriptionWriting),
    atmosphere: currentBody(location.atmosphereWriting),
    significance: currentBody(location.significanceWriting),
    sensoryDetails: currentBody(location.sensoryWriting)
  };
}

export function toChapter(chapter: ProjectWithManuscript['chapters'][number]): Chapter {
  const head = chapter.bodyWriting.defaultBranch?.headVersion;
  return {
    id: chapter.id,
    writingId: chapter.bodyWritingId,
    branchId: chapter.bodyWriting.defaultBranch?.id ?? null,
    headVersionId: chapter.bodyWriting.defaultBranch?.headVersionId ?? null,
    number: chapter.number,
    title: chapter.title,
    status: toSdkChapterStatus(chapter.status),
    povCharacterId: chapter.povCharacterId ?? undefined,
    locationId: chapter.locationId ?? undefined,
    summary: chapter.summary ?? '',
    content: head?.body ?? '',
    wordCount: head?.wordCount ?? 0,
    publishedAt: chapter.publishedAt ? chapter.publishedAt.toISOString() : null,
    scenes: chapter.scenes.map(toScene)
  };
}

export function toScene(scene: SceneWithBody): Scene {
  const head = scene.bodyWriting.defaultBranch?.headVersion;
  const statusMap = {
    PLANNED: 'planned',
    DRAFT: 'draft',
    IN_PROGRESS: 'in-progress',
    REVIEW: 'review',
    REVISED: 'revised',
    FINAL: 'final'
  } as const;
  return {
    id: scene.id,
    writingId: scene.bodyWritingId,
    branchId: scene.bodyWriting.defaultBranch?.id ?? null,
    headVersionId: scene.bodyWriting.defaultBranch?.headVersionId ?? null,
    chapterId: scene.chapterId,
    order: scene.order,
    title: scene.title ?? '',
    status: statusMap[scene.status],
    povCharacterId: scene.povCharacterId,
    locationId: scene.locationId,
    storyDate: scene.storyDate,
    storyTime: scene.storyTime,
    estimatedWordCount: scene.estimatedWordCount,
    actualWordCount: scene.actualWordCount || head?.wordCount || 0,
    sceneFunction: scene.sceneFunction ?? '',
    goal: scene.goal ?? '',
    obstacle: scene.obstacle ?? '',
    stakes: scene.stakes ?? '',
    conflict: scene.conflict ?? '',
    turn: scene.turn ?? '',
    revelation: scene.revelation ?? '',
    outcome: scene.outcome ?? '',
    emotionalValueShift: scene.emotionalValueShift ?? '',
    tension: scene.tension,
    characterPresentIds: scene.characterPresentIds,
    characterReferencedIds: scene.characterReferencedIds,
    plotThreadIds: scene.plotThreadIds,
    setupPayoffIds: scene.setupPayoffIds,
    knowledgeDeltas: scene.knowledgeDeltas as Scene['knowledgeDeltas'],
    objectTransfers: scene.objectTransfers as Scene['objectTransfers'],
    injuryStateChanges: scene.injuryStateChanges as Scene['injuryStateChanges'],
    worldRuleRefs: scene.worldRuleRefs as Scene['worldRuleRefs'],
    entryState: scene.entryState as Scene['entryState'],
    exitState: scene.exitState as Scene['exitState'],
    summary: scene.summary ?? '',
    writerNotes: scene.writerNotes ?? '',
    aiNotes: scene.aiNotes ?? '',
    content: head?.body ?? '',
    createdAt: scene.createdAt.toISOString(),
    updatedAt: scene.updatedAt.toISOString(),
    revision: scene.revision
  };
}

function toProjectDoc(doc: ProjectWithManuscript['docs'][number]): ProjectDoc {
  const head = doc.bodyWriting.defaultBranch?.headVersion;
  const kindMap = {
    NOTE: 'note',
    BRAINSTORM: 'brainstorm',
    INSTRUCTIONS: 'instructions',
    REFERENCE: 'reference',
    OTHER: 'other'
  } as const;
  return {
    id: doc.id,
    projectId: doc.projectId,
    folderId: doc.folderId,
    title: doc.title,
    path: doc.folder ? `${doc.folder.path}/${doc.title}` : doc.title,
    kind: kindMap[doc.kind],
    content: head?.body ?? '',
    wordCount: head?.wordCount ?? 0,
    order: doc.order,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString()
  };
}

function toAct(act: ProjectWithManuscript['acts'][number]): Act {
  return {
    id: act.id,
    title: act.title,
    chapterIds: act.chapters.map((chapter) => chapter.id)
  };
}

export function toStoryStructure(project: ProjectWithManuscript): StoryStructure {
  const structure = project.storyStructure;
  return {
    title: project.title,
    genre: project.genre ?? '',
    perspective: project.perspective ?? '',
    pov: project.pov ?? '',
    voice: project.voice ?? '',
    tone: project.tone ?? '',
    themes: project.themes,
    logline: structure ? currentBody(structure.loglineWriting) : '',
    outline: structure ? currentBody(structure.outlineWriting) : '',
    climax: structure ? currentBody(structure.climaxWriting) : '',
    obstacles: project.obstacles.map((obstacle) => ({
      id: obstacle.id,
      title: obstacle.title,
      type: obstacle.type.toLowerCase() as ObstacleType,
      description: currentBody(obstacle.descriptionWriting),
      resolution: currentBody(obstacle.resolutionWriting)
    }))
  };
}

function currentBody(writing: WritingWithHead): string {
  return writing.defaultBranch?.headVersion?.body ?? '';
}

function toSdkChapterStatus(status: ProjectWithManuscript['chapters'][number]['status']): ChapterStatus {
  const map = {
    DRAFT: 'draft',
    IN_PROGRESS: 'in-progress',
    REVIEW: 'review',
    FINAL: 'final'
  } as const;
  return map[status];
}
