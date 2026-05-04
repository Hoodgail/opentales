import type { PrismaClient } from '@prisma/client';
import { bodyOf } from './tools/shared.js';
import {
  booleanValue,
  loadMarkdownFiles,
  parseMarkdownWithFrontmatter,
  safeCatalogName,
  stringValue
} from './markdownCatalog.js';

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

const NATIVE_AGENTS: Record<string, AiAgentInfo> = {
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

const builtInAgentCache = new Map<string, AiAgentInfo>();

function loadBuiltInAgents(): Record<string, AiAgentInfo> {
  if (builtInAgentCache.size === 0) {
    for (const agent of Object.values(NATIVE_AGENTS)) builtInAgentCache.set(agent.name, { ...agent });

    for (const { filename, markdown } of loadMarkdownFiles('agents')) {
      const nameFromPath = agentNameFromDocTitle(filename.replace(/^.*[\\/]/, ''));
      const parsed = parseMarkdownWithFrontmatter(markdown);
      const name = safeAgentName(String(parsed.frontmatter.name ?? nameFromPath));
      if (!name) continue;
      const current = builtInAgentCache.get(name) ?? {
        name,
        description: '',
        mode: 'all' as const,
        native: true
      };
      builtInAgentCache.set(name, {
        ...current,
        name,
        description: stringValue(parsed.frontmatter.description) ?? current.description,
        mode: modeValue(parsed.frontmatter.mode) ?? current.mode,
        model: stringValue(parsed.frontmatter.model) ?? current.model,
        prompt: parsed.content || stringValue(parsed.frontmatter.prompt) || current.prompt,
        hidden: booleanValue(parsed.frontmatter.hidden) ?? current.hidden,
        native: true
      });
    }
  }

  return Object.fromEntries(Array.from(builtInAgentCache.entries()).map(([name, agent]) => [name, { ...agent }]));
}

export async function loadAiAgents(prisma: PrismaClient, projectId: string): Promise<AiAgentInfo[]> {
  const agents: Record<string, AiAgentInfo> = loadBuiltInAgents();

  const agentsFolder = await prisma.projectFolder.findFirst({
    where: { projectId, parentFolderId: null, name: 'agents' },
    select: { id: true }
  });
  if (!agentsFolder) return Object.values(agents).filter((agent) => agent.description.trim().length > 0);

  const docs = await prisma.projectDoc.findMany({
    where: { projectId, folderId: agentsFolder.id },
    include: {
      bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]
  });

  for (const doc of docs) {
    const nameFromPath = agentNameFromDocTitle(doc.title);
    const parsed = parseMarkdownWithFrontmatter(bodyOf(doc.bodyWriting));
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

function agentNameFromDocTitle(title: string): string {
  return safeAgentName(title.replace(/\.md$/i, ''));
}

function safeAgentName(value: string): string {
  return safeCatalogName(value);
}

function modeValue(value: unknown): AiAgentMode | undefined {
  return value === 'primary' || value === 'subagent' || value === 'all' ? value : undefined;
}
