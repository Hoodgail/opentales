# Architecture

This document explains how OpenTales is put together: the high-level shape of the system, the conventions inside each package, and the reasoning behind a few non-obvious decisions.

## High-level layout

OpenTales is a pnpm monorepo with four packages:

```
┌──────────────┐   HTTP / JSON    ┌─────────────────┐
│  frontend    │ ───────────────▶ │  backend (API)  │
│  SvelteKit   │ ◀─────────────── │  Express        │
└────┬─────────┘                  └────────┬────────┘
     │                                     │
     │ wraps                                │ Prisma
     ▼                                     ▼
┌──────────────┐                   ┌─────────────────┐
│  electron    │                   │   PostgreSQL    │
│  desktop     │                   └─────────────────┘
└──────────────┘
                 ┌──────────────┐
                 │  sdk         │ ← shared between frontend & electron
                 │  TS client   │
                 └──────────────┘
```

- The **backend** owns the database. Nothing else talks to Prisma.
- The **SDK** is the only blessed way to talk to the backend. The frontend never builds raw `fetch()` calls.
- The **frontend** is a SvelteKit static site. The same build is mounted by Electron via `file://`.
- **Electron** adds a chrome-less window, native file dialogs, and the auto-updater. It does *not* own application logic.

## Backend (`packages/backend`)

Express + Prisma + clean-architecture style.

```
src/
├── app.ts                  Express bootstrap, middleware, route mounting
├── config/                 env parsing
├── controllers/            HTTP layer — parse req, call use case, shape res
├── routes/                 thin route -> controller wiring
├── useCases/               business logic — one file per operation
├── repositories/           Prisma access (data layer)
├── middleware/             auth, error handler, request id, etc.
├── lib/                    cross-cutting helpers (jwt, password hashing)
└── prisma/                 schema + migrations + seed
```

### Layering rules

- Controllers parse request shape, delegate to a use case, format the response. No DB access, no business logic.
- Use cases orchestrate one operation. They call repositories, enforce permissions, and return domain results. They throw `HttpError`s for known failures.
- Repositories wrap Prisma queries. They expose **typed** functions, not raw `prisma.x.findMany`.

This split makes operations easy to test in isolation and keeps controllers thin enough to read in one screen.

### Data model

Defined in `packages/backend/prisma/schema.prisma`. The big idea:

- **Multi-tenant.** Everything lives under an `Org`. `Membership(orgId, userId, role)` controls access; `Role` is one of `OWNER | ADMIN | EDITOR | VIEWER`.
- **Versioned writing.** A single shared model — `Writing → WritingBranch → WritingVersion` — captures any prose-like document. Chapter content, character bios, location descriptions, plot beats, and obstacle text are all writings under the hood. This gives every text field free version history and makes the drafts/inbox feature (PR #6) work uniformly across entity types.
- **Projects.** A `Project` belongs to an `Org` and has `acts → chapters → writings`, plus orthogonal collections of `characters`, `locations`, `obstacles`, and a `structure` (premise/POV/voice/theme/climax). Chapters can be `published` individually; the project itself has a `visibility` (private / unlisted / public).
- **Submissions (drafts inbox).** A `Submission` is a proposed change targeting a specific `WritingBranch`. EDITORs open submissions, OWNER/ADMINs merge or decline. The diff is computed against the snapshot taken at submit time, so the base can keep moving without invalidating in-flight reviews.
- **Assets.** Uploaded files are rows in `Asset` with the bytes on local disk under `ASSETS_DIR`. Avatars/covers reference an `assetId`, and the public `GET /assets/:assetId` route streams them.

`prisma.md` at the repo root has the original design notes and explains *why* the writing/branch/version model is shared across entity types — worth reading before any schema change.

### Authentication

Username/email + password with `bcrypt` hashing and a JWT in an HTTP-only cookie. The token carries the user id and the active membership. Every authed route resolves a `RequestContext` that exposes `userId`, `orgId`, and the user's role for the org.

Most operations check membership and role at the use-case level via a small `assertCan(role, action)` helper. Public routes (`/public/projects/...`, `/assets/:id`, `/read/...`) are unauthenticated by design.

## Frontend (`packages/frontend`)

SvelteKit + Svelte 5 (runes) + Tailwind v4 + Monaco.

```
src/
├── routes/
│   ├── +page.svelte             public landing page (this PR)
│   ├── projects/+page.svelte    the IDE
│   ├── invite/+page.svelte      invite-acceptance landing
│   └── read/.../+page.svelte    public read view
├── lib/
│   ├── components/
│   │   ├── ide/                 the desktop-style IDE shell
│   │   ├── landing/             public marketing site
│   │   ├── Logo.svelte          the brand mark (inline SVG)
│   │   └── ...
│   └── stores/
│       ├── manuscript.svelte.ts the IDE state machine (auth, projects, tabs)
│       ├── viewport.svelte.ts   reactive breakpoints
│       └── ui.svelte.ts         drawer state for mobile
├── service-worker.ts            PWA: pre-cache shell, network-first for the rest
├── app.html                     HTML shell + PWA meta + favicon links
└── app.css                      Tailwind theme tokens (oklch palette)
```

### Configuration

- `adapter-static` outputs a fully static site (`packages/frontend/build/`). Electron loads it via `file://`, web hosts serve it directly.
- `paths.relative = true` so the same build works from any URL prefix.
- The landing page at `/` opts into SSR + prerender so SEO meta tags end up in the static HTML. The rest of the app (`/projects`, `/invite`, `/read/...`) is CSR-only because Monaco needs `window` at module load.

### State

State lives in three small Svelte 5 stores:

- `manuscript.svelte.ts` — the big one. Owns auth, projects, tabs, active chapter, draft buffers, and the SDK client. UI components read fields directly (`manuscript.activeChapter`) and mutate via methods (`manuscript.openChapter(id)`).
- `viewport.svelte.ts` — `mobile`/`tablet`/`desktop` flags driven by a `matchMedia` listener. The IDE collapses into drawers + bottom nav under `mobile`.
- `ui.svelte.ts` — which mobile drawer is open. Persisted in `sessionStorage`.

We deliberately avoid a global event bus or generic store factory. Components subscribe to fields they care about; Svelte 5's reactivity does the rest.

### IDE shell

The IDE in `packages/frontend/src/routes/projects/+page.svelte` mounts a desktop-style layout:

```
┌─────────────────────────────────────────────────────┐
│                    TitleBar                         │
├──┬─────────┬───────────────────────────┬────────────┤
│  │         │                           │            │
│ A│  Side   │        Editor             │ Inspector  │
│ c│  Panel  │        (Monaco tabs)      │  Panel     │
│ t│         │                           │            │
│ B│         │                           │            │
│ a│         │                           │            │
│ r│         │                           │            │
├──┴─────────┴───────────────────────────┴────────────┤
│                    StatusBar                        │
└─────────────────────────────────────────────────────┘
```

The activity bar swaps which `SidePanel` is active (Explorer, Characters, Locations, Structure, Submissions, Members, Settings). Each panel is its own component under `lib/components/ide/`. The inspector is context-sensitive: open a chapter, get a chapter inspector; open a character, get a character inspector.

On mobile (PR #7) the side and inspector panels become drawers and the activity bar collapses into a bottom nav.

## SDK (`packages/sdk`)

A typed wrapper around the backend's HTTP API. Method names mirror REST resources:

```ts
const sdk = createSdk({ baseUrl: '...', tokenStore });

await sdk.projects.list();
await sdk.projects.create({ orgId, title });
await sdk.chapters.update(id, { title, status });
await sdk.assets.upload(projectId, file);
```

Both the frontend and Electron import from `@opentales/sdk`. The SDK has zero browser dependencies and works in node too — useful for tests and scripts.

## Electron (`packages/electron`)

A thin wrapper:

- `main.ts` — creates a frameless `BrowserWindow`, loads the prebuilt frontend from `file://`, wires the `ipc` channels for window controls (`minimize` / `maximize` / `close`), and handles the `app` lifecycle.
- `preload.ts` — exposes a tiny `window.opentales` API to the renderer (window controls, secure secrets storage).

We don't ship a Node API to the renderer; the frontend stays browser-pure so it can also run on the web.

## PWA / offline

The frontend is a Progressive Web App:

- `manifest.webmanifest` declares the icons, theme color, and start URL (`/projects/`).
- `service-worker.ts` precaches the build artifacts (Vite hashed assets), uses **network-first** for everything else, and falls back to the cached SPA shell on offline navigation.
- `InstallPrompt.svelte` shows a non-intrusive "Install OpenTales" toast when `beforeinstallprompt` fires.

The service worker is only registered in production builds (`import.meta.env.PROD`). In dev, you get a fresh fetch on every reload.

## Public surface area

For a feature shipping today, three URL surfaces matter:

| Surface | Auth | Renders |
|---|---|---|
| `/` | none | Landing page (prerendered HTML, SEO-tuned) |
| `/projects` | required | The IDE |
| `/read/:org/:project` | none | Read view of a public project's published chapters |

Anything else is internal (`/invite/:token`, the API).

## Where to look first

- New backend endpoint? Start in `routes/`, then `controllers/`, then add a use case.
- New IDE panel? Add a component under `lib/components/ide/`, register it on the activity bar in `ActivityBar.svelte`, and stash any state on `manuscript.svelte.ts`.
- New schema field? Edit `prisma/schema.prisma`, generate a migration (`prisma migrate dev`), expose via repository → use case → controller → SDK → frontend.

For ideas on what to build next, see [`future-directions.md`](future-directions.md).
