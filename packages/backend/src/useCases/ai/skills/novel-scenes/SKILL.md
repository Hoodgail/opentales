---
name: novel-scenes
description: "Break chapters into causal scene plans stored as native OpenTales scenes with goal, obstacle, stakes, conflict, turn, outcome, POV, location, characters, and story date — ready to draft one by one. Load this when planning scenes, turning a chapter brief into scenes, asking 'what happens in chapter N', preparing to draft, or fixing a chapter that feels like it has no shape."
---

# Novel Scene Planning

A scene is a unit of change: someone wants something now, something opposes
them, and by the end the situation is different. Planning scenes as native
objects (not as a bulleted doc) matters because the drafter, the diagnostics,
and the continuity checks all read scene metadata.

## For each chapter

1. Read its brief (`Chapter Briefs/…`), the chapter summary, the previous
   chapter's final scene summary, and the relevant characters/locations.
2. Choose 2–5 scenes (most chapters of ~3,500 words want 3–4). Each must
   change story state; if two scenes do the same job, merge them. A single scene
   per chapter is almost always an under-plan: the chapter brief's beats should
   map to distinct scenes with their own turns.
3. Create each with `createScene { chapterId, title, order, … }` and fill:
   - `summary` — one or two sentences of what happens.
   - `sceneFunction` — what it does for the book (reveal, reversal, escalation, breath).
   - `goal` — what the POV character wants in this scene, specifically, now.
   - `obstacle`, `stakes`, `conflict` — what's in the way and what it costs to fail.
   - `turn` — the moment the scene changes direction.
   - `outcome` — how the situation is different at the end (not "they talk").
   - `emotionalValueShift` — e.g. "hope → dread".
   - `revelation` — what the reader or a character learns, if anything.
   - `povCharacterId`, `locationId`, `characterPresentIds` — real IDs.
   - `storyDate` / `storyTime` — consistent with Threads & Timeline.
   - `estimatedWordCount` — so the chapter hits its target.
   - `writerNotes` — craft notes for the drafter: the image to land on, the line
     of dialogue that must appear, the setup being planted.
4. Chain causality: each scene's entry state is the previous scene's outcome.
   Scenes that could be reordered without consequence need sharper turns.

## Checks before drafting

- Every chapter's scenes add up to its brief's purpose and word target.
- Every setup in Threads & Timeline has a scene that plants it and one that pays it off.
- No scene's outcome is "nothing changes".
- Update the Ledger: which chapters have scenes planned.
