import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateChapterUseCase } from '../../projects/CreateChapterUseCase.js';
import { CreateProjectUseCase } from '../../projects/CreateProjectUseCase.js';
import { executeMutationTool } from './mutations.js';

const databaseUrl = process.env.REVISION_TEST_DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('renumberChapters', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const suffix = randomUUID().slice(0, 8);
  let projectId: string;
  let userId: string;
  const ids: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { username: `renum-${suffix}`, email: `renum-${suffix}@example.test`, passwordHash: 'x' } });
    userId = user.id;
    await prisma.org.create({ data: { slug: `renum-${suffix}`, name: 'Renumber', memberships: { create: { userId, role: 'OWNER' } } } });
    projectId = (await new CreateProjectUseCase(prisma).execute(userId, { title: 'Renumber', slug: `renum-${suffix}` } as never)).id;
    // Created out of reading order, as an agent creating chapters in parallel would.
    await Promise.all(['Three', 'One', 'Two'].map(async (title) => {
      const created = await new CreateChapterUseCase(prisma).executeWithReceipt(userId, projectId, { title });
      ids.push(created.id);
    }));
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('assigns 1..n in the requested order without unique-number collisions', async () => {
    const byTitle = Object.fromEntries(
      (await prisma.chapter.findMany({ where: { projectId }, select: { id: true, title: true } })).map((c) => [c.title, c.id])
    );
    const order = [byTitle.One, byTitle.Two, byTitle.Three];
    await executeMutationTool(prisma, { projectId, userId }, 'renumberChapters', { chapterIds: order });
    const chapters = await prisma.chapter.findMany({ where: { projectId }, orderBy: { number: 'asc' }, select: { title: true, number: true } });
    expect(chapters).toEqual([{ title: 'One', number: 1 }, { title: 'Two', number: 2 }, { title: 'Three', number: 3 }]);
  });

  it('refuses a partial order so no chapter is silently dropped', async () => {
    await expect(executeMutationTool(prisma, { projectId, userId }, 'renumberChapters', { chapterIds: [ids[0]] }))
      .rejects.toMatchObject({ status: 400 });
  });
});
