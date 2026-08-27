# Deep Research: Turning OpenTales into a Real Novel-Writing IDE and an Autonomous “Novel Build” System

## Executive assessment

OpenTales has a much stronger foundation than “just a concept.” The repository already contains a desktop/web IDE shell, versioned writing data, chapters, scenes, characters, locations, acts, obstacles, project documents, search, deterministic manuscript linting, drafting/review workflows, AI settings and sessions, editable AI skills, subagents, approval-gated mutations, streaming, and manuscript-aware tool calls. The overall metaphor in the README—treating a novel as a “codebase of human meaning”—is unusually good because it gives OpenTales a coherent product direction rather than making it another text editor with a chatbot bolted on. fileciteturn4file0L2-L2 fileciteturn5file0L2-L2

My main conclusion is:

> **The largest problem is not that your prompts are bad. It is that the system does not yet have an architecture capable of long-horizon creative work.**

Your `novel-idea`, `novel-outline`, and especially `novel-chapters` skills actually contain a significant amount of sensible fiction-writing guidance. The idea skill thinks in terms of protagonist pressure, world machinery, opposing truth, and climactic choice; the outline skill emphasizes irreversibility, causality, recontextualization, and ending cost; the chapter skill covers scene objectives, POV, prose rhythm, interiority, tension, setting, and revision checks. That material is considerably better than the rest of the current agent infrastructure around it. fileciteturn31file0L2-L2 fileciteturn32file0L2-L2 fileciteturn33file0L2-L2

The problem is that those skills behave mostly like **large instruction essays that produce large Markdown documents**. They are not executable components in a persistent planning system. OpenTales currently asks a fairly ordinary tool-calling chat agent to behave as if it were a novelist, project manager, continuity editor, researcher, planner, critic, and workflow engine simultaneously. The primary model is then hard-stopped after only eight AI SDK steps. fileciteturn25file0L2-L2

That is fundamentally incompatible with your stated goal: **one human brainstorm should be sufficient to initiate the construction of an entire book.**

But “one-shot a novel” should **not** mean:

> brainstorm → one gigantic 90,000-word LLM completion.

It should mean:

> brainstorm → one durable autonomous build request → hundreds of well-scoped planning, drafting, memory, validation, and revision operations → finished manuscript branch.

This distinction is strongly supported by long-form generation research. Re3 improved long-story coherence by constructing a structured overarching plan, repeatedly reinserting relevant plan/story-state context during generation, reranking continuations, and revising for factual consistency. DOC subsequently improved long-story coherence further by moving more creative work into a detailed hierarchical outline and explicitly controlling generated passages against that outline. LongWriter's AgentWrite likewise decomposes ultra-long generation into smaller writing jobs instead of asking a model for one huge output. citeturn6search3turn6search0turn6academia29

A newer 2025 story-generation result is especially relevant to OpenTales: STORYTELLER combines a persistent storyline with a narrative entity knowledge graph that evolves alongside generation, reporting large gains in human preference over comparison systems. The architecture is much closer to what a serious novel-writing agent needs than “give the model the last few chat messages and let it call tools.” citeturn9search2

I would therefore orient the entire project around a new central abstraction:

**OpenTales should become a compiler for stories.**

The writer supplies intent. OpenTales constructs and maintains an intermediate representation of the book—premise, constraints, characters, world rules, arcs, timeline, beats, scenes, continuity facts, setup/payoff threads, and drafts—and the agent system repeatedly “compiles” those structures into prose, runs diagnostics, and revises the result.

That approach also creates your strongest differentiation from Scrivener, Plottr, Dabble, Novelcrafter, and generic AI chat applications. Scrivener already has mature corkboards, outliners, snapshots, metadata, targets, split editors, research organization, and compilation/export; Plottr already has visual timelines, scene cards, plotlines, filters, custom scene attributes, and story bibles; Dabble connects plot-grid cards directly to manuscript scenes; Novelcrafter already combines a reusable Codex with selectable AI context and customizable prompts/personas. OpenTales should learn from those products rather than merely duplicate them, while pushing much harder on **semantic project intelligence, compiler-style diagnostics, versioned story state, and autonomous build workflows**. citeturn8search0turn7search0turn7search19turn7search4turn7search5

My overall assessment of the repository today is:

| Area | My assessment | Main reason |
|---|---:|---|
| Product concept | **Excellent** | “IDE for stories” is a coherent and differentiated metaphor. |
| Existing application shell | **Strong prototype** | Many major IDE surfaces already exist. |
| Core writing UX | **Early** | Editing exists, but long-form planning/revision workflows remain shallow. |
| Story data model | **Promising** | You already have more structured entities than a document-only editor. |
| AI skills as craft references | **Better than expected** | Idea/outline/chapter instructions are thoughtful. |
| AI skills as executable capabilities | **Weak** | Inputs, outputs, preconditions, postconditions, and evaluation contracts are informal. |
| Agent orchestration | **Weak** | Eight-step chat loop is being asked to perform long-horizon workflow orchestration. |
| Long-term agent memory | **Very weak** | Recent chat plus ad hoc document retrieval is not enough for a novel. |
| Continuity intelligence | **Early** | Four simple deterministic lint rules are a start, not a semantic continuity engine. |
| Evaluation infrastructure | **Critical gap** | Fixtures exist, but the repository exposes no real test/eval pipeline in package scripts. |
| Autonomous full-book generation | **Not architecturally possible yet** | Needs durable workflows, branches, artifacts, memory, context packing, and validation gates. |

The encouraging part is that you do **not** need to throw away the current system. The existing Svelte application, Prisma/Postgres backend, AI SDK integration, approval system, project docs, structured manuscript entities, branch/version concepts, and progressive skill loading are all usable foundations. fileciteturn6file0L2-L2 fileciteturn34file0L2-L2

## Repository audit and the real bottlenecks

The public documentation describes an ambitious application, but the current repository has already outgrown parts of those docs. `future-directions.md`, for example, discusses writing statistics, trash, continuity linting, focus modes, scene functionality, and other capabilities as future ideas, while the current Activity Bar and components show that several of these now exist. That means the first non-AI engineering improvement should be to make the documentation versioned and generated closer to source-of-truth capability flags; otherwise contributors will increasingly design against an obsolete picture of the application. fileciteturn8file0L2-L2 fileciteturn9file0L2-L2 fileciteturn40file0L2-L2

There is also a concrete documentation defect: the root README references an AI-assistive-features document, while the current `docs/` directory contains `ai-system.md`, `architecture.md`, `future-directions.md`, and `getting-started.md`, not that referenced document. fileciteturn4file0L2-L2 fileciteturn2file0L2-L2

The UI skeleton is already broad. The Activity Bar exposes manuscript, characters, settings/locations, plot, outline, search, problems, drafts inbox, writing statistics, trash, docs/notes, AI, members, and settings. `SidePanel.svelte` has concrete panels behind those views rather than placeholders. fileciteturn40file0L2-L2 fileciteturn42file0L2-L2

The chapter editor is also more mature than the documentation might suggest. It has Monaco-backed Markdown editing, POV/location metadata, typewriter mode, focus mode, preview, selection rewriting, AI dialogue insertion, and collaboration wiring. That is a credible technical editor foundation. fileciteturn54file0L2-L2

The weakness is the *semantic depth* behind the surfaces.

For example, the current Outline panel is effectively a master-outline document, a word-count-based pacing visualization, and an act/chapter list. It does not yet operate as an editable causal story model: there is no rich scene-card matrix, subplot lane view, timeline, setup/payoff graph, POV distribution view, tension curve, dependency graph, character-arc overlay, or drag-and-drop structural editing in this component. Its “AI Expand” behavior appends generated Markdown to the existing outline rather than translating the new planning material into the structured manuscript model. fileciteturn43file0L2-L2

The Search panel illustrates the same issue. Current search is a client-side lowercase substring scan over chapter title/summary/content, character description/traits, and location description. It does not search project docs, scenes, obstacles, relationships, assets, story structure, aliases, canon facts, timeline events, or semantic relationships; it also lacks reference search, fuzzy matching, regex, field filters, backlinks, structural queries, or a project-wide rename/refactor operation. fileciteturn44file0L2-L2

The Problems panel is the beginning of one of OpenTales' potentially most differentiating features, but the current linter only implements four rules: eye-color drift, tense drift, forgotten-prop heuristics, and sentence-length variance. The implementation uses straightforward regular expressions/token counting and only receives chapters and characters as its lint context. This is useful proof of concept, but it is many orders of magnitude below what the “compiler for novels” idea could become. fileciteturn50file0L2-L2 fileciteturn52file0L2-L2

The AI architecture has more consequential bottlenecks.

Your main `systemPrompt.hbs` is competent as an interactive agent prompt: it defines the assistant's role, gives project metadata, injects standing instructions, advertises skills and subagents, describes tools, tells the model to prefer acting over excessive clarification, and distinguishes read operations from approval-gated mutations. fileciteturn17file0L2-L2

But the session executor uses:

```ts
streamText({
  model,
  abortSignal,
  tools,
  stopWhen: stepCountIs(8),
  system: systemPrompt,
  messages: [{ role: 'user', content: messagePrompt }]
})
```

so the autonomous reasoning/tool loop has only eight SDK steps. Vercel's own AI SDK documentation treats `stopWhen` as loop control for multi-step agents; the current documentation says its agent abstractions otherwise default to a substantially larger step budget. More importantly, an arbitrary small turn cap is a guardrail for a conversational agent, not a workflow architecture for a task that may legitimately require hundreds of operations. fileciteturn25file0L2-L2 citeturn1search11

Increasing that `8` to `1000` would **not** solve the problem. It would just create a less controllable chat loop.

The next bottleneck is context management. `buildPrompts()` fetches only a bounded recent message history—twenty messages—and builds the prompt from project metadata, standing instruction docs, skill descriptions, subagent descriptions, and that transcript. Your user-context template itself only provides recent conversation and the current request. There is no persistent workflow plan, no structured task state, no compacted agent memory, no canonical artifact inventory, no explicit unresolved-decision list, and no automatic story-state bundle. fileciteturn26file0L2-L2 fileciteturn19file0L2-L2

There is also a likely prompt-quality bug in that flow. The current user prompt is persisted as a USER message before `buildPrompts()` loads recent messages; the resulting recent transcript can therefore already contain the current request, after which `userContext.hbs` adds the same request again under “Current request.” Based on the code flow, the active request can be represented twice. That duplication should be removed and covered by a prompt-snapshot test. fileciteturn25file0L2-L2 fileciteturn26file0L2-L2

The session runtime itself is not durable. Active abort controllers, SSE clients, approval waiters, and question waiters live in an in-memory runtime map. Your AI documentation acknowledges the in-memory nature of runtime streaming state. A server restart during a long generation can therefore preserve database records while losing the actual executing control flow that knew what to do next. That is acceptable for a chat prototype; it is unacceptable for a novel build that may span a long chain of independent requests. fileciteturn5file0L2-L2 fileciteturn25file0L2-L2

The approval model has the same mismatch. Approval-gated edits are a good default for interactive AI assistance, and I would keep them. But a chapter writer that proposes a mutation and then waits for a human approval cannot autonomously construct dozens of chapters plus hundreds of supporting entities. The current runtime even has a ten-minute default approval timeout. fileciteturn25file0L2-L2

Subagents are another example of a sound primitive used at the wrong abstraction level. `task` takes a description, prompt, subagent type, and optional task ID. It launches a subordinate session and waits for a final result. The parent does not delegate a typed contract containing dependencies, required inputs, expected artifacts, completion criteria, resource budget, model policy, quality threshold, or retry policy. fileciteturn28file0L2-L2

Anthropic reported almost exactly this failure mode while building its multi-agent research system: vague subagent assignments produced duplication and missing coverage, and its solution was to require objectives, output formats, tool/source guidance, and explicit task boundaries. citeturn4view1

Your existing runner agents reinforce the problem. `outline-runner` is essentially “load this skill, read context, generate/update one ProjectDoc,” while `chapter-writer-runner` is “load chapter skills, inspect relevant context, then propose one chapter update.” `critic-runner` reviews exactly one target. Those are useful workers, but nothing above them currently constructs and persists a whole-book dependency plan or repeatedly schedules workers until the book reaches a declared end state. fileciteturn45file0L2-L2 fileciteturn46file0L2-L2 fileciteturn47file0L2-L2

There is also insufficient hard capability isolation. The code distinguishes agent modes and prevents subagents from spawning additional subagents, but the actual tool factory still builds the broad toolset around the current agent. “Explore is read-only” and “load only these skills” are largely behavioral instructions rather than a full capability-security boundary. An autonomous system should enforce those constraints in code: a read-only worker should literally not receive mutation tools; a chapter worker should only be authorized to mutate its assigned chapter and its explicitly scoped supporting artifacts. fileciteturn20file0L2-L2 fileciteturn29file0L2-L2

Finally, your testing situation needs to become a release blocker. `future-directions.md` itself calls the absence of an automated test suite the highest-leverage problem. The current root package still defines lint as `echo 'no lint configured'`, and neither the root nor backend package scripts expose an automated test/eval command. Some skills contain `evals/evals.json`, but for example the outline eval contains only two prompt/expected-output fixtures rather than an executable scoring rubric, and those fixtures are not represented by a package-level eval runner. fileciteturn9file0L2-L2 fileciteturn38file0L2-L2 fileciteturn37file0L2-L2 fileciteturn35file0L2-L2

That gap matters more for an agent product than it would for a conventional CRUD application. Anthropic's current guidance is explicitly “eval-driven development”: begin with real tasks and failures, grade both outcomes and behavior, run multiple trials because agent behavior is stochastic, and combine deterministic, model-based, and human evaluation. citeturn10view0

## The architecture for one brainstorm to become one novel

The central product change I recommend is to introduce a distinction OpenTales does not currently make strongly enough:

| Concept | Responsibility |
|---|---|
| **Workflow** | Durable orchestration: what must happen, dependencies, retries, checkpoints. |
| **Agent** | A model runtime with a particular tool scope, model policy, and context policy. |
| **Skill** | Procedural knowledge about how to perform one class of work. |
| **Tool** | A concrete read/action API into OpenTales. |
| **Artifact** | Persistent structured output from a task. |
| **Canon** | Authoritative facts and story state accepted for downstream work. |
| **Context pack** | The smallest relevant subset of artifacts/canon/manuscript needed for one model call. |
| **Eval** | Evidence that a task/artifact satisfies its declared completion criteria. |

At the moment, too much of this is implicitly delegated to prompts.

The full-novel capability should instead be represented as a durable **Novel Build**.

```text
                         HUMAN
                           │
                  brainstorm / constraints
                           │
                           ▼
                 ┌────────────────────┐
                 │   Novel Build Run  │
                 │ target + budget +  │
                 │ autonomy policy    │
                 └─────────┬──────────┘
                           │
          ┌────────────────▼─────────────────┐
          │     Intent / Constraint Pass      │
          └────────────────┬─────────────────┘
                           ▼
                    Story Brief v1
                           │
             ┌─────────────┼──────────────┐
             ▼             ▼              ▼
        Characters      World/Lore     Research
             └─────────────┼──────────────┘
                           ▼
                       Story Bible
                           │
                           ▼
                    Macro Architecture
                           │
                           ▼
                 Acts → Beats → Scenes
                           │
                           ▼
                    Scene Dependency DAG
                           │
                           ▼
                 chapter / scene context pack
                           │
                           ▼
                       Draft prose
                           │
          ┌────────────────┼──────────────────┐
          ▼                ▼                  ▼
   Canon extraction   Continuity lint     Craft critic
          └────────────────┼──────────────────┘
                           ▼
                        Revision
                           │
                   checkpoint / commit
                           │
                     next scene/chapter
                           │
                           ▼
              Act-level / manuscript review
                           │
                           ▼
                  Structural revision pass
                           │
                           ▼
             line edit → copy edit → export
```

This is mostly a **workflow**, not an unconstrained agent. That distinction is consistent with Anthropic's production guidance: workflows are preferable where the decomposition is known and predictability matters, while autonomous agents are useful inside open-ended portions where the correct steps cannot be predetermined. Prompt chaining, routing, parallel work, orchestrator-workers, and evaluator-optimizer loops can be combined rather than selecting “agent” as the architecture for everything. citeturn4view0

A novel is an almost perfect hybrid case. The *high-level production pipeline* is predictable: establish premise, build canon, plan structure, break it into scenes, draft, validate, revise. The *creative decisions inside those phases* are open-ended. Therefore deterministic code should own the outer workflow while LLMs own creative operations inside it. citeturn6search3turn6search0

The first new persistent entities should look conceptually like this:

```ts
type BuildRun = {
  id: string;
  projectId: string;
  branchId: string;

  status:
    | "planning"
    | "drafting"
    | "revising"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";

  objective: string;
  targetWordCount?: number;
  autonomyMode: "assist" | "plan-review" | "autonomous-draft";

  maxTokens?: number;
  maxCost?: number;

  currentPhase: string;
  workflowVersion: string;
  createdAt: Date;
  updatedAt: Date;
};

type BuildTask = {
  id: string;
  buildRunId: string;

  type: string;
  status: "blocked" | "ready" | "running" | "review" | "done" | "failed";

  dependencies: string[];
  inputArtifactIds: string[];
  outputArtifactIds: string[];

  assignedAgent: string;
  skillVersions: Record<string, string>;

  attempts: number;
  maxAttempts: number;

  acceptanceCriteria: unknown;
};
```

This state belongs in Postgres, not in SSE runtime memory. Every model invocation should be a recoverable task. If the process dies after Chapter 17, the worker comes back, queries `BuildTask WHERE status IN (...)`, and continues. Streaming becomes merely the UI transport for observing an execution, rather than the execution itself. This is the same general reason long-running agent runtimes emphasize durable state and checkpointing; for example, LangGraph explicitly persists graph state so interrupted workflows can resume, and distinguishes thread-scoped checkpoints from longer-term memory. citeturn1search0turn1search5

You do not necessarily need LangGraph. Given that OpenTales is already TypeScript + Prisma + Postgres + AI SDK, I would initially implement this state machine yourself. The important architecture is **durable tasks plus idempotent transitions**, not the framework name. LangGraph.js becomes attractive later if conditional graphs, parallel nodes, interrupts, replay, and checkpoint management become burdensome to maintain; its current positioning is specifically a low-level runtime for long-running stateful agents with persistence and human-in-the-loop execution. citeturn1search4turn1search12

The second major abstraction should be a structured **Story Intermediate Representation**.

Today, Markdown ProjectDocs contain a large amount of planning intelligence. Keep them because writers need human-readable documents. But do not make Markdown the sole machine-readable truth.

I would introduce at least these artifact classes:

| Artifact | What it represents |
|---|---|
| `StoryBrief` | Premise, genre, target audience, tone, promises, constraints, thematic question. |
| `NarrativeContract` | POV rules, tense, narrative distance, content constraints, stylistic dimensions. |
| `CharacterBible` | Wants, needs, contradictions, backstory, arc, voice, knowledge, secrets. |
| `WorldBible` | Rules, institutions, geography, factions, terminology, technology/magic constraints. |
| `PlotThread` | Main plot, subplot, character arc, mystery, romance, thematic thread. |
| `Beat` | Narrative event/function with cause, consequence, thread links and expected payoff. |
| `ScenePlan` | POV, time, location, goal, obstacle, turn, outcome, revelations, dependencies. |
| `TimelineEvent` | Absolute/relative chronological event. |
| `CanonFact` | Atomic established proposition and its evidence/source. |
| `EntityState` | Character location, injuries, possessions, knowledge, relationships at a point in story time. |
| `OpenLoop` | Promise/question/clue/setup that requires later resolution. |
| `ForeshadowingThread` | Setup, reinforcement, misdirection, payoff. |
| `ChapterDraft` | Prose plus its provenance and plan version. |
| `RevisionIssue` | Structured diagnostic with severity, scope, evidence and candidate resolution. |
| `EvaluationResult` | Rubric scores and deterministic checks for an artifact. |

This is one place where recent story-generation research is particularly useful. STORYTELLER reports gains from continuously integrating a storyline representation with a narrative entity knowledge graph rather than generating prose from an outline alone. citeturn9search2

The **canon ledger** should become the most important AI-facing database in the system.

Suppose Chapter 7 establishes:

```json
{
  "subject": "character:mara",
  "predicate": "knows",
  "object": "secret:the-bridge-is-alive",
  "validFromScene": "scene:7.3",
  "status": "canonical",
  "source": {
    "chapterId": "chapter:7",
    "sceneId": "scene:7.3",
    "span": "..."
  }
}
```

Then Chapter 5's writer cannot accidentally give Mara that knowledge. Likewise, the system should be able to represent:

```text
Mara location:          North Station → Ch 8 Scene 2
Mara left-hand injury:  active → Ch 11 Scene 1
Black key possession:   Elias → transferred to Mara → destroyed
Council knows rebellion: false → true at midpoint
Weather:                snow begins Tuesday night
Distance A→B:           two-day ride
Rule: resurrection requires a living memory as payment
Setup "red moth":       Ch 2 → reinforced Ch 9 → intended payoff Ch 24
```

That enables deterministic and LLM-assisted story validation in ways that repeatedly rereading prose cannot.

After **every scene**, run a lightweight state-extraction task:

```text
draft scene
    ↓
extract:
  new facts
  state changes
  character knowledge changes
  relationship changes
  timeline events
  introduced objects
  unresolved promises
  fulfilled promises
    ↓
validate against existing canon
    ↓
commit accepted delta
```

This is essentially the fiction equivalent of updating a program's symbol table after compiling a module.

The third architectural piece is the **context assembler**.

Do not solve long novels by passing the whole book to a model. Long-context research has repeatedly found that merely enlarging context does not guarantee reliable use of all information; “Lost in the Middle” found substantial degradation based on where information occurred in long contexts. Anthropic's later context-engineering guidance similarly treats context as a finite attention budget and recommends minimizing low-value tokens, retrieving information just in time, compacting histories, and using persistent structured notes for long-horizon work. citeturn9search0turn5view0turn5view2turn5view3

A Chapter 19 drafting context might be assembled as:

```text
GLOBAL — always small
• 700-token story brief
• 500-token narrative contract
• 700-token global arc state

TASK
• Chapter 19 brief
• Scene 19.1 / 19.2 / 19.3 plans
• acceptance criteria

CHARACTERS IN THESE SCENES
• compressed character cards
• current relationship states
• current knowledge/secrets
• voice cues

WORLD
• only referenced locations/factions/rules/items

RECENT CAUSAL CONTEXT
• previous chapter summary
• last 1,000–2,000 words where useful
• consequences still active

THREADS
• subplots active in Chapter 19
• setups available to reinforce/pay off
• unresolved promises

CANON
• facts selected by entity + time + scene relevance

STYLE
• author's abstract voice profile
• one or two short project-owned examples if available
```

The agent should be able to search outward from there when necessary.

Anthropic's current recommendation is almost exactly this hybrid pattern: provide a small amount of important context up front while retaining identifiers and search primitives that let an agent retrieve more information just in time. citeturn5view2

The final architectural principle is **parallelize only where the story permits parallelism**.

Multi-agent systems are useful for independent research or independent perspectives, but Anthropic specifically warns that they are weaker fits where tasks share heavy dependencies and require constantly synchronized context. citeturn4view1

So:

```text
GOOD TO PARALLELIZE

Character deepening ─┐
World institutions ──┼──► Story architect synthesizes
Genre research ──────┤
Comp/title research ─┘

Continuity critic ───┐
Character critic ────┼──► Revision planner synthesizes
Pacing critic ───────┤
Prose critic ─────────┘
```

But:

```text
BAD DEFAULT

Chapter 1 writer ─┐
Chapter 2 writer ─┼── all draft simultaneously
Chapter 3 writer ─┤
...
Chapter 40 writer ┘
```

because Chapter 20 depends on the exact canon created while drafting Chapters 1–19.

A sensible compromise is sequential drafting within causal chains, with parallel analysis/critique and occasional act-level fan-out once a canon snapshot is frozen.

## Agents, skills, prompts, tools, and memory

The most important conceptual cleanup is to stop treating every specialization as “another agent.”

**Agents should define execution environments. Skills should define expertise.**

You probably need only a small family of runtime agents:

| Agent runtime | Purpose | Tool access |
|---|---|---|
| **Orchestrator** | Decomposition, scheduling, gap detection | Build/task/artifact tools; little direct prose mutation |
| **Explorer** | Read-only project investigation | Search/read only |
| **Creator** | Planning/artifact construction | Scoped structured artifact writes |
| **Drafter** | Scene/chapter prose | Assigned chapter/scene + reads |
| **Critic** | Independent evaluation | Read + diagnostics only |
| **Reviser** | Apply accepted critique | Assigned artifact/prose mutation |
| **Researcher** | Optional external factual research | Research notebook + web/references |
| **Librarian** | Canon/state extraction and reconciliation | Canon/state tools |

Most “character expert,” “dialogue expert,” “worldbuilding expert,” “outline expert,” and similar specialization can be **skills loaded into those runtimes**, rather than independent agent personalities.

This reduces coordination complexity and aligns with Anthropic's finding that successful systems often use simple composable patterns and only add autonomous/multi-agent complexity where it measurably helps. citeturn4view0

Your current skill discovery mechanism is directionally excellent. `markdownCatalog.ts` loads built-in `skills/*/SKILL.md`, advertises name/description cheaply, and lets project-specific skills override or disable built-ins. That is the right progressive-disclosure idea. fileciteturn34file0L2-L2

Keep it.

But evolve a skill from this:

```yaml
---
name: novel-outline
description: Create a detailed outline for a novel...
---
[large prose guide]
```

toward something conceptually like:

```yaml
---
name: novel-outline
version: 2
description: Build or revise the causal scene architecture of a novel.
kind: planning
inputs:
  - story-brief
  - character-bible
  - world-bible
outputs:
  - plot-thread[]
  - beat[]
  - scene-plan[]
allowedTools:
  - read-artifact
  - search-project
  - create-plot-thread
  - create-beat
  - create-scene-plan
maxIterations: 3
rubric: outline-v2
---
```

Your current frontmatter parser is deliberately simple—it handles basic scalar and folded values rather than a fully nested YAML data model—so richer skill metadata would require either a proper YAML parser or a separate machine-readable manifest alongside `SKILL.md`. fileciteturn34file0L2-L2

I favor:

```text
novel-outline/
  SKILL.md
  skill.json
  references/
    causality.md
    pacing.md
    mystery-structures.md
    romance-structures.md
  templates/
    scene-plan.json
  rubrics/
    outline-quality.md
  evals/
    ...
```

That preserves the human-readable/open-source Skill format while moving machine enforcement into a stable schema.

The current long skills should also be split. `novel-chapters/SKILL.md`, for example, has a lot of useful material, but an agent does not need every sentence-level prose lesson every time it drafts a scene. Put the invariant workflow in the main skill and load POV, dialogue, exposition, fight scenes, romance, description, suspense, humor, line editing, and other craft references only when relevant. Anthropic's context-engineering guidance specifically recommends small high-signal contexts and warns against bloated instruction/tool environments. fileciteturn33file0L2-L2 citeturn5view1turn5view2

I would also remove the named-book/author imitation anchors from the chapter-writing core prompt. The current skill frames the target using titles and authors such as *Red Rising*, *No Country for Old Men*, *The Name of the Wind*, and others. fileciteturn33file0L2-L2

Instead define voice in dimensions the system can actually track:

```json
{
  "narrativeDistance": "close",
  "sentenceRhythm": "mostly-short-with-periodic-expansion",
  "diction": "concrete, contemporary, lightly lyrical",
  "metaphorDensity": "low-medium",
  "interiority": "high",
  "dialogueCompression": "high",
  "expositionStyle": "embedded-in-action",
  "humor": "dry",
  "violence": "visceral-but-brief",
  "descriptionDensity": "medium"
}
```

That creates a reusable **Narrative Contract** and is much easier to evaluate for drift.

The skill library is currently missing the procedural decomposition required for a whole book. My recommended first-class skill set is:

| Skill family | Capabilities |
|---|---|
| **Intake** | brainstorm extraction, constraint resolution, story brief |
| **Architecture** | story engine, genre promise, theme tension, macro structure |
| **Characters** | cast design, arcs, relationships, secrets, voice |
| **World** | world rules, institutions, factions, terminology, locations |
| **Plot** | threads, causality, reversals, midpoint, climax, ending |
| **Scenes** | scene purpose, goal/conflict/turn/outcome, sequel/reaction |
| **Continuity** | canon extraction, entity state, timeline, contradictions |
| **Setup/payoff** | mysteries, clues, promises, motifs, foreshadowing |
| **Research** | factual research, source notebook, fact confidence |
| **Drafting** | prose generation from explicit scene contracts |
| **Dialogue** | character-distinct dialogue and subtext |
| **Developmental revision** | structure, causality, character, pacing |
| **Line revision** | rhythm, specificity, repetition, clarity |
| **Copy edit** | mechanical consistency |
| **Finalization** | synopsis, front/back matter, export preparation |
| **Series** | multi-book canon, series arcs, recurring entities |

Do **not** create one giant `one-shot-novel/SKILL.md` containing all of that. `novel-build` should be a workflow entrypoint that schedules the specialized capabilities.

The current prompt architecture should also be layered differently.

Instead of one ever-expanding general system prompt, construct each inference from:

```text
Layer A — Runtime invariants
    identity
    security / authority
    tool protocol
    truthful state reporting
    mutation policy

Layer B — Active workflow state
    build ID
    phase
    task
    dependencies
    completion criteria
    available budget

Layer C — Active skill
    concise procedural instructions

Layer D — Context pack
    relevant canon/artifacts/manuscript

Layer E — User creative authority
    original brainstorm
    standing preferences
    explicit constraints

Layer F — Output contract
    artifact schema
    rubric
```

Anthropic currently characterizes context engineering—not just wording a system prompt—as the central challenge for long-horizon agents, and recommends clearly partitioned, minimal, high-signal context. citeturn5view0turn5view1

For model output, prefer **structured decisions and artifacts**, not explicit private reasoning logs. An outline task should report things like:

```json
{
  "status": "complete",
  "decisions": [
    {
      "decision": "Reveal Aster's betrayal at the midpoint",
      "reason": "Turns the external pursuit into an internal loyalty crisis"
    }
  ],
  "createdArtifacts": ["beat:17", "beat:18"],
  "unresolvedQuestions": [],
  "quality": {
    "causality": 0.91,
    "characterPressure": 0.86,
    "setupPayoffCoverage": 0.82
  }
}
```

These are inspectable product artifacts rather than fragile hidden scratchpads.

The **tool layer needs equal attention**. Anthropic says it spent more effort improving agent tools than the overall prompt in one coding-agent project and recommends distinct, obvious tool purposes, clear parameters, examples, and interfaces that make errors difficult. citeturn4view0turn10view1

Your current tool library already contains a surprisingly broad set of reads—projects, folders/files, characters, relationships, chapters, grep, acts, scenes, locations, obstacles, docs, story structure, statistics, versions, and more—plus mutation tools. fileciteturn29file0L2-L2

The next tools should therefore not simply be “more CRUD.” They should expose **story intelligence**:

| Tool | Purpose |
|---|---|
| `searchStory` | Hybrid exact/FTS/semantic search across every story entity. |
| `findReferences` | All places an entity/fact/thread is referenced. |
| `getSceneContext` | Compiler-built context pack for a scene. |
| `queryCanon` | Structured canonical facts with time/source filtering. |
| `commitCanonDelta` | Persist validated state changes after a scene. |
| `queryTimeline` | Events between times/scenes/entities. |
| `queryEntityState` | “What does Mara know/own/believe at Scene 16?” |
| `queryOpenLoops` | Outstanding mysteries, setups and promises. |
| `linkSetupPayoff` | Explicitly connect setup/reinforcement/payoff. |
| `runStoryLint` | Deterministic and AI-assisted diagnostics. |
| `getArcState` | Progress of a character/subplot through the manuscript. |
| `compareVersions` | Semantic + prose diff between revisions. |
| `createCheckpoint` | Immutable build milestone. |
| `applyArtifactBatch` | Atomic structured planning mutations. |
| `applyChapterPatch` | Scoped prose edit against expected version. |
| `getBuildState` | Current tasks, blockers and completion state. |
| `reportTaskResult` | Typed subagent result + artifacts + evidence. |

Bulk/atomic tools are important because an outline can legitimately create forty chapters and one hundred scenes. Having a model negotiate individual human approvals or tool steps for each object wastes context and massively increases failure surface.

Your existing versioned writing architecture gives you an elegant solution to autonomy: **AI should build on a branch**. The architecture already models `Writing → WritingBranch → WritingVersion`; make that a first-class AI capability. fileciteturn6file0L2-L2

I would implement three autonomy modes:

| Mode | Behavior |
|---|---|
| **Assist** | Current behavior: significant mutations require approval. |
| **Plan & Review** | Human approves the generated build manifest; AI may then write freely to an isolated AI branch, stopping at declared checkpoints. |
| **Autonomous Draft** | Human authorizes a branch, scope, cost/token budget, and creative brief; agent works until completion or a true blocker. Final merge remains human-controlled. |

That is much better than either extreme of “approve every paragraph” or “let an agent rewrite the canonical manuscript without limits.”

For a request like:

> “Write me an 85k-word gothic fantasy about a disgraced cartographer whose maps erase memories. Close third person, tragic romance, no resurrection, bittersweet ending.”

the system should first create a **build manifest**:

```text
Target:
  82k–90k words
  Gothic fantasy
  Close third person
  Single primary POV
  Tragic romantic subplot
  No resurrection
  Bittersweet ending

Artifacts:
  Story brief
  Narrative contract
  5 primary characters
  7 supporting characters
  World bible
  3 main factions
  Magic constraints
  Main plot + 4 supporting threads
  3-act / 32-chapter architecture
  90–110 scene plans
  Full draft
  Developmental pass
  Continuity pass
  Line pass

Approval:
  Human approved autonomous generation on branch ai/build-...
```

From then onward, OpenTales—not the human—tracks what remains to be done.

## The IDE OpenTales needs to become

The AI work will fail to create a great product if the non-AI IDE is underpowered. Your stated principle is that writers should be able to use OpenTales **with or without AI**, and I think that principle should be treated as an architectural constraint: every structured object the AI can manipulate must have a good human interface.

The current Monaco-backed chapter editor gives OpenTales a convincing IDE feel, and typewriter/focus modes show that prose-specific thinking has already started. fileciteturn54file0L2-L2

But Monaco should not dictate the entire writer experience. A mature novel IDE should offer two complementary modes:

**Structured/source mode** can retain Monaco/Markdown for users who like the IDE metaphor.

**Manuscript mode** should feel like a purpose-built prose editor: typography, paragraph indentation, scene breaks, comments, annotations, suggestion tracking, rich text where needed, smart navigation, spelling/grammar integrations, and a whole-manuscript “scrivenings”-style continuous reading/editing mode. Scrivener's long-form editor explicitly lets authors divide a book into scenes/documents while viewing them continuously as one manuscript, alongside comments, formatting, split editing, snapshots, and research. citeturn8search0

The **Outline** should be transformed from a mostly textual view into several projections over one underlying story graph:

```text
OUTLINE
Act I
  Chapter 1
    Scene 1
    Scene 2
  Chapter 2
    Scene 3

CORKBOARD
[Scene 1] [Scene 2] [Scene 3] ...
drag/reorder

PLOT GRID
              Ch1     Ch2     Ch3     Ch4
Main Plot      ●───────●───────●──────●
Romance        ●───────────────●───────●
Murder                ●────────●
Mara Arc       ●──────●────────●───────●
Foreshadow     S──────R───────────────P

TIMELINE
Day 1   Day 2   Day 3   ...
events independent of manuscript ordering

CHARACTER ARC
lie → pressure → compromise → revelation → choice

TENSION
       ╱╲
  ╱╲ ╱  ╲      ╱╲
 ╱  ╲    ╲____╱  ╲____
```

This is table stakes in specialized planning tools. Plottr supports draggable visual timelines, scene cards, scene stacks, plotlines, POV/goals/conflict attributes, filters, and story bibles. Dabble's plot grid similarly ties plotline cards back to manuscript scenes. citeturn7search0turn7search19

OpenTales can go significantly beyond them by making these views **semantically synchronized**. Moving Scene 16 before Scene 14 should cause the Problems panel to reevaluate chronology, knowledge dependencies, setups/payoffs, and character state.

Every **scene should be first-class**. I would give scenes fields such as:

```text
Title
Chapter
Ordinal
POV
Location
Story date/time
Estimated / actual words
Status

Scene function
POV immediate goal
Obstacle
Stakes
Conflict
Turn / revelation
Outcome
Emotional value shift

Characters present
Characters referenced
Plot threads
Setup/payoff links
Knowledge gained
Objects transferred
Injuries/state changes
World rules invoked

Entry state
Exit state
Scene summary
Writer notes
AI notes
```

These fields should remain optional for human “pantsers.” The mistake would be forcing everyone to fill in a screenplay production form before writing. The IDE can progressively expose structure: minimal cards for discovery writers, deep metadata for planners, automatic AI extraction for users who opt into it.

The **Story Bible** should become one of the application's central surfaces rather than a collection of unrelated character/location forms.

Think of it as a local knowledge graph:

```text
                     ┌───────────┐
                ┌───►│ Black Key │◄────┐
                │    └───────────┘     │
                │                      │
           possesses                created by
                │                      │
           ┌────┴───┐             ┌────┴─────┐
           │  Mara  │────sister──►│  Elian   │
           └────┬───┘             └──────────┘
                │
              knows
                │
           ┌────▼─────────┐
           │ Bridge Secret│
           └──────────────┘
```

The user should be able to click any entity and see definitions, aliases, related entities, appearances, first mention, scenes present, relevant canon facts, contradictions, images, research, and revision history.

Novelcrafter's Codex already demonstrates why this is useful commercially: its product emphasizes a reusable story knowledge ecosystem, and its prompting system lets writers explicitly add chapters, snippets, outlines, Codex material, and other context to AI conversations. citeturn7search4turn7search5

OpenTales should make its version more structured and inspectable.

The **Problems** panel is where the “IDE” metaphor can become more than branding.

Today's four checks are useful seeds. fileciteturn52file0L2-L2

Eventually I would expect families like:

| Category | Examples |
|---|---|
| Continuity | eye/hair/name drift; inconsistent ages; dead character appears; object changes owner |
| Chronology | impossible travel; event occurs before prerequisite; inconsistent dates |
| Knowledge | character references something they have not learned |
| Location | character simultaneously in incompatible places |
| World rules | magic/technology/social rule violated |
| Character | stated goal/voice/behavior discontinuity |
| POV | head hopping, forbidden perspective, wrong narrative distance |
| Setup/payoff | unresolved setup, payoff without setup, forgotten mystery |
| Plot | missing causal bridge, dormant major subplot, duplicated beat |
| Pacing | long low-conflict run, clustered revelations, uneven chapter sizes |
| Repetition | repeated phrases, descriptions, beats, explanations |
| Dialogue | speaker indistinctness, overused tags, exposition dialogue |
| Style | tense drift, person drift, excessive filtering, configured banned tendencies |
| Metadata | scene lacks POV/location/time where project requires them |
| Publishing | chapter numbering, front matter, export requirements |

Each diagnostic needs **evidence and navigation**, not merely “AI says your pacing is poor.” The user should click a problem and jump to both sides of a contradiction.

Search should become equally IDE-like:

```text
Mara
"Mara" exact mentions
@character:Mara references
knows:"Black Key"
location:"North Station" after:chapter-10
pov:Mara status:draft
thread:romance
setup:unpaid
scene.goal:"escape"
regex:/red (moth|butterfly)/i
```

Add “Find References,” “Go to Definition,” backlinks, symbol-aware rename, and relationship traversal. Your own `future-directions.md` already identifies IDE-like project search, references, command palettes, refactoring, split editing, and shortcuts as desirable directions. fileciteturn9file0L2-L2

A **command palette** is essential:

```text
> New chapter
> New scene after current
> Move scene
> Go to character…
> Find references…
> Mark selection as setup…
> Link payoff…
> Compare with snapshot…
> Run continuity check…
> Start revision pass…
> Ask agent about selection…
> Generate chapter brief…
```

Add **snapshots and semantic diffs** at chapter, scene, planning-document, and whole-project levels. Scrivener makes section snapshots and comparison a core revision capability; OpenTales' existing branch/version architecture gives you the opportunity to make this substantially more powerful and Git-like. citeturn8search0 fileciteturn6file0L2-L2

For example:

```text
Chapter 12
Version A vs Version B

+ Mara now discovers the key before confronting Elias
- Elias directly explains the bridge's origin

Semantic changes:
• Mara knows bridge origin 2 scenes earlier
• Black Key ownership unchanged
• Setup "red moth" removed
• Romance thread tension increased
• Chapter +814 words
```

That semantic layer is much more useful to a novelist than line-by-line diffs alone.

The **revision workflow** should also be explicit. A book is not simply “draft” or “final.” Support passes:

```text
Draft
  ↓
Story / developmental
  ↓
Character
  ↓
Continuity
  ↓
Pacing
  ↓
Scene-level
  ↓
Line edit
  ↓
Copy edit
  ↓
Proof
  ↓
Final
```

Diagnostics can be filtered by current pass so writers are not shown fifty comma suggestions while trying to repair the climax.

A serious novel IDE also needs robust **import/export**. Scrivener's established workflow supports Word, PDF, RTF, plain text, EPUB and other targets, with a compile stage that separates drafting format from final output. citeturn8search0

For OpenTales I would prioritize:

```text
Import:
DOCX
Markdown
plain text
HTML
project ZIP/JSON
eventually Scrivener interoperability where feasible

Export:
DOCX manuscript
PDF
EPUB
Markdown
plain text
HTML
full OpenTales project archive
```

DOCX deserves especially high priority because “export” is not merely publishing; writers need to exchange editable manuscripts with human editors and collaborators.

Other high-value non-AI capabilities include customizable writing targets, session history, per-scene/chapter targets, labels/statuses/tags, smart collections, distraction-free composition, research side-by-side with manuscript text, annotations/comments, and dependable automatic backups. These are long-established features in mature long-form writing software rather than speculative AI features. citeturn8search0

Finally, consider whether “offline-ready” should eventually mean **true local manuscript persistence**, not only a PWA shell. Your architecture currently describes a network-first service-worker approach while the backend owns persistent application data. For a desktop novelist application, a stronger long-term design would be local-first storage—such as a desktop SQLite database or IndexedDB-backed local cache—with background server synchronization when collaboration/cloud access is enabled. fileciteturn6file0L2-L2

## Evaluation, reliability, permissions, and observability

This should be treated as a core product feature, not engineering cleanup.

At present, the repository has the beginning of skill eval fixtures but not a serious evaluation harness, while ordinary automated testing is also missing from package scripts. fileciteturn35file0L2-L2 fileciteturn37file0L2-L2 fileciteturn38file0L2-L2

I would build evaluation at several layers.

**Tool contract evaluation**

Test every tool without an LLM:

```text
correct permission checking
correct project isolation
valid IDs
invalid IDs
concurrent edits
stale versions
atomic batch rollback
scope enforcement
retry idempotency
```

**Agent-tool evaluation**

Ask models to perform representative operations and verify:

```text
Did it choose searchStory rather than dumping all chapters?
Did explorer avoid mutation?
Did chapter writer mutate only its assigned chapter?
Did it retrieve relevant canon?
Did it stop when complete?
Did it avoid duplicate tool calls?
```

**Skill evaluation**

Your current fixture style can evolve into:

```yaml
task:
  prompt: ...
  project_fixture: ...

expected_artifacts:
  - type: StoryBrief
  - type: ScenePlan
    min_count: 20

deterministic_checks:
  - schema_valid
  - no_duplicate_scene_ids
  - all_major_characters_defined
  - every_scene_has_causal_predecessor_or_is_opening
  - finale_resolves_main_plot

rubrics:
  - causality
  - protagonist_specificity
  - escalation
  - character_arc_integration
  - ending_cost
```

**Novel-level semantic evaluation**

This is where OpenTales can build an OSS benchmark no competitor appears to be centered around.

Create synthetic projects containing deliberate errors:

```text
Character's eyes change
Character knows secret too early
Dead character appears without explanation
Travel takes less than possible duration
Object changes owner without transfer
Magic violates previously stated rule
Setup never pays off
Payoff lacks setup
POV shifts illegally
Character's age contradicts timeline
Subplot vanishes for 40% of manuscript
Scene outcome contradicts next scene opening
```

Then measure recall and false positives.

**Creative quality evaluation**

Creative writing cannot be reduced to deterministic tests, so use blinded rubric grading and pairwise comparisons for:

```text
coherence
causal inevitability
character specificity
scene tension
dialogue distinction
prose specificity
voice stability
emotional payoff
outline adherence
interestingness
```

This combination matches current agent-evaluation guidance: deterministic code graders are best for objective state constraints, model graders are useful for open-ended judgments, and human ratings are needed to calibrate subjective model judgments. Anthropic recommends starting with roughly a few dozen representative tasks rather than postponing evals until hundreds are available. citeturn10view0

Story-generation research gives you useful benchmark hypotheses as well. Re3 measured plot coherence and premise relevance; DOC measured coherence, outline relevance, interestingness, and controllability; STORYTELLER evaluated creativity, coherence, engagement, relevance, and human preference. Those dimensions could inform an OpenTales long-form benchmark, while your structured data allows additional state-based tests those papers could not easily perform. citeturn6search3turn6search0turn9search2

Every Build Run should produce an **observability trace** containing:

```text
model
provider
model parameters
workflow version
system-prompt version
skill versions
tool schema versions

task
inputs
retrieved artifact IDs
context token count
tool calls
tool results
outputs
validator results

input tokens
output tokens
cost
latency
retries
completion state
```

Do not store or expose private hidden model reasoning as your debugging system. Inspect task decomposition, inputs, tool behavior, decisions, state transitions, and outputs instead.

The UI should show an understandable execution graph:

```text
Novel Build                                    63%

✓ Story brief
✓ Character architecture
✓ World bible
✓ Main outline
✓ Scene graph
✓ Chapters 1–18
● Chapter 19
  ├─ ✓ context assembled
  ├─ ✓ scene 19.1 drafted
  ├─ ● scene 19.2 drafting
  └─ ○ continuity extraction
○ Chapters 20–32
○ Developmental review
○ Continuity review
○ Final revision
```

The writer should be able to stop, pause, inspect, rerun, pin a decision, replace an artifact, branch from a checkpoint, or tell the build:

> Keep everything through Chapter 11. Re-plan the novel from Chapter 12 because Mara should refuse Elias here.

Then invalidate only downstream dependent artifacts.

That is a much more compelling form of AI control than a chat transcript.

You also need hard **permission scopes**.

For example:

```text
explorer:
  read: *
  write: none

character-planner:
  read: story + character + relevant docs
  write: character artifacts only

chapter-writer:
  read: context pack + retrieval
  write:
    chapterId == assignedChapter
    supporting docs under buildRunId

continuity-librarian:
  read: *
  write: proposed canon delta only

critic:
  read: *
  write: diagnostics only
```

Enforce that in the backend, not just the prompt.

The same principle should apply to instruction authority. Project-owner instructions and built-in skills can legitimately guide the model; imported research, attachments, manuscript prose, public web content, and user-created story text should be treated as **data**, never as executable instructions merely because they contain phrases such as “ignore previous instructions.” This becomes especially important once you add autonomous web research or third-party skill packages.

For third-party skills, think of a skill as code. Give installed skills explicit permissions and provenance:

```text
Skill: historical-research
Publisher: ...
Version: ...
Allowed tools:
  web search
  research notebook
Forbidden:
  manuscript mutation
  project settings
```

The current project-specific override mechanism is a good foundation for customization, but a mature ecosystem needs versioning, trust, validation, and capability declarations. fileciteturn34file0L2-L2

The existing approval design should then evolve from per-operation interruption to **scope-based authorization**.

```text
User approves:

"Allow Build 4 to:
 • create/edit planning artifacts
 • create/edit chapters
 • create/edit scenes
 • update canon
 only on branch ai/build-4
 up to $X / Y tokens
 until completion or blocker."
```

Anything outside that scope interrupts.

This preserves human authority without making unattended generation impossible.

## Recommended implementation architecture and roadmap

I would **not** begin by adding another twenty prompts or another dozen personas. That would improve demos while reinforcing the wrong architecture.

The order of work matters.

| Priority | Build | Why |
|---|---|---|
| **Critical** | Automated unit/integration/eval harness | You need measurements before changing agent behavior. |
| **Critical** | Durable `BuildRun` / `BuildTask` workflow state | Foundation for long-horizon autonomy. |
| **Critical** | AI sandbox branches + scoped authorization | Makes autonomous writing safe and reviewable. |
| **Critical** | Structured artifacts and schemas | Removes Markdown/chat as machine source of truth. |
| **Critical** | Context assembler | Necessary for coherent long-form generation. |
| **Critical** | Canon/state ledger | Necessary for continuity at novel scale. |
| **High** | Scene graph and scene-first planning | Gives drafting a granular executable plan. |
| **High** | Tool capability scoping | Makes specialized agents reliable. |
| **High** | Typed subagent task contracts | Eliminates vague delegation. |
| **High** | Per-scene canon extraction | Keeps story state synchronized as prose evolves. |
| **High** | Evaluator/revision loop | Converts first drafts into iterative output. |
| **High** | Real project search / references | Needed by humans and agents alike. |
| **High** | Story Bible UI | Makes structured canon usable without AI. |
| **High** | Corkboard / plot grid / timeline | Core human novel-planning capability. |
| **High** | Expanded Problems engine | Central differentiating IDE feature. |
| **Medium** | Rich manuscript/continuous editing mode | Major writer UX improvement. |
| **Medium** | Semantic snapshots/diffs | Excellent fit with your versioning architecture. |
| **Medium** | DOCX/EPUB/PDF build pipeline | Completes book workflow. |
| **Medium** | Optional research agent/notebook | Useful for historical/speculative research. |
| **Later** | Third-party skill/plugin ecosystem | Valuable after the core capability model stabilizes. |

The first architectural milestone should be **“autonomously build a complete book plan,” not “autonomously write a complete book.”**

Given one brainstorm, the system should be able to create, without further human intervention:

```text
StoryBrief
NarrativeContract
CharacterBibles
RelationshipGraph
WorldBible
PlotThreads
ActArchitecture
ChapterBriefs
ScenePlans
Timeline
SetupPayoffMap
ResearchQuestions
OpenQuestions
```

and all of it should be structured, inspectable, manually editable, schema-valid, and internally cross-linked.

Only after that passes repeatable evals should you make “Draft entire book” call the chapter workflow.

The next milestone is **one chapter end-to-end**:

```text
scene plans
    ↓
context pack
    ↓
draft
    ↓
canon extraction
    ↓
deterministic diagnostics
    ↓
independent critic
    ↓
revision plan
    ↓
revision
    ↓
quality gate
    ↓
checkpoint
```

The evaluator-optimizer pattern is explicitly recommended for tasks where criteria are meaningful and iterative feedback improves output, with writing given as a natural analogy. citeturn4view0

Re3 independently arrived at a similar long-story pattern: structured planning, repeated context injection, candidate selection, and factual-consistency editing outperform direct long-form generation. citeturn6search3

Once that works reliably, a full-book run is primarily scheduling:

```ts
for (const chapter of build.chaptersInCausalOrder) {
  await ensureChapterBrief(chapter);
  await ensureScenePlans(chapter);

  const context = await assembleChapterContext(chapter);

  await draftChapter(chapter, context);
  await extractCanonDelta(chapter);
  await runChapterDiagnostics(chapter);

  if (needsRevision(chapter)) {
    await critiqueChapter(chapter);
    await reviseChapter(chapter);
    await extractCanonDelta(chapter);
    await runChapterDiagnostics(chapter);
  }

  await checkpoint(chapter);
}
```

The actual implementation should of course use resumable persisted tasks rather than an in-memory loop, but this illustrates how much orchestration should be ordinary deterministic code.

Do not endlessly self-revise either. Give each task an explicit quality gate and bounded iterations:

```text
Draft
  ↓
deterministic validation
  ├─ schema/state failure → must fix
  └─ pass
       ↓
critic rubric
       ├─ >= threshold → accept
       └─ < threshold → one revision
                         ↓
                       regrade
                         ↓
              accept or escalate/flag
```

Reflection-style research supports the general value of persistent textual feedback and iterative correction, while agent practitioners warn about uncontrolled loops and compounding costs. citeturn9academia36turn4view0

Model routing should be a first-class workflow setting rather than one project-wide model choice:

```text
Strong reasoning model:
  story architecture
  difficult outline repair
  prose drafting
  developmental revision

Fast/cheap model:
  summarization
  entity extraction
  canon delta extraction
  categorization
  metadata generation

Specialized judge:
  rubric evaluation
```

Routing work to specialized or cheaper models when task complexity permits is one of the standard workflow patterns Anthropic describes for controlling cost while preserving quality. citeturn4view0

The final runtime might therefore look like:

```text
┌───────────────────────────────────────────────────────────┐
│                     OpenTales Frontend                    │
│                                                           │
│ Manuscript │ Story Bible │ Plot Grid │ Problems │ AI Run │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│                    Application Backend                    │
│                                                           │
│ Projects / Chapters / Scenes / Characters / Versions      │
│ Search / Canon / Timeline / Diagnostics / Export          │
└───────────────┬───────────────────────┬───────────────────┘
                │                       │
                ▼                       ▼
┌──────────────────────────┐   ┌────────────────────────────┐
│ Novel Workflow Engine    │   │ Context Engine             │
│                          │   │                            │
│ BuildRun                 │   │ exact search               │
│ BuildTask                │   │ full-text search           │
│ dependency DAG           │   │ semantic retrieval         │
│ retry / checkpoint       │   │ graph traversal            │
│ authorization            │   │ token budgeting            │
└─────────────┬────────────┘   └──────────────┬─────────────┘
              │                               │
              └──────────────┬────────────────┘
                             ▼
┌───────────────────────────────────────────────────────────┐
│                      Agent Runtime                        │
│                                                           │
│ Orchestrator  Creator  Drafter  Critic  Librarian         │
│                        │                                  │
│           dynamically loaded Skills                       │
│                        │                                  │
│              narrowly scoped Tools                        │
└────────────────────────┬──────────────────────────────────┘
                         │
                         ▼
┌───────────────────────────────────────────────────────────┐
│                     Persistent State                      │
│                                                           │
│ Postgres                                                  │
│ ├─ Story artifacts                                       │
│ ├─ Canon facts                                           │
│ ├─ Entity states                                         │
│ ├─ Timeline                                              │
│ ├─ Plot/setup/payoff graph                               │
│ ├─ Build checkpoints                                     │
│ ├─ Agent traces                                          │
│ └─ Eval results                                          │
└───────────────────────────────────────────────────────────┘
```

The key is that **the model is no longer the database, the project manager, or the workflow engine**.

It is the creative reasoning component inside a system that knows:

- what the novel is supposed to be,
- what has already been decided,
- what has already happened,
- what every character currently knows,
- what remains unresolved,
- what task is being performed now,
- what context that task needs,
- what tools that task is allowed to use,
- what “done” means,
- what quality bar must be passed,
- what work comes next,
- and how to resume after a crash.

That is the missing foundation beneath OpenTales' current LLM layer.

## Strategic conclusion

The deepest change I would make to OpenTales is therefore **not a new system prompt**.

It is to change the unit of intelligence from:

> **chat session**

to:

> **versioned story state + durable creative workflow**.

Your existing AI implementation is optimized around conversation: recent messages, general-purpose tools, an eight-step loop, Markdown skills, subagent chat sessions, and human approval of individual mutations. That architecture is perfectly reasonable for “help me improve Chapter 3,” but it cannot scale cleanly to “take this premise and construct an internally coherent 90,000-word novel.” fileciteturn25file0L2-L2 fileciteturn26file0L2-L2

The research on long-form generation points in the opposite direction from giant one-shot completions: hierarchical planning, detailed outlines, repeated retrieval of relevant story state, iterative revision, entity/state tracking, and decomposition all improve long-range generation. citeturn6search3turn6search0turn6academia29turn9search2

Research and production experience with agents says much the same thing at the systems level: preserve only high-signal context, store long-lived state outside the context window, checkpoint long-running work, give delegated workers explicit objectives and output contracts, use multi-agent parallelism selectively, design tools as carefully as prompts, and evaluate the complete agent harness rather than assuming a better prompt equals a better agent. citeturn5view2turn5view3turn4view1turn10view1turn10view0

And mature writing products demonstrate the human side of the equation: writers need flexible scene organization, corkboards, plot lanes, story bibles, metadata, research, revision history, split views, targets, continuous manuscript editing, robust export, and the freedom to choose their own planning method. citeturn8search0turn7search0turn7search19turn7search4

OpenTales can combine those two worlds in a way the project's existing “IDE for novelists” concept is unusually well suited to support:

> **The manuscript is source code.**  
> **The Story Bible and canon ledger are the symbol table.**  
> **Scenes are executable units.**  
> **The plot graph is the dependency graph.**  
> **Story constraints are types.**  
> **Continuity checks are static analysis.**  
> **The Problems panel is the compiler diagnostic stream.**  
> **Versions and AI branches are Git.**  
> **Skills are reusable build procedures.**  
> **Agents are scoped workers.**  
> **The context assembler is the linker.**  
> **Revision is optimization.**  
> **Export is the build artifact.**

That is a considerably more powerful product than “Scrivener with AI.”

It also gives you a realistic path to the capability you actually want:

> A human gives OpenTales a single brainstorm, chooses how much authority the AI has, and starts a Novel Build. OpenTales turns the brainstorm into structured story state, plans the book, identifies missing information, resolves what it can, constructs characters/world/plot/scenes, drafts incrementally from tightly assembled context, records what becomes canon after every scene, continuously checks the new prose against the rest of the story, independently critiques weak work, revises it, checkpoints every stage on an isolated branch, and eventually presents the author with a complete manuscript plus the entire inspectable reasoning *product* behind it: outline, story bible, timeline, arcs, diagnostics, revisions, and provenance.

The current OpenTales repository already contains many of the right nouns—**chapters, scenes, characters, locations, acts, docs, versions, tools, skills, agents, approvals, problems**. fileciteturn29file0L2-L2 fileciteturn40file0L2-L2

The next stage is to build the verbs and invariants that connect them into a real writing system:

**plan → structure → retrieve → draft → extract → validate → critique → revise → checkpoint → continue.**

Once that loop is durable, structured, measurable, and deeply integrated into the IDE, “one-shot a novel” stops being a prompt-engineering trick and becomes an engineering problem OpenTales can actually solve.