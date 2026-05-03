import type { PrismaClient } from '@prisma/client';
import { bodyOf } from './tools/shared.js';

export type AiAgentMode = 'primary' | 'subagent' | 'all';

export interface AiAgentInfo {
  name: string;
  description: string;
  mode: AiAgentMode;
  prompt?: string;
  model?: string;
  hidden?: boolean;
  native?: boolean;
}

const BUILT_IN_AGENTS: Record<string, AiAgentInfo> = {
  build: {
    name: 'build',
    description: 'The default agent. Executes tools based on configured permissions.',
    mode: 'primary',
    native: true
  },
  plan: {
    name: 'plan',
    description: 'Plan mode. Focuses on analysis and planning before implementation.',
    mode: 'primary',
    prompt: 'You are in planning mode. Analyze the request, gather context, and produce a concise implementation plan. Do not propose project mutations unless the user asks you to proceed.',
    native: true
  },
  general: {
    name: 'general',
    description: 'General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.',
    mode: 'subagent',
    native: true
  },
  explore: {
    name: 'explore',
    description: 'Fast agent specialized for exploring manuscripts and project context. Use this when you need to quickly find chapters, docs, characters, locations, or answer questions about project structure. Specify desired thoroughness: quick, medium, or very thorough.',
    mode: 'subagent',
    prompt: 'You are an explore subagent. Gather context quickly using read-only tools, prefer lists and bounded reads, and return concise findings with relevant IDs and titles. Do not propose mutations unless explicitly asked by the parent agent.',
    native: true
  }
};

export async function loadAiAgents(prisma: PrismaClient, projectId: string): Promise<AiAgentInfo[]> {
  const agents: Record<string, AiAgentInfo> = Object.fromEntries(
    Object.entries(BUILT_IN_AGENTS).map(([name, agent]) => [name, { ...agent }])
  );

  const docs = await prisma.projectDoc.findMany({
    where: { projectId },
    include: {
      folder: true,
      bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]
  });

  for (const doc of docs) {
    const path = doc.folder ? `${doc.folder.path}/${doc.title}` : doc.title;
    const nameFromPath = agentNameFromPath(path);
    if (!nameFromPath) continue;
    const parsed = parseAgentMarkdown(bodyOf(doc.bodyWriting));
    const name = safeAgentName(String(parsed.frontmatter.name ?? nameFromPath));
    if (!name) continue;
    const current = agents[name] ?? {
      name,
      description: '',
      mode: 'all' as const,
      native: false
    };
    agents[name] = {
      ...current,
      name,
      description: stringValue(parsed.frontmatter.description) ?? current.description,
      mode: modeValue(parsed.frontmatter.mode) ?? current.mode,
      model: stringValue(parsed.frontmatter.model) ?? current.model,
      prompt: parsed.content || stringValue(parsed.frontmatter.prompt) || current.prompt,
      hidden: booleanValue(parsed.frontmatter.hidden) ?? current.hidden,
      native: current.native ?? false
    };
  }

  return Object.values(agents).filter((agent) => agent.description.trim().length > 0);
}

export function subagentsForTask(agents: AiAgentInfo[]): AiAgentInfo[] {
  return agents
    .filter((agent) => (agent.mode === 'subagent' || agent.mode === 'all') && !agent.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findAgent(agents: AiAgentInfo[], name: string): AiAgentInfo | undefined {
  const normalized = safeAgentName(name);
  return agents.find((agent) => agent.name === normalized);
}

function agentNameFromPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const match = normalized.match(/^(?:agent|agents)\/(.+)\.md$/i);
  if (!match) return null;
  const basename = match[1].split('/').pop() ?? '';
  return safeAgentName(basename) || null;
}

function safeAgentName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseAgentMarkdown(markdown: string): { frontmatter: Record<string, unknown>; content: string } {
  const text = markdown.trim();
  if (!text.startsWith('---')) return { frontmatter: {}, content: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { frontmatter: {}, content: text };
  const rawFrontmatter = text.slice(3, end).trim();
  const content = text.slice(end + 4).trim();
  return { frontmatter: parseSimpleFrontmatter(rawFrontmatter), content };
}

function parseSimpleFrontmatter(value: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf(':');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    result[key] = parseScalar(raw);
  }
  return result;
}

function parseScalar(value: string): unknown {
  const unquoted = value.replace(/^['"]|['"]$/g, '');
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  if (unquoted === 'null') return null;
  return unquoted;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function modeValue(value: unknown): AiAgentMode | undefined {
  return value === 'primary' || value === 'subagent' || value === 'all' ? value : undefined;
}
