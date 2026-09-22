# Full-length Novel Build readiness

Status on 2026-09-22: **not yet validated for general unattended full-length use**. PR #8 remains draft. Passing deterministic CI is not a substitute for both requested real-provider manuscripts completing and being read.

## What blocked validation

1. Earlier local validation processes did not survive the end of an interactive work session. The persisted database can recover a worker, but it cannot run one. Portable checkpoints preserve progress; they do not provide continuous execution. Production already starts its worker in the backend. Long acceptance runs need a continuously running isolated validation host, not deployment of unreviewed code to production.
2. The 32-chapter / 110-scene fixture expands to 1,231 tasks. Many are cheap deterministic checks, but repeated full-context model/tool loops dominate usage. Gemini consumed more than 100 million cumulative tokens before finishing the first few scenes. This is repeated input across calls, not one oversized context window or actual provider billing.
3. Provider quota limits are separate from OpenTales token authorization. Increasing a build budget cannot bypass a provider reset deadline.
4. Luna's independent planning judge rejected a complete 290-artifact corpus despite zero deterministic lint findings. It found missing per-chapter illustration/genre allocations and chronology/reference inconsistencies. The strict chapter schema lacked dedicated genre/illustration fields, and the planning gate previously had no bounded repair route.

## Changes in this follow-up

- Reuse scene canon only when exact manuscript heads, extraction provenance, and the entire current ledger fingerprint remain unchanged. Recheck at completion under the run lock; keep diagnostics and independent quality gates. Gemini's scene-five re-extraction used this path with zero additional model tokens.
- Show provider retry deadlines and queued-for-worker state rather than implying that a phase label means active inference.
- Add chapter `genre` and `illustrationDirections` fields and explicit final-scene handoff.
- Let a planning judge identify exact rejected artifact IDs. Atomically rerun only their completed planning producers and dependents, preserving unrelated planning work. Feed back escaped diagnostic data and regrade. Enforce the existing planning repair allowance; reject stale/unknown IDs, pinned targets, and automatic repair after manuscript materialization.

Regression tests cover reuse versus prose/ledger/provenance changes, a concurrent change immediately before completion, deadline/queue UI states, schema handoff, scoped planning repair, successful regrading, invalid repair IDs and exhausted repair limits. The normal PostgreSQL CI and full-sized deterministic export fixture remain required.

## Remaining path to general usability

1. **Durable acceptance execution:** run each provider against its own persistent test database and supervised process, retaining checkpoints and exports. Demonstrate restart, provider cooldown and resume without losing accepted work. Do not claim background validation from an inactive temporary session.
   The [isolated staging configuration](../deploy/novel-build/README.md) now provides separate databases/output volumes, restart-safe run selection, a database-name guard, in-flight heartbeat reports, and bounded crash restarts. It was deployed on 2026-09-22 after the Dokploy API routing was fixed. Both native PostgreSQL imports matched all 67 checkpoint tables, and both waiting workers were restarted and reverified before inference resumed. Gemini has nine scenes / 3,940 words; Luna is regenerating the chapter briefs. This proves idle-worker restart preservation, not active-call or host-reboot recovery. Neither full manuscript is complete.
2. **Fewer creative model passes:** measure input tokens, calls, latency, retries and accepted words per chapter. Replace repeated per-scene read/act/report conversations with chapter-sized structured draft/canon/review batches where tests demonstrate equivalent continuity and provenance. Keep deterministic validation in code. Do not reduce writers to an arbitrary 100K context cap to disguise repeated-call overhead.
3. **Explicit requirement and reference contracts:** carry author requirements into typed planning allocations, validate known identifiers and structured chronology at write time, and route bounded repairs to the exact affected producer. Semantic/prose-only chronology still needs independent review.
4. **Release gates:** both Gemini and Luna must reach `COMPLETED`, persist all 110 nonempty scenes, compile 32 chapters in the requested 32K–48K range, pass final diagnostics, and produce downloadable checksum/current-head-verified exports. Read the outputs for names, locations, chronology, requirement coverage and ending quality. A mocked large fixture proves orchestration, not creative reliability or affordability.

The goal is not to promise an error-free model or provider. It is to make failures bounded, recoverable, visible, and unlikely to discard accepted work. Further budget increases alone do not establish readiness.
