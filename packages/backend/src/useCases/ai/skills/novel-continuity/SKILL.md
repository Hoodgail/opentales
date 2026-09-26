---
name: novel-continuity
description: "Keep the story consistent: extract canon facts after drafting, check scenes and chapters against Canon, the timeline, character knowledge, injuries, objects, and locations, and log or repair contradictions. Load this after drafting or revising a scene or chapter, before a continuity or copy pass, when the author asks 'is this consistent', 'did I contradict myself', 'check the timeline', or when runStoryLint reports chronology, knowledge, location, or POV issues."
---

# Novel Continuity

Readers forgive almost anything except the story contradicting itself. You keep
the book honest by writing facts down the moment they're created and checking
new prose against them.

## After drafting a scene or chapter — extract

Read the new prose once and add to `Story Bible/Canon` every fact a later chapter
could contradict:

- Names, ages, physical traits, relationships.
- Dates, times, days elapsed, seasons, weather that matters.
- Objects: who has what, where it is, what state it's in.
- Injuries and illnesses, and when they heal.
- Knowledge: who learned what, from whom, in which scene. (Most continuity
  errors are characters knowing things they shouldn't yet.)
- Places: travel times, layout details, what's broken or changed.

Each fact is numbered, atomic, and cites its source: `F41. Dani's left hand is
bandaged from Ch 6 sc 2 until at least Ch 9 (Ch 6, scene 2).`

Update scene metadata where it helps: `knowledgeDeltas`, `objectTransfers`,
`injuryStateChanges`, `exitState`.

## Before drafting or when checking — verify

1. `runStoryLint { chapterIds, categories: ["continuity","chronology","knowledge","location","pov","character"] }`.
2. `grepProject`/`grepChapters` Canon subjects mentioned in the target text.
3. Compare against Threads & Timeline for dates and intervals. Re-derive every
   "three days later", "a week since", age, and anniversary from the timeline
   rather than trusting the prose.
4. Check character knowledge: could this character know this yet?

## Resolve

- A contradiction is fixed on purpose: change the prose (exact `contentEdit`) or
  change Canon with a note explaining why — never silently both.
- Queue anything you can't fix now in Ledger → Standing corrections or a
  `Revision/Continuity queue` doc, with chapter/scene IDs.
- Report what you found and fixed in one short list.
