import type { PrismaClient } from '@prisma/client';
import type { Response } from 'express';
import type {
  CollaborationDocumentRef,
  CollaborationEdit,
  CollaborationEditInput,
  CollaborationEvent,
  CollaborationLocation,
  CollaborationPresence,
  CollaborationPresenceInput,
  CollaborationSnapshot,
  CollaborationTextChange,
  CollaborationUser
} from '@opentales/sdk';
import { HttpError } from '../../http/HttpError.js';
import { ProjectAccessRepository } from '../../repositories/ProjectAccessRepository.js';

type RuntimeDocument = {
  ref: CollaborationDocumentRef;
  revision: number;
  content: string;
  history: CollaborationEdit[];
  clients: Map<string, Response>;
  presence: Map<string, CollaborationPresence>;
};

const MAX_HISTORY = 500;
const documents = new Map<string, RuntimeDocument>();
const projectClients = new Map<string, Set<Response>>();

export class CollaborationUseCase {
  private readonly access: ProjectAccessRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.access = new ProjectAccessRepository(prisma);
  }

  async snapshot(userId: string, projectId: string, ref: CollaborationDocumentRef): Promise<CollaborationEvent> {
    await this.access.assertProjectAccess(userId, projectId);
    const doc = await this.getDocument(projectId, ref);
    return { type: 'snapshot', snapshot: toSnapshot(doc) };
  }

  async subscribe(
    userId: string,
    projectId: string,
    ref: CollaborationDocumentRef,
    clientId: string,
    res: Response
  ): Promise<void> {
    if (!clientId) throw new HttpError(400, 'clientId is required');
    await this.access.assertProjectAccess(userId, projectId);
    const doc = await this.getDocument(projectId, ref);
    const user = await this.getUser(userId);
    const presence = this.touchPresence(doc, clientId, user, {
      selection: null,
      focused: false,
      location: null
    });

    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();

    doc.clients.set(clientId, res);
    writeEvent(res, { type: 'snapshot', snapshot: toSnapshot(doc) });
    this.broadcast(doc, { type: 'presence', presence }, clientId);
    this.broadcastProject(projectId);

    res.on('close', () => {
      doc.clients.delete(clientId);
      doc.presence.delete(clientId);
      this.broadcast(doc, { type: 'leave', clientId }, clientId);
      this.broadcastProject(projectId);
    });
  }

  async subscribeProject(userId: string, projectId: string, res: Response): Promise<void> {
    await this.access.assertProjectAccess(userId, projectId);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();

    const clients = getProjectClients(projectId);
    clients.add(res);
    writeEvent(res, this.projectPresenceEvent(projectId));
    res.on('close', () => clients.delete(res));
  }

  async applyEdit(
    userId: string,
    projectId: string,
    ref: CollaborationDocumentRef,
    input: CollaborationEditInput
  ): Promise<CollaborationEvent> {
    await this.access.assertPermission(userId, projectId, 'project:write');
    if (!input.clientId) throw new HttpError(400, 'clientId is required');
    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
      throw new HttpError(400, 'baseRevision must be a non-negative integer');
    }
    if (!Array.isArray(input.changes) || input.changes.length === 0) {
      throw new HttpError(400, 'At least one change is required');
    }

    const doc = await this.getDocument(projectId, ref);
    const user = await this.getUser(userId);
    const transformed = transformChanges(input.changes, doc.history, input.baseRevision);
    const content = applyChanges(doc.content, transformed);

    doc.revision += 1;
    doc.content = content;
    const edit: CollaborationEdit = {
      id: `${doc.revision}-${Date.now().toString(36)}`,
      clientId: input.clientId,
      revision: doc.revision,
      user,
      changes: transformed,
      selection: input.selection ?? null
    };
    doc.history.push(edit);
    if (doc.history.length > MAX_HISTORY) doc.history.splice(0, doc.history.length - MAX_HISTORY);

    const presence = this.touchPresence(doc, input.clientId, user, {
      selection: input.selection ?? null,
      focused: input.focused ?? true,
      location: input.location ?? null
    });
    const event = { type: 'edit', edit } satisfies CollaborationEvent;
    this.broadcast(doc, event);
    this.broadcast(doc, { type: 'presence', presence }, input.clientId);
    this.broadcastProject(projectId);
    return event;
  }

  async updatePresence(
    userId: string,
    projectId: string,
    ref: CollaborationDocumentRef,
    input: CollaborationPresenceInput
  ): Promise<CollaborationEvent> {
    await this.access.assertProjectAccess(userId, projectId);
    if (!input.clientId) throw new HttpError(400, 'clientId is required');
    const doc = await this.getDocument(projectId, ref);
    const user = await this.getUser(userId);
    const presence = this.touchPresence(doc, input.clientId, user, {
      selection: input.selection ?? null,
      focused: input.focused ?? false,
      location: input.location ?? null
    });
    const event = { type: 'presence', presence } satisfies CollaborationEvent;
    this.broadcast(doc, event, input.clientId);
    this.broadcastProject(projectId);
    return event;
  }

  private async getDocument(projectId: string, ref: CollaborationDocumentRef): Promise<RuntimeDocument> {
    validateRef(ref);
    const key = documentKey(projectId, ref);
    const existing = documents.get(key);
    if (existing) return existing;
    const content = await this.loadContent(projectId, ref);
    const doc: RuntimeDocument = {
      ref,
      revision: 0,
      content,
      history: [],
      clients: new Map(),
      presence: new Map()
    };
    documents.set(key, doc);
    return doc;
  }

  private touchPresence(
    doc: RuntimeDocument,
    clientId: string,
    user: CollaborationUser,
    input: {
      selection: CollaborationEditInput['selection'];
      focused: boolean;
      location: CollaborationLocation | null;
    }
  ): CollaborationPresence {
    const presence: CollaborationPresence = {
      clientId,
      user,
      selection: input.selection,
      document: doc.ref,
      focused: input.focused,
      location: input.location,
      updatedAt: new Date().toISOString()
    };
    doc.presence.set(clientId, presence);
    return presence;
  }

  private broadcast(doc: RuntimeDocument, event: CollaborationEvent, exceptClientId?: string): void {
    for (const [clientId, client] of doc.clients) {
      if (clientId !== exceptClientId) writeEvent(client, event);
    }
  }

  private broadcastProject(projectId: string): void {
    const event = this.projectPresenceEvent(projectId);
    for (const client of getProjectClients(projectId)) writeEvent(client, event);
  }

  private projectPresenceEvent(projectId: string): CollaborationEvent {
    const collaborators: CollaborationPresence[] = [];
    const prefix = `${projectId}:`;
    for (const [key, doc] of documents) {
      if (!key.startsWith(prefix)) continue;
      collaborators.push(...doc.presence.values());
    }
    return { type: 'project-presence', collaborators };
  }

  private async getUser(userId: string): Promise<CollaborationUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, name: true }
    });
    if (!user) throw new HttpError(401, 'Invalid authentication token');
    return user;
  }

  private async loadContent(projectId: string, ref: CollaborationDocumentRef): Promise<string> {
    if (ref.kind === 'chapter') {
      const chapter = await this.prisma.chapter.findFirst({
        where: { id: ref.entityId, projectId, deletedAt: null },
        include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
      });
      if (!chapter) throw new HttpError(404, 'Chapter not found');
      if (ref.field === 'title') return chapter.title;
      if (ref.field === 'summary') return chapter.summary ?? '';
      if (ref.field !== 'content') throw new HttpError(400, 'Unsupported chapter collaboration field');
      return currentBody(chapter.bodyWriting);
    }

    if (ref.kind === 'character') {
      const character = await this.prisma.character.findFirst({
        where: { id: ref.entityId, projectId },
        include: {
          descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          appearanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          motivationWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          arcWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
        }
      });
      if (!character) throw new HttpError(404, 'Character not found');
      if (ref.field === 'name') return character.name;
      if (ref.field === 'role') return character.role ?? '';
      if (ref.field === 'age') return character.age ?? '';
      if (ref.field === 'occupation') return character.occupation ?? '';
      if (ref.field === 'description') return currentBody(character.descriptionWriting);
      if (ref.field === 'appearance') return currentBody(character.appearanceWriting);
      if (ref.field === 'motivation') return currentBody(character.motivationWriting);
      if (ref.field === 'arc') return currentBody(character.arcWriting);
      throw new HttpError(400, 'Unsupported character collaboration field');
    }

    if (ref.kind === 'location') {
      const location = await this.prisma.location.findFirst({
        where: { id: ref.entityId, projectId },
        include: {
          descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          atmosphereWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          significanceWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          sensoryWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
        }
      });
      if (!location) throw new HttpError(404, 'Location not found');
      if (ref.field === 'name') return location.name;
      if (ref.field === 'type') return location.type ?? '';
      if (ref.field === 'description') return currentBody(location.descriptionWriting);
      if (ref.field === 'atmosphere') return currentBody(location.atmosphereWriting);
      if (ref.field === 'significance') return currentBody(location.significanceWriting);
      if (ref.field === 'sensoryDetails') return currentBody(location.sensoryWriting);
      throw new HttpError(400, 'Unsupported location collaboration field');
    }

    if (ref.kind === 'structure') {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: {
          storyStructure: {
            include: {
              loglineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
              outlineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
              climaxWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
            }
          }
        }
      });
      if (!project?.storyStructure) throw new HttpError(404, 'Story structure not found');
      if (ref.field === 'logline') return currentBody(project.storyStructure.loglineWriting);
      if (ref.field === 'outline') return currentBody(project.storyStructure.outlineWriting);
      if (ref.field === 'climax') return currentBody(project.storyStructure.climaxWriting);
      if (ref.field === 'title') return project.title;
      if (ref.field === 'slug') return project.slug;
      if (ref.field === 'description') return project.description ?? '';
      if (ref.field === 'genre') return project.genre ?? '';
      if (ref.field === 'perspective') return project.perspective ?? '';
      if (ref.field === 'pov') return project.pov ?? '';
      if (ref.field === 'voice') return project.voice ?? '';
      if (ref.field === 'tone') return project.tone ?? '';
      if (ref.field === 'themes') return project.themes.join('\n');
      if (ref.field === 'themesText') return project.themes.join(', ');
      throw new HttpError(400, 'Unsupported structure collaboration field');
    }

    if (ref.kind === 'obstacle') {
      const obstacle = await this.prisma.obstacle.findFirst({
        where: { id: ref.entityId, projectId },
        include: {
          descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
          resolutionWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
        }
      });
      if (!obstacle) throw new HttpError(404, 'Obstacle not found');
      if (ref.field === 'title') return obstacle.title;
      if (ref.field === 'description') return currentBody(obstacle.descriptionWriting);
      if (ref.field === 'resolution') return currentBody(obstacle.resolutionWriting);
      throw new HttpError(400, 'Unsupported obstacle collaboration field');
    }

    if (ref.kind === 'doc') {
      const doc = await this.prisma.projectDoc.findFirst({
        where: { id: ref.entityId, projectId },
        include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
      });
      if (!doc) throw new HttpError(404, 'Project document not found');
      if (ref.field === 'title') return doc.title;
      if (ref.field !== 'content') throw new HttpError(400, 'Unsupported doc collaboration field');
      return currentBody(doc.bodyWriting);
    }

    throw new HttpError(400, 'Unsupported collaboration document kind');
  }
}

function validateRef(ref: CollaborationDocumentRef): void {
  if (!ref.kind || !ref.entityId || !ref.field) throw new HttpError(400, 'Invalid collaboration document');
}

function documentKey(projectId: string, ref: CollaborationDocumentRef): string {
  return `${projectId}:${ref.kind}:${ref.entityId}:${ref.field}`;
}

function toSnapshot(doc: RuntimeDocument): CollaborationSnapshot {
  return {
    document: doc.ref,
    revision: doc.revision,
    content: doc.content,
    collaborators: Array.from(doc.presence.values())
  };
}

function transformChanges(
  changes: CollaborationTextChange[],
  history: CollaborationEdit[],
  baseRevision: number
): CollaborationTextChange[] {
  let transformed = changes.map(normalizeChange);
  for (const edit of history) {
    if (edit.revision <= baseRevision) continue;
    for (const remote of edit.changes) {
      transformed = transformed.map((change) => transformAgainst(change, remote));
    }
  }
  return transformed;
}

function transformAgainst(
  local: CollaborationTextChange,
  remote: CollaborationTextChange
): CollaborationTextChange {
  const remoteStart = remote.rangeOffset;
  const remoteEnd = remote.rangeOffset + remote.rangeLength;
  const localStart = local.rangeOffset;
  const localEnd = local.rangeOffset + local.rangeLength;
  const delta = remote.text.length - remote.rangeLength;

  if (remoteEnd <= localStart) {
    return { ...local, rangeOffset: Math.max(0, local.rangeOffset + delta) };
  }
  if (remoteStart >= localEnd) return local;

  const nextStart = Math.min(localStart, remoteStart + remote.text.length);
  const nextEnd = Math.max(nextStart, localEnd + delta);
  return { ...local, rangeOffset: nextStart, rangeLength: Math.max(0, nextEnd - nextStart) };
}

function normalizeChange(change: CollaborationTextChange): CollaborationTextChange {
  return {
    rangeOffset: Math.max(0, Math.trunc(change.rangeOffset)),
    rangeLength: Math.max(0, Math.trunc(change.rangeLength)),
    text: String(change.text ?? '')
  };
}

function applyChanges(content: string, changes: CollaborationTextChange[]): string {
  return [...changes]
    .sort((a, b) => b.rangeOffset - a.rangeOffset)
    .reduce((next, change) => {
      const start = Math.min(change.rangeOffset, next.length);
      const end = Math.min(start + change.rangeLength, next.length);
      return next.slice(0, start) + change.text + next.slice(end);
    }, content);
}

function currentBody(writing: {
  defaultBranch: { headVersion: { body: string | null } | null } | null;
}): string {
  return writing.defaultBranch?.headVersion?.body ?? '';
}

function writeEvent(res: Response, event: CollaborationEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function getProjectClients(projectId: string): Set<Response> {
  const existing = projectClients.get(projectId);
  if (existing) return existing;
  const clients = new Set<Response>();
  projectClients.set(projectId, clients);
  return clients;
}
