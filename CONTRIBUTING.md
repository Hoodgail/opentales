# Contributing to OpenTales

Thanks for thinking about contributing — OpenTales is built in the open by writers who got tired of cobbling together five different tools to draft a novel. Bug reports, design feedback, prose-tested feature ideas, and pull requests are all welcome.

This document covers the practical bits: how to set up a working copy, how the codebase is laid out, and what we look for when reviewing changes.

## Code of conduct

Be kind. We're trying to make a tool that respects the craft; that respect extends to the people in this repo. Harassment, hostility, or condescension will get you removed.

## Ways to contribute

- **Bug reports.** File an issue with reproduction steps, expected vs. actual behaviour, browser/OS, and a screenshot or screen recording if you can. The smaller the repro, the faster the fix.
- **Feature ideas.** Open a discussion or issue describing the *problem* first, then your proposed solution. We care more about the writing experience than the feature checklist.
- **Documentation.** Typos, gaps, ambiguous setup steps — all fair game. Touch the README, `docs/`, or inline JSDoc.
- **Pull requests.** See [Development workflow](#development-workflow) below.

If you're not sure whether something is in scope, open an issue first. The roadmap in [`docs/future-directions.md`](docs/future-directions.md) is a good map of what we want to build.

## Development setup

Requirements:

- Node.js 20+
- pnpm 10+
- PostgreSQL 15+

```bash
git clone https://github.com/Hoodgail/opentales.git
cd opentales
pnpm install
```

Set up the backend env and database:

```bash
cp packages/backend/.env.example packages/backend/.env
# edit DATABASE_URL and JWT_SECRET
pnpm --dir packages/backend prisma:generate
pnpm --dir packages/backend prisma:migrate
pnpm --dir packages/backend prisma:seed
```

Run the dev stack:

```bash
# terminal 1 — API at http://localhost:4000
pnpm dev:backend

# terminal 2 — frontend at http://localhost:5173
pnpm dev:web
```

The seed creates a demo user (`demo@opentales.local` / `password123`) with a project, characters, and chapters so you have something to look at immediately.

For a deeper walkthrough see [`docs/getting-started.md`](docs/getting-started.md).

## Repo layout

```
packages/
  backend/   Express + Prisma API (use-cases, controllers, repositories)
  frontend/  SvelteKit + Svelte 5 renderer, Tailwind v4
  electron/  Electron main + preload (desktop shell)
  sdk/       Typed TypeScript client shared by frontend + Electron
docs/        Project documentation
```

The architecture is documented in [`docs/architecture.md`](docs/architecture.md) — give that a read before deep-diving on backend changes.

## Development workflow

1. **Fork** the repo and create a feature branch off `main`:
   ```bash
   git checkout -b your-username/short-description
   ```
2. **Make your change.** Keep it focused — small PRs land faster.
3. **Run checks** locally before pushing:
   ```bash
   pnpm check          # frontend types
   pnpm check:backend  # backend types
   pnpm check:sdk      # sdk types
   pnpm build          # full build
   ```
4. **Commit** with a descriptive message. We don't enforce a strict format, but `feat:`, `fix:`, `docs:`, `refactor:`, `chore:` prefixes are appreciated.
5. **Open a pull request** against `main`. Fill out the template — what changed, why, and how you tested.

If your PR touches the schema, also include the Prisma migration (don't hand-edit `schema.prisma` and skip migrations — generate them with `pnpm --dir packages/backend prisma migrate dev --name your_migration_name`).

## Code style

- TypeScript everywhere. No `any` unless you're genuinely interfacing with something untyped — and even then, narrow it down.
- Frontend: Svelte 5 runes (`$state`, `$derived`, `$effect`). No legacy stores in new code unless there's a reason.
- Backend: clean architecture (controller → use case → repository). Don't reach into Prisma from controllers.
- Tailwind v4 utility classes, no inline styles unless dynamic.
- Comments are sparing. Names should carry the meaning; comments should explain *why*, not *what*.

## Testing

The repo doesn't yet have an automated test suite — see [`docs/future-directions.md`](docs/future-directions.md) for the testing roadmap. For now, please test changes manually and describe what you tested in the PR body.

If you add tests (please do!), put backend tests under `packages/backend/src/**/*.test.ts` and frontend tests next to their components.

## Branch conventions

- `main` — always deployable
- `your-username/<short-description>` — feature/fix branches

Don't push directly to `main`. Open a PR even for tiny changes — it gives reviewers a chance to spot ripple effects.

## Releasing

Releases are tagged off `main`. We bump the version in the root `package.json` and the per-package `package.json` files together, then tag `v<major>.<minor>.<patch>`.

## Questions?

Open a [discussion](https://github.com/Hoodgail/opentales/discussions) or drop a comment on a relevant issue. Thanks for being here.
