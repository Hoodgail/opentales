# MCP story-writing harness handoff

OpenTales now gives external agents stale-safe full replacement, exact editing, atomic multi-target prose patches, editable open submissions, deterministic scene-to-chapter compilation, and a complete user-facing Novel Build unit/compile/review lifecycle. Worker leases remain private.

## Continuation prompt for GPT

```text
Resume this OpenTales story from persisted project state in a cold session. Begin with opentales_workspace, then load the matching continuity, revision, and finalization skills. Resolve all opaque IDs with bounded list/read tools; do not rely on this prompt as manuscript evidence.

The author explicitly authorizes the two bounded continuity repairs you reported, the merge of the corrected staged proposals, and continuation through line edit, copy edit, proof, and finalization. The known anchors are CH32 submission cmtjrrivr04c1qf01accp0l78 and review cmtjrygvp04clqf019af3exnv. Do not create replacement submissions and do not silently invent canon.

1. Page through listSubmissions(status="open") until nextPage is null and map every proposal to its chapter. Read the affected proposals and the smallest earlier canon/planning evidence needed to decide (a) whether Lio or Neri is the single injured apprentice and (b) the established amplifier location. Treat the earliest unambiguous setup and accepted canon as authoritative; record a concise evidence-backed decision.
2. Repair the existing OPEN proposals in place. Use updateSubmission for one proposal or one idempotent applyStoryPatch batch for several. Copy each proposal's current headVersionId, use exact edits with enough context to match once (replaceAll only when every occurrence is intended), and touch no unrelated prose. On 409, re-read and reconsider; never open a duplicate.
3. Re-read every changed proposal, run the available continuity/story diagnostics, and confirm the apprentice identity and amplifier location are consistent across all affected chapters. Fix only evidence-backed fallout.
4. Merge proposals in manuscript order. Before each chapter-edit merge, readChapter or listChapters and pass the current canonical head as expectedMainHeadVersionId with confirm=true; use null for new-chapter proposals. If main advanced, reconcile the proposal against that new head before retrying. Do not claim a merge until its receipt confirms it.
5. Inspect listBuildRuns/getBuildState. If this manuscript also has isolated build units, use listBuildUnits/readBuildUnit and updateBuildUnit with the current build/unit/head tokens for the same bounded repairs, mark genuinely gated units accepted, then use compileBuild, createBuildReview, and the owner-confirmed approve/merge tools. Do not call or imitate worker-lease tools. If there is no applicable Novel Build, continue from the merged canonical manuscript instead of creating a parallel one.
6. Continue the requested line, copy, proof, and finalization passes. Finish only after diagnostics pass, the complete manuscript is on the intended reviewed/canonical surface, and required exports/finalization gates are satisfied. Report changed proposal/unit IDs, merge/review IDs, diagnostics, and any genuinely author-dependent decision.
```

## Continuation prompt for Claude

```text
Resume THE NINE-DAY TONGUE in OpenTales from persisted state only. Begin with opentales_workspace and load the relevant drafting, continuity, critic, revision, and finalization skills. The project/folder clues are “Opus 5” and “Build v1 — Season One,” but the persisted timeline/canon ledger is authoritative. Do not restart planning or trust the old chat's chapter count when the ledger disagrees.

The author authorizes continuation from the next incomplete unit through the finished Season One manuscript. Preserve the established defaults unless persisted instructions override them: Sabeth survives Season One, and the other world is named once, unglossed. First resolve the next incomplete chapter/scene from the ledger (the prior session expected to resume around Chapter 14), then continue in order.

1. Use listChapters/listScenes for bounded metadata plus head/revision tokens, and read only the current scene, causal predecessors, relevant canon, open loops, and style evidence. Prefer createScene with its initial content. If a chapter or scene already exists with an empty body, initialize it with updateChapter/updateScene full content; updateScene must receive both expectedRevision and expectedHeadVersionId from readScene.
2. Keep the established per-scene gate: draft → canon/state extraction → deterministic diagnostics → independent critic → one bounded revision → re-extraction/re-check. Use exact contentEdits or applyStoryPatch for bounded repairs; use full replacement only for an intentional complete draft/rewrite. On any stale token, re-read rather than retrying blindly.
3. After all scenes in a canonical chapter pass, call compileChapterFromScenes with the chapter head and the complete current scene-revision map. Do not manually copy/concatenate scene prose. Re-read the compiled chapter and verify order, separators, word count, POV, and continuity.
4. Repair the four queued copy-pass defects from the persisted ledger, including day-count arithmetic, using evidence-backed exact edits. Retain the discoveries already established in prose (grease-lights, stored force, Hain's dilemma, Sabeth's documented illness) unless the ledger or diagnostics show a contradiction.
5. If a durable Novel Build now exists, inspect listBuildArtifacts/readBuildArtifact and listBuildUnits/readBuildUnit. Leave persisted tasks to the backend worker; use the public updateBuildUnit/invalidateBuildUnit/reorderBuildUnits/compileBuild/review tools only for explicit repair and author review, with current build/unit/head tokens. Do not build a second parallel manuscript.
6. Continue all remaining units while controlling the total to the agreed 85k target tolerance, then run developmental, character, continuity, pacing, line, copy, proof, and finalization gates. Finish with a validated compilation/review or canonical manuscript (whichever the persisted workflow owns), required exports, and a concise receipt of completed units, revisions, diagnostics, and remaining author decisions.
```
