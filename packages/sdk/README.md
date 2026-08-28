# @opentales/sdk

TypeScript SDK for calling the OpenTales backend from the frontend or other clients.

The package exports API DTOs plus `OpenTalesClient`, a small fetch-based client with auth token handling.

## Build

```bash
pnpm build
```

## Typecheck

```bash
pnpm check
```

## Usage

```ts
import { OpenTalesClient } from '@opentales/sdk';

const client = new OpenTalesClient({
  baseUrl: 'http://localhost:4000'
});

const session = await client.login({
  emailOrUsername: 'demo@opentales.local',
  password: 'password123'
});

const projects = await client.listProjects();
const manuscript = await client.getProject(projects[0].id);

await client.updateChapter(manuscript.id, manuscript.chapters[0].id, {
  content: '# Revised opening\n\nNew chapter text.'
});
```

`login` and `register` automatically store the returned token on the client instance. You can also provide or replace a token manually:

```ts
const client = new OpenTalesClient({
  baseUrl: 'http://localhost:4000',
  token: savedToken
});

client.setToken(nextToken);
```

## Exports

```ts
export { ApiError, OpenTalesClient } from './client.js';
export type * from './types.js';
```

Important DTOs:

- `AuthSession`
- `AuthUser`
- `ProjectSummary`
- `ManuscriptProject`
- `ProjectFolder`
- `ProjectFileTree`
- `ProjectStorageUsage`
- `ProjectAiSkill`
- `ProjectMcpApiKey`, `CreateProjectMcpApiKeyResult`
- `AiAgentSession`, `AiAgentSessionPart`, `AiAgentToolCall`
- `Character`
- `Location`
- `Chapter`
- `StoryStructure`
- `UpdateChapterInput`
- `UpdateCharacterInput`
- `UpdateLocationInput`
- `UpdateStructureInput`
- `BuildRun`, `BuildTask`, `StoryArtifact`, `StoryStateSnapshot`
- `BuildManuscriptUnit`, `BuildCompilation`, `BuildReview`, `BuildObservability`
- `ProjectExport`, `ProjectImportPreview`

## Client Methods

| method | backend route |
| ------ | ------------- |
| `register(input)` | `POST /auth/register` |
| `login(input)` | `POST /auth/login` |
| `me()` | `GET /auth/me` |
| `listProjects()` | `GET /projects` |
| `createProject(input)` | `POST /projects` |
| `getProject(projectId)` | `GET /projects/:projectId` |
| `updateProject(projectId, input)` | `PATCH /projects/:projectId` |
| `updateChapter(projectId, chapterId, input)` | `PATCH /projects/:projectId/chapters/:chapterId` |
| `updateCharacter(projectId, characterId, input)` | `PATCH /projects/:projectId/characters/:characterId` |
| `attachCharacterAsset(projectId, characterId, input)` | `POST /projects/:projectId/characters/:characterId/assets` |
| `detachCharacterAsset(projectId, characterId, attachmentId)` | `DELETE /projects/:projectId/characters/:characterId/assets/:attachmentId` |
| `updateLocation(projectId, locationId, input)` | `PATCH /projects/:projectId/locations/:locationId` |
| `updateStructure(projectId, input)` | `PATCH /projects/:projectId/structure` |
| `getProjectFileTree(projectId)` | `GET /projects/:projectId/docs/tree` |
| `createProjectFolder(projectId, input)` | `POST /projects/:projectId/folders` |
| `updateProjectFolder(projectId, folderId, input)` | `PATCH /projects/:projectId/folders/:folderId` |
| `deleteProjectFolder(projectId, folderId)` | `DELETE /projects/:projectId/folders/:folderId` |
| `updateProjectAsset(projectId, assetId, input)` | `PATCH /projects/:projectId/assets/:assetId` |
| `getProjectStorage(projectId)` | `GET /projects/:projectId/storage` |
| `getProjectAiSettings(projectId)` | `GET /projects/:projectId/ai-settings` |
| `updateProjectAiSettings(projectId, input)` | `PATCH /projects/:projectId/ai-settings` |
| `startGithubCopilotAuth(projectId)` | `POST /projects/:projectId/ai-settings/github-copilot/auth/start` |
| `pollGithubCopilotAuth(projectId, input)` | `POST /projects/:projectId/ai-settings/github-copilot/auth/poll` |
| `startCodexAuth(projectId)` | `POST /projects/:projectId/ai-settings/codex/auth/start` |
| `pollCodexAuth(projectId, input)` | `POST /projects/:projectId/ai-settings/codex/auth/poll` |
| `listAiModels(projectId)` | `GET /projects/:projectId/ai/models` |
| `listProjectMcpApiKeys(projectId)` | `GET /projects/:projectId/mcp-api-keys` |
| `createProjectMcpApiKey(projectId, input)` | `POST /projects/:projectId/mcp-api-keys` |
| `revokeProjectMcpApiKey(projectId, keyId)` | `DELETE /projects/:projectId/mcp-api-keys/:keyId` |
| `listProjectAiSkills(projectId)` | `GET /projects/:projectId/ai/skills` |
| `createProjectAiSkill(projectId, input)` | `POST /projects/:projectId/ai/skills` |
| `updateProjectAiSkill(projectId, skillId, input)` | `PATCH /projects/:projectId/ai/skills/:skillId` |
| `deleteProjectAiSkill(projectId, skillId)` | `DELETE /projects/:projectId/ai/skills/:skillId` |
| `answerAiQuestion(projectId, toolCallId, input, sessionId?)` | `POST /projects/:projectId/ai/agent-session/tool-calls/:toolCallId/answer` |

Agent session snapshots include the additive `timeline` projection: stable, sequenced `message`, contiguous `text`, `tool-call`, `tool-result`, and `task` parts. `timelineInfo` reports exact, approximate legacy, or mixed chronology plus truncation. Consumers should prefer the timeline, fall back to `messages`/`toolCalls` against older backends, and retain the current snapshot when an incremental stream event omits `session`. Load older durable parts with `beforeSequence`; best-effort legacy pages use `legacyCursor` (the response returns both next cursors). `createAiAgentSession` accepts optional `buildRunId` and `approvalMode`; `updateAiAgentSession` switches an idle session between `manual` and admin-only `auto`. Auto executes available in-scope mutations immediately and removes `askUser`; each queued prompt captures the current mode. Snapshots expose the resolved `activeBuildRunId`. Large tool inputs/outputs—including pending approvals—and parent task results are previewed; call `getAiAgentToolCall` or open the child session for full values.

Novel Build methods include `createBuildRun`, authorization/lifecycle/replan, manuscript-unit CRUD/reorder, compile/compare, review approve/merge/reject, artifact and versioned story-state operations, observability, search/references, and diagnostics. Publishing methods include secure export create/list/download/regenerate/delete and import preview/apply. Consult [`../../docs/novel-build.md`](../../docs/novel-build.md) for workflow semantics and required idempotency/revision fields.

Project docs are path-based through folders. `ProjectDoc.kind` is only metadata for filtering and AI behavior; use `folderId` to place docs in the tree. Assets appear in the tree only when they have a `folderId`.
