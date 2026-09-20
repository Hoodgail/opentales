import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { NovelBuildUseCase } from '../src/useCases/novelBuild/NovelBuildUseCase.js';
import { ARTIFACT_TYPES } from '../src/useCases/novelBuild/schemas.js';
import { resumeRunnableBuilds } from '../src/useCases/ai/workflow/NovelBuildWorker.js';
import { ProjectExportUseCase } from '../src/useCases/exportImport/ProjectExportUseCase.js';
import { ProjectAiSettingsUseCase } from '../src/useCases/ai/ProjectAiSettingsUseCase.js';
import { encryptSecret } from '../src/utils/secretBox.js';

// Run only against a migrated disposable database. Credentials stay in the environment.
const apiKey = process.env.LIVE_API_KEY;
const baseUrl = process.env.LIVE_BASE_URL;
const model = process.env.LIVE_MODEL;
if (!apiKey || !baseUrl || !model) throw new Error('LIVE_API_KEY, LIVE_BASE_URL and LIVE_MODEL are required');
const maxTokens = process.env.LIVE_MAX_TOKENS ? Number(process.env.LIVE_MAX_TOKENS) : 5_000_000;
assert(Number.isSafeInteger(maxTokens) && maxTokens > 0, 'LIVE_MAX_TOKENS must be a positive safe integer');
const prisma = new PrismaClient();
const output = process.env.LIVE_OUTPUT_DIR ?? '/tmp/opentales-live-result';
await mkdir(output, { recursive: true });
try {
  const suffix = randomUUID();
  let buildRunId = process.env.LIVE_BUILD_ID;
  if (!buildRunId) {
    const user = await prisma.user.create({ data: { username: `live-${suffix}`, email: `${suffix}@example.test`, passwordHash: 'no-login' } });
    const org = await prisma.org.create({ data: { slug: `live-${suffix}`, name: 'Live build validation', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
    const project = await prisma.project.create({ data: { orgId: org.id, slug: 'last-signal', title: 'The Last Signal', genre: 'literary speculative fiction' } });
    await prisma.projectAiSettings.create({ data: { projectId: project.id, enabled: true, providerKind: 'OPENAI_COMPATIBLE', baseUrl, model, apiKey: encryptSecret(apiKey) } });
    const run = await new NovelBuildUseCase(prisma).create(user.id, project.id, {
      idempotencyKey: suffix,
      brainstorm: 'At a coastal radio station scheduled for demolition at dawn, Mara receives a recording of her late father asking her to keep transmitting. Her practical brother Ivo arrives to disconnect the power. The signal is an old emergency relay, not a ghost. Together they must choose what to save before the tide floods the transmitter room. End with a concrete costly choice, a repaired relationship, and no supernatural reversal.',
      objective: 'Write a complete polished 1200-word short story in two chapters and three causal scenes. Use specific sensory details, restrained emotion, natural dialogue, and a resolved ending. Planning must serve the actual finished prose.',
      targetWordCount: 1200, minWordCount: 1000, maxWordCount: 1800,
      targetChapterCount: 2, targetSceneCount: 3, targetCharacterCount: 2,
      autonomyMode: 'autonomous-draft',
      authorizationScope: { artifactTypes: [...ARTIFACT_TYPES], chapterIds: [], sceneIds: [], allowPlanningArtifacts: true, allowCanonWrites: true, allowChapterWrites: true, allowSceneWrites: true, allowDiagnostics: true, expiresAt: null },
      maxTokens, maxCostMicros: 200_000_000
    });
    buildRunId = run.id;
    await writeFile(`${output}/run-id.txt`, buildRunId);
    console.log(JSON.stringify({ buildRunId }));
  }
  const existingRun = await prisma.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
  const existingSettings = await prisma.projectAiSettings.findUniqueOrThrow({ where: { projectId: existingRun.projectId } });
  if (existingSettings.model !== model) {
    await new ProjectAiSettingsUseCase(prisma).update(existingRun.authorizedById ?? existingRun.createdById!, existingRun.projectId, { model });
  }
  if (process.env.LIVE_BUILD_ID && process.env.LIVE_MAX_TOKENS) {
    const builds = new NovelBuildUseCase(prisma);
    const current = await builds.get(existingRun.authorizedById ?? existingRun.createdById!, existingRun.projectId, buildRunId);
    await builds.authorize(existingRun.authorizedById ?? existingRun.createdById!, existingRun.projectId, buildRunId, {
      idempotencyKey: randomUUID(), expectedRevision: current.revision,
      authorizationScope: current.authorizationScope, maxTokens
    });
  }
  if (process.env.LIVE_RERUN_TASK) {
    const run = await prisma.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
    const task = await prisma.buildTask.findFirstOrThrow({ where: { buildRunId, key: process.env.LIVE_RERUN_TASK } });
    await new NovelBuildUseCase(prisma).rerun(run.authorizedById ?? run.createdById!, run.projectId, run.id, task.id, {
      idempotencyKey: randomUUID(), expectedRevision: run.revision,
      reason: 'Explicit live validation rerun after correcting the implementation; invalidate dependent outputs.'
    });
  }
  // Explicit conservative validation accounting, not a claim about provider billing.
  const price = { inputMicrosPerMillion: 10_000_000, outputMicrosPerMillion: 40_000_000, source: 'live validation accounting ceiling; not provider billing', version: '1' };
  const modelPricing = { [model]: price, [existingSettings.model]: price };
  let completed = false;
  for (let sweep = 0; sweep < 500; sweep++) {
    const count = await resumeRunnableBuilds(prisma, { buildRunIds: [buildRunId], maxTasksPerSweep: 1, modelPricing });
    const run = await prisma.buildRun.findUniqueOrThrow({ where: { id: buildRunId } });
    const tasks = await prisma.buildTask.findMany({ where: { buildRunId }, orderBy: { createdAt: 'asc' }, select: { key: true, status: true, attempts: true, lastError: true } });
    console.log(JSON.stringify({ status: run.status, phase: run.currentPhase, done: tasks.filter(t => t.status === 'DONE').length, total: tasks.length, errors: tasks.filter(t => t.lastError).map(t => ({ key: t.key, error: t.lastError })), lastError: run.lastError }));
    await writeFile(`${output}/report.json`, JSON.stringify({ buildRunId, model, status: run.status, phase: run.currentPhase, lastError: run.lastError, tasks }, null, 2));
    if (['COMPLETED', 'FAILED', 'PAUSED', 'CANCELLED'].includes(run.status)) {
      const units = await prisma.buildManuscriptUnit.findMany({ where: { buildRunId }, orderBy: { order: 'asc' }, include: { branch: { include: { headVersion: true } } } });
      const chapterOrder = new Map(units.filter(unit => unit.kind === 'CHAPTER').map(unit => [unit.id, unit.chapterNumber ?? unit.order]));
      const orderedScenes = units.filter(unit => unit.kind === 'SCENE' && !unit.invalidatedAt).sort((a, b) => (chapterOrder.get(a.parentUnitId!) ?? 0) - (chapterOrder.get(b.parentUnitId!) ?? 0) || a.order - b.order);
      await writeFile(`${output}/manuscript.md`, orderedScenes.map(u => `## ${u.title}\n\n${u.branch.headVersion?.body ?? ''}`).join('\n\n'));
      if (run.status === 'COMPLETED') {
        assert(tasks.every(task => task.status === 'DONE'), 'Every workflow task must be DONE');
        const scenes = orderedScenes;
        assert.equal(scenes.length, 3);
        assert(scenes.every(unit => (unit.branch.headVersion?.wordCount ?? 0) > 0), 'Every scene needs saved prose');
        const words = scenes.reduce((sum, unit) => sum + (unit.branch.headVersion?.wordCount ?? 0), 0);
        assert(words >= 1000 && words <= 1800, `Manuscript has ${words} words, expected 1000–1800`);
        const exports = await prisma.projectExport.findMany({ where: { buildRunId, status: 'READY', deletedAt: null } });
        assert(exports.length > 0, 'A completed build needs a real export');
        const artifact = await new ProjectExportUseCase(prisma).download(run.authorizedById ?? run.createdById!, run.projectId, exports[0].id);
        const chunks: Buffer[] = [];
        for await (const chunk of artifact.stream) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.checksum);
        await writeFile(`${output}/story.txt`, bytes);
        const modelsUsed = (await prisma.buildTrace.findMany({ where: { buildRunId, model: { not: null } }, distinct: ['model'], select: { model: true } })).map(trace => trace.model);
        await writeFile(`${output}/verification.json`, JSON.stringify({ buildRunId, model, modelsUsed, words, scenes: scenes.length, tasks: tasks.length, exportChecksum: artifact.checksum, tokensUsed: run.tokensUsed, accountingCostMicros: run.costMicrosUsed }, null, 2));
        completed = true;
      } else process.exitCode = 1;
      break;
    }
    if (!count) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!completed) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
