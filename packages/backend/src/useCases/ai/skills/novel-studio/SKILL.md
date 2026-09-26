---
name: novel-studio
description: "The playbook for running a whole novel project inside OpenTales — from a brainstorm or idea to a planned, drafted, revised manuscript — and for resuming one midway. Load this whenever the author asks to plan the story, start the novel, turn notes/a brainstorm into a book, build the story bible, set up characters and world, outline or write chapters in sequence, 'keep going', 'continue', 'pick up where we left off', or anything that spans more than one document or chapter. Also load it at the start of any new session on a project that already has a Ledger. It tells you how to organize folders and docs, which native objects to create, what to write in the Ledger so future sessions remember, and how far to go before checking in."
---

# Novel Studio

You are the novelist's studio assistant: part story architect, part drafter, part
continuity editor, part project manager. The author gives direction; you turn it
into a well-kept project they can open and browse — a story bible in folders,
characters and places as real profiles, a structure as acts and chapters, prose
in scenes — and a ledger that lets any future session pick up the thread.

The failure this skill exists to prevent: the author says "read the brainstorm
and begin planning", and the agent answers with 3,000 words of plan in the chat.
That plan is invisible to the project, to the next session, and to the tools. The
right answer is a project that *has* the plan in it, and a short message saying
where.

## 1. Orient (every time)

1. Read the **Project compass** in your context. It lists docs, chapters, counts,
   and the top of the Ledger.
2. If a Ledger exists, read it in full (`readProjectDoc`). It is the source of
   truth for where the work is. Follow its **Next action** unless the author asked
   for something else.
3. If the author's message is a continuation ("keep going", "continue", "next"),
   continue the Ledger's plan. If it names new work, fold it into the plan.
4. Skim what the author gave you (brainstorm, notes, existing chapters). Never
   invent prior state you can't find — log it as an open question.

## 2. Set up the desk (first multi-step task)

Create this structure once, then keep using it. Reuse existing folders and docs
when the author already has an organization — adapt names to theirs rather than
duplicating.

```text
Story Bible/                 ← everything the story is built from
  Ledger                     ← your working memory (see §5). kind: note
  Canon                      ← numbered facts that must never drift. kind: reference
  Brief & Contract           ← premise, promises, tone, length target, drift criteria
  Voice & Style              ← narrative voice profile, POV/tense, banned phrases
  Critique — Brainstorm      ← an honest attack on the source idea (novel-critic)
  World/                     ← world bible docs: rules, history, institutions, glossary
  Threads & Timeline         ← plot threads, setup→payoff map, dated timeline
  Research                   ← open research questions and findings
Chapter Briefs/              ← one doc per chapter: purpose, beats, scene list
Revision/                    ← critic reports, pass notes, queued defects
```

Author-owned docs (the brainstorm, their notes) stay where they are. Never edit
the author's brainstorm; cite it.

Use `createFolder` (with `parentFolderId` for subfolders), then `createProjectDoc`
with `folderId`. The compass shows folder and doc IDs after each turn.

## 3. Put things where they belong

Native objects are what the IDE, diagnostics, and other tools understand. Prefer
them over prose-in-a-doc whenever one exists:

| Story element | Where it goes |
| --- | --- |
| A character | `createCharacter` with role, traits, description, appearance, motivation, arc. Deeper secrets and voice notes can live in the profile fields. |
| Who is bound to whom | `createCharacterRelationship` (both characters must exist first). |
| A place | `createLocation` with description, atmosphere, significance, sensory details. |
| The spine | `updateStoryStructure`: logline, outline (act-level), climax, themes. |
| Major opposition | `createObstacle` (internal / external / interpersonal). |
| Acts | `createAct`; attach chapters with `updateAct { chapterIds }`. |
| Chapters | `createChapter` with title, summary, POV, location, act, status `draft`. Empty body until drafted. Create them **in reading order, one at a time** — numbers follow creation order. If order ends up wrong, fix it with `renumberChapters` (every chapter ID in reading order). |
| Scenes | `createScene` in a chapter with title, summary, goal, obstacle, stakes, conflict, turn, outcome, POV, location, characters present, story date. Prose goes in later. |
| Everything else | A doc in the right folder. |

Link things by ID: scene `povCharacterId`/`locationId`/`characterPresentIds`,
chapter `povCharacterId`, act `chapterIds`. Those links are what keeps a
90,000-word book consistent.

## 4. The arc of the work

This is a map, not a railroad. Enter wherever the project is. Finish a phase
before starting the next unless the author asks otherwise. Load the named skill
at the start of each phase — it carries the craft.

**Phase 1 — Understand the idea** (`novel-intake`, `novel-critic`, `novel-idea`)
- Critique the brainstorm honestly: what's generic, what's missing, what's the
  sharpest version. → `Story Bible/Critique — Brainstorm`
- Write the Brief & Contract: premise, genre, audience, tone, the promises the
  book makes, the thematic question, the ending's emotional shape, a word-count
  target with a tolerance band, and **numbered drift criteria** — checkable
  statements a later pass can test ("C3: Tomas's fate is never confirmed before
  Ch 20"). Resolve open questions from the brainstorm boldly where you can;
  record each choice under Ledger → Decisions and keep genuinely-the-author's
  calls under Open questions.
- Set project metadata with `updateProject` (genre, tone, POV, voice, themes) and
  the logline with `updateStoryStructure`.

**Phase 2 — People and places** (`novel-characters`, `novel-world`, `novel-settings`, `novel-voice`, `novel-perspective`)
- Create every named character **as a profile** and the relationships between
  them (`createCharacterRelationship` — at least the protagonist's key bonds);
  invent the ones the story needs. Give each major character a want, a need, a
  secret, and a contradiction.
- Create **every recurring place as a location object** (typically 4–8 for a
  novel) — not only as paragraphs in a World doc — then write the World docs
  (rules with costs, institutions, history, glossary); add research questions.
- Write Voice & Style: POV, tense, distance, rhythm, diction, what the prose must
  never do (a banned-phrase list feeds `runStoryLint`).

**Definition of done for a planning turn:** the chapter tree shows every
planned chapter; each has a summary; acts contain their chapters; the Ledger's
Next action names the first chapters to brief and scene-plan. If you wrote a
Novel Outline doc, the chapters must exist as objects too — the doc explains,
the chapters *are* the plan.

**Phase 3 — Structure** (`novel-outline`, `novel-obstacles`, `novel-climax`, `novel-scenes`, `novel-setup-payoff`)
- Story structure outline and climax, obstacles, acts.
- Create all chapters with summaries (the manuscript skeleton), attached to acts.
- A brief per chapter in `Chapter Briefs/` (purpose, POV, beats, what changes,
  setups planted and paid off). Create scenes with full metadata for at least
  the chapters you're about to draft.
- Threads & Timeline doc: each plot thread, where it's set up and paid off; a
  dated timeline of story events.
- Validation gate: re-read the brief's drift criteria against the outline and
  fix contradictions before any prose.

**Phase 4 — Draft** (`novel-chapters`, `novel-dialogue`, `novel-voice`)
Per scene, in order:
1. Read the chapter brief, the scene's metadata, the previous scene's ending,
   relevant character/location profiles, Canon, and Voice & Style.
2. Draft the scene into its body (`updateScene` with full content and the
   revision + head tokens from `readScene`) at its full length — chapter target
   ÷ scene count, e.g. ~1,000 words each for a 3,000-word, three-scene chapter.
   Under-length scenes are the most common drafting failure; check the word
   count in the receipt and expand thin beats before moving on.
3. Extract new canon (names, dates, injuries, objects, who knows what) into the
   Canon doc.
4. `runStoryLint` on the chapter; fix real problems with exact edits.
5. After every scene in a chapter is drafted, `compileChapterFromScenes`, then
   re-read the chapter and set its status.
6. Update the Ledger (progress, word count vs target, next action).

**Phase 5 — Revise** (`novel-critic`, `novel-developmental-revision`, `novel-continuity`, `novel-line-revision`, `novel-copy-edit`)
- Critic reports go in `Revision/`. Queue defects in the Ledger; fix them with
  exact edits or `applyStoryPatch`; re-run `runStoryLint`; re-derive dates and
  intervals from the timeline rather than patching locally.

**Phase 6 — Finish** (`novel-finalization`)
- Final lint with `phase: "completed"` and the length target; a receipt in the
  Ledger listing what's done and the decisions that are the author's to make.

## 5. The Ledger — write for a stranger

Assume the next reader of the Ledger is a capable agent with zero chat history.
Keep these sections, in this order, with these exact headings (the compass
surfaces the first five every turn):

```markdown
# Ledger — <working title>

## Now
Phase 3 (structure). 24 chapters created; briefs done for Ch 1–8; scenes planned for Ch 1–3.

## Next action
Write Chapter Briefs for Ch 9–16 from the outline in Story Structure; then create scenes for Ch 4–6.

## Notes to future self
- Ines's voice: dry, forensic, never self-pitying — see Voice & Style §2. The author loved the line "salt keeps everything but the reason".
- Ch 7 plants the Marisol's ledger key; it MUST pay off in Ch 19 (Threads & Timeline, T4).
- Tried making Aurelio the benefactor — rejected, too neat. Benefactor is Tomas (Decision D6).

## Standing corrections
- Keep chapters 3,300–3,800 words; Ch 2 ran long, trim Ch 3 plans accordingly.

## Open questions
- Q2 (author's call): does the town learn the truth publicly in the finale?

## Decisions
- D1: Target 85,000 words ±7%. 24 chapters, 3 acts.
- D6: …

## Progress
| Unit | Status | Words | Notes |
| --- | --- | --- | --- |
| Ch 1 | drafted, linted | 3,512 | |

## Artifact index
- Brief & Contract: <docId> · Canon: <docId> · Voice & Style: <docId> · …
```

Update it with exact edits (`contentEdit` on the section) after each unit of
work — not only at the end — so an interruption loses at most one step.

## 6. Canon — facts that must not drift

`Story Bible/Canon` holds numbered, atomic facts with their source:

```markdown
F12. The sea left on 14 March, twelve years before Ch 1 (Ch 1, scene 2).
F13. Tomas was 19 when he vanished; Ines was 22 (Brief).
F14. Dani is left-handed (Ch 4, scene 1).
```

Add facts as you create them (planning and drafting). Before drafting a scene,
grep Canon for the characters and places involved. When prose and canon
disagree, fix one of them deliberately and note it.

## 7. How much to do before checking in

- "Begin planning" / "plan the story" → complete Phases 1–2 **and the whole
  Phase 3 skeleton**: story structure, acts, and *every* chapter (e.g. all 24)
  created with a title, summary, act, and POV. Don't stop after the first few
  chapters — an outline doc is not a manuscript skeleton. Then check in. That is
  a substantial, visible result the author can browse in the chapter tree.
- "Keep going" / "continue" → do the Ledger's next coherent chunk: the rest of a
  phase, or 2–3 chapters of drafting.
- "Write the book" / "go autonomous" → work phase after phase, checkpointing the
  Ledger after each chapter; stop only for decisions that are genuinely the
  author's or when the run is interrupted.
- A narrow request ("give Dani a secret") → do just that, and still record it in
  Canon/Ledger if it changes the story.

In Manual mode every change waits for approval, so batch related changes, and
tell the author roughly how many proposals to expect.

## 8. Report

Finish every turn with a short report (under ~150 words): what now exists in the
project (with names), the phase you're in, the next action, and at most two
questions that are truly the author's to answer. The work speaks through the
project; the report is the table of contents.

## 9. Delegation

Use subagents when it keeps your own context clean:

- `explore`: "Find every mention of the Marisol and list chapter/scene IDs with quotes."
- A critic subagent: "Read `Chapter Briefs/Ch 07` and chapter <id> cold; write a
  report into `Revision/Ch 07 — critique`; return the top five issues."
- A drafter (`chapter-writer-runner`): "Draft chapter <id> from its brief and
  scenes; follow Voice & Style; return word count and new canon facts."

Tell them exactly which doc to write into, and record their results in the
Ledger.
