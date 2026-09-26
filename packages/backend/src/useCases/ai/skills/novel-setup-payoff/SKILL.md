---
name: novel-setup-payoff
description: "Plan and audit the promises a story makes — clues, mysteries, motifs, Chekhov's guns, foreshadowing, misdirection — and make sure each is planted, reinforced, and paid off, tracked in a Threads & Timeline doc tied to chapter and scene IDs. Load this when outlining a mystery or twist, planning plot threads, checking 'does this pay off', 'is the ending earned', or before revision when endings feel unearned or clues go missing."
---

# Setup & Payoff

Every satisfying ending is a debt the book has been quietly paying down. You
keep the ledger of those debts.

## The map — `Story Bible/Threads & Timeline`

```markdown
## Plot threads
T1. Where did the sea go? (main mystery) — opens Ch 1, turns Ch 9, Ch 16, resolves Ch 22.
T2. Ines & Dani: distrust → alliance → betrayal → trust.

## Setups → payoffs
S1. Tomas's dry, laced boot — planted Ch 1 sc 1 · reinforced Ch 8 sc 2 · paid off Ch 20 sc 3 (he left it on purpose).
S2. The benefactor's letters use tide tables as dates — planted Ch 3 · misdirect Ch 11 · payoff Ch 21.

## Timeline
| Story date | Event | Chapter/scene |
| --- | --- | --- |
| -12y, 14 Mar | The sea leaves; Tomas vanishes | backstory |
```

## Rules of thumb

- Plant early and innocently: the setup should read as texture the first time.
- Reinforce once in the middle so the reader's subconscious holds it.
- Pay off at a moment of maximum pressure, preferably by a character's choice.
- Every mystery clue needs a fair-play appearance before its solution.
- Misdirection must be honest: the false reading is reasonable, the true one is
  available.
- Kill any setup you can't pay off, or turn it into deliberate texture.

## Link it to the objects

Put setup IDs (`S1`) in scene `writerNotes` and `setupPayoffIds` where they're
planted and paid off, so drafting honors them and lint can check order.

## Audit (during revision)

For each S#: grep the manuscript for the planted detail and the payoff; confirm
order and that the reinforcement exists. Log gaps in the Ledger's queued
defects.
