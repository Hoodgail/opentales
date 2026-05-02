# @opentales/backend

Express API for OpenTales. It uses Prisma with PostgreSQL and keeps business logic in class-based use cases called from thin controllers.

## Responsibilities

- Username, email, and password auth
- JWT bearer sessions
- Org and membership based project access
- Project manuscript reads
- Chapter, character, location, project, and story structure updates
- Path-based project docs, nested folders, and foldered assets
- Project storage usage accounting across assets and writing content
- Versioned prose through `Writing`, `WritingBranch`, and `WritingVersion`
- Demo seed data converted from the current frontend manuscript fixture

## Setup

Create an env file:

```bash
cp .env.example .env
```

Required variables:

```text
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/opentales?schema=public"
JWT_SECRET="replace-me-with-a-long-random-secret"
PORT="4000"
CORS_ORIGIN="http://localhost:5173"
```

Run migrations and seed data:

```bash
pnpm prisma:migrate
pnpm prisma:seed
```

Start the API:

```bash
pnpm dev
```

## Scripts

| command | description |
| ------- | ----------- |
| `pnpm dev` | Run the API with `tsx watch` |
| `pnpm build` | Generate Prisma Client and compile TypeScript |
| `pnpm check` | Typecheck without emitting files |
| `pnpm start` | Run the compiled API |
| `pnpm prisma:generate` | Generate Prisma Client |
| `pnpm prisma:migrate` | Create/apply a development migration |
| `pnpm prisma:seed` | Seed demo user and project data |

## API

Base URL in development:

```text
http://localhost:4000
```

Auth routes:

| method | path | description |
| ------ | ---- | ----------- |
| `POST` | `/auth/register` | Create user, workspace, and owner membership |
| `POST` | `/auth/login` | Login with email or username |
| `GET` | `/auth/me` | Read the current user |

Project routes require `Authorization: Bearer <token>`.

| method | path | description |
| ------ | ---- | ----------- |
| `GET` | `/projects` | List accessible projects |
| `POST` | `/projects` | Create a project and empty story structure writings |
| `GET` | `/projects/:projectId` | Load the manuscript surface used by the frontend |
| `PATCH` | `/projects/:projectId` | Update project metadata |
| `PATCH` | `/projects/:projectId/chapters/:chapterId` | Update chapter metadata and content |
| `PATCH` | `/projects/:projectId/characters/:characterId` | Update character fields and prose |
| `POST` | `/projects/:projectId/characters/:characterId/assets` | Attach an uploaded asset to a character |
| `DELETE` | `/projects/:projectId/characters/:characterId/assets/:attachmentId` | Remove a character asset attachment |
| `PATCH` | `/projects/:projectId/locations/:locationId` | Update location fields and prose |
| `PATCH` | `/projects/:projectId/structure` | Update project structure prose and metadata |
| `GET` | `/projects/:projectId/docs/tree` | Load the folder tree of docs and foldered assets |
| `POST` | `/projects/:projectId/folders` | Create a project folder |
| `PATCH` | `/projects/:projectId/folders/:folderId` | Rename, move, or reorder a folder |
| `DELETE` | `/projects/:projectId/folders/:folderId` | Delete a folder subtree |
| `PATCH` | `/projects/:projectId/assets/:assetId` | Rename or move an asset into/out of folders |
| `GET` | `/projects/:projectId/storage` | Calculate total project storage usage |

Folders use Linux-like case-sensitive names. A folder cannot contain two child items with the same name across folders, docs, and foldered assets. The backend enforces this in transactions with PostgreSQL advisory locks scoped to the project and parent folder, so cross-table sibling checks do not race.

## Structure

```
src/
  app.ts                 Express app composition
  server.ts              HTTP server entrypoint
  config/                Env and Prisma client
  controllers/           Request/response boundary
  middleware/            Auth and error handling
  repositories/          Access helpers
  routes/                Express route registration
  useCases/              Business logic classes
  utils/                 Small shared helpers
prisma/
  schema.prisma          PostgreSQL schema
  seed.ts                Demo data seed
```

## Demo Login

After `pnpm prisma:seed`:

```text
demo@opentales.local / password123
```
