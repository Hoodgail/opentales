# Failed story run review — 2026-08-26

## Outcome

The original attempt failed before the durable Novel Build executed a single task. After the repairs below, the same build was explicitly resumed against the project’s stored Yasui OpenAI-compatible provider with `gpt-5.6-terra` and is now advancing through the persisted planning graph.

At the verified recovery snapshot, Story Brief, Narrative Contract, eleven Character Bibles, World Bible, Relationship Graph, and Research Questions were `DONE` with current VALIDATED artifacts; Plot Threads was actively leased and running. The workflow remains Plan & Review and will pause at its planning checkpoint rather than silently entering manuscript drafting.

## Evidence from the failed attempt

| Time (UTC) | Evidence | Finding |
| --- | --- | --- |
| 04:12 | Parent AI session `cmt9kvsk70001zc6e646dsskv` | The author explicitly asked to draft the story with the Novel Build skill. |
| 04:21 | Build `e574c354-8c9e-4d93-8b84-22ed85809cfd` | The agent created a `PLAN_REVIEW` build and added a planning-only constraint, silently narrowing the requested drafting intent. |
| 04:21 | `startNovelBuild` result | The tool returned 45,217 characters, including the full manifest and task graph, directly into model context. |
| 04:21–04:49 | Child session `cmt9l78kc001dzc6eticrsoo4` | The parent delegated `story-brief` to a generic subagent instead of leaving the persisted task for the durable worker. |
| 04:21 and 04:48 | `getBuildState` results | Each call returned 49,722 characters. The child loaded the same oversized state twice. |
| 04:26 and 04:38 | `applyArtifactBatch` | Two approximately 21KB artifact proposals waited for Manual approval and each reached the ten-minute approval timeout. Neither was persisted. |
| 04:49 | Child usage | The child accumulated 172,086 input and 8,273 output tokens (180,359 total) against a 128,000-token context budget. |
| 04:54 | Parent session | The upstream provider failed after three attempts. |
| 20:06 | Durable worker | After authorization, the build paused before inference because static `AI_MODEL_PRICING_JSON` had no `gpt-5.6-terra` entry. No trace was created and no build cost was incurred. |

## Root causes and repairs

### 1. Static pricing made an otherwise runnable model permanently unknown

Pricing now comes from the [models.dev API](https://models.dev/api.json), whose documented costs are USD per million tokens. OpenTales converts those prices to integer currency micro-units, refreshes them through a conditional in-memory TTL cache, retries stale snapshots after transient failures, and never persists the catalog. Ambiguous relay IDs use the conservative maximum provider price. Explicit sourced/versioned `AI_MODEL_PRICING_JSON` entries remain operator overrides.

### 2. Interactive orchestration bypassed the durable worker

The Novel Build skill, system prompt, layered workflow prompt, and task-tool description now state that persisted build tasks belong exclusively to the authorized worker. The runtime also rejects generic subagent contracts that try to emit build artifacts without a fenced `buildTaskId` lease.

This removes the failed path where a Manual child session waited invisibly for artifact approval. Worker tasks execute only after build authorization, validate their lease and scope, persist traces, and run artifact writes directly within that authority.

### 3. Read tools amplified context instead of bounding it

`startNovelBuild` now returns a compact creation receipt rather than the full run. `getBuildState` defaults to a bounded summary with compact ready/blocker/artifact/checkpoint metadata. Source brainstorm and target context require `detail=context`; the compact dependency graph requires `detail=tasks`. Artifact bodies, full task policies, and the full manifest are never returned by the default projection.

On the failed run, the new default projection is roughly one fifth the previous payload size and no longer exposes artifact bodies or full policy/manifest blobs.

### 4. The agent silently changed “draft this story” into planning-only work

The Novel Build instructions now prohibit silently choosing Plan & Review when the author explicitly requests a drafted manuscript. Autonomous Draft requires explicit finite token and cost budgets; Manual mode asks for that authorization, while Auto mode states the boundary rather than inventing a budget.

The existing run remains Plan & Review because changing its authorization and spend semantics automatically would exceed the author’s prior approval. Resuming it will continue structured planning. A full unattended manuscript draft should use an explicitly budgeted Autonomous Draft authorization.

### 5. Built-in skill edits were not published as new versions

The initial repair changed `novel-build` instructions while its manifest still declared `1.0.0`, so the worker correctly rejected the changed content hash against pinned provenance. `novel-build@1.1.0` and `novel-characters@1.2.0` are now published versions. Future task templates pin those versions, and an existing task can auto-repin only when it is untouched, belongs to a built-in skill, and the available version is a strict semantic-version upgrade. Started tasks and project overrides remain fail-closed.

### 6. Provider-native structured output and oversized single responses were not portable

Yasui Terra persisted valid artifacts but did not reliably finish with provider-native `Output.object` or `reportTaskResult`. The worker now prefers `reportTaskResult`, can derive an observable candidate from successful persisted `applyArtifactBatch` results, and still runs independent schema/task/cardinality validation before completion.

Durable workers now expose only the active procedural skill’s tools. Character planning uses a concise versioned skill, batches at most three bibles per tool call, reserves a realistic cumulative multi-step budget, and enforces both batch size and exact manifest cardinality inside the fenced tool boundary. This produced exactly eleven validated bibles in four calls (`3+3+3+2`) on one Terra attempt.

## Recovery state

- Build status: `PLANNING` (worker active)
- Completed boundaries: `story-brief`, `narrative-contract`, `character-bibles`, `world-bible`, `relationship-graph`, `research-questions`
- Current artifacts: 1 Story Brief, 1 Narrative Contract, 11 Character Bibles, 1 World Bible, 1 Relationship Graph, 1 Research Questions artifact
- Published provenance: `novel-build@1.1.0`, `novel-characters@1.2.0`
- Successful Story Brief trace: 46,122 input / 3,962 output tokens, $0.174735
- Successful Narrative Contract trace: 83,205 input / 4,347 output tokens, $0.273218
- Successful exact-count Character Bibles trace: 217,545 input / 10,557 output tokens, $0.702218
- Successful World Bible trace: 94,636 input / 8,775 output tokens, $0.368215
- Successful Relationship Graph trace: 82,332 input / 5,560 output tokens, $0.289230
- Ledger snapshot while Plot Threads was running: 2,015,258 tokens and $6.882923, including the earlier failed compatibility/timeout/cardinality attempts described above
- Next automatic boundary: finish Plot Threads, then continue dependency-ready planning until Plan & Review pauses at the planning checkpoint
