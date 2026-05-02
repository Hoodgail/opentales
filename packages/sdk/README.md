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
- `Character`
- `Location`
- `Chapter`
- `StoryStructure`
- `UpdateChapterInput`
- `UpdateCharacterInput`
- `UpdateLocationInput`
- `UpdateStructureInput`

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

Project docs are path-based through folders. `ProjectDoc.kind` is only metadata for filtering and AI behavior; use `folderId` to place docs in the tree. Assets appear in the tree only when they have a `folderId`.
