/**
 * Live A/B eval for the opentales-tools skill against the embedded OpenCode
 * harness. Each run gets a fresh project; baseline runs hide the skill.
 *
 *   DATABASE_URL=… OPENCODE_EVAL_BASE_URL=… OPENCODE_EVAL_API_KEY=… \
 *   OPENCODE_EVAL_MODEL=gpt-6-luna OPENCODE_EVAL_OUT=/tmp/skill-eval \
 *   pnpm exec tsx scripts/eval-opentales-tools-skill.ts
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const out = process.env.OPENCODE_EVAL_OUT ?? '/tmp/opentales-skill-eval';
process.env.OPENCODE_DATA_DIR = path.join(out, 'opencode-data');
const prisma = new PrismaClient();

const { encryptSecret } = await import('../src/utils/secretBox.js');
const { OpencodeAgentUseCase } = await import('../src/useCases/ai/OpencodeAgentUseCase.js');
const { opencodeRuntime, closeOpencodeRuntime } = await import('../src/useCases/ai/opencode/host.js');
const { CreateChapterUseCase } = await import('../src/useCases/projects/CreateChapterUseCase.js');
const { UpdateChapterUseCase } = await import('../src/useCases/projects/UpdateChapterUseCase.js');

const CHAPTERS = [
  { title: 'The Keeper', content: 'Mara climbed the tower at dusk.\nEzra had left the lamp unlit again.\nThe fog came in thick and grey over Gull Rock.\nShe wondered where Ezra went on these nights.' },
  { title: 'The Letter', content: 'A letter arrived with no stamp.\nIt was in Ezra\'s hand, or something close to it.\nMara read it twice by the lamp.' },
  { title: 'The Search', content: 'They searched the shoals at low tide.\nNo one would say Ezra\'s name aloud.\nThe gulls wheeled and cried.' }
];

type Variant = 'with_skill' | 'without_skill';

async function seed() {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({ data: { username: `eval-${suffix}`, email: `eval-${suffix}@example.test`, passwordHash: 'x' } });
  const org = await prisma.org.create({ data: { slug: `eval-${suffix}`, name: 'Eval', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
  const project = await prisma.project.create({ data: { orgId: org.id, slug: `eval-${suffix}`, title: 'The Lighthouse Keeper' } });
  await prisma.projectAiSettings.create({
    data: {
      projectId: project.id,
      enabled: true,
      providerKind: 'OPENAI_COMPATIBLE',
      model: process.env.OPENCODE_EVAL_MODEL ?? 'gpt-6-luna',
      baseUrl: process.env.OPENCODE_EVAL_BASE_URL!,
      apiKey: encryptSecret(process.env.OPENCODE_EVAL_API_KEY!)
    }
  });
  const chapterIds: string[] = [];
  for (const chapter of CHAPTERS) {
    const created = await new CreateChapterUseCase(prisma).executeWithReceipt(user.id, project.id, chapter);
    chapterIds.push((created as { id: string }).id);
  }
  return { userId: user.id, projectId: project.id, chapterIds };
}

async function hideSkill(projectId: string, variant: Variant) {
  if (variant === 'without_skill') {
    await prisma.projectAiSkill.create({
      data: { projectId, name: 'opentales-tools', description: 'disabled for baseline', content: 'x', enabled: false }
    });
  }
}

async function run(evalId: number, prompt: string, variant: Variant, runIndex: number) {
  const { userId, projectId, chapterIds } = await seed();
  await hideSkill(projectId, variant);
  const useCase = new OpencodeAgentUseCase(prisma);
  const session = await useCase.create(userId, projectId, { approvalMode: 'auto' });
  const runtime = opencodeRuntime(prisma);

  let concurrentEditDone = false;
  const trace: Array<{ tool: string; status: string; input: unknown; output?: string }> = [];
  let done!: () => void;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const unsubscribe = runtime.subscribe(projectId, (event) => {
    const data = (event as { data?: Record<string, unknown> }).data ?? {};
    if (event.type === 'session.execution.succeeded' || event.type === 'session.execution.failed') {
      if (data.sessionID === session.id) done();
    }
    // Eval 2: simulate a collaborator editing chapter 1 right after the agent's first read.
    if (evalId === 2 && !concurrentEditDone && event.type === 'session.tool.success') {
      concurrentEditDone = true;
      void (async () => {
        const chapter = await prisma.chapter.findUniqueOrThrow({
          where: { id: chapterIds[0] },
          include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
        });
        const body = chapter.bodyWriting.defaultBranch?.headVersion?.body ?? '';
        await new UpdateChapterUseCase(prisma).execute(userId, projectId, chapterIds[0], {
          content: body.replace('Mara climbed the tower at dusk.', 'Mara climbed the iron tower at dusk.'),
          expectedHeadVersionId: chapter.bodyWriting.defaultBranch?.headVersionId ?? null
        } as never);
      })();
    }
  });

  const text = variant === 'with_skill'
    ? `${prompt}\n\n(Load the opentales-tools skill first.)`
    : prompt;
  const started = Date.now();
  await useCase.prompt(userId, projectId, session.id, { text });
  await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 240_000))]);
  unsubscribe();
  const durationMs = Date.now() - started;

  const detail = await useCase.get(userId, projectId, session.id);
  for (const message of detail.messages) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (part.type !== 'tool') continue;
      trace.push({
        tool: part.name,
        status: part.state.status,
        input: part.state.status === 'streaming' ? part.state.input : part.state.input,
        output: part.state.status === 'completed' ? part.state.output.slice(0, 400) : part.state.status === 'error' ? part.state.error : undefined
      });
    }
  }
  const finalText = detail.messages
    .flatMap((m) => (m.role === 'assistant' ? m.parts : []))
    .flatMap((p) => (p.type === 'text' ? [p.text] : []))
    .join('\n');
  const chapters = await prisma.chapter.findMany({
    where: { id: { in: chapterIds } },
    orderBy: { number: 'asc' },
    include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } }
  });
  const bodies = chapters.map((c) => c.bodyWriting.defaultBranch?.headVersion?.body ?? '');

  const dir = path.join(out, `iteration-${process.env.OPENCODE_EVAL_ITERATION ?? 1}`, `eval-${evalId}`, variant, `run-${runIndex}`);
  await fs.mkdir(path.join(dir, 'outputs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'outputs', 'skills.json'), JSON.stringify(trace.filter((t) => t.tool === 'skill').map((t) => t.input)));
  await fs.writeFile(path.join(dir, 'outputs', 'trace.json'), JSON.stringify(trace, null, 2));
  await fs.writeFile(path.join(dir, 'outputs', 'chapters.md'), bodies.map((b, i) => `## Chapter ${i + 1}\n\n${b}`).join('\n\n'));
  await fs.writeFile(path.join(dir, 'outputs', 'reply.md'), finalText);
  await fs.writeFile(path.join(dir, 'timing.json'), JSON.stringify({ total_tokens: detail.tokens.input + detail.tokens.output, duration_ms: durationMs, total_duration_seconds: durationMs / 1000 }, null, 2));
  return { trace, bodies, finalText, dir };
}

const evals = JSON.parse(await fs.readFile(new URL('../src/useCases/ai/skills/opentales-tools/evals/evals.json', import.meta.url), 'utf8')) as {
  evals: Array<{ id: number; prompt: string }>;
};
const runs = Number(process.env.OPENCODE_EVAL_RUNS ?? 2);
try {
  const jobs = evals.evals.flatMap((e) => (['with_skill', 'without_skill'] as Variant[]).flatMap((variant) =>
    Array.from({ length: runs }, (_, runIndex) => ({ e, variant, runIndex }))
  ));
  const results = await Promise.all(jobs.map(async ({ e, variant, runIndex }) => {
    try {
      const result = await run(e.id, e.prompt, variant, runIndex);
      console.log(`eval-${e.id} ${variant} run-${runIndex}: ${result.trace.map((t) => `${t.tool}:${t.status}`).join(', ')}`);
      return result;
    } catch (error) {
      console.error(`eval-${e.id} ${variant} run-${runIndex} failed`, error);
      return null;
    }
  }));
  console.log(`completed ${results.filter(Boolean).length}/${jobs.length}`);
} finally {
  await closeOpencodeRuntime();
  await prisma.$disconnect();
}
