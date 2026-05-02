import type { Prisma } from '@prisma/client';
import type { ProjectDoc, ProjectDocKind } from '@opentales/sdk';

export const projectDocInclude = {
  folder: true,
  bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
} satisfies Prisma.ProjectDocInclude;

export type ProjectDocWithBody = Prisma.ProjectDocGetPayload<{
  include: typeof projectDocInclude;
}>;

const KIND_MAP = {
  NOTE: 'note',
  BRAINSTORM: 'brainstorm',
  INSTRUCTIONS: 'instructions',
  REFERENCE: 'reference',
  OTHER: 'other'
} as const;

export function toPrismaProjectDocKind(kind: ProjectDocKind) {
  const map = {
    note: 'NOTE',
    brainstorm: 'BRAINSTORM',
    instructions: 'INSTRUCTIONS',
    reference: 'REFERENCE',
    other: 'OTHER'
  } as const;
  return map[kind];
}

export function toProjectDoc(doc: ProjectDocWithBody): ProjectDoc {
  const head = doc.bodyWriting.defaultBranch?.headVersion;
  return {
    id: doc.id,
    projectId: doc.projectId,
    folderId: doc.folderId,
    title: doc.title,
    path: doc.folder ? `${doc.folder.path}/${doc.title}` : doc.title,
    kind: KIND_MAP[doc.kind] as ProjectDocKind,
    content: head?.body ?? '',
    wordCount: head?.wordCount ?? 0,
    order: doc.order,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString()
  };
}
