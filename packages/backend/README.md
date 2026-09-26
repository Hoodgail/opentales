# @opentales/backend

Express API for OpenTales. It uses Prisma with PostgreSQL and keeps business logic in class-based use cases called from thin controllers.

## Responsibilities

- Username, email, and password auth
- JWT bearer sessions
- Org and membership based project access
- Project manuscript reads
- Chapter, character, location, project, and story structure updates
- Path-based project docs, nested folders, and foldered assets
- Project-scoped AI settings and Agent Skills
- Embedded OpenCode V2 agent harness with one isolated workspace per project
- Project-scoped, revocable MCP API keys for external agents
- Project storage usage accounting across assets and writing content
- Versioned prose through `Writing`, `WritingBranch`, and `WritingVersion`
- Validated private DOCX/PDF/EPUB/Markdown/text/HTML/archive export and safe import preview/apply
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

| command                       | description                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`                    | Run the API with `tsx watch`                                                  |
| `pnpm build`                  | Generate Prisma Client and compile TypeScript                                 |
| `pnpm check`                  | Typecheck without emitting files                                              |
| `pnpm test`                   | Run unit and contract tests; database suites run when their test URLs are set |
| `pnpm eval`                   | Run deterministic artifact/behavior and continuity evals                      |
| `pnpm test:critical-coverage` | Enforce coverage thresholds over the workflow security/runtime core           |
| `pnpm start`                  | Run the compiled API                                                          |
| `pnpm prisma:generate`        | Generate Prisma Client                                                        |
| `pnpm prisma:migrate`         | Create/apply a development migration                                          |
| `pnpm prisma:seed`            | Seed demo user and project data                                               |

## API

Base URL in development:

```text
http://localhost:4000
```

Auth routes:

| method | path             | description                                  |
| ------ | ---------------- | -------------------------------------------- |
| `POST` | `/auth/register` | Create user, workspace, and owner membership |
| `POST` | `/auth/login`    | Login with email or username                 |
| `GET`  | `/auth/me`       | Read the current user                        |

Project routes require `Authorization: Bearer <token>`.

| method   | path                                                                | description                                                            |
| -------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/projects`                                                         | List accessible projects                                               |
| `POST`   | `/projects`                                                         | Create a project and empty story structure writings                    |
| `GET`    | `/projects/:projectId`                                              | Load the manuscript surface used by the frontend                       |
| `PATCH`  | `/projects/:projectId`                                              | Update project metadata                                                |
| `PATCH`  | `/projects/:projectId/chapters/:chapterId`                          | Update chapter metadata and content                                    |
| `PATCH`  | `/projects/:projectId/characters/:characterId`                      | Update character fields and prose                                      |
| `POST`   | `/projects/:projectId/characters/:characterId/assets`               | Attach an uploaded asset to a character                                |
| `DELETE` | `/projects/:projectId/characters/:characterId/assets/:attachmentId` | Remove a character asset attachment                                    |
| `PATCH`  | `/projects/:projectId/locations/:locationId`                        | Update location fields and prose                                       |
| `PATCH`  | `/projects/:projectId/structure`                                    | Update project structure prose and metadata                            |
| `GET`    | `/projects/:projectId/docs/tree`                                    | Load the folder tree of docs and foldered assets                       |
| `POST`   | `/projects/:projectId/folders`                                      | Create a project folder                                                |
| `PATCH`  | `/projects/:projectId/folders/:folderId`                            | Rename, move, or reorder a folder                                      |
| `DELETE` | `/projects/:projectId/folders/:folderId`                            | Delete a folder subtree                                                |
| `PATCH`  | `/projects/:projectId/assets/:assetId`                              | Rename or move an asset into/out of folders                            |
| `GET`    | `/projects/:projectId/storage`                                      | Calculate total project storage usage                                  |
| `GET`    | `/projects/:projectId/ai-settings`                                  | Read project AI provider settings without exposing credentials         |
| `PATCH`  | `/projects/:projectId/ai-settings`                                  | Enable AI and select a provider/model                                  |
| `POST`   | `/projects/:projectId/ai-settings/github-copilot/auth/start`        | Start GitHub Copilot device authorization                              |
| `POST`   | `/projects/:projectId/ai-settings/github-copilot/auth/poll`         | Poll and persist GitHub Copilot authorization                          |
| `POST`   | `/projects/:projectId/ai-settings/codex/auth/start`                 | Start OpenAI Codex device authorization                                |
| `POST`   | `/projects/:projectId/ai-settings/codex/auth/poll`                  | Poll and persist an encrypted refreshable Codex session                |
| `GET`    | `/projects/:projectId/ai/models`                                    | List configured endpoint models with models.dev metadata fallback; otherwise the reference catalog |
| `POST`   | `/projects/:projectId/ai/models/discover`                            | Preview an OpenAI-compatible endpoint's models before saving (project admin) |
| `GET`    | `/projects/:projectId/mcp-api-keys`                                 | List safe MCP key metadata (project admin)                             |
| `POST`   | `/projects/:projectId/mcp-api-keys`                                 | Create a project-scoped MCP bearer key and return its secret once      |
| `DELETE` | `/projects/:projectId/mcp-api-keys/:keyId`                          | Revoke an MCP key immediately                                          |

External agents connect to `POST/GET /mcp` with `Authorization: Bearer otmcp_...`. The endpoint is a stateless Streamable HTTP MCP server whose key fixes the project scope. It adapts the existing AI tool schemas and use cases, publishes skills and agent prompts as MCP resources/prompts, and omits only session-only or durable-worker-lease tools. See [`../../docs/mcp.md`](../../docs/mcp.md).

Hosted clients such as ChatGPT, Gemini, and Claude.ai discover the OAuth provider through `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`. OpenTales supports public Dynamic Client Registration at `/register`, authorization-code + PKCE exchange and refresh at `/token`, revocation at `/revoke`, and authenticated project consent under `/oauth/authorize`.

AI skill routes under `/projects/:projectId/ai/skills` let project admins list, create, update, and delete project-scoped Agent Skills. Enabled skills are written into the project's OpenCode workspace and loaded on demand through OpenCode's `skill` tool.

Agent sessions run on an embedded `@opencode/sdk` host (`src/useCases/ai/opencode/`). Routes under `/projects/:projectId/ai/agent-sessions` create, list, prompt, interrupt, and delete sessions and reply to approvals/questions; `/projects/:projectId/ai/agent-events` streams live activity. Set `OPENCODE_DATA_DIR` (default `./data/opencode`) to persistent storage. See [`../../docs/ai-system.md`](../../docs/ai-system.md).

Agents plan and track work in project docs, using ordinary writing tools for drafting and revision. Scene CRUD remains available under `/projects/:projectId/chapters/:chapterId/scenes`.

Publishing routes under `/projects/:projectId/exports` and `/imports` generate private artifacts or preview/apply supported imports. Export records retain checksums and source provenance.

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
