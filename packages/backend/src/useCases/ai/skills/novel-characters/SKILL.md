---
name: novel-characters
description: Build a causal, differentiated character ensemble as structured Novel Build artifacts.
---

# Novel Characters

Execute only the assigned character-planning BuildTask. The durable task contract
and manifest artifact cardinality are authoritative. If an input artifact suggests
a different cast size, the manifest count wins.

## Character-bible task

1. Derive the minimum complete ensemble required by the Story Brief target.
2. Give every major character conflicting wants, needs, beliefs, secrets,
   knowledge boundaries, voice cues, arc pressure, and relationship leverage.
3. Differentiate characters by collision: each important coping strategy or
   belief must create pressure for somebody else.
4. Preserve spoiler boundaries. Author-only identities, conditioning, missions,
   and betrayals belong in secrets/knowledge, not reader-facing summaries.
5. Persist VALIDATED `character-bible` artifacts in provider-safe batches of
   at most three operations per `applyArtifactBatch` call.
6. Keep stable character keys across calls. Continue until the target ensemble
   is persisted, then report every created artifact ID.

Do not create the relationship graph in this task; it has its own dependency
boundary.

## Relationship-graph task

Read the persisted character bibles from assigned context, encode directional
alliances, conflicts, leverage, secrecy, and incompatible beliefs, then persist
one VALIDATED `relationship-graph` artifact.

## Runtime boundaries

- Never write a markdown ProjectDoc as a substitute for structured artifacts.
- Never emit more than three character-bible operations in one tool call.
- Never claim completion until backend tool results prove persistence.
- Use `reportTaskResult` when supported; otherwise the worker independently
  validates successful persisted tool output.
