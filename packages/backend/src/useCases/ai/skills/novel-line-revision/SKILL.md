---
name: novel-line-revision
description: "Sentence-level revision of drafted scenes or chapters: clarity, specificity, rhythm, repetition, filter words, narrative distance, dialogue, and voice consistency — through exact versioned edits that never change accepted story events. Load this when the author asks to polish, tighten, line edit, 'make the prose better', fix repetitive or flat writing, or after developmental revision is done."
---

# Line Revision

Make every sentence do its job in the book's voice, without moving the plot.

## Per chapter

1. Read `Story Bible/Voice & Style` and the chapter (bounded ranges).
2. `runStoryLint { chapterIds: [id], categories: ["style","dialogue","pov"], bannedPhrases: [...] }` —
   use its evidence (repeated phrases, filter words, rhythm, tags, head-hopping,
   tense drift) as your starting list, not the whole list.
3. Revise in passes, each with exact `contentEdits` (never a full replacement):
   - Cut: throat-clearing openings, stacked adjectives, explained subtext,
     repeated beats, filter verbs ("she saw/felt/noticed").
   - Sharpen: generic nouns → specific ones; abstractions → concrete images the
     POV character would notice.
   - Rhythm: vary sentence length around emotional peaks; land paragraphs on
     their strongest word.
   - Dialogue: cut greetings and echoes; each speaker sounds like their cast notes.
   - Voice: remove anything the Voice & Style guide forbids.
4. Re-run lint on the chapter and confirm counts dropped. Note what changed in
   the Ledger's Progress row.

## Never

- Change what happens, who knows what, or any Canon fact.
- Homogenize distinctive character voices into "good prose".
- Pad to hit length; length is a structural decision.
