---
name: novel-developmental-revision
description: "Big-picture revision of a drafted manuscript or act: causality, structure, character pressure and arcs, pacing, thread coverage, stakes, and whether the ending is earned — diagnosed in a report and repaired in bounded, versioned edits. Load this when the author says 'revise the book/act', 'the middle sags', 'the ending doesn't land', 'developmental edit', after a first draft is complete, or when critique shows structural (not sentence-level) problems."
---

# Developmental Revision

Fix the story before the sentences. Line edits on a chapter that should be cut
are wasted work.

## Diagnose — `Revision/Developmental report`

Read chapter summaries, the outline, Threads & Timeline, and character arcs
first; read prose only where a summary raises a question. Report:

1. **Spine** — does every act escalate the central question? Where does it stall?
2. **Causality** — mark "and then" chains that should be "therefore/but".
3. **Character** — does the protagonist choose, or only react? Is each arc's
   turning point dramatized on the page?
4. **Threads** — any thread dropped, resolved offstage, or paid off without setup?
5. **Pacing** — runs of low-conflict scenes (`runStoryLint { categories: ["pacing","plot"] }`), lumpy chapter lengths vs. the length target.
6. **Ending** — earned by prior choices? Does it answer the Brief's thematic question?
7. **Drift** — test every numbered drift criterion from the Brief & Contract.

Rank issues by impact; for each, name the chapters/scenes (IDs) and a concrete fix.

## Repair

- Structural moves first: add/merge/cut/reorder scenes (`createScene`,
  `reorderScenes`, `deleteScene`), then rewrite affected scenes.
- Use exact edits or `applyStoryPatch` for multi-chapter changes; full
  replacement only for an intentional rewrite of a scene.
- After each repair: update chapter summaries, Threads & Timeline, Canon, and
  the Ledger's Progress. Re-run lint on touched chapters.
- Keep a changelog section in the report so the author can see what moved.
