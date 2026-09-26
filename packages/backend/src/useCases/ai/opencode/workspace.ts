import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../../../http/HttpError.js';
import { loadAiAgents, type AiAgentInfo } from '../agents.js';
import { loadAiSkillCatalog, loadAiSkillReferences, safeCatalogName, type AiSkillCatalogItem } from '../markdownCatalog.js';
import { renderSystemPrompt } from '../prompts/promptEngine.js';
import { OPENTALES_PROVIDER_ID, providerConfigFor } from './providers.js';
import { projectWorkspaceDirectory } from './paths.js';
import { basePermissions, OPENTALES_PRIMARY_AGENT, READ_ONLY_AGENT_PERMISSIONS } from './permissions.js';

export interface ProjectWorkspace {
  projectId: string;
  directory: string;
  /** Hash of everything written; changes when settings, agents, or skills change. */
  fingerprint: string;
  defaultModel: string;
  agents: AiAgentInfo[];
}

/**
 * Tool-call budgets per run. Autonomous novel work (a whole planning phase, or
 * drafting a chapter scene by scene) takes hundreds of tool calls; a run still
 * ends at a natural checkpoint, and the Ledger lets the next run resume.
 */
const PRIMARY_AGENT_STEPS = 400;
const SUBAGENT_STEPS = 150;

/** Agents OpenCode ships that make no sense inside a novel IDE. */
const HIDDEN_NATIVE_AGENTS = ['build', 'plan'];

/**
 * Materializes the per-project OpenCode configuration directory from the
 * OpenTales database: provider/model, agents (built-ins + `agents/*.md`
 * project docs), skills (built-ins + ProjectAiSkill rows), and the
 * OpenTales-only permission policy. Writes are idempotent and skipped when the
 * fingerprint is unchanged.
 */
export async function syncProjectWorkspace(
  prisma: PrismaClient,
  projectId: string
): Promise<ProjectWorkspace> {
  const directory = projectWorkspaceDirectory(projectId);
  const [settings, project, agents, skills] = await Promise.all([
    prisma.projectAiSettings.findUnique({ where: { projectId } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { title: true } }),
    loadAiAgents(prisma, projectId),
    loadAiSkillCatalog(prisma, projectId)
  ]);
  if (!project) throw new HttpError(404, 'Project not found');
  if (!settings?.enabled) throw new HttpError(400, 'AI is not enabled for this project');

  const agentModels = agents.map((agent) => agent.model).filter((model): model is string => Boolean(model));
  const provider = providerConfigFor(settings, agentModels);

  const agentConfig: Record<string, unknown> = {};
  for (const id of HIDDEN_NATIVE_AGENTS) agentConfig[id] = { disabled: true };
  agentConfig[OPENTALES_PRIMARY_AGENT] = {
    description: 'OpenTales writing agent: plans, drafts, revises, and organizes the novel inside the project.',
    mode: 'primary',
    system: primarySystemPrompt(),
    steps: PRIMARY_AGENT_STEPS,
    color: '#d4882a'
  };
  agentConfig.planner = {
    description: 'Planning mode. Reads the manuscript and produces plans without changing project data.',
    mode: 'primary',
    system: [
      primarySystemPrompt(),
      'You are in read-only planning mode: project changes are disabled. This is the one exception to "persist, don\'t recite": analyze with read tools and answer in chat with a concise plan or assessment the author can approve before switching to the writer agent.'
    ].join('\n\n'),
    permissions: READ_ONLY_AGENT_PERMISSIONS,
    color: '#7c9cbf'
  };
  agentConfig.general = { steps: SUBAGENT_STEPS };
  agentConfig.explore = {
    description:
      'Fast read-only explorer for manuscripts and project context. Finds chapters, docs, characters, and locations and returns concise findings with IDs.',
    permissions: READ_ONLY_AGENT_PERMISSIONS
  };
  for (const agent of agents) {
    const id = safeCatalogName(agent.name);
    if (!id || id === 'build' || id === 'plan' || id === 'explore' || id === 'general') continue;
    // Primary agents get the shared writer prompt so they inherit the
    // persist-don't-recite contract and memory model; subagents stay focused.
    const primary = agent.mode === 'primary' || agent.mode === 'all';
    const system = primary ? [primarySystemPrompt(), agent.prompt].filter(Boolean).join('\n\n') : agent.prompt;
    agentConfig[id] = {
      description: agent.description,
      mode: agent.mode,
      hidden: agent.hidden ?? false,
      steps: primary ? PRIMARY_AGENT_STEPS : SUBAGENT_STEPS,
      ...(system ? { system } : {}),
      ...(agent.model ? { model: `${OPENTALES_PROVIDER_ID}/${providerConfigFor({ ...settings, model: agent.model }).model.split('/')[1]}` } : {}),
      ...(agent.runtimeRole === 'explorer' || agent.runtimeRole === 'researcher' ? { permissions: READ_ONLY_AGENT_PERMISSIONS } : {})
    };
  }

  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: provider.model,
    default_agent: OPENTALES_PRIMARY_AGENT,
    providers: { [OPENTALES_PROVIDER_ID]: provider.provider },
    agents: agentConfig,
    permissions: basePermissions(),
    snapshots: false,
    share: 'disabled',
    info: { title: project.title }
  };

  const skillFiles = skills.map((skill) => ({
    name: safeCatalogName(skill.name),
    content: skillMarkdown(skill.name, skill.description, skill.content),
    // Built-in skills ship reference files the agent can read on demand.
    references: skill.native ? safeReferences(skill) : []
  })).filter((skill) => skill.name);

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ config, skillFiles }))
    .digest('hex');

  const configDir = path.join(directory, '.opencode');
  const marker = path.join(configDir, '.fingerprint');
  const current = await fs.readFile(marker, 'utf8').catch(() => '');
  if (current !== fingerprint) {
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'opencode.json'), `${JSON.stringify(config, null, 2)}\n`);
    const skillsDir = path.join(configDir, 'skills');
    await fs.rm(skillsDir, { recursive: true, force: true });
    for (const skill of skillFiles) {
      const skillDir = path.join(skillsDir, skill.name);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skill.content);
      for (const reference of skill.references) {
        const target = path.join(skillDir, reference.name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, reference.content);
      }
    }
    await fs.writeFile(
      path.join(directory, 'AGENTS.md'),
      '# OpenTales agent workspace\n\nThis directory is generated. Project data lives in OpenTales and is reached only through OpenTales tools.\n'
    );
    await fs.writeFile(marker, fingerprint);
  }

  return {
    projectId,
    directory,
    fingerprint,
    defaultModel: settings.model,
    agents
  };
}

function primarySystemPrompt(): string {
  return renderSystemPrompt({
    project: { title: '', genre: '', tone: '', voice: '', perspective: '', pov: '' },
    themes: '',
    instructionDocs: [],
    skills: [],
    subagents: []
  });
}

/** Ensure every skill carries the frontmatter OpenCode needs to advertise it. */
function skillMarkdown(name: string, description: string, content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('---')) return `${trimmed}\n`;
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${trimmed}\n`;
}

function safeReferences(skill: AiSkillCatalogItem): Array<{ name: string; content: string }> {
  try {
    return loadAiSkillReferences(skill);
  } catch (error) {
    console.warn(`[opencode] skipping references for skill ${skill.name}`, error);
    return [];
  }
}
