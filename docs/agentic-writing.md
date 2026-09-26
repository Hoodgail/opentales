# Agentic writing

Describe the writing goal in AI Agent. A single sentence is enough: “Read the brainstorm and begin planning out the story”, “Keep going”, “Draft the next chapter”. The agent does the work **inside the project** — planning docs, characters, places, acts, chapters, and scenes — and replies with a short summary of what it created. You shouldn’t need a long workflow prompt; the workflow lives in the agent’s system prompt and skills.

## What the agent builds

On the first multi-step task the agent sets up a desk you can browse in the file tree:

```text
Story Bible/
  Ledger              working memory: Now, Next action, Notes to future self, Decisions, Progress
  Canon               numbered facts that must not drift (ages, dates, who knows what)
  Brief & Contract    premise, promises, tone, ending shape, length target, numbered drift criteria
  Voice & Style       POV, tense, rhythm, banned phrases
  World/              rules with costs, institutions, history, glossary
  Threads & Timeline  plot threads, setup→payoff map, dated timeline
Chapter Briefs/       one brief per chapter
Revision/             critique, continuity reports, final receipt
```

Story elements become native objects: characters and relationships, locations, acts, obstacles, story structure (logline/outline/climax), chapters with summaries, and scenes with goal/conflict/turn/outcome metadata. Prose is drafted scene by scene and compiled into chapters with `compileChapterFromScenes`.

## How it remembers

- **Project compass.** Every agent turn receives a compact, database-generated map of the project: docs and folders with IDs, chapters with status and word counts, counts of characters/locations/acts, the logline, and the top sections of the Ledger (Now, Next action, Notes to future self, Standing corrections, Open questions). A brand-new session or a session right after context compaction therefore starts oriented.
- **Ledger.** The agent updates the Ledger after each unit of work and writes “Next action” for a reader with no chat history, so “keep going” resumes the right step.
- **Canon.** Facts are recorded as they are invented or drafted and checked before later scenes are written.

## Phases

The `novel-studio` skill is the playbook: understand the idea (critique, brief & contract), people and places, structure (acts, all chapters, briefs, scenes, threads, timeline), draft (scene by scene with canon extraction and lint), revise (developmental, continuity, line, copy), and finish (final lint and receipt). Craft skills (`novel-intake`, `novel-characters`, `novel-world`, `novel-outline`, `novel-scenes`, `novel-chapters`, `novel-critic`, `novel-continuity`, …) are loaded at each phase.

How far one turn goes depends on the request: “begin planning” completes the idea, cast, world, and a full chapter skeleton; “keep going” does the Ledger’s next coherent chunk; “write the book” continues phase after phase, checkpointing the Ledger after each chapter.

## Agents

- **writer** (default) — the general writing agent, following the playbook above.
- **story-architect** — the autonomous production agent for long runs; delegates chapters and critiques to subagents.
- **planner** — read-only: assesses and proposes a plan in chat without changing anything.
- Subagents: `chapter-writer-runner`, `critic-runner`, `continuity-keeper`, `outline-runner`, `characters-runner`, `settings-runner`, `voice-runner`, and others — each writes its result into the project and returns a short receipt.

## Checking the work

`runStoryLint` runs the deterministic diagnostics engine over the live manuscript (POV/tense drift, head-hopping, repetition, filter words, rhythm, dialogue tags, chronology, unknown names, scene metadata gaps, length targets). The agent runs it after drafting or revising and before declaring a pass clean.

## Modes

Manual mode requires approval for every proposed change (batch-approve related changes in the panel). Admin-only Auto mode executes permitted changes immediately. Project permissions and version checks apply in both modes.

Messages, tool calls, writing versions, and docs persist. A backend restart interrupts a running model invocation; ask the agent to “keep going” and it resumes from the Ledger.

## Evaluating the agent

`packages/backend/scripts/eval-novel-agent.ts` seeds a project, runs a scenario (`plan-from-brainstorm`, `resume-from-ledger`, `continue-session`, `write-next-chapter`) against a real model, and snapshots everything the agent persisted; `scripts/grade-novel-agent.py` grades the snapshot against objective assertions.
