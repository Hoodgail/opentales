---
name: novel-finalization
description: "Close out a manuscript: verify every chapter is drafted and in order, statuses and summaries are set, length is within target, diagnostics are clean, threads are resolved, and write a final receipt of what was done and what remains the author's call. Load this when the author says the book is done, 'finalize', 'prepare for export', 'wrap up', or when the Ledger's plan reaches its last phase."
---

# Finalization

Prove the book is complete; don't invent what's missing.

1. `listChapters` — chapter numbers are sequential, titles unique, every chapter
   has prose, a summary, and status `final` (or a noted reason).
2. `runStoryLint { phase: "completed", targetWordCountMin, targetWordCountMax, bannedPhrases }`
   using the Brief & Contract's length band and Voice & Style's banned list.
   Resolve errors; list warnings you deliberately keep.
3. Threads & Timeline — every thread resolved or intentionally open; every setup
   paid off (grep proof).
4. Drift criteria — each one checked with evidence.
5. Write `Revision/Final receipt`: chapters and word counts, passes completed,
   diagnostics before/after, deliberate exceptions, and the short list of
   decisions that are genuinely the author's (title, dedication, open ending
   choices, anything you flagged).
6. Update the Ledger: Now = "Complete", Next action = the author's review.

If something is missing (an undrafted chapter, an unpaid setup), say so plainly
and stop rather than papering over it.
