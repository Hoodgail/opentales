# Novel Build and MCP reliability audit

> Historical validation report: this workflow has been retired. See [agentic writing](agentic-writing.md) for current behavior.

Base revision: `9f8b15f` (master). Validation date: 2026-09-20.

## Confirmed defects and changes

- **Forced copy-edit rewrites:** every reviser previously had to change every assigned unit, including compiled chapters. A legitimate copy edit failed twice after inspecting all units and correcting only the text that needed it. Copy editing and finalization now accept nonempty unchanged units only with matching current-head read receipts, and always require an independent model evaluation when validation passes. Empty prose, stale/unmatched receipts, unsupported completion claims, and no-op substantive revisions still fail. Pricing reservations include the added judge work.

- **Standalone worker exited with pending work:** unreferencing an active task's deadline let Node exit with code 13 during an idle provider/backoff period. The deadline now keeps awaited work alive until completion or bounded timeout, while idle polling stays unreferenced. A child-process regression reproduces the event-loop condition and verifies clean timeout handling.

- **Review/edit handoff deadlock:** the continuity critic reported `blocked` on an overlong draft before downstream editors could shorten it, even though story lint had zero errors. Task instructions now distinguish diagnostic review completion from final manuscript acceptance and state the combined word budget explicitly. The final word-count and export gates remain enforced.

- **Restart receipt collisions:** deterministic blocked-task failures, compilation, and export receipts omitted the monotonic restart iteration from their keys. A second attempt after an explicit restart could reuse a receipt with different input. These keys now include the iteration; a database test reproduces successive diagnostic failures across a rerun.
- **False inventory-transfer diagnostics:** the ownership rule treated a character's inventory prose as an object holder identity. Character/person states are excluded from that object-transfer rule, while real object transfers and overlapping state conflicts remain checked. Canon instructions distinguish specific knowledge properties, same-scene corrections, and inclusive interval endpoints.

- **Ambiguous canon provenance:** the live agent confused chapter keys, manuscript IDs, and artifact IDs, then guessed replacements. Canon tool schemas and worker instructions now describe the exact source fields, and source rejection errors identify the offending ID and correction. A database regression verifies rejection and rollback; ownership checks remain strict.

- **Explicit restarts exhausted revision allowances:** the monotonic revision counter also enforced the automatic revision cap, so repeated authorized restarts could make later revisers impossible to complete. A restart baseline now resets only the allowance, preserving unique write IDs. Automatic quality-triggered revisions still consume and enforce their cap; the inspector displays the effective count.
- **Completion report starved by tool budget:** the live canon task used all 16 calls on work and verification, so its final report was rejected. Work calls now reserve up to two slots for reporting/correction within the same total cap, with lease and abort guards preserved. Tool guidance distinguishes StoryArtifact IDs from canon/state/manuscript IDs.
- **Active-descendant rerun failure:** resetting an ancestor attempted the illegal RUNNING→BLOCKED transition for an executing child. Rerun now releases execution before reblocking within the same atomic lease-fencing transaction; a database regression rejects the old worker heartbeat afterward.
- **Stale unit projection after replanning:** replacing a plan refreshed only its metadata, leaving dates, POV, ordering, and title stale and omitting the replacement binding. Materialization now refreshes those fields while preserving writing history; diagnostics exclude units whose source plans were invalidated. A public artifact-replacement regression verifies the same unit and branch receive the corrected plan.
- **Drafting diagnostic dead ends:** isolated character-bible IDs were falsely reported as unknown canonical characters. Diagnostics now recognize active build bibles without publishing them. Scene-plan dates/times are validated at write time rather than accepted until manuscript hydration. The initial scene diagnostic pass now records findings for the critic/reviser; post-revision diagnostics remain a hard gate. Regression tests cover both sides. Canon extraction instructions require specific single-valued predicates and reuse of existing fact keys to avoid false conflicts between independent conditions.
- **Stale pause errors:** reauthorizing a budget-paused build left the obsolete error visible while execution resumed. Authorization now clears it, covered by a lifecycle regression.
- **False causal-order failure:** planning lint compared chapter-local scene ordinals across chapters. It now compares chapter number first for both planned and materialized scenes. A regression covers numbering restarts and genuinely reversed dependencies.
- **Late malformed entity references:** the live models used `sibling` as a reference type and invented a character ID in the timeline. Dossier relationships now require type `character`; downstream artifact batches validate character identifiers against the persisted corpus before committing. A database regression checks rejection, rollback, and acceptance of exact artifact IDs.
- **Lost chapter receipts:** returning the full manuscript or chapter body could exceed the MCP response cap and hide the new chapter ID/head token. Chapter mutation tools now return bounded metadata receipts, and creation avoids reloading the entire manuscript. A protocol test writes and edits 140,000 characters and verifies the returned tokens.
- **Heartbeat/failure race:** a live timeline attempt failed to produce a result; its heartbeat advanced the task revision while failure handling read its CAS token, crashing the worker. Failure handling now waits for any in-flight heartbeat before recording the failure. Failed result-extraction traces also retain bounded tool receipts and model output for diagnosis.
- **Export dead end:** `export-preparation` only checked for an externally created manifest. Even the end-to-end test manually generated an export to unblock the worker. The worker now compiles the revised manuscript and creates a real plain-text reading-copy export itself. Registration checks the active task lease in the transaction, and records task provenance so invalidation can find it.
- **Silently discarded chapter prose:** `createChapter` stripped unknown properties. A call containing `body` instead of `content` could succeed with an empty chapter. The tool now rejects unknown properties, describes `content` explicitly, and the MCP instructions distinguish saved chapter prose from notes and summaries.
- **Delayed beat-reference failure:** the live provider put a backstory sentence in `causeKeys`. These fields were unlabelled string arrays, and the bad plan persisted until the planning quality gate failed. Beat schemas and task instructions now explain exact key semantics; the worker rejects unresolved beat references before persisting a batch, allowing same-batch forward references and existing beats. Sharded plans retain single-token forward keys until aggregate validation, preserving the 104-scene production fixture. A regression fixture uses the actual malformed value.
- **Premature stop on a rejected report:** the model loop stopped on any `reportTaskResult` call, including a rejected call. It now stops on a schema-valid successful receipt, allowing correction within the existing step/tool limits.

The original reported incident was not available as a trace. Correctly formed chapter creation and empty-chapter initialization already worked at the base revision. These tests reproduce a silent-loss input path; they do not establish that it caused the historical incident.

## Validation

- Frontend and SDK type checks: pass; Svelte reports zero errors/warnings.
- Full backend suite with database variables enabled: 251 tests in 43 suites pass, none skipped. Frontend: 121 tests pass. SDK: 24 tests pass. Total: 396 passing tests.
- MCP JSON-RPC persistence: 4 tests pass (empty-body initialization/edit/read-back with stale edit rejection, large-prose receipts, creation with prose, and unknown prose-field rejection).
- Existing database suites: writing 5, Novel Build 4, backend corrections 9, exports/imports 3, revisions 2, refactoring 3, OAuth 2, worker 19 tests pass.
- Deterministic full-build test now reaches COMPLETED with a generated export and no manual export operation.

Local database tests used PGlite with a PostgreSQL wire-protocol server, with per-suite checks followed by a successful combined run. This is useful persistence validation, but is not evidence of native PostgreSQL concurrency parity. The repository CI still uses PostgreSQL 16 and must pass before merge.

Full backend coverage run: 251 tests pass; overall covered lines 85.46%, worker lines 84.95%, with all configured per-file thresholds met.

## Live provider run

The real fixture requests a 1,200-word story in two chapters and three causal scenes, using the supplied OpenAI-compatible provider. It uses the actual worker and independent judge, with no substituted model executor, fabricated completion, or manual export. The initial model was `gemini-3.8-flash-high`; subsequent execution uses the other authorized model, `gpt-5.6-luna`.

This was a repair-and-resume validation, not a clean first-attempt success. Live failures exposed malformed beat and character references, the heartbeat race, false chapter-order diagnostics, stale materialized dates after replanning, completion-report starvation, and exhausted revision allowances after explicit restarts. Repairs used the normal rerun/authorization APIs, invalidating affected descendants. A 5-million-token test budget was raised explicitly to 8 million and then 12 million after earlier attempts consumed it; the unchanged cost cap is test accounting, not a claim about provider billing.

The corrected run **completed all 63 tasks**, produced **two chapters and three nonempty scenes**, and exported **1,120 manuscript words** (required range 1,000–1,800). The downloaded READY export matched its stored SHA-256 checksum: `c8d96ffe82c36afe246856aa0cbc43788e3197f617cb1e6f70691a30b127f101`. Run ID: `c148a2a8-938c-4642-b283-1668b5a0ad1b`. The harness exited successfully. No task was manually marked complete, no gate was bypassed, and no export was manually generated.

Recorded usage across the repaired run was 10,839,011 tokens. The recorded 118,082,270 cost micros use conservative test rates, not actual provider billing; interrupted calls may not have finalized usage. This is a short-story pipeline validation, not evidence of a full-length novel completing at production scale.

Editorial read: the exported text contains a coherent mechanical explanation for the recording, a costly decision to abandon the transformer, a concrete escape, and a resolved relationship arc. Compression leaves some family backstory implicit. It is a readable completed draft, not a guarantee of publication-ready prose.

The reproducible command is `pnpm --dir packages/backend eval:novel-build`; credentials are environment-only. `verification.json`, `report.json`, and the unchanged downloaded `The-Last-Signal.txt` accompany the review package.

## Delivery and deployment

GitHub write access was verified after the owner updated the integration permissions. Changes are prepared for review on `fix/novel-build-mcp-reliability`.

Production preflight: HTTPS homepage returned 200; unauthenticated `/mcp` returned 401 with its OAuth resource challenge. No deployment was made. Deployment remains conditional on the user's PR review and merge.
