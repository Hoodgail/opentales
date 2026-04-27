# Future directions

> A living roadmap. Some of this is "before 1.0", some is "if it works it works", some is research-grade. Ideas are grouped by whether they touch craft, the IDE, the platform, or the org.

If you want to pick something up, open a GitHub issue first so we can sanity-check scope and shape.

## Vision

The pitch is in one line:

> **A novel is a codebase of human meaning. It deserves the same scaffolding that software gets.**

That means: structured documents, version control, refactor tools, navigable cross-references, autocomplete that knows your characters, lint rules for continuity, and a build pipeline that turns a draft into something you can publish or share. The goal isn't "AI writes for you." The goal is "your tools take the bookkeeping off your plate so you can spend the focused hours actually writing."

---

## 1. Craft — features specific to the act of writing fiction

### 1.1 Continuity lint
Treat the manuscript like source code and run a "linter" against it.
- **Eye-color drift.** Character has hazel eyes in chapter 2, brown in chapter 11. Surface as a warning.
- **Timeline contradictions.** Detect statements like "three days later" when an earlier scene already said "a week passed."
- **POV slip.** Highlight sentences in chapter 4 that contain knowledge only character X has, when chapter 4's POV is character Y.
- **Tense drift.** Flag passages that switch from past to present without a scene break.
- **Forgotten props.** "Jamie pocketed the key" in chapter 3 but never references it again — surface as a Chekhov's gun candidate.

Implemented as pluggable rules under a new `packages/lint/` package. Each rule operates on a `Chapter` and emits diagnostics that surface in a "Problems" panel — same UX VS Code uses.

### 1.2 Character voice consistency
Per-character, train a tiny statistical fingerprint of their dialogue (sentence length, function-word usage, contraction rate, vocabulary tier). When they say something off-fingerprint, flag it.
- **Bonus:** auto-generate a "voice sample" card — three representative quotes with average sentence length, etc. Useful when you come back to a manuscript after a six-month break.

### 1.3 Plot structure overlays
Pluggable structural templates that map to chapters/scenes:
- Save the Cat 15 beats
- Hero's journey 12 stages
- Three-act structure
- Story Grid 5 commandments
- Freytag's pyramid

The user picks a template; OpenTales overlays it on the act/chapter tree as transparent "expected beat" markers. As chapters are written, the editor tags which beat each scene fulfills (manually or auto-detected). Missing beats are visible at a glance.

### 1.4 Scene cards and outline mode
Beyond chapters: a **scene** is a unit of narrative time. A chapter might have 1–5 scenes. Scene cards expose:
- POV character, location, time-of-day
- Goal / conflict / outcome (the classic Dwight Swain "scene-and-sequel" structure)
- Word count / estimated reading time
- Linked characters, locations, obstacles

A dedicated **Outline** view shows scene cards as a corkboard (Scrivener-style) with drag-to-reorder and zoomable hierarchy.

### 1.5 Character arcs
A character has a starting belief, a wound, a want, a need, and a final state. OpenTales should track these as first-class fields on the character, then cross-reference with the chapters where each transformation lands. Visualize arcs as a timeline:

```
Elena: ──A───B─────C──D────────────E──→
              ↑               ↑
              "first doubt"   "decisive break"
```

Each marker links back to the scene where it happens.

### 1.6 Theme & motif tracking
Tag any passage with a **theme** ("the cost of inheritance") or **motif** ("locks and keys"). The Theme panel shows where each one appears across the manuscript and how often. Useful for revision — "this theme is loud in act I and disappears by act II; intentional?"

### 1.7 Foreshadowing tracker
Mark a passage as a **setup**; later mark its **payoff**. OpenTales draws a line between them in the manuscript timeline. A "loose threads" view lists setups with no payoff — these are either Chekhov's guns waiting to fire or things you forgot to resolve.

### 1.8 Worldbuilding wiki
The current Locations panel is a start. Extend it to a full wiki with:
- Categories (locations, factions, magic systems, technologies, calendars, languages).
- Bidirectional links — type `[[Blackwood Manor]]` and it links automatically.
- Backlinks panel — show every chapter that mentions this entity.
- Aliases — `Marcus`, `Hale`, and `the doctor` all resolve to the same character.

### 1.9 Reading time and pacing analysis
- Per-chapter and per-scene **estimated reading time** (250 wpm for prose, configurable).
- A **pacing graph** plotting scene tension/word-count over time. Sudden flat plateaus = pacing dip; spikes = action peaks. Helps you see structural problems at 30,000-foot view.
- **Sentence-length variance heatmap** per chapter — long stretches of monotone sentence length read as monotone prose.

### 1.10 Research notebook
A free-form notes panel attached to the project (not to any single chapter or character). Markdown, attachments, web clips. Search across notes from the command palette. Optionally surface a research sidebar in the editor when you're in a chapter that links to a note.

### 1.11 Distraction-free writing modes
- **Typewriter mode** — current line stays vertically centered; you write "into" the screen.
- **Focus mode** — only current paragraph is full-opacity; rest is dimmed.
- **Hemingway mode** — disables backspace and arrow keys until a session word goal is hit. (Cursed, but writers ask for it.)

### 1.12 Session goals and writing streaks
- Daily/weekly word goals; visualized as GitHub-style contribution heatmap.
- Per-session goals ("write 800 words today"). Sound + confetti when you hit them — opt-in, off by default.
- **Writing sprints** — 25-minute Pomodoro with a paused word-count tracker. Compete with yourself or with collaborators.

### 1.13 Snapshot / "save state"
Beyond the existing version history, allow named snapshots — `"end of first draft"`, `"after agent feedback"`. Visible as branches in a project's history graph. Cheap branching encourages experimentation: "let me try rewriting chapter 5 from Marcus's POV in a branch."

### 1.14 Export pipeline
A "build" step that turns a manuscript into:
- **EPUB** with proper front-matter, ToC, chapter breaks
- **PDF** with submission-formatted typography (12pt Times, double-spaced, half-inch indents — the standard for agent submissions)
- **Markdown bundle** for static-site publication
- **Plain-text manuscript** for old-school agents
- **Audiobook script** (paragraphs split for breath, with stage directions for character voices)

Configurable per-project under `Project → Export presets`.

### 1.15 Submission tracker
A built-in agent/publisher submission tracker. When you submit your manuscript to an agent, log the agent name, contact, date, response. Built-in templates for query letters, synopsis, and the dreaded "personalized opening paragraph."

---

## 2. AI / assistive features (opt-in, local-first)

OpenTales should be useful without AI. When AI is added, it must be:
- **Opt-in** per project (off by default)
- **Local-first** when possible (Ollama / llama.cpp integration)
- **Never auto-generates prose** without an explicit request

Ideas:

### 2.1 AI continuity reviews
A model is given the current chapter and a summary of prior chapters. Asks: "Does this chapter contradict anything earlier?" Surfaces as a comment on the submission/inbox feed (the inbox already supports `AI_REVIEW_POSTED` activities, see PR #6).

### 2.2 AI rewrite suggestions
Highlight a paragraph → "rewrite tighter / softer / more visceral / more lyrical." Diff view shows the suggestion; you accept or reject. Never auto-applies.

### 2.3 Character voice match
"Generate a line of dialogue Elena would say in this situation" — sampled from the trained voice fingerprint (1.2). Helps unstick a scene when you can't hear a character.

### 2.4 Outline expander
Bullet-point synopsis → first-draft scene. Mark explicitly as "AI draft" so it shows up in the diff with a different background and forces an explicit accept-with-edits step.

### 2.5 Smart autocomplete
- Character name autocomplete (`@Elena` resolves to "Elena Voss").
- Location autocomplete.
- Optional **sentence completion** — small local model trained on your own past chapters, so it suggests in *your* voice rather than ChatGPT's voice.

### 2.6 Reading-level / sensitivity check
Configurable target reading level (Flesch-Kincaid). Optional sensitivity scan with explanations — not a censor, just a pair of eyes.

---

## 3. Collaboration

The drafts inbox (PR #6) is a foundation. Build on it:

### 3.1 Inline comments
Highlight a passage → leave a comment. Threaded replies. Resolve to dismiss. Same surface area as Google Docs / GitHub PR comments. Replays into the activity feed.

### 3.2 Beta-reader mode
A read-only project view that lets beta readers leave comments without seeing draft branches or inspector internals. Time-limited share links.

### 3.3 Editor mode (track changes)
Like Google Docs "suggesting." Every typed change becomes a proposed edit. Author accepts/rejects in bulk or individually.

### 3.4 Co-authoring presence
See where co-authors' cursors are. See typing indicators. Avoid stepping on each other.

### 3.5 Roles & granular permissions
Beyond OWNER/ADMIN/EDITOR/VIEWER — per-chapter ACLs ("Sarah can only edit chapters 3 and 7"), per-entity ACLs ("Beta readers can read chapters 1-3 but not the climax").

### 3.6 Real-time editing
Operational transforms or CRDT (yjs) layered on top of the existing branch model. Probably its own large project — see "Risks" below.

---

## 4. IDE refinements

### 4.1 Command palette (cmd+K)
Fuzzy-find anything — chapters, characters, locations, scenes, settings, commands. The single keystroke that makes the IDE feel like an IDE.

### 4.2 Go to definition
Click a character mention → jump to their character page. Cmd+click for new tab. Hover preview shows the character's headshot + one-liner.

### 4.3 Find in project + Find references
- Find in project: full-text search across chapters, character bios, location notes, themes.
- Find references: "show me every chapter where Marcus appears."

### 4.4 Rename refactor
Rename `Elena` → `Eleanor` and update every mention across the manuscript. Preview as a diff before applying. Like LSP rename in VS Code.

### 4.5 Multi-cursor across documents
Already inside a chapter (Monaco does this). Extend to "find/replace across all chapters" with multi-file editing.

### 4.6 Split editor / picture-in-picture
Open two chapters side-by-side. Drag a tab to a new pane. Useful when you're rewriting chapter 7 and need chapter 3 visible for reference.

### 4.7 Minimap
Monaco has it, just need to enable it for prose with sensible defaults (collapsed by default).

### 4.8 Themes
A handful of curated editor themes — "amber" (current), "parchment" (warm cream/sepia for daytime writing), "graphite" (high-contrast monochrome), "midnight" (very dark with low blue light). User-settable in Settings.

### 4.9 Keyboard shortcuts everywhere
Audit and fill the gaps. Every action in the title-bar menu should have a shortcut. Document them in a single help-overlay (`?` opens it).

### 4.10 Mobile-first writing widget
The mobile shell (PR #7) works for editing. Add a **lock-screen / homescreen widget** — "current word count today, tap to open today's chapter" — for iOS/Android via Capacitor.

### 4.11 Polished onboarding
First-time-user wizard: pick a template (mystery, fantasy, literary, memoir), generate a starter project skeleton (acts, beats, character archetypes, sample scenes). Skip-able.

### 4.12 Right-click menus
Currently sparse. Right-click a chapter → rename, duplicate, move, delete, copy URL, copy markdown. Same for characters, locations, acts.

### 4.13 Better drag-and-drop
- Drag chapters between acts.
- Drag characters into a scene to add them.
- Drag a markdown file from desktop into the explorer to import as a chapter.

---

## 5. Backend / data

### 5.1 Soft delete + trash
Currently DELETE is destructive. Move deleted entities to a `trash_at` field; a `Trash` panel surfaces them with a 30-day auto-purge.

### 5.2 Audit log
Every mutation logged: who, what, when. Replays into a project history view. Reuse the existing `Activity` polymorphic feed.

### 5.3 Real backups + export
- Daily database dumps (when self-hosted) to a configurable target.
- One-click "export everything as a zip" — chapters as markdown, characters as JSON, assets as binary blobs. Lock-in resistance is a feature.

### 5.4 Asset storage backends
Local disk works. Add adapters for S3, MinIO, Cloudflare R2. Asset URLs become signed when using cloud backends; signed URLs already mooted as a follow-up in PR #3.

### 5.5 Asset processing
- Auto-resize uploaded covers/avatars (web-optimized variants).
- Generate `og:image` for the public read view from cover + project title.
- Thumbnail strip for character portraits.

### 5.6 Search (the proper kind)
Postgres `tsvector` + `tsquery` for full-text across writings. Index per-org, per-project. Surface in the command palette and in a dedicated Search panel.

### 5.7 Writing stats / analytics (private, on-device)
- Total words by day/week/month, per project.
- Rate of word-count change per chapter (revision intensity).
- Time-of-day heatmap: when do you actually write? Maybe everyone writing at 2 AM should be a sad finding rather than a celebration.

### 5.8 Public RSS / atom feed for published chapters
For projects with `visibility: public`, expose `/read/:org/:project/feed.xml`. Episodic publication = serial fiction = readers want feeds.

### 5.9 Webhooks
On submission opened/merged/declined, on chapter published — fire a webhook. Lets users glue OpenTales into Discord, Slack, IFTTT, etc.

---

## 6. Platform / packaging

### 6.1 First-class auto-update
The Electron app needs a polished auto-updater (electron-updater + a release server). Today there's no update story.

### 6.2 Linux AppImage / Flatpak
Already partial via `electron-builder` config; verify Flatpak distribution.

### 6.3 Mobile native via Capacitor
Wrap the SvelteKit build in Capacitor for iOS/Android. The PWA already works in mobile browsers (PR #7); native wrappers add deeper OS integration (lock-screen widgets, share sheet, biometric unlock).

### 6.4 Self-hosting bundle
A single `docker-compose.yml` that runs Postgres + the backend + a static frontend. One-command self-hosting for users who don't trust the cloud.

### 6.5 Hosted version
A first-party hosted instance at opentales.lumina.pw. Free tier with reasonable limits; paid tier with cloud sync, larger asset quotas, AI features.

### 6.6 Monorepo CI
There's no CI today. Add GitHub Actions:
- Lint & typecheck on every PR.
- Build all packages.
- Run e2e (when we have e2e — see Testing).
- Auto-deploy `main` to a preview environment.

### 6.7 Release automation
`changesets` for managed versioning. Tag → build → publish to GitHub releases automatically.

---

## 7. Testing

There is no automated test suite right now. This is the highest-leverage thing to fix.

### 7.1 Backend
- **Unit tests** for use cases (jest/vitest). Mock the repository layer.
- **Integration tests** that boot Express against a test Postgres (testcontainers). Cover the auth flow, project CRUD, the membership/invite happy path, the submission merge flow, and asset upload.
- **Schema migrations** verified — apply each migration against an empty DB in CI.

### 7.2 Frontend
- **Component tests** with Vitest + Testing Library.
- **E2E** with Playwright covering the critical user journeys: log in → create project → create chapter → write → publish → public read view loads.

### 7.3 SDK
- Contract tests against the running backend, ensuring the SDK and the API don't drift apart.

---

## 8. Refactoring opportunities

These are tech-debt items the maintainers know about. Not breaking, but worth fixing.

### 8.1 Manuscript store is a monolith
`manuscript.svelte.ts` does auth, projects, tabs, drafts, and SDK wiring. Split it:
- `auth.svelte.ts` — login/register/logout.
- `projects.svelte.ts` — project list + active project + project settings.
- `tabs.svelte.ts` — open tabs and active document.
- `drafts.svelte.ts` — submission/branch state.

Keep the existing public API working during the split.

### 8.2 Use cases that bypass repositories
A handful of use cases use Prisma directly. Push every Prisma call through the repository layer.

### 8.3 Frontend SDK error handling
Errors surface as raw thrown messages. Wrap them in a typed `OpenTalesError` with `code` discriminators so the UI can render "Project not found" differently from "Network error."

### 8.4 Prisma JSON columns where they shouldn't be
A couple of fields (notably `Project.metadata`) are JSON. Audit which actually need to be JSON vs which should be normalized columns.

### 8.5 Activity feed coupling
`Activity` records currently embed a serialized `payload` JSON. Consider modeling the well-known activity types as structured columns/tables and reserving `payload` for plugin-defined types.

### 8.6 Dropping the legacy `index.html` SPA shell
Now that the landing page is prerendered, the Electron entrypoint should load `app.html` (the SPA fallback) directly instead of falling through `/`. Update `electron/main.ts` accordingly.

### 8.7 Assets path consistency
`AssetController` builds URLs from `PUBLIC_BASE_URL` but the frontend assumes relative paths in some places. Pick one and standardize.

### 8.8 Tailwind class soup
Some long Svelte components have lines of 20+ Tailwind classes. Extract semantic component classes via `@apply` for the most repeated patterns.

### 8.9 Unify the IDE & landing color tokens
The landing page uses `bg-panel`, `text-accent`, `bg-sidebar` etc. Confirm every token is defined in `app.css` for both light + dark modes (currently dark-only).

---

## 9. Known bugs / fixes

A pinned issue list of things to fix when someone has an afternoon. (Not exhaustive — search the issue tracker for live bugs.)

- **Service worker stickiness in dev.** A previously-installed prod SW lingers in dev. Add a "purge service worker" devtool.
- **Mobile drawer scroll lock.** Body sometimes scrolls behind the drawer. Add `overflow: hidden` on `<body>` while a drawer is open.
- **Monaco mounting on mobile.** Monaco is heavy; on slow 3G it can take 5+ seconds. Consider lazy-mounting Monaco only when a chapter is opened, not when the IDE shell loads.
- **Inspector "Connections" UI.** When a chapter has many linked characters, the connection cards overflow horizontally without scroll. Add overflow-x-auto.
- **iOS PWA back-swipe.** The back-swipe gesture conflicts with the side drawer. Block edge-swipes when a drawer is open.
- **Word count off by 1 on em-dashes.** Edge case in the splitter; needs proper Unicode-aware tokenizer.
- **Character avatars are eagerly loaded.** Lazy-load below-the-fold avatars on the character panel.

---

## 10. Stretch / research

The "if it works, it works" pile.

### 10.1 Voice-to-prose
Plug in a local Whisper model. Talk while you walk; chapters fill themselves out as drafts. Mark voice-drafts visually so you remember to revise.

### 10.2 Read-aloud (TTS)
Generate a chapter audiobook with high-quality TTS (ElevenLabs or local Piper). Listen to your own prose to find awkward sentences your eye glides over.

### 10.3 Visual novel / interactive fiction export
For projects flagged as "branching," export to Twine / Ink / Yarn. The act/scene/branch model is already close.

### 10.4 Embedded reader market
For published projects, allow readers to leave inline annotations. Authors see aggregated highlights — Kindle's "popular highlights" but for indie fiction.

### 10.5 Plot-graph visualization
Render the project's characters, locations, scenes, and themes as an interactive force-directed graph. Click a node, jump to it. Useful for spotting structural imbalances ("act II has no character interactions outside the protagonist").

### 10.6 Generative covers
Stable Diffusion / DALL·E integration to riff on potential book covers from the project's blurb + genre.

### 10.7 Submission preparation toolkit
- Auto-generated manuscript metadata (word count, comparable titles, genre, log line).
- One-click "format for [Agent X]" using stored agent guidelines.

### 10.8 Multiplayer scratch-pad
A shared whiteboard inside the project for plot-storming, mind maps, and chapter sketching. Real-time, ephemeral, doesn't get versioned.

---

## How to propose new directions

This document is a roadmap, not a contract. If you have an idea worth listing here:

1. Open an issue with `[future-direction]` in the title.
2. Describe the problem (one paragraph), the proposed solution (one paragraph), and what success looks like (a few bullets).
3. If accepted, edit this file in your PR — group it under the appropriate section.

Pick what excites you, and write the kind of tool you wish you had. That's how OpenTales got started.
