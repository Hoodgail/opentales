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
import { OpenTalesClient } from "@opentales/sdk";

const client = new OpenTalesClient({
  baseUrl: "http://localhost:4000",
});

const session = await client.login({
  emailOrUsername: "demo@opentales.local",
  password: "password123",
});

const projects = await client.listProjects();
const manuscript = await client.getProject(projects[0].id);

await client.updateChapter(manuscript.id, manuscript.chapters[0].id, {
  content: "# Revised opening\n\nNew chapter text.",
});
```

`login` and `register` automatically store the returned token on the client instance. You can also provide or replace a token manually:

```ts
const client = new OpenTalesClient({
  baseUrl: "http://localhost:4000",
  token: savedToken,
});

client.setToken(nextToken);
```

## Exports

```ts
export { ApiError, OpenTalesClient } from "./client.js";
export type * from "./types.js";
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
- `AiAgentSession`, `AiAgentMessage`, `AiAgentPart`, `AiAgentPermissionRequest`, `AiAgentQuestion`, `AiAgentStreamEvent`
- `Character`
- `Location`
- `Chapter`
- `StoryStructure`
- `UpdateChapterInput`
- `UpdateCharacterInput`
- `UpdateLocationInput`
- `UpdateStructureInput`
- `ProjectExport`, `ProjectImportPreview`

## Client Methods

| method                                                       | backend route                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `register(input)`                                            | `POST /auth/register`                                                      |
| `login(input)`                                               | `POST /auth/login`                                                         |
| `me()`                                                       | `GET /auth/me`                                                             |
| `listProjects()`                                             | `GET /projects`                                                            |
| `createProject(input)`                                       | `POST /projects`                                                           |
| `getProject(projectId)`                                      | `GET /projects/:projectId`                                                 |
| `updateProject(projectId, input)`                            | `PATCH /projects/:projectId`                                               |
| `updateChapter(projectId, chapterId, input)`                 | `PATCH /projects/:projectId/chapters/:chapterId`                           |
| `updateCharacter(projectId, characterId, input)`             | `PATCH /projects/:projectId/characters/:characterId`                       |
| `attachCharacterAsset(projectId, characterId, input)`        | `POST /projects/:projectId/characters/:characterId/assets`                 |
| `detachCharacterAsset(projectId, characterId, attachmentId)` | `DELETE /projects/:projectId/characters/:characterId/assets/:attachmentId` |
| `updateLocation(projectId, locationId, input)`               | `PATCH /projects/:projectId/locations/:locationId`                         |
| `updateStructure(projectId, input)`                          | `PATCH /projects/:projectId/structure`                                     |
| `getProjectFileTree(projectId)`                              | `GET /projects/:projectId/docs/tree`                                       |
| `createProjectFolder(projectId, input)`                      | `POST /projects/:projectId/folders`                                        |
| `updateProjectFolder(projectId, folderId, input)`            | `PATCH /projects/:projectId/folders/:folderId`                             |
| `deleteProjectFolder(projectId, folderId)`                   | `DELETE /projects/:projectId/folders/:folderId`                            |
| `updateProjectAsset(projectId, assetId, input)`              | `PATCH /projects/:projectId/assets/:assetId`                               |
| `getProjectStorage(projectId)`                               | `GET /projects/:projectId/storage`                                         |
| `getProjectAiSettings(projectId)`                            | `GET /projects/:projectId/ai-settings`                                     |
| `updateProjectAiSettings(projectId, input)`                  | `PATCH /projects/:projectId/ai-settings`                                   |
| `startGithubCopilotAuth(projectId)`                          | `POST /projects/:projectId/ai-settings/github-copilot/auth/start`          |
| `pollGithubCopilotAuth(projectId, input)`                    | `POST /projects/:projectId/ai-settings/github-copilot/auth/poll`           |
| `startCodexAuth(projectId)`                                  | `POST /projects/:projectId/ai-settings/codex/auth/start`                   |
| `pollCodexAuth(projectId, input)`                            | `POST /projects/:projectId/ai-settings/codex/auth/poll`                    |
| `listAiModels(projectId)`                                    | `GET /projects/:projectId/ai/models`                                       |
| `discoverAiModels(projectId, input)`                         | `POST /projects/:projectId/ai/models/discover` (admin-only preview)          |
| `listProjectMcpApiKeys(projectId)`                           | `GET /projects/:projectId/mcp-api-keys`                                    |
| `createProjectMcpApiKey(projectId, input)`                   | `POST /projects/:projectId/mcp-api-keys`                                   |
| `revokeProjectMcpApiKey(projectId, keyId)`                   | `DELETE /projects/:projectId/mcp-api-keys/:keyId`                          |
| `getMcpOAuthAuthorizationContext(input)`                     | `GET /oauth/authorize/context`                                             |
| `authorizeMcpOAuth(input)`                                   | `POST /oauth/authorize`                                                    |
| `listProjectAiSkills(projectId)`                             | `GET /projects/:projectId/ai/skills`                                       |
| `createProjectAiSkill(projectId, input)`                     | `POST /projects/:projectId/ai/skills`                                      |
| `updateProjectAiSkill(projectId, skillId, input)`            | `PATCH /projects/:projectId/ai/skills/:skillId`                            |
| `deleteProjectAiSkill(projectId, skillId)`                   | `DELETE /projects/:projectId/ai/skills/:skillId`                           |
| `getAiAgentCapabilities(projectId)`                          | `GET /projects/:projectId/ai/agent-capabilities`                           |
| `listAiAgentSessions(projectId)`                             | `GET /projects/:projectId/ai/agent-sessions`                               |
| `createAiAgentSession(projectId, input)`                     | `POST /projects/:projectId/ai/agent-sessions`                              |
| `getAiAgentSession(projectId, sessionId)`                    | `GET /projects/:projectId/ai/agent-sessions/:sessionId`                    |
| `updateAiAgentSession(projectId, sessionId, input)`          | `PATCH /projects/:projectId/ai/agent-sessions/:sessionId`                  |
| `deleteAiAgentSession(projectId, sessionId)`                 | `DELETE /projects/:projectId/ai/agent-sessions/:sessionId`                 |
| `getAiAgentMessages(projectId, sessionId, input)`            | `GET /projects/:projectId/ai/agent-sessions/:sessionId/messages`           |
| `sendAiAgentPrompt(projectId, sessionId, input)`             | `POST /projects/:projectId/ai/agent-sessions/:sessionId/prompts`           |
| `interruptAiAgentSession(projectId, sessionId)`              | `POST /projects/:projectId/ai/agent-sessions/:sessionId/interrupt`         |
| `replyAiPermission(projectId, sessionId, requestId, input)`  | `POST /projects/:projectId/ai/agent-sessions/:sessionId/permissions/:id`   |
| `answerAiQuestion(projectId, sessionId, questionId, input)`  | `POST /projects/:projectId/ai/agent-sessions/:sessionId/questions/:id`     |
| `dismissAiQuestion(projectId, sessionId, questionId)`        | `DELETE /projects/:projectId/ai/agent-sessions/:sessionId/questions/:id`   |
| `streamAiAgentEvents(projectId, onEvent, options)`           | `GET /projects/:projectId/ai/agent-events` (SSE)                           |

Agent sessions run on the backend's embedded OpenCode V2 host. `AiAgentSession` returns the summary, recent messages (`getAiAgentMessages` pages older ones), and pending `permissions` and `questions` for the session and its subagents. `streamAiAgentEvents` delivers live activity for every session the caller owns in a project, including subagent children. Manual mode approvals are OpenCode permission replies (`once`, `always`, `reject`); `auto` is admin-only. See [`docs/ai-system.md`](../../docs/ai-system.md).

`listAiModels` lists the saved custom endpoint's advertised models and fills missing metadata from models.dev. `discoverAiModels` previews an unsaved endpoint using `{ baseUrl, apiKey? }`. A saved key is reused only for the same endpoint. `createAiAgentSession` and `updateAiAgentSession` accept `model`, `reasoningEffort` (`null` for default), and `serviceTier` (`standard` or `fast`); these choices belong to the session and do not overwrite the project model.

Agents use project doc, chapter, scene, character, and relationship tools to plan and write dynamically. Publishing methods include secure export create/list/download/regenerate/delete and import preview/apply. See [agentic writing](../../docs/agentic-writing.md).

Project docs are path-based through folders. `ProjectDoc.kind` is only metadata for filtering and AI behavior; use `folderId` to place docs in the tree. Assets appear in the tree only when they have a `folderId`.
