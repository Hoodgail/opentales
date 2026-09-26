import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateChapterUseCase } from '../../projects/CreateChapterUseCase.js';
import { CreateProjectUseCase } from '../../projects/CreateProjectUseCase.js';
import { runStoryLintTool } from './storyLint.js';

const databaseUrl = process.env.REVISION_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('runStoryLint over the live manuscript', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const suffix = randomUUID().slice(0, 8);
  let projectId: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { username: `lint-${suffix}`, email: `lint-${suffix}@example.test`, passwordHash: 'x' } });
    userId = user.id;
    await prisma.org.create({ data: { slug: `lint-${suffix}`, name: 'Lint', memberships: { create: { userId, role: 'OWNER' } } } });
    projectId = (await new CreateProjectUseCase(prisma).execute(userId, { title: 'Lint', slug: `lint-${suffix}` } as never)).id;
    const tic = 'The fog rolled in like a slow tide.';
    await new CreateChapterUseCase(prisma).executeWithReceipt(userId, projectId, {
      title: 'One',
      content: Array.from({ length: 12 }, () => `${tic} Ines watched it come.`).join('\n\n')
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('reports banned phrases with evidence and collapses repeats', async () => {
    const result = await runStoryLintTool(prisma, { projectId }).execute({ bannedPhrases: ['like a slow tide'] });
    const banned = result.issues.find((issue) => issue.code === 'configured-banned-phrase');
    expect(banned).toBeDefined();
    expect(banned!.occurrences).toBeGreaterThan(1);
    expect(banned!.evidence[0]?.quote).toContain('like a slow tide');
    expect(result.checkedChapters).toBe(1);
  });

  it('respects minimumSeverity and category filters', async () => {
    const result = await runStoryLintTool(prisma, { projectId }).execute({
      bannedPhrases: ['like a slow tide'],
      categories: ['pov'],
      minimumSeverity: 'error'
    });
    expect(result.issues.every((issue) => issue.category === 'pov' && issue.severity === 'error')).toBe(true);
  });
});
