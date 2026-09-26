---
name: novel-characters
description: "Develop a causal, differentiated cast as native OpenTales character profiles and relationships — wants, needs, secrets, contradictions, voice, arc — with deeper notes in the Story Bible. Load this when creating or deepening characters, when the author says 'build the cast', 'who are these people', 'give X a backstory/secret/arc', when characters feel flat or sound alike, or during planning after the Brief & Contract exists."
---

# Novel Characters

A cast is a pressure system. Each important character wants something that
makes someone else's life harder, believes something the plot will test, and
hides something that will cost them when it comes out. Build the system, not a
gallery of portraits.

## Read first

The Brief & Contract, Canon, World docs, and any existing characters
(`listCharacters`, `readCharacter`) — update rather than duplicate.

## For each major character

Create or update with `createCharacter`/`updateCharacter`:

- `name`, `aliases`, `role` (protagonist, antagonist, ally, foil…), `age`, `occupation`.
- `traits` — 3–6 specific traits, including one that contradicts another.
- `description` — who they are *in this story*: wound, belief, secret (mark
  secrets clearly, e.g. "[secret] …"), what they'd never do, what they'll end up doing.
- `appearance` — two or three details a POV character would actually notice.
- `motivation` — want (conscious, concrete, scene-drivable) vs. need (what the
  arc gives them), and what they fear losing.
- `arc` — start state → pressure → breaking point → end state, with the chapters
  where each turn lands once the outline exists.

Voice cues (verbal tics, vocabulary, what they avoid saying) go in `description`
or a `Story Bible/Cast notes` doc so dialogue stays distinct.

Minor characters get a name, role, one vivid detail, and what they want in their
scenes — no more.

## Relationships

After characters exist, `createCharacterRelationship` for every relationship the
plot leans on: type (sibling, rival, debtor, former lover…) and a note on the
tension in it and how it changes. Aim for triangles: every major character
should pressure at least two others.

## Canon and ledger

- Ages, family ties, dates, and physical facts → numbered entries in Canon.
- Bold inventions (a secret the brainstorm didn't have) → Ledger → Decisions.

## Checks

- Could you swap two characters' dialogue without noticing? Differentiate them.
- Does the antagonist believe they're right, with a reason the reader half-accepts?
- Does every major character's want collide with the protagonist's somewhere in the outline?
