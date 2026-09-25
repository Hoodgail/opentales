import type {
  AiAgentMessage,
  AiAgentPart,
  AiAgentPermissionRequest,
  AiAgentQuestion,
  AiAgentSessionStatus,
  AiAgentSessionSummary,
  AiAgentTokenUsage,
  AiAgentModelRef,
  AiQuestionField
} from '@opentales/sdk';
import { parseMetadata } from './host.js';
import { modelFromKey } from './providers.js';
import { projectIdFromWorkspace } from './paths.js';

/**
 * Pure projections from OpenCode wire objects (as returned by the embedded
 * client) to the stable OpenTales SDK types. Kept loose-typed on input so an
 * OpenCode minor version bump degrades gracefully instead of failing a build.
 */

type Json = Record<string, any>;

export function toTokens(tokens: Json | undefined | null): AiAgentTokenUsage {
  return {
    input: Number(tokens?.input ?? 0),
    output: Number(tokens?.output ?? 0),
    reasoning: Number(tokens?.reasoning ?? 0),
    cacheRead: Number(tokens?.cache?.read ?? 0),
    cacheWrite: Number(tokens?.cache?.write ?? 0)
  };
}

export function toModelRef(model: Json | undefined | null): AiAgentModelRef | null {
  if (!model?.id) return null;
  return {
    providerId: String(model.providerID ?? ''),
    modelId: String(model.id),
    model: modelFromKey(String(model.id))
  };
}

const iso = (ms: unknown) => new Date(typeof ms === 'number' ? ms : Date.now()).toISOString();

export function toSessionSummary(
  info: Json,
  status: AiAgentSessionStatus = 'idle',
  rootMetadata?: ReturnType<typeof parseMetadata>
): AiAgentSessionSummary {
  const metadata = parseMetadata(info.metadata) ?? rootMetadata ?? null;
  return {
    id: String(info.id),
    projectId: metadata?.opentalesProjectId ?? projectIdFromWorkspace(String(info.location?.directory ?? '')) ?? '',
    parentId: info.parentID ?? null,
    title: typeof info.title === 'string' && info.title.trim() ? info.title : 'New session',
    agent: info.agent ?? null,
    model: toModelRef(info.model),
    approvalMode: metadata?.approvalMode ?? 'manual',
    status: status === 'idle' && info.outcome === 'failed' ? 'error' : status,
    outcome: info.outcome ?? null,
    cost: Number(info.cost ?? 0),
    tokens: toTokens(info.tokens),
    createdAt: iso(info.time?.created),
    updatedAt: iso(info.time?.updated ?? info.time?.created)
  };
}

export function toolOutputText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item: Json) => (item?.type === 'text' ? String(item.text ?? '') : item?.type === 'file' ? `[file ${item.name ?? item.uri}]` : ''))
    .join('\n');
}

export function childSessionFromTool(part: Json): string | null {
  const fromMetadata = part.state?.metadata?.sessionID;
  if (typeof fromMetadata === 'string') return fromMetadata;
  const match = /<subagent sessionID="([^"]+)"/.exec(toolOutputText(part.state?.content));
  return match?.[1] ?? null;
}

export function toToolPart(part: Json): Extract<AiAgentPart, { type: 'tool' }> {
  const state = part.state ?? { status: 'running', input: {} };
  const common = {
    type: 'tool' as const,
    id: String(part.id),
    name: String(part.name),
    childSessionId: part.name === 'subagent' ? childSessionFromTool(part) : null,
    startedAt: part.time?.ran ? iso(part.time.ran) : part.time?.created ? iso(part.time.created) : null,
    completedAt: part.time?.completed ? iso(part.time.completed) : null
  };
  switch (state.status) {
    case 'streaming':
      return { ...common, state: { status: 'streaming', input: String(state.input ?? '') } };
    case 'completed':
      return {
        ...common,
        state: { status: 'completed', input: state.input ?? {}, output: toolOutputText(state.content), metadata: state.metadata }
      };
    case 'error':
      return {
        ...common,
        state: {
          status: 'error',
          input: state.input ?? {},
          error: String(state.error?.message ?? 'Tool failed'),
          output: state.content ? toolOutputText(state.content) : undefined,
          metadata: state.metadata
        }
      };
    default:
      return { ...common, state: { status: 'running', input: state.input ?? {}, metadata: state.metadata } };
  }
}

export function toMessage(message: Json): AiAgentMessage | null {
  const createdAt = iso(message.time?.created);
  switch (message.type) {
    case 'user':
      return {
        id: String(message.id),
        role: 'user',
        text: String(message.text ?? ''),
        files: Array.isArray(message.files)
          ? message.files.map((file: Json) => ({
              name: file.name ?? null,
              mime: String(file.mime ?? 'application/octet-stream'),
              uri: file.source?.type === 'uri' ? String(file.source.uri) : `data:${file.mime};base64,`
            }))
          : [],
        createdAt
      };
    case 'assistant': {
      const parts: AiAgentPart[] = [];
      for (const part of message.content ?? []) {
        if (part.type === 'text') parts.push({ type: 'text', text: String(part.text ?? '') });
        else if (part.type === 'reasoning') parts.push({ type: 'reasoning', text: String(part.text ?? '') });
        else if (part.type === 'tool') parts.push(toToolPart(part));
      }
      return {
        id: String(message.id),
        role: 'assistant',
        agent: String(message.agent ?? ''),
        model: toModelRef(message.model),
        parts,
        finish: message.finish ?? null,
        error: message.error?.message ?? null,
        cost: Number(message.cost ?? 0),
        tokens: message.tokens ? toTokens(message.tokens) : null,
        createdAt,
        completedAt: message.time?.completed ? iso(message.time.completed) : null
      };
    }
    case 'skill':
      return { id: String(message.id), role: 'system', kind: 'skill', text: `Skill activated: ${message.name ?? message.skill}`, createdAt };
    case 'synthetic':
    case 'system':
      return { id: String(message.id), role: 'system', kind: message.type, text: String(message.description ?? message.text ?? ''), createdAt };
    case 'compaction':
      return {
        id: String(message.id),
        role: 'system',
        kind: 'compaction',
        text: message.status === 'completed' ? 'Earlier conversation was summarized to free context.' : message.status === 'failed' ? 'Context compaction failed.' : 'Summarizing earlier conversation…',
        createdAt
      };
    case 'agent-switched':
    case 'agent-selected':
      return { id: String(message.id), role: 'system', kind: 'agent', text: `Switched to agent ${message.agent ?? ''}`.trim(), createdAt };
    case 'model-switched':
    case 'model-selected':
      return { id: String(message.id), role: 'system', kind: 'model', text: `Model set to ${toModelRef(message.model)?.model ?? ''}`.trim(), createdAt };
    default:
      return null;
  }
}

export function toPermissionRequest(request: Json): AiAgentPermissionRequest {
  const metadata = (request.metadata ?? {}) as Json;
  return {
    id: String(request.id),
    sessionId: String(request.sessionID),
    toolName: String(metadata.tool ?? request.resources?.[0] ?? request.action ?? 'unknown'),
    toolInput: (metadata.input && typeof metadata.input === 'object' ? metadata.input : {}) as Record<string, unknown>,
    toolCallId: request.source?.id ?? null,
    messageId: request.source?.messageID ?? null,
    message: request.message ?? null
  };
}

export function toQuestion(form: Json): AiAgentQuestion {
  const fields: AiQuestionField[] = (form.fields ?? []).map((field: Json) => ({
    key: String(field.key),
    title: String(field.title ?? field.key),
    description: field.description ?? undefined,
    type: (['string', 'multiselect', 'boolean', 'number', 'integer'].includes(field.type) ? field.type : 'string') as AiQuestionField['type'],
    options: Array.isArray(field.options)
      ? field.options.map((option: Json) => ({ value: String(option.value), label: String(option.label ?? option.value), description: option.description ?? undefined }))
      : [],
    custom: field.custom !== false
  }));
  return {
    id: String(form.id),
    sessionId: String(form.sessionID),
    title: String(form.title ?? 'Questions'),
    toolCallId: form.metadata?.tool?.id ?? null,
    fields
  };
}
