# Failed story run review — 2026-08-26

## Outcome

The attempt failed before the durable Novel Build executed a single task. The run remains recoverable: `story-brief` is still `READY`, all downstream tasks are dependency-blocked, and the build ledger contains no traces, artifacts, task attempts, model tokens, or model cost.

OpenTales now resolves the previously unknown `gpt-5.6-terra` price from models.dev and has replaced the stale error with: **“Pricing for task story-brief is now available from the refreshed models.dev catalog. Resume the build to continue.”** The run remains paused so resuming provider spend is an explicit author action.

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

## Recovery state

- Build status: `PAUSED`
- Build revision: `2`
- Ready task: `story-brief`
- Durable task attempts: `0`
- Durable traces: `0`
- Persisted story artifacts: `0`
- Build token/cost usage: `0`
- Required action: open **Novel Builds**, review the preserved Plan & Review scope, and choose **Resume**.

