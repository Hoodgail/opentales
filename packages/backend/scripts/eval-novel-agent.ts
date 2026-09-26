/**
 * Live scenario harness for the autonomous novel agent. Seeds a fresh project
 * (optionally with a brainstorm doc and prior state), runs one or more prompts
 * through the embedded OpenCode agent in Auto mode, then snapshots what the
 * agent persisted: folders, docs, characters, locations, acts, chapters,
 * scenes, and the transcript.
 *
 *   DATABASE_URL=… OPENCODE_EVAL_BASE_URL=… OPENCODE_EVAL_API_KEY=… \
 *   OPENCODE_EVAL_MODEL=gpt-6-luna OPENCODE_EVAL_OUT=/tmp/novel-agent-eval \
 *   pnpm exec tsx scripts/eval-novel-agent.ts <scenario> [label]
 *
 * Scenarios: plan-from-brainstorm, continue-session, write-next-chapter.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const out = process.env.OPENCODE_EVAL_OUT ?? '/tmp/novel-agent-eval';
process.env.OPENCODE_DATA_DIR = path.join(out, 'opencode-data');
const prisma = new PrismaClient();

const { encryptSecret } = await import('../src/utils/secretBox.js');
const { OpencodeAgentUseCase } = await import('../src/useCases/ai/OpencodeAgentUseCase.js');
const { opencodeRuntime, closeOpencodeRuntime } = await import('../src/useCases/ai/opencode/host.js');
const { ProjectDocUseCase } = await import('../src/useCases/projectDocs/ProjectDocUseCase.js');
const { bodyOf } = await import('../src/useCases/ai/tools/shared.js');
const { CreateProjectUseCase } = await import('../src/useCases/projects/CreateProjectUseCase.js');

export const BRAINSTORM = `# Brainstorm — working title "The Salt Archive"

- A coastal town where the tide went out twelve years ago and never came back. The seabed is now a salt flat full of wrecks.
- Protagonist: Ines Varga, 34, a former maritime insurance investigator who now catalogues the wrecks for a museum nobody visits.
- Her younger brother Tomas vanished the night the sea left. Official story: drowned. Ines found his boot on the flat, dry, laced.
- Someone is digging in the wrecks at night. Ines finds fresh shovel marks around the *Marisol*, the ship that ran aground the night the water left.
- Maybe the town made a deal? Maybe the sea was sold? I like the idea that the water is *somewhere* — contracted, stored, owed.
- Tone: literary mystery with a little magical realism. Quiet, melancholy, but with real suspense. Think Station Eleven meets The Shadow of the Wind.
- Other people: the harbourmaster Aurelio (knows more than he says), Dani (teen salt-miner, Tomas's former friend), the museum's absent benefactor who sends letters.
- I want the ending to be earned, bittersweet — Ines gets the truth but has to choose between getting Tomas back and giving the town its sea back.
- Target: a novel around 80–90k words. Maybe 24 chapters?
- Open: is Tomas alive? what does "the sea was sold" literally mean? who is the benefactor?`;

interface Scenario {
  seed: (ctx: SeedContext) => Promise<void>;
  prompts: string[];
}

interface SeedContext {
  userId: string;
  projectId: string;
}

async function createDoc(ctx: SeedContext, title: string, content: string, kind: 'NOTE' | 'BRAINSTORM' | 'INSTRUCTIONS' | 'REFERENCE' | 'OTHER' = 'BRAINSTORM') {
  const useCase = new ProjectDocUseCase(prisma) as unknown as {
    create: (userId: string, projectId: string, input: Record<string, unknown>) => Promise<{ id: string }>;
  };
  return useCase.create(ctx.userId, ctx.projectId, {
    title,
    kind: kind.toLowerCase(),
    content
  });
}

const scenarios: Record<string, Scenario> = {
  'plan-from-brainstorm': {
    seed: async (ctx) => {
      await createDoc(ctx, 'Brainstorm', BRAINSTORM);
    },
    prompts: ['Read the brainstorm and begin planning out the story.']
  },
  'continue-session': {
    seed: async (ctx) => {
      await createDoc(ctx, 'Brainstorm', BRAINSTORM);
    },
    prompts: [
      'Read the brainstorm and begin planning out the story.',
      '__NEW_SESSION__',
      'Keep going.'
    ]
  },
  'resume-from-ledger': {
    seed: async (ctx) => {
      await createDoc(ctx, 'Brainstorm', BRAINSTORM);
      await seedResumeState(ctx);
    },
    prompts: ['Keep going.']
  },
  'write-next-chapter': {
    seed: async (ctx) => {
      await createDoc(ctx, 'Brainstorm', BRAINSTORM);
      await seedResumeState(ctx, DRAFT_LEDGER);
    },
    prompts: ['Keep going.']
  }
};

/**
 * A project a previous session left mid-way: Story Bible with a Ledger whose
 * Next action is to write briefs and plan scenes for chapters 1–3, plus the
 * cast, places, and a chapter skeleton. A good agent resumes from the Ledger
 * without re-planning from scratch.
 */
async function seedResumeState(ctx: SeedContext, ledger = RESUME_LEDGER) {
  const { ProjectFolderUseCase } = await import('../src/useCases/projectFiles/ProjectFolderUseCase.js');
  const { CreateCharacterUseCase } = await import('../src/useCases/projects/CreateCharacterUseCase.js');
  const { CreateLocationUseCase } = await import('../src/useCases/projects/CreateLocationUseCase.js');
  const { CreateChapterUseCase } = await import('../src/useCases/projects/CreateChapterUseCase.js');
  const folders = new ProjectFolderUseCase(prisma) as unknown as { create: (u: string, p: string, i: Record<string, unknown>) => Promise<{ id: string }> };
  const bible = await folders.create(ctx.userId, ctx.projectId, { name: 'Story Bible', parentFolderId: null });
  await folders.create(ctx.userId, ctx.projectId, { name: 'Chapter Briefs', parentFolderId: null });
  const docs = new ProjectDocUseCase(prisma) as unknown as { create: (u: string, p: string, i: Record<string, unknown>) => Promise<{ id: string }> };
  await docs.create(ctx.userId, ctx.projectId, { title: 'Brief & Contract', folderId: bible.id, kind: 'reference', content: RESUME_BRIEF });
  await docs.create(ctx.userId, ctx.projectId, { title: 'Canon', folderId: bible.id, kind: 'reference', content: RESUME_CANON });
  await docs.create(ctx.userId, ctx.projectId, { title: 'Ledger', folderId: bible.id, kind: 'note', content: ledger });
  await docs.create(ctx.userId, ctx.projectId, { title: 'Voice & Style', folderId: bible.id, kind: 'reference', content: VOICE });
  const ines = await new CreateCharacterUseCase(prisma).execute(ctx.userId, ctx.projectId, { name: 'Ines Varga', role: 'protagonist', age: '34', occupation: 'Wreck cataloguer, former maritime insurance investigator', traits: ['forensic', 'guarded', 'stubborn'] } as never);
  void ines;
  for (const name of ['Tomas Varga', 'Aurelio Sava', 'Dani Rojas']) {
    await new CreateCharacterUseCase(prisma).execute(ctx.userId, ctx.projectId, { name } as never);
  }
  for (const name of ['The Salt Flat', 'The Wreck Museum', 'The Marisol']) {
    await new CreateLocationUseCase(prisma).execute(ctx.userId, ctx.projectId, { name } as never);
  }
  const summaries = [
    ['The Dry Inventory', 'Ines catalogues the Marisol and finds fresh shovel marks around its keel.'],
    ['The Laced Boot', 'Ines returns to where she found Tomas\'s boot and meets Dani salt-mining nearby.'],
    ['Harbour Hours', 'Aurelio deflects Ines\'s questions; a letter from the benefactor arrives.']
  ];
  for (const [title, summary] of summaries) {
    await new CreateChapterUseCase(prisma).executeWithReceipt(ctx.userId, ctx.projectId, { title, summary });
  }
}

const RESUME_BRIEF = `# Brief & Contract — The Salt Archive

## Premise
Twelve years after the sea left, Ines Varga finds fresh digging at the wreck of the Marisol and reopens her brother Tomas's supposed drowning.

## Length and structure target
85,000 words ±7%; 24 chapters; three acts; ~3,500 words per chapter.

## Drift criteria
C1. Ines is the sole POV; close third, past tense.
C2. Tomas's survival is not confirmed before Chapter 12.
C3. The sea's absence is never explained scientifically.`;

const RESUME_CANON = `# Canon
F1. The sea left on 14 March, twelve years before Chapter 1.
F2. Tomas was 19 when he vanished; Ines was 22.
F3. The Marisol ran aground the night the sea left.`;

const RESUME_LEDGER = `# Ledger — The Salt Archive

## Now
Phase 3 (structure) in progress. Brief, Canon, cast, and places exist; chapters 1–3 exist with summaries only.

## Next action
Write chapter briefs for chapters 1–3 in Chapter Briefs/, then create their scenes with full metadata (goal, conflict, turn, outcome, POV, location). Do not draft prose yet.

## Notes to future self
- The author loved the image of the dry, laced boot; it must recur in Ch 2 and pay off in the final act.
- Aurelio must never lie outright — he only withholds. The author was firm about this.

## Standing corrections
- Keep Dani's dialogue clipped and practical; the author found an earlier draft too lyrical.

## Open questions
- Q1 (author): Is the benefactor alive?

## Decisions
- D1: Sole POV Ines, close third, past tense.
- D2: 24 chapters across three acts.
`;

const VOICE = `# Voice & Style
Close third on Ines, past tense. Dry, forensic, observant; she notices materials, labels, and discrepancies before feelings. Short declaratives under pressure; longer sentences only for the flat's scale. Dialogue clipped; subtext over statement.

## Banned phrases
- "a chill ran down"
- "let out a breath she didn't know"
- "little did she know"`;

const DRAFT_LEDGER = `# Ledger — The Salt Archive

## Now
Phase 4 (drafting) about to begin. Brief, Canon, Voice & Style, cast, places, and chapters 1–3 with summaries exist.

## Next action
Draft Chapter 1 ("The Dry Inventory") in full, around 3,000 words, scene by scene into scenes (create 3 scenes if none exist), then compile the chapter and lint it. Stop after Chapter 1 and report.

## Notes to future self
- Open on the Marisol at dawn: Ines measuring the hull, the salt crust "like frost that never melts".
- The dry, laced boot must appear in Ch 1 as memory only; the physical boot returns in Ch 2.
- Aurelio never lies outright; he withholds.

## Standing corrections
- Keep Dani's dialogue clipped and practical.

## Decisions
- D1: Sole POV Ines, close third, past tense.
`;

async function seedProject(): Promise<SeedContext> {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({ data: { username: `agent-${suffix}`, email: `agent-${suffix}@example.test`, passwordHash: 'x' } });
  const org = await prisma.org.create({ data: { slug: `agent-${suffix}`, name: 'Agent eval', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
  void org;
  // Use the real use case so the project gets its story structure writings.
  const project = await new CreateProjectUseCase(prisma).execute(user.id, { title: 'The Salt Archive', slug: `salt-${suffix}` } as never);
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
  return { userId: user.id, projectId: project.id };
}

async function runPrompt(
  useCase: InstanceType<typeof OpencodeAgentUseCase>,
  ctx: SeedContext,
  sessionId: string,
  text: string,
  timeoutMs: number
) {
  const runtime = opencodeRuntime(prisma);
  let done!: () => void;
  const finished = new Promise<void>((resolve) => (done = resolve));
  const unsubscribe = runtime.subscribe(ctx.projectId, (event) => {
    const data = (event as { data?: Record<string, unknown> }).data ?? {};
    if ((event.type === 'session.execution.succeeded' || event.type === 'session.execution.failed') && data.sessionID === sessionId) done();
  });
  const started = Date.now();
  await useCase.prompt(ctx.userId, ctx.projectId, sessionId, { text });
  const timedOut = await Promise.race([finished.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs))]);
  unsubscribe();
  if (timedOut) await useCase.interrupt(ctx.userId, ctx.projectId, sessionId).catch(() => undefined);
  return { durationMs: Date.now() - started, timedOut };
}

async function snapshot(ctx: SeedContext) {
  const [folders, docs, characters, relationships, locations, acts, chapters, obstacles, structure] = await Promise.all([
    prisma.projectFolder.findMany({ where: { projectId: ctx.projectId }, orderBy: { path: 'asc' } }),
    prisma.projectDoc.findMany({
      where: { projectId: ctx.projectId },
      include: { folder: true, bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.character.findMany({ where: { projectId: ctx.projectId }, include: { descriptionWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } }),
    prisma.characterRelationship.findMany({ where: { fromCharacter: { projectId: ctx.projectId } } }).catch(() => []),
    prisma.location.findMany({ where: { projectId: ctx.projectId } }),
    prisma.act.findMany({ where: { projectId: ctx.projectId }, orderBy: { order: 'asc' } }),
    prisma.chapter.findMany({
      where: { projectId: ctx.projectId, deletedAt: null },
      orderBy: { number: 'asc' },
      include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } }, scenes: { orderBy: { order: 'asc' }, include: { bodyWriting: { include: { defaultBranch: { include: { headVersion: true } } } } } } }
    }),
    prisma.obstacle.findMany({ where: { projectId: ctx.projectId } }),
    prisma.storyStructure.findUnique({
      where: { projectId: ctx.projectId },
      include: {
        loglineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        outlineWriting: { include: { defaultBranch: { include: { headVersion: true } } } },
        climaxWriting: { include: { defaultBranch: { include: { headVersion: true } } } }
      }
    })
  ]);
  const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
  return {
    folders: folders.map((f) => f.path),
    docs: docs.map((d) => ({ path: d.folder ? `${d.folder.path}/${d.title}` : d.title, kind: d.kind, words: words(bodyOf(d.bodyWriting)), body: bodyOf(d.bodyWriting) })),
    characters: characters.map((c) => ({ name: c.name, role: c.role, descriptionWords: words(bodyOf(c.descriptionWriting)) })),
    relationships: relationships.length,
    locations: locations.map((l) => l.name),
    acts: acts.map((a) => a.title),
    obstacles: obstacles.map((o) => o.title),
    structure: structure
      ? { logline: bodyOf(structure.loglineWriting), outlineWords: words(bodyOf(structure.outlineWriting)), climaxWords: words(bodyOf(structure.climaxWriting)) }
      : null,
    chapters: chapters.map((c) => ({
      number: c.number,
      title: c.title,
      summary: c.summary,
      words: words(bodyOf(c.bodyWriting)),
      scenes: c.scenes.map((s) => ({ title: s.title, goal: s.goal, turn: s.turn, words: words(bodyOf(s.bodyWriting)) }))
    }))
  };
}

const scenarioName = process.argv[2] ?? 'plan-from-brainstorm';
const label = process.argv[3] ?? 'run';
/** `without_skill` disables novel-studio for a baseline comparison. */
const variant = process.env.OPENCODE_EVAL_VARIANT ?? 'with_skill';
const scenario = scenarios[scenarioName];
if (!scenario) throw new Error(`Unknown scenario ${scenarioName}`);
const timeoutMs = Number(process.env.OPENCODE_EVAL_TIMEOUT_MS ?? 900_000);

try {
  const ctx = await seedProject();
  await scenario.seed(ctx);
  if (variant === 'without_skill') {
    await prisma.projectAiSkill.create({
      data: { projectId: ctx.projectId, name: 'novel-studio', description: 'disabled for baseline', content: 'x', enabled: false }
    });
  }
  const useCase = new OpencodeAgentUseCase(prisma);
  let session = await useCase.create(ctx.userId, ctx.projectId, { approvalMode: 'auto' });
  const runs: Array<{ prompt: string; sessionId: string; durationMs: number; timedOut: boolean }> = [];
  for (const prompt of scenario.prompts) {
    if (prompt === '__NEW_SESSION__') {
      session = await useCase.create(ctx.userId, ctx.projectId, { approvalMode: 'auto' });
      continue;
    }
    const result = await runPrompt(useCase, ctx, session.id, prompt, timeoutMs);
    runs.push({ prompt, sessionId: session.id, ...result });
    console.log(`[${scenarioName}/${label}] "${prompt.slice(0, 50)}" → ${(result.durationMs / 1000).toFixed(0)}s${result.timedOut ? ' (timed out)' : ''}`);
  }

  const dir = path.join(out, scenarioName, label);
  await fs.mkdir(dir, { recursive: true });
  const transcripts = [];
  for (const run of runs) {
    const detail = await useCase.get(ctx.userId, ctx.projectId, run.sessionId);
    let cursor = detail.earlierCursor;
    let messages = detail.messages;
    while (cursor) {
      const page = await useCase.messages(ctx.userId, ctx.projectId, run.sessionId, { cursor, limit: 200 });
      messages = [...page.messages, ...messages];
      cursor = page.hasMore ? page.cursor : null;
    }
    transcripts.push({ ...run, tokens: detail.tokens, messages });
  }
  const state = await snapshot(ctx);
  const toolCalls = transcripts.flatMap((t) => t.messages.flatMap((m) => (m.role === 'assistant' ? m.parts.filter((p) => p.type === 'tool') : [])));
  const assistantText = transcripts.flatMap((t) => t.messages.flatMap((m) => (m.role === 'assistant' ? m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text) : [])));
  const summary = {
    scenario: scenarioName,
    label,
    projectId: ctx.projectId,
    durationSeconds: Math.round(runs.reduce((sum, r) => sum + r.durationMs, 0) / 1000),
    timedOut: runs.some((r) => r.timedOut),
    toolCalls: toolCalls.length,
    toolErrors: toolCalls.filter((p) => p.type === 'tool' && p.state.status === 'error').length,
    toolHistogram: Object.fromEntries(
      Object.entries(toolCalls.reduce<Record<string, number>>((acc, p) => {
        if (p.type === 'tool') acc[p.name] = (acc[p.name] ?? 0) + 1;
        return acc;
      }, {})).sort((a, b) => b[1] - a[1])
    ),
    chatWords: assistantText.join(' ').split(/\s+/).filter(Boolean).length,
    persistedDocWords: state.docs.filter((d) => d.path !== 'Brainstorm').reduce((sum, d) => sum + d.words, 0),
    folders: state.folders,
    docs: state.docs.map((d) => `${d.path} (${d.kind}, ${d.words}w)`),
    characters: state.characters.length,
    locations: state.locations.length,
    acts: state.acts.length,
    chapters: state.chapters.length,
    scenes: state.chapters.reduce((sum, c) => sum + c.scenes.length, 0),
    proseWords: state.chapters.reduce((sum, c) => sum + c.words + c.scenes.reduce((s, sc) => s + sc.words, 0), 0),
    finalReply: assistantText.at(-1)?.slice(0, 1500) ?? ''
  };
  await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  await fs.writeFile(path.join(dir, 'transcript.json'), JSON.stringify(transcripts, null, 2));
  await fs.writeFile(
    path.join(dir, 'docs.md'),
    state.docs.map((d) => `\n\n==================== ${d.path} (${d.kind}) ====================\n\n${d.body}`).join('')
  );
  console.log(JSON.stringify({ ...summary, finalReply: summary.finalReply.slice(0, 400) }, null, 2));
} finally {
  await closeOpencodeRuntime();
  await prisma.$disconnect();
}
