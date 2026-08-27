import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import {
  legacySkillManifest,
  parseSkillManifest,
  type SkillManifest
} from './skills/skillManifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ParsedMarkdownDoc {
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface BuiltInAiSkill {
  id: string;
  projectId: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  native: true;
  manifest: SkillManifest;
}

export interface AiSkillCatalogItem {
  name: string;
  description: string;
  content: string;
  updatedAt: Date;
  native?: boolean;
  manifest: SkillManifest;
}

const builtInSkillCache = new Map<string, BuiltInAiSkill[]>();

export function loadMarkdownFiles(folderName: 'agents' | 'skills'): Array<{ filename: string; markdown: string; manifest?: SkillManifest }> {
  const folderPath = resolve(__dirname, folderName);
  let entries: Dirent[];
  try {
    entries = readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .flatMap((entry) => {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          return [{ filename: entry.name, markdown: readFileSync(resolve(folderPath, entry.name), 'utf-8') }];
        }
        if (entry.isDirectory()) {
          const skillPath = resolve(folderPath, entry.name, 'SKILL.md');
          try {
            const markdown = readFileSync(skillPath, 'utf-8');
            let manifest: SkillManifest | undefined;
            const manifestPath = resolve(folderPath, entry.name, 'skill.json');
            if (existsSync(manifestPath)) {
              const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
              manifest = parseSkillManifest(raw, `${entry.name}/skill.json`);
              if (manifest.name !== safeCatalogName(entry.name)) {
                throw new Error(`Invalid ${entry.name}/skill.json: name must match its directory`);
              }
            }
            return [{ filename: `${entry.name}/SKILL.md`, markdown, manifest }];
          } catch (error) {
            if (existsSync(skillPath) && existsSync(resolve(folderPath, entry.name, 'skill.json'))) throw error;
            return [];
          }
        }
        return [];
      })
      .sort((a, b) => a.filename.localeCompare(b.filename));
}

export function loadBuiltInAiSkills(projectId = '__built_in__'): BuiltInAiSkill[] {
  const cached = builtInSkillCache.get(projectId);
  if (cached) return cached.map((skill) => ({ ...skill }));

  const now = new Date(0);
  const skills = loadMarkdownFiles('skills')
    .map(({ filename, markdown, manifest }) => {
      const parsed = parseMarkdownWithFrontmatter(markdown);
      const fallbackName = filename.replace(/\/SKILL\.md$/i, '').replace(/\.md$/i, '');
      const name = safeCatalogName(String(parsed.frontmatter.name ?? fallbackName));
      const description = stringValue(parsed.frontmatter.description) ?? '';
      if (!name || !description) return null;
      return {
        id: `built-in:${name}`,
        projectId,
        name,
        description,
        content: markdown.trim(),
        enabled: true,
        createdAt: now,
        updatedAt: now,
        native: true as const,
        manifest: manifest ?? legacySkillManifest(name, description)
      };
    })
    .filter((skill): skill is BuiltInAiSkill => Boolean(skill));

  builtInSkillCache.set(projectId, skills);
  return skills.map((skill) => ({ ...skill }));
}

export async function loadAiSkillCatalog(prisma: PrismaClient, projectId: string): Promise<AiSkillCatalogItem[]> {
  const skills: Record<string, AiSkillCatalogItem> = Object.fromEntries(
    loadBuiltInAiSkills(projectId).map((skill) => [skill.name, skill])
  );
  const projectSkills = await prisma.projectAiSkill.findMany({
    where: { projectId },
    orderBy: { name: 'asc' },
    select: { name: true, description: true, content: true, enabled: true, updatedAt: true }
  });

  for (const skill of projectSkills) {
    if (!skill.enabled) {
      delete skills[skill.name];
      continue;
    }
    skills[skill.name] = {
      name: skill.name,
      description: skill.description,
      content: skill.content,
      updatedAt: skill.updatedAt,
      manifest: projectSkillManifest(skill.name, skill.description, skill.content)
    };
  }

  return Object.values(skills).sort((a, b) => a.name.localeCompare(b.name));
}

export async function readAiSkillFromCatalog(
  prisma: PrismaClient,
  projectId: string,
  name: string
): Promise<AiSkillCatalogItem | undefined> {
  const normalized = safeCatalogName(name);
  if (!normalized) return undefined;
  const projectSkill = await prisma.projectAiSkill.findFirst({
    where: { projectId, name: normalized }
  });
  if (projectSkill) {
    return projectSkill.enabled
      ? {
        name: projectSkill.name,
        description: projectSkill.description,
        content: projectSkill.content,
        updatedAt: projectSkill.updatedAt,
        manifest: projectSkillManifest(projectSkill.name, projectSkill.description, projectSkill.content)
      }
      : undefined;
  }
  return loadBuiltInAiSkills(projectId).find((skill) => skill.name === normalized);
}

export function loadAiSkillReferences(skill: Pick<AiSkillCatalogItem, 'name' | 'manifest' | 'native'>): Array<{ name: string; content: string }> {
  if (!skill.manifest.references.length) return [];
  if (!skill.native) throw new Error(`Project skill ${skill.name} declares external references, but project skill resources are not installed`);
  const skillRoot = resolve(__dirname, 'skills', skill.name);
  return skill.manifest.references.map((name) => {
    if (!name || name.startsWith('/') || name.includes('..') || name.includes('\\')) throw new Error(`Skill ${skill.name} has unsafe reference path '${name}'`);
    const path = resolve(skillRoot, name);
    if (!path.startsWith(`${skillRoot}/`)) throw new Error(`Skill ${skill.name} reference escapes its package`);
    return { name, content: readFileSync(path, 'utf8') };
  });
}

export function projectSkillManifest(name: string, description: string, content: string): SkillManifest {
  const parsed = parseMarkdownWithFrontmatter(content);
  const declaredName = stringValue(parsed.frontmatter.name);
  if (declaredName && safeCatalogName(declaredName) !== name) throw new Error(`Project skill manifest name '${declaredName}' does not match '${name}'`);
  const version = stringValue(parsed.frontmatter.version);
  if (!version) return legacySkillManifest(name, description);
  const declaredContext = recordValue(parsed.frontmatter.context);
  return parseSkillManifest({
    schemaVersion: 1,
    name,
    version,
    description,
    kind: stringValue(parsed.frontmatter.kind) ?? 'planning',
    inputs: stringListValue(parsed.frontmatter.inputs),
    outputs: stringListValue(parsed.frontmatter.outputs),
    runtimeRoles: stringListValue(parsed.frontmatter.runtimeRoles, ['creator']),
    allowedTools: stringListValue(parsed.frontmatter.allowedTools, ['readProjectAiSkill']),
    maxIterations: numberValue(parsed.frontmatter.maxIterations) ?? 1,
    context: {
      maxTokens: numberValue(declaredContext.maxTokens) ?? 24_000,
      sections: stringListValue(declaredContext.sections, ['story-brief', 'active-task'])
    },
    rubric: stringValue(parsed.frontmatter.rubric),
    procedure: stringListValue(parsed.frontmatter.procedure, ['Follow the project-owned SKILL.md within the declared runtime capability boundary.']),
    references: stringListValue(parsed.frontmatter.references)
  }, `project skill ${name}`);
}

export function parseMarkdownWithFrontmatter(markdown: string): ParsedMarkdownDoc {
  const text = markdown.trim();
  if (!text.startsWith('---')) return { frontmatter: {}, content: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { frontmatter: {}, content: text };
  const rawFrontmatter = text.slice(3, end).trim();
  const content = text.slice(end + 4).trim();
  return { frontmatter: parseSimpleFrontmatter(rawFrontmatter), content };
}

export function safeCatalogName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function parseSimpleFrontmatter(value: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = value.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf(':');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    if (raw === '>' || raw === '|') {
      const folded: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i += 1;
        folded.push(lines[i].trim());
      }
      result[key] = raw === '>' ? folded.join(' ').replace(/\s+/g, ' ').trim() : folded.join('\n').trim();
    } else {
      result[key] = parseScalar(raw);
    }
  }
  return result;
}

function parseScalar(value: string): unknown {
  const unquoted = value.replace(/^['"]|['"]$/g, '');
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  if (unquoted === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(unquoted)) return Number(unquoted);
  if ((unquoted.startsWith('[') && unquoted.endsWith(']')) || (unquoted.startsWith('{') && unquoted.endsWith('}'))) {
    try { return JSON.parse(unquoted); } catch { return unquoted; }
  }
  return unquoted;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringListValue(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
