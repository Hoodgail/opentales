# Getting started

This guide gets a working copy of OpenTales running on your machine in about five minutes. By the end you'll have the API, the SvelteKit frontend, and a seeded project to play with.

## Requirements

- **Node.js 20+** — install with [nvm](https://github.com/nvm-sh/nvm) or [Volta](https://volta.sh).
- **pnpm 10+** — `npm install -g pnpm` if you don't already have it.
- **PostgreSQL 15+** — running locally or reachable via `DATABASE_URL`. [`postgres.app`](https://postgresapp.com) is the easiest way on macOS; on Linux use your distro's package manager; on Windows use [WSL](https://learn.microsoft.com/en-us/windows/wsl/) or the official installer.

## 1. Clone and install

```bash
git clone https://github.com/Hoodgail/opentales.git
cd opentales
pnpm install
```

`pnpm install` will install dependencies for every workspace (`backend`, `frontend`, `electron`, `sdk`).

## 2. Configure the backend

Copy the example env file:

```bash
cp packages/backend/.env.example packages/backend/.env
```

Open `packages/backend/.env` and set:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/opentales"
JWT_SECRET="something-long-and-random"
PORT=4000
PUBLIC_BASE_URL="http://localhost:4000"
ASSETS_DIR="./data/assets"
```

The `ASSETS_DIR` is where uploaded character avatars and project covers get written. The backend will auto-create this directory on first upload.

## 3. Migrate and seed the database

```bash
pnpm --dir packages/backend prisma:generate
pnpm --dir packages/backend prisma:migrate
pnpm --dir packages/backend prisma:seed
```

The seed creates:

- A demo user — `demo@opentales.local` / `password123`
- A demo organization
- A starter project with a few chapters, characters, and a location

## 4. Run the dev stack

In one terminal:

```bash
pnpm dev:backend
# → API listening on http://localhost:4000
```

In another terminal:

```bash
pnpm dev:web
# → SvelteKit dev server on http://localhost:5173
```

Open http://localhost:5173 — you'll land on the marketing page. Click **Open the editor** (or visit `/projects` directly) to log in with the demo credentials.

## 5. (Optional) Run the Electron desktop app

```bash
pnpm dev
```

This boots the SvelteKit dev server *and* launches the Electron shell pointing at it. Closing the Electron window will stop the dev session.

To produce a packaged installer:

```bash
pnpm package
```

The artifacts land in `packages/electron/dist/`.

## Project structure tour

A quick map of what you're looking at, then keep [the architecture doc](architecture.md) handy when you start changing things.

```
opentales/
├── packages/
│   ├── backend/      Express + Prisma API
│   ├── frontend/     SvelteKit renderer (the IDE + landing page)
│   ├── electron/     Desktop shell wrapping the frontend
│   └── sdk/          TypeScript client used by frontend + Electron
├── docs/             You are here
├── prisma.md         Data-model plan / design notes
└── README.md
```

## Your first edits

Once you're logged in:

1. **Create a project** from the title bar (or use the seeded one).
2. **Add an Act** in the explorer (`Acts → +`), then **add a chapter** inside it.
3. Click the chapter — Monaco opens with markdown highlighting.
4. Write something. The status bar shows live word count; chapter status flips to *in-progress* automatically.
5. Open the **Characters** activity tab to add a character; relate them to chapters via the inspector.
6. Open **Locations** to add a setting and upload a reference image.

When you're ready to share, head to **Project settings → Visibility** and flip the project to *public*. Individual chapters need their own *Publish* toggle. The public read view lives at `/read/:orgSlug/:projectSlug`.

## Common issues

**`prisma:migrate` fails with "database does not exist".** Create it first: `createdb opentales` (or `CREATE DATABASE opentales;` in `psql`).

**Frontend boots but every API call 401s.** Make sure `JWT_SECRET` is set and the backend is actually running on port 4000. The frontend assumes `http://localhost:4000` in dev.

**Avatar/cover uploads return a broken image.** The backend writes to `ASSETS_DIR` and serves them via `GET /assets/:assetId`. Check that the process can write to that directory and that `PUBLIC_BASE_URL` matches where the API is reachable.

**Service worker keeps serving stale assets in dev.** Open DevTools → *Application* → *Service Workers* → *Unregister*, then hard reload. The SW is registered only in production builds, but a stale registration from a previous prod build can persist.

## What next?

- Read [the architecture overview](architecture.md) to understand how the pieces fit together.
- Browse [future directions](future-directions.md) — that's where roadmap, refactor ideas, and craft-focused feature briefs live. Pick something and open a PR.
- Found a bug? File it on [the issue tracker](https://github.com/Hoodgail/opentales/issues).
