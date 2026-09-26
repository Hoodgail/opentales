---
name: novel-world
description: "Build a story-generating world: rules with costs, institutions, factions, history, economy, geography, and a glossary — persisted as World docs in the Story Bible plus native locations. Load this when the author asks for worldbuilding, a world bible, magic or technology systems, how the town/society works, lore, factions, or history, or during planning when the premise depends on a strange world or a speculative rule (a vanished sea, a curse, a regime)."
---

# Novel World

A world earns its place by constraining choices. Every rule should make some
scene harder; every institution should want something; every place should
change what a character can do there. Decorative lore is a tax on the reader.

## Build

Work from the Brief & Contract and the characters' goals. For each element ask:
*what does this force a character to do or pay?*

1. **The core rule(s).** The one or two impossible or unusual facts the premise
   rests on. For each: what it does, what it costs, its limits, who knows the
   truth, and what would break it. (The sea was sold → to whom, for what, how is
   it stored, what happens if the contract is broken?)
2. **Consequences.** Economy, daily life, law, religion, and technology as they
   bend around the rule. Three concrete everyday details per consequence.
3. **Institutions and factions.** Who benefits from the status quo, who is hurt,
   what each wants, what each hides.
4. **History.** Only the events that still press on the present. A dated list.
5. **Geography.** The places scenes will happen in — create each as a native
   location (`createLocation`) with description, atmosphere, significance, and
   sensory details. Keep travel times consistent and note them.
6. **Glossary.** Invented terms, local slang, names — one line each.

## Persist

- `Story Bible/World/` folder with docs: `Rules`, `Society & Institutions`,
  `History`, `Glossary` (split or merge to fit the book's scale).
- Locations as native objects; link them from the World docs by name.
- Numbered facts into `Story Bible/Canon` (rules, dates, distances).
- Mysteries the plot will reveal go in the docs marked **[secret — reader learns in Act III]**
  so drafting doesn't leak them early.

## Checks

- Can you name a scene each rule complicates? If not, cut or sharpen it.
- Does anything contradict the Brief's drift criteria or tone?
- Did you create locations as objects, not just paragraphs?
