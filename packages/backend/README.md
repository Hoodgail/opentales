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
- Project-scoped, revocable MCP API keys for external agents
- Project storage usage accounting across assets and writing content
- Versioned prose through `Writing`, `WritingBranch`, and `WritingVersion`
- Durable, restart-safe Novel Build task graphs with scoped leases, checkpoints, traces, and evaluations
- Structured Story IR, immutable canon/state history, temporal queries, and evidence-backed diagnostics
- Sandboxed scene/chapter manuscript units with compilation and owner approve/merge/reject
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

| command | description |
| ------- | ----------- |
| `pnpm dev` | Run the API with `tsx watch` |
| `pnpm build` | Generate Prisma Client and compile TypeScript |
| `pnpm check` | Typecheck without emitting files |
| `pnpm test` | Run unit and contract tests; database suites run when their test URLs are set |
| `pnpm eval` | Run deterministic artifact/behavior and continuity evals |
| `pnpm test:critical-coverage` | Enforce coverage thresholds over the workflow security/runtime core |
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
| `GET` | `/projects/:projectId/ai-settings` | Read project AI provider settings without exposing credentials |
| `PATCH` | `/projects/:projectId/ai-settings` | Enable AI and select a provider/model |
| `POST` | `/projects/:projectId/ai-settings/github-copilot/auth/start` | Start GitHub Copilot device authorization |
| `POST` | `/projects/:projectId/ai-settings/github-copilot/auth/poll` | Poll and persist GitHub Copilot authorization |
| `POST` | `/projects/:projectId/ai-settings/codex/auth/start` | Start OpenAI Codex device authorization |
| `POST` | `/projects/:projectId/ai-settings/codex/auth/poll` | Poll and persist an encrypted refreshable Codex session |
| `GET` | `/projects/:projectId/ai/models` | List the cached models.dev catalog plus subscription-safe Codex models |
| `GET` | `/projects/:projectId/mcp-api-keys` | List safe MCP key metadata (project admin) |
| `POST` | `/projects/:projectId/mcp-api-keys` | Create a project-scoped MCP bearer key and return its secret once |
| `DELETE` | `/projects/:projectId/mcp-api-keys/:keyId` | Revoke an MCP key immediately |

External agents connect to `POST/GET /mcp` with `Authorization: Bearer otmcp_...`. The endpoint is a stateless Streamable HTTP MCP server whose key fixes the project scope. It adapts the existing AI tool schemas and use cases, publishes skills and agent prompts as MCP resources/prompts, and omits only session-only or durable-worker-lease tools. See [`../../docs/mcp.md`](../../docs/mcp.md).

Claude.ai discovers the OAuth provider through `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`. OpenTales supports public Dynamic Client Registration at `/register`, authorization-code + PKCE exchange and refresh at `/token`, revocation at `/revoke`, and authenticated project consent under `/oauth/authorize`.

AI skill routes under `/projects/:projectId/ai/skills` let project admins list, create, update, and delete project-scoped Agent Skills. Enabled skills are disclosed to agent sessions as a compact catalog and loaded on demand with read-only AI tools.

Novel Build routes under `/projects/:projectId/builds` expose human controls and reads: intake/authorization/lifecycle/replan, sandbox manuscript units, compilation/comparison, reviews, artifacts, versioned story state, observability, search/references, and diagnostics. Claim/heartbeat/task-result/trace/branch-patch operations remain backend-internal.

Publishing routes under `/projects/:projectId/exports` and `/imports` generate private artifacts or preview/apply supported imports. Build completion accepts only verified export records whose bytes, checksums, compilation, and branch heads match.

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
