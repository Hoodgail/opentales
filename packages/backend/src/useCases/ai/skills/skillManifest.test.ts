import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkillManifest } from './skillManifest.js';
import { loadAiSkillReferences, loadBuiltInAiSkills, projectSkillManifest } from '../markdownCatalog.js';

describe('skill manifests', () => {
it('rejects undeclared capability fields', () => {
  expect(() => parseSkillManifest({
    schemaVersion: 1,
    name: 'unsafe-skill',
    version: '1.0.0',
    description: 'Unsafe',
    kind: 'planning',
    runtimeRoles: ['creator'],
    allowedTools: ['applyArtifactBatch'],
    context: { maxTokens: 2_000, sections: ['story-brief'] },
    procedure: ['Do work'],
    shellAccess: true
  })).toThrow(/Unrecognized key/);
});

it('declares bounded procedure, role, tools, and context', () => {
  const manifest = parseSkillManifest({
    schemaVersion: 1,
    name: 'novel-build',
    version: '1.0.0',
    description: 'Build a novel through durable tasks.',
    kind: 'workflow',
    inputs: ['story-brief'],
    outputs: ['chapter-draft'],
    runtimeRoles: ['orchestrator'],
    allowedTools: ['getBuildState'],
    maxIterations: 2,
    context: { maxTokens: 16_000, sections: ['story-brief', 'active-task'] },
    procedure: ['Schedule the next dependency-ready task.']
  });
  expect(manifest.version).toBe('1.0.0');
  expect(manifest.maxIterations).toBe(2);
});

it('validates the shipped novel-build entrypoint manifest', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifest = parseSkillManifest(JSON.parse(await readFile(resolve(here, 'novel-build/skill.json'), 'utf8')));
  expect(manifest.name).toBe('novel-build');
  expect(manifest.kind).toBe('workflow');
  expect(manifest.allowedTools).toContain('commitCanonDelta');
  expect(manifest.allowedTools).toEqual(expect.arrayContaining(['listBuildRuns', 'startNovelBuild']));
  expect(manifest.maxIterations).toBeLessThanOrEqual(2);
  const skill = loadBuiltInAiSkills().find((candidate) => candidate.name === 'novel-build');
  expect(skill && loadAiSkillReferences(skill)).toEqual([{ name: 'references/runtime-boundaries.md', content: expect.stringContaining('Durable runtime boundaries') }]);
});

it('gives every shipped skill a matching versioned machine contract', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const directories = (await readdir(here, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const manifests = await Promise.all(directories.map(async (entry) => parseSkillManifest(JSON.parse(await readFile(resolve(here, entry.name, 'skill.json'), 'utf8')), `${entry.name}/skill.json`)));
  expect(manifests).toHaveLength(directories.length);
  expect(new Set(manifests.map((manifest) => manifest.name)).size).toBe(manifests.length);
  for (const manifest of manifests) {
    expect(manifest.name).toBe(directories.find((entry) => entry.name === manifest.name)?.name);
    expect(manifest.procedure.length).toBeGreaterThan(0);
    expect(manifest.allowedTools.length).toBeGreaterThan(0);
  }
});

it('rejects mismatched project-owned skill provenance', () => {
  expect(() => projectSkillManifest('safe-name', 'A sufficiently useful description', [
    '---',
    'name: different-name',
    'version: 2.0.0',
    'kind: planning',
    '---',
    'Instructions'
  ].join('\n'))).toThrow(/does not match/);
});

it('validates explicit project-owned runtime permissions and context instead of silently widening them', () => {
  const manifest = projectSkillManifest('project-drafter', 'A scoped project drafting procedure', [
    '---',
    'name: project-drafter',
    'version: 3.1.0',
    'kind: drafting',
    'runtimeRoles: ["drafter"]',
    'allowedTools: ["readBuildUnit", "applyBuildUnitPatch"]',
    'inputs: ["scene-plan"]',
    'outputs: ["chapter-draft"]',
    'maxIterations: 2',
    'context: {"maxTokens":12000,"sections":["active-task","recent-causal","canon"]}',
    'procedure: ["Read the assigned unit.", "Patch only that unit."]',
    '---',
    'Project-specific drafting constraints.'
  ].join('\n'));
  expect(manifest.runtimeRoles).toEqual(['drafter']);
  expect(manifest.allowedTools).toEqual(['readBuildUnit', 'applyBuildUnitPatch']);
  expect(manifest.context.maxTokens).toBe(12_000);
  expect(manifest.maxIterations).toBe(2);
});
});
