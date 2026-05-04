import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';

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
}

export interface AiSkillCatalogItem {
  name: string;
  description: string;
  content: string;
  updatedAt: Date;
  native?: boolean;
}

const builtInSkillCache = new Map<string, BuiltInAiSkill[]>();

export function loadMarkdownFiles(folderName: 'agents' | 'skills'): Array<{ filename: string; markdown: string }> {
  const folderPath = resolve(__dirname, folderName);
  try {
    return readdirSync(folderPath, { withFileTypes: true })
      .flatMap((entry) => {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          return [{ filename: entry.name, markdown: readFileSync(resolve(folderPath, entry.name), 'utf-8') }];
        }
        if (entry.isDirectory()) {
          const skillPath = resolve(folderPath, entry.name, 'SKILL.md');
          try {
            return [{ filename: `${entry.name}/SKILL.md`, markdown: readFileSync(skillPath, 'utf-8') }];
          } catch {
            return [];
          }
        }
        return [];
      })
      .sort((a, b) => a.filename.localeCompare(b.filename));
  } catch {
    return [];
  }
}

export function loadBuiltInAiSkills(projectId = '__built_in__'): BuiltInAiSkill[] {
  const cached = builtInSkillCache.get(projectId);
  if (cached) return cached.map((skill) => ({ ...skill }));

  const now = new Date(0);
  const skills = loadMarkdownFiles('skills')
    .map(({ filename, markdown }) => {
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
        native: true as const
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
      updatedAt: skill.updatedAt
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
        updatedAt: projectSkill.updatedAt
      }
      : undefined;
  }
  return loadBuiltInAiSkills(projectId).find((skill) => skill.name === normalized);
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
  return unquoted;
}
