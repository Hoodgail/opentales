import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface SkillEvalCase {
  id: string | number;
  prompt: string;
  expected_output: string;
  files?: unknown[];
}

interface SkillEvalFile {
  skill_name: string;
  evals: SkillEvalCase[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(here, '../useCases/ai/skills');

async function skillDirectories(): Promise<string[]> {
  return (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function frontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const values: Record<string, string> = {};
  let foldedField: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (foldedField && /^\s+\S/.test(line)) {
      values[foldedField] = `${values[foldedField]} ${line.trim()}`.trim();
      continue;
    }
    foldedField = null;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    const raw = field[2].trim();
    values[field[1]] = /^[>|]$/.test(raw) ? '' : raw.replace(/^['"]|['"]$/g, '');
    if (/^[>|]$/.test(raw)) foldedField = field[1];
  }
  return values;
}

describe('built-in Agent Skill catalog', () => {
  it('has unique directory and declared names with useful descriptions', async () => {
    const directories = await skillDirectories();
    expect(directories.length).toBeGreaterThan(0);

    const declaredNames: string[] = [];
    for (const directory of directories) {
      const markdown = await readFile(path.join(skillsRoot, directory, 'SKILL.md'), 'utf8');
      const metadata = frontmatter(markdown);
      expect(metadata.name, `${directory} must declare a name`).toBe(directory);
      expect(metadata.description?.length, `${directory} needs a useful description`).toBeGreaterThan(20);
      declaredNames.push(metadata.name);
    }

    expect(new Set(declaredNames).size).toBe(declaredNames.length);
  });

  it('keeps every available eval fixture well formed and tied to its skill', async () => {
    const directories = await skillDirectories();
    let evaluatedSkills = 0;

    for (const directory of directories) {
      const evalPath = path.join(skillsRoot, directory, 'evals/evals.json');
      let source: string;
      try {
        source = await readFile(evalPath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      evaluatedSkills += 1;
      const fixture = JSON.parse(source) as SkillEvalFile;
      expect(fixture.skill_name).toBe(directory);
      expect(fixture.evals.length).toBeGreaterThanOrEqual(2);
      expect(new Set(fixture.evals.map((entry) => String(entry.id))).size).toBe(fixture.evals.length);
      for (const entry of fixture.evals) {
        expect(entry.prompt.trim().length).toBeGreaterThan(40);
        expect(entry.expected_output.trim().length).toBeGreaterThan(40);
        expect(entry.files ?? []).toBeInstanceOf(Array);
      }
    }

    expect(evaluatedSkills).toBeGreaterThanOrEqual(5);
  });
});
