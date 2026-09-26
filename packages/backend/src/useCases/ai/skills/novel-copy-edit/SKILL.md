---
name: novel-copy-edit
description: "Mechanical copy edit of a revised manuscript: spelling of names and invented terms, capitalization, tense, punctuation, dialogue formatting, numbers and dates, and consistency with Canon and the Glossary — using grep-proven, exact edits. Load this for a copy edit or proofread, 'fix typos', 'check consistency of names', before export, or after line revision."
---

# Copy Edit

Consistency is proven with search, not memory.

1. **Build the style sheet** (`Revision/Style sheet` doc): every proper noun and
   invented term with its canonical spelling (from Canon, Glossary, character and
   location profiles), numbers style, date format, dialogue punctuation rules,
   hyphenations the book uses.
2. **Grep each item** (`grepChapters`) for variants and misspellings; fix with
   exact `contentEdits` or one `applyStoryPatch` across chapters.
3. **Numbers and time:** grep every numeric and temporal claim (ages, "three
   days", dates, distances) and verify it against Canon and Threads & Timeline.
   Re-derive intervals; don't patch locally.
4. **Mechanics:** `runStoryLint { categories: ["style","pov"] }` for tense and
   person drift; fix dialogue punctuation and paragraphing.
5. Log every class of fix in the Ledger (not every instance) and re-run lint.

Never rewrite sentences for style during a copy edit — queue those for the
author or a line pass.
