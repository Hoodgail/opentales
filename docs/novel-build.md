# Novel Builds

OpenTales turns a brainstorm into a durable, inspectable story build. The language model is a creative worker inside the build; PostgreSQL owns workflow state, authorization, story state, provenance, and recovery.

## Core model

| Concept | Persisted responsibility |
| --- | --- |
| `BuildRun` | Objective, target, autonomy, budgets, authorization, phase, branch, and aggregate status. |
| `BuildTask` | Typed work, dependencies, immutable inputs, expected outputs, attempts, quality gate, lease token, and transition history. |
| `StoryArtifact` | Schema-versioned planning or output data such as a Story Brief, Scene Plan, Chapter Draft, or Export Manifest. |
| Story state | Versioned canon facts, entity state, timeline events, open loops, setup/payoff links, and plot threads. |
| `BuildManuscriptUnit` | A sandboxed chapter or scene writing branch. Units compile into a reviewable manuscript without changing main. |
| `BuildCheckpoint` | Immutable, hashed workflow and story-state snapshot. |
| `BuildTrace` / evaluation | Model and tool provenance, bounded usage, validator evidence, independent rubric scores, latency, and completion state. |
| `BuildReview` | Frozen prose and metadata proposed for an explicit owner approve/merge or reject decision. |

## Autonomy modes

- **Assist** keeps the existing approval-gated interactive behavior. Human story-state edits use project permissions and are not blocked by the AI's narrower scope.
- **Plan & Review** creates the complete structured plan, pauses for manifest review, and then writes only to isolated build manuscript units after explicit authorization. It pauses again at declared checkpoints.
- **Autonomous Draft** requires an explicit branch, artifact/chapter/scene scope, token/cost limits, and optional expiry. Final merge remains owner-controlled.

Authorization never grants a durable worker access to canonical chapter or scene mutation tools. Each worker mutation is fenced by build ID, task ID, worker ID, lease token and generation, expiry, and declared output scope.

## Workflow

The built-in workflow is deterministic at the outer level:

```text
brainstorm
  → story brief / narrative contract
  → characters / relationships / world / research
  → plot threads / acts / chapters / beats / scene plans
  → timeline / setup-payoff / open questions
  → plan validation and checkpoint
  → per-scene draft
      → canon/state extraction
      → deterministic diagnostics
      → independent critic
      → bounded revision
      → canon re-extraction and diagnostics
      → quality gate and checkpoint
  → chapter compilation
  → developmental / character / continuity / pacing passes
  → structural / line / copy / proof / finalization
  → validated export set
  → final checkpoint and owner review
```

Planning for a normal 85,000-word target is sharded into bounded beat and scene tasks. A production-size fixture covers 32 chapters and 104 scenes rather than requiring one oversized response. Causal dependencies serialize drafting while independent analysis remains parallelizable.

## Durability and stopping

Workers claim ready tasks with expiring fenced leases and heartbeat during execution. `STARTED` traces are persisted before inference. A backend restart recovers stale leases and interrupted traces without replaying a committed output.

Pause and cancel abort local executions and invalidate their lease authority. A late provider response cannot mutate state after pause, expiry, reassignment, or cancellation. Failed or over-budget attempts compensate provisional artifacts, story-state versions, and manuscript heads before retry or escalation.

## Context and model routing

Each inference is rendered once in layers A–F:

1. runtime and security invariants;
2. active build/task/dependencies/budget;
3. pinned, versioned skills and references;
4. a token-budgeted context pack;
5. explicit author authority and directives;
6. output schema and rubric.

Manuscript, attachment, imported, and public-web content is serialized as untrusted data. Context uses build-branch prose, causal predecessors, facts valid at the target story position, current entity state, timeline, active threads, open loops, directives, pins, and prior evaluation feedback.

Model routing is configured with `AI_MODEL_ROUTING_JSON`. The worker automatically fetches the open [models.dev catalog](https://models.dev/api.json), converts its per-million-token USD prices to currency micro-units, and keeps them in an in-memory cache for six hours by default. Expired entries are conditionally refreshed; a temporary network failure reuses the last in-memory snapshot for five minutes while continuing to retry. The cache is never persisted across backend restarts.

Unknown prices still fail closed. Bare official OpenAI (`gpt-*`, `o<number>*`), Google (`gemini-*`), and Anthropic (`claude-*`) IDs use their official provider entries. Reasoning-effort suffixes advertised by the catalog resolve to the same price, for example `gemini-3.8-flash-high` → `google/gemini-3.8-flash`. Exact catalog IDs always win over derived aliases. Unknown namespaces and unadvertised suffixes are not guessed. Other ambiguous model IDs served by several relays use the conservative maximum input/output price. Published context tiers are applied above their input-token threshold; aggregated multi-call usage can conservatively overestimate long-context charges. Cache-read discounts, special service modes, and relay-specific markups are not inferred; these remain budget estimates, not provider invoices. `AI_MODEL_PRICING_JSON` remains an optional, explicitly sourced and versioned operator override, and its entries win over models.dev. Canonical overrides also apply to derived aliases; an exact alias override wins. Cold-start failures back off for the retry interval rather than fetching on every worker poll. `OPENTALES_MODELS_URL` also selects the pricing catalog unless `AI_MODELS_DEV_PRICING_URL` overrides it. Task contracts enforce duration, maximum input/output tokens, tool calls, retry classification/backoff, model tier, and fallbacks.

Example:

```env
AI_MODEL_PRICING_JSON='{"provider/model":{"inputMicrosPerMillion":2000000,"outputMicrosPerMillion":8000000,"source":"provider price sheet","version":"2026-08-25"}}'
AI_MODEL_ROUTING_JSON='{"strong":["provider/reasoning"],"fast":["provider/fast"],"judge":["provider/judge"]}'
# Optional cache controls (defaults shown):
AI_MODEL_PRICING_CACHE_TTL_MS=21600000
AI_MODEL_PRICING_CACHE_RETRY_MS=300000
AI_MODEL_PRICING_FETCH_TIMEOUT_MS=15000
```

Set `AI_NOVEL_BUILD_WORKER_ENABLED=false` to run the API without the background worker. Tests also disable startup workers through `NODE_ENV=test` and invoke workers explicitly.

## Story state and diagnostics

Story state is append-only. An edit creates a new current version and retains the prior value, evidence, task/unit provenance, validity interval, and restoration path. Replanning invalidates downstream prose and state while preserving explicitly pinned artifacts.

The Problems surface combines local prose checks and build-aware backend diagnostics for continuity, chronology/travel, character knowledge, location, world rules, character/POV, setup/payoff, plot/pacing, repetition, dialogue/style, metadata, publishing, schema, cross-link, and workflow errors. Diagnostics carry navigable evidence and are filtered by revision pass. Optional scene metadata does not create warnings unless the project requires it.

Project search supports exact, full-text, regex, field, structural, and reference queries over manuscript prose, build prose, scenes, story structure, characters and aliases, relationships, locations, docs, obstacles, artifacts, canon, timeline, open loops, and plot threads. Results contain absolute offsets and branch/unit navigation data.

Examples:

```text
"Mara" exact mentions
@character:Mara
knows:"Black Key"
location:"North Station" after:chapter-10
pov:Mara status:draft
thread:romance
setup:unpaid
scene.goal:"escape"
regex:/red (moth|butterfly)/i
```

## Human review and merge

Build units have their own writing branches and never alter main before merge. Writers can edit units, reorder build scenes, compile a snapshot, compare prose and semantic state with main, and create a review.

A review freezes the exact writing versions, word counts, metadata, and hashes. Post-review drift is rejected. Owners can approve then merge, or reject with a reason. Merge applies the reviewed snapshot under locks and optimistic checks; stale main or ambiguous entity mapping is surfaced rather than guessed.

## Export and import

OpenTales generates and validates:

- editable DOCX standard manuscripts;
- US Letter PDF submission copies;
- EPUB3 with navigation and spine metadata;
- Markdown bundle, plain text, and sanitized HTML;
- a structured OpenTales project archive.

Exports may target main or a compiled build. They are private authenticated assets with checksums, sizes, format metadata, branch-head provenance, regeneration/deletion history, and secure downloads. The worker automatically recompiles the final revised manuscript and generates a plain-text reading-copy export before the final checkpoint. It no longer requires a separate manual export to finish. Export-manifest registration is fenced by the active task lease; a paused or superseded worker cannot register its output. Other formats remain available through Publish.

The Novel Build final gate accepts only a `READY` project export whose stored bytes, checksum, compilation, and branch heads match its Export Manifest.

Imports support DOCX, Markdown, text, HTML, and project archives. Preview runs before apply and reports chapter mapping and conflicts. Applying is explicit and transactional. HTML is sanitized; ZIP paths, compressed/uncompressed sizes, file counts, MIME type, and project ownership are validated.

## Snapshots, annotations, and suggestions

Named snapshots can freeze the heads and structured metadata for a whole project, chapter, scene, project doc/planning writing, Build checkpoint, or compilation. Comparing snapshots produces prose and semantic changes. Restore and branch operations are explicit, idempotent, and create new versions; they never delete or rewind immutable history.

Comments, notes, and suggestions are anchored to an immutable WritingVersion with absolute offsets, quote text, and an anchor hash. Threads and replies retain author and resolution history. Accepting a suggestion requires the expected current head and a still-matching anchor, then creates a new WritingVersion. Stale or changed prose returns a conflict instead of applying a blind replacement.

## Frontend surfaces

- **Build**: intake, authorization, dependency graph, task/trace/eval inspection, pause/resume/cancel/retry/rerun/replan, pins, checkpoints, and branch review.
- **Story Bible**: artifacts and immutable history, canon, entity state, timeline, threads, setups/payoffs, relationships, aliases, evidence, edit, and restore.
- **Outline Studio**: hierarchy, corkboard, plot grid, timeline, character arcs, tension, and full optional scene metadata over synchronized units.
- **Manuscript**: chapter source plus continuous read/write/source modes and research sidecar.
- **Search / Problems**: branch-aware query/reference navigation and evidence-backed diagnostics.
- **Publish**: export, secure download, import preview, conflict confirmation, and apply.
- **Revisions**: named project/writing snapshots, semantic/prose comparison, restore/branch, and manuscript annotation/suggestion threads.

## Public API and SDK

Routes are mounted below `/projects/:projectId`. The TypeScript SDK exposes matching methods.

Important resource families:

- `/builds`, authorization, lifecycle, task retry/rerun, replan, and checkpoint branching;
- `/builds/:buildRunId/units`, compilation, comparison, reviews, merge/reject, pins, artifacts, story state/history/temporal queries, observability, search, references, and diagnostics;
- `/chapters/:chapterId/scenes` for optimistic scene CRUD/reorder;
- `/exports` and `/imports` for publishing artifacts and preview/apply.
- `/snapshots` and `/annotations` for immutable revision markers and anchored writer collaboration;
- `/refactor/rename` for previewed, atomic character/location symbol rename across main and build branches.

Worker-only claim, heartbeat, completion, trace, evaluation, branch patch, and task-bound artifact/state operations are not exposed as ordinary authenticated project routes.

External MCP agents receive parallel user-facing operations rather than worker credentials: `createBuildUnit`, `updateBuildUnit`, `invalidateBuildUnit`, `reorderBuildUnits`, `compileBuild`, `compareBuildManuscript`, and the build-review tools. These call the same public use cases with project permissions, idempotency keys, and build/unit/head revisions. They are intended for explicit repair, review, and handoff; they cannot claim tasks, forge evaluator results, or write through a worker lease.

## Verification

Run the release checks:

```bash
pnpm lint
pnpm test
pnpm eval
pnpm test:coverage
pnpm build
```

Database-backed suites use `NOVEL_BUILD_TEST_DATABASE_URL`, `AI_WORKER_TEST_DATABASE_URL`, `EXPORT_IMPORT_TEST_DATABASE_URL`, `REVISION_TEST_DATABASE_URL`, and `RENAME_REFACTOR_TEST_DATABASE_URL`. CI points all five to a migrated PostgreSQL service and exercises concurrent worker, transaction, review/merge, search/history, diagnostics, and export/import behavior.

Repeated model rubric trials are opt-in because they require provider credentials:

```bash
pnpm --dir packages/backend eval:model
```

The command writes a machine-readable report with means, thresholds, and variance; it is not required for credential-free CI.

### Complete live-provider validation

Use a migrated disposable database and configure an OpenAI-compatible endpoint:

```bash
export DATABASE_URL='postgresql://.../opentales_test'
export JWT_SECRET='local-validation-secret'
export LIVE_API_KEY='...'
export LIVE_BASE_URL='https://your-provider.example/v1'
export LIVE_MODEL='your-model'
pnpm --dir packages/backend eval:novel-build
```

The command creates an isolated test project, runs the actual worker and provider through a two-chapter, three-scene story, and writes its run ID, task report, manuscript, verified export, and verification summary to `LIVE_OUTPUT_DIR` (default `/tmp/opentales-live-result`). It exits unsuccessfully for incomplete/paused builds, empty scenes, out-of-range prose, unfinished tasks, or a mismatched export checksum. Set `LIVE_BUILD_ID` to inspect or continue the same fixture run; the selected `LIVE_MODEL` is applied to that fixture project on resume. This does not bypass paused tasks or quality gates. To explicitly repair a failed boundary after changing the implementation, also set `LIVE_RERUN_TASK` to its task key; the normal rerun API invalidates dependent outputs before regenerating them. Credentials are read from the environment and encrypted in project settings.

For explicit test-budget changes, set `LIVE_MAX_TOKENS` (default 5,000,000). On an existing run, this calls the normal authorization endpoint with the existing scope and unchanged cost cap before continuing; it does not mark tasks complete.

To stop a long validation run cleanly after its current task, configure `LIVE_STOP_FILE` and create that file. The runner exits unsuccessfully because validation is incomplete, while preserving the runnable build for `LIVE_BUILD_ID` resume. Remove the stop file before resuming. Task reports include token usage, the authorized token limit, and accounting cost.

Completed runs can be verified again without reauthorizing them. Verification selects an export from the latest compilation and checks that its scene snapshots match the current saved writing versions before checking the downloaded checksum.

For a larger supplied brainstorm, set `LIVE_BRAINSTORM_FILE` to a UTF-8 text file. `LIVE_TITLE`, `LIVE_OBJECTIVE`, `LIVE_TARGET_WORDS`, `LIVE_MIN_WORDS`, `LIVE_MAX_WORDS`, `LIVE_CHAPTERS`, `LIVE_SCENES`, and `LIVE_CHARACTERS` configure the new build. For example, use 32 chapters, 110 scenes, 20 characters, and a 40,000-word target with a 32,000–48,000-word range. Verification uses the persisted run's targets, including on resume. `LIVE_MAX_COST_MICROS` sets the new run's cost cap (default 200,000,000). To compare providers in parallel, use separate disposable databases and separate output directories; never run two workers against the same fixture run.

Scene planning receives a complete structural index of the relevant persisted chapter briefs, separate from truncated prose excerpts. A scene shard uses its chapter's declared scene keys and count, rather than assuming an even distribution. The worker retains build-scoped artifact listing and reading under strict skill filtering. Missing or oversized structural input fails before inference instead of asking the author to reconstruct existing data.

Artifact replacement increments the producer task revision. Heartbeats refresh that revision and retry a bounded revision conflict while retaining the original lease token and generation checks. Completion refreshes the revision after stopping heartbeats, so a worker can revise its own artifact without losing an otherwise valid lease. A delayed integration fixture exercises replacements on both sides of a real heartbeat.

Failed-attempt compensation invalidates all artifact versions created in that attempt and restores only predecessors outside the failed attempt. Replacement versions advance beyond all retained history, including invalidated versions. Interrupted calls without finalized usage are conservatively charged against their reservation; trace pricing metadata marks `chargedReservedCeiling` even when catalog pricing is available. Those charges are budget accounting estimates, not provider invoices.

Large beat plans allocate `beat-1` through `beat-N` before model generation. Shards write only their assigned range, use the same artifact key and `beatKey`, and may link forward only to this declared corpus. Later shards depend on the previous shard, so causal inputs and rerun invalidation follow the graph. Descriptive beat names belong in `title`. Aggregate failures report concrete counts or invalid keys instead of a generic failed-check message. `LIVE_RERUN_TASK` also accepts comma-separated task keys when repairing multiple independent shards from an older run.

Scene dependencies must likewise name scene keys declared in the persisted chapter briefs, including forward references. The write tool rejects undeclared dependencies before they enter the planning corpus.

The runner uses the same automatic models.dev pricing loader, cache, alias resolution, and optional `AI_MODEL_PRICING_JSON` overrides as production. It no longer injects fixed test prices. Unresolved prices pause a cost-bounded run before inference. Historical validation totals recorded with fixed test rates are not retroactively changed. Run PostgreSQL-backed CI as well: embedded database validation does not prove production concurrency behavior.
