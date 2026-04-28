import type { PrismaClient } from '@prisma/client';
import type {
  CreateProjectDocInput,
  ListProjectDocsInput,
  PaginatedProjectDocs,
  ProjectDoc,
  ProjectDocKind,
  UpdateProjectDocInput
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';
import { WritingUseCase } from '../writings/WritingUseCase.js';
import {
  projectDocInclude,
  toPrismaProjectDocKind,
  toProjectDoc
} from './projectDocMapper.js';

const PROJECT_DOC_KINDS = new Set<ProjectDocKind>([
  'note',
  'brainstorm',
  'instructions',
  'reference',
  'other'
]);

export class ProjectDocUseCase {
  private readonly access: ProjectAccessRepository;
  private readonly writingUseCase = new WritingUseCase();

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async list(
    userId: string,
    projectId: string,
    input: ListProjectDocsInput = {}
  ): Promise<PaginatedProjectDocs> {
    await this.access.assertProjectAccess(userId, projectId);
    const limit = clampInt(input.limit, 1, 100, 50);
    const offset = clampInt(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const where = {
      projectId,
      ...(input.kind ? { kind: toPrismaProjectDocKind(validateKind(input.kind)) } : {})
    };
    const [total, docs] = await this.prisma.$transaction([
      this.prisma.projectDoc.count({ where }),
      this.prisma.projectDoc.findMany({
        where,
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        skip: offset,
        take: limit,
        include: projectDocInclude
      })
    ]);
    const nextOffset = offset + docs.length < total ? offset + docs.length : null;
    return {
      items: docs.map(toProjectDoc),
      total,
      limit,
      offset,
      nextOffset
    };
  }

  async get(userId: string, projectId: string, docId: string): Promise<ProjectDoc> {
    await this.access.assertProjectAccess(userId, projectId);
    const doc = await this.prisma.projectDoc.findFirst({
      where: { id: docId, projectId },
      include: projectDocInclude
    });
    if (!doc) throw new HttpError(404, 'Project document not found');
    return toProjectDoc(doc);
  }

  async create(
    userId: string,
    projectId: string,
    input: CreateProjectDocInput
  ): Promise<ProjectDoc> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const title = input.title?.trim();
    if (!title) throw new HttpError(400, 'Document title is required');
    const kind = validateKind(input.kind ?? 'note');

    const docId = await this.prisma.$transaction(async (tx) => {
      const last = await tx.projectDoc.findFirst({
        where: { projectId },
        orderBy: { order: 'desc' },
        select: { order: true }
      });
      const bodyWritingId = await this.writingUseCase.createWriting(tx, {
        projectId,
        kind: 'NOTE',
        body: input.content ?? '',
        authorId: userId,
        message: 'Create project document'
      });
      const doc = await tx.projectDoc.create({
        data: {
          projectId,
          title,
          kind: toPrismaProjectDocKind(kind),
          bodyWritingId,
          order: (last?.order ?? -1) + 1
        },
        select: { id: true }
      });
      return doc.id;
    });

    return this.get(userId, projectId, docId);
  }

  async update(
    userId: string,
    projectId: string,
    docId: string,
    input: UpdateProjectDocInput
  ): Promise<ProjectDoc> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const existing = await this.prisma.projectDoc.findFirst({
      where: { id: docId, projectId },
      select: { id: true, bodyWritingId: true }
    });
    if (!existing) throw new HttpError(404, 'Project document not found');

    await this.prisma.$transaction(async (tx) => {
      const data: { title?: string; kind?: ReturnType<typeof toPrismaProjectDocKind> } = {};
      if (input.title !== undefined) {
        const title = input.title.trim();
        if (!title) throw new HttpError(400, 'Document title cannot be empty');
        data.title = title;
      }
      if (input.kind !== undefined) data.kind = toPrismaProjectDocKind(validateKind(input.kind));

      if (Object.keys(data).length > 0) {
        await tx.projectDoc.update({ where: { id: docId }, data });
      }
      if (input.content !== undefined) {
        await this.writingUseCase.updateDefaultBranch(tx, {
          writingId: existing.bodyWritingId,
          body: input.content,
          authorId: userId,
          message: 'Update project document'
        });
      }
    });

    return this.get(userId, projectId, docId);
  }

  async delete(
    userId: string,
    projectId: string,
    docId: string
  ): Promise<{ id: string; deleted: true }> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    const doc = await this.prisma.projectDoc.findFirst({
      where: { id: docId, projectId },
      select: { id: true, bodyWritingId: true }
    });
    if (!doc) throw new HttpError(404, 'Project document not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.projectDoc.delete({ where: { id: docId } });
      await tx.writing.delete({ where: { id: doc.bodyWritingId } });
    });
    return { id: docId, deleted: true };
  }
}

function validateKind(kind: ProjectDocKind): ProjectDocKind {
  if (!PROJECT_DOC_KINDS.has(kind)) throw new HttpError(400, 'Unsupported document kind');
  return kind;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}
