import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.NOVEL_BUILD_TEST_DATABASE_URL;
process.env.DATABASE_URL ??= databaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ??= 'validation-test-secret-not-for-production';
const { NovelBuildUseCase } = await import('../useCases/novelBuild/NovelBuildUseCase.js');
const execFileAsync = promisify(execFile);

describe.runIf(Boolean(databaseUrl))('live validation process restart', () => {
  it('resumes the saved paused run without reauthorizing it, duplicating it or calling a provider', async () => {
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    const suffix = randomUUID();
    const output = await mkdtemp(join(tmpdir(), 'opentales-live-restart-'));
    let orgId: string | undefined;
    let userId: string | undefined;
    let modelRequests = 0;
    const provider = createServer((request, response) => {
      if (request.url !== '/models') modelRequests++;
      response.setHeader('Content-Type', 'application/json');
      response.end('{}');
    });
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const user = await prisma.user.create({ data: { username: `restart-${suffix}`, email: `restart-${suffix}@example.test`, passwordHash: 'no-login' } });
      userId = user.id;
      const org = await prisma.org.create({ data: { slug: `restart-${suffix}`, name: 'Restart fixture', memberships: { create: { userId, role: 'OWNER' } } } });
      orgId = org.id;
      const project = await prisma.project.create({ data: { orgId, slug: 'story', title: 'Restart fixture' } });
      const builds = new NovelBuildUseCase(prisma);
      const run = await builds.create(userId, project.id, {
        idempotencyKey: suffix, brainstorm: 'A courier returns a lost letter before the last train departs.',
        objective: 'Write a complete short story with a resolved ending.',
        targetWordCount: 1200, minWordCount: 1000, maxWordCount: 1800,
        targetChapterCount: 2, targetSceneCount: 3, targetCharacterCount: 2,
        autonomyMode: 'autonomous-draft', maxTokens: 5_000_000, maxCostMicros: 10_000_000
      });
      await builds.pause(userId, project.id, run.id, { idempotencyKey: `${suffix}:pause`, expectedRevision: run.revision, reason: 'Author paused validation for review' });
      const before = await prisma.buildRun.findUniqueOrThrow({ where: { id: run.id } });
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('LIVE_')));
      Object.assign(env, {
        DATABASE_URL: databaseUrl, LIVE_API_KEY: 'fixture-key-never-sent', LIVE_BASE_URL: `${baseUrl}/v1`, LIVE_MODEL: 'fixture-model',
        LIVE_MAX_TOKENS: '5000000', LIVE_OUTPUT_DIR: output, LIVE_REQUIRE_BUILD_ID: '1', LIVE_SUPERVISED: '1',
        LIVE_HEARTBEAT_SECONDS: '1', LIVE_SOURCE_REVISION: 'fixture-revision', AI_MODELS_DEV_PRICING_URL: `${baseUrl}/models`
      });
      const script = fileURLToPath(new URL('../../scripts/live-novel-build.ts', import.meta.url));
      // A second process starts with only the persisted output directory.
      await execFileAsync(process.execPath, ['--import', 'tsx', script], { env: { ...env, LIVE_BUILD_ID: run.id }, timeout: 30000 });
      await execFileAsync(process.execPath, ['--import', 'tsx', script], { env, timeout: 30000 });
      const after = await prisma.buildRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(after.status).toBe('PAUSED');
      expect(after.revision).toBe(before.revision);
      expect(after.authorizedAt).toEqual(before.authorizedAt);
      expect(await prisma.buildRun.count({ where: { projectId: project.id } })).toBe(1);
      expect(await prisma.buildTrace.count({ where: { buildRunId: run.id } })).toBe(0);
      expect(modelRequests).toBe(0);
      expect((await readFile(`${output}/run-id.txt`, 'utf8')).trim()).toBe(run.id);
      const heartbeat = JSON.parse(await readFile(`${output}/heartbeat.json`, 'utf8'));
      expect(heartbeat).toMatchObject({ buildRunId: run.id, status: 'PAUSED', active: [], sourceRevision: 'fixture-revision' });
      expect(Date.now() - Date.parse(heartbeat.recordedAt)).toBeLessThan(10000);
      expect(JSON.parse(await readFile(`${output}/report.json`, 'utf8')).status).toBe('PAUSED');
      await expect(readFile(`${output}/verification.json`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await new Promise<void>(resolve => provider.close(() => resolve()));
      if (orgId) await prisma.org.deleteMany({ where: { id: orgId } });
      if (userId) await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
      await rm(output, { recursive: true, force: true });
    }
  }, 90000);
});
