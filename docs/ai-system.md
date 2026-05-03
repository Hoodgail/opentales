# AI system

OpenTales AI is an opt-in project assistant for manuscript-aware chat, controlled rewrites, continuity review, dialogue generation, outline expansion, and approval-gated project edits. The system is designed around one rule: model output may propose changes, but user approval is required before mutating manuscript data.

## Main pieces

| Area | Location | Responsibility |
| --- | --- | --- |
| Backend AI controller | `packages/backend/src/controllers/AiController.ts` | Exposes settings, assistive endpoints, agent sessions, SSE, prompts, cancellation, and approval routes. |
| Agent session use case | `packages/backend/src/useCases/ai/AiAgentSessionUseCase.ts` | Persists chat state, queues prompts, streams model output, records tool calls, and executes approved mutations. |
| AI settings use case | `packages/backend/src/useCases/ai/ProjectAiSettingsUseCase.ts` | Stores project-level provider configuration and encrypted BYOK API keys. |
| SDK client | `packages/sdk/src/client.ts` | Provides typed frontend calls for AI settings, assistive endpoints, agent sessions, streams, and approvals. |
| Frontend AI store | `packages/frontend/src/lib/stores/ai.svelte.ts` | Holds settings, docs, active session, session list, stream state, generated feature results, and errors. |
| Agent panel | `packages/frontend/src/lib/components/ide/AiAgentPanel.svelte` | Renders chat, session switching, queued prompts, pending approvals, and prompt input. |
| Approval diff UI | `packages/frontend/src/lib/components/ide/AiApprovalEditor.svelte` | Opens proposed mutations as multi-pane Monaco diffs before approval. |

## Data model

The AI data model lives in `packages/backend/prisma/schema.prisma`.

`ProjectAiSettings` stores whether AI is enabled and how to reach the model provider.

`ProjectAiSkill` stores project-scoped Agent Skills. Each skill has a unique `name`, `description`, full markdown `content`, and an `enabled` flag. Enabled skills are disclosed to the agent as a compact catalog and loaded on demand through read-only tools.

`ProjectAiAgentSession` stores each chat session for a project. A project can have multiple sessions. Each session has a title, status, active prompt, messages, queued prompts, and tool calls.

`AiAgentMessage` stores persisted transcript messages with roles: `USER`, `ASSISTANT`, `SYSTEM`, and `TOOL`.

`AiAgentPrompt` stores queued or running user prompts. Prompts can be queued normally or inserted ahead of the queue by interrupting the active run.

`AiAgentToolCall` stores model tool calls, including approval-required mutations. Tool calls move through statuses such as `PENDING_APPROVAL`, `EXECUTED`, `REJECTED`, and `ERROR`.

Project docs are separate from chat state. `ProjectDoc` uses the versioned `Writing` system and can be read by the agent. Docs are organized by path-based folders; `kind` is metadata for filtering and internal behavior, not hierarchy. Docs with kind `INSTRUCTIONS` are automatically injected into the agent prompt as standing project guidance regardless of their folder.

## Provider configuration

AI must be enabled per project before calls can run. Settings are exposed through:

```ts
client.getProjectAiSettings(projectId)
client.updateProjectAiSettings(projectId, input)
```

Provider modes:

- `gateway`: Uses AI SDK model strings such as `openai/gpt-5.4`; credentials come from backend environment configuration.
- `openai-compatible`: Uses `@ai-sdk/openai-compatible` with project-level `model`, optional `baseUrl`, and optional encrypted project API key.

The backend does not return raw API keys. It returns whether a key exists. Sending `apiKey: null` clears a stored key, while omitting `apiKey` leaves the existing key unchanged.

## Agent skills

Projects can define reusable Agent Skills from the AI settings UI. The frontend edits skill markdown with `MonacoMarkdownEditor`, using the live collaboration system for skill content so co-authors see remote edits and presence like other project documents.

Skill management uses:

```ts
client.listProjectAiSkills(projectId)
client.createProjectAiSkill(projectId, input)
client.updateProjectAiSkill(projectId, skillId, input)
client.deleteProjectAiSkill(projectId, skillId)
```

During agent runs, enabled skills follow progressive disclosure. The system prompt includes only name and description in an `<available_skills>` catalog. When a task matches a skill, the agent activates it with `readProjectAiSkill`, which returns the full skill content wrapped in `<skill_content name="...">` tags.

## Agent sessions

The agent panel supports multiple chat sessions per project. The frontend loads the session list and the active session through the SDK:

```ts
client.listAiAgentSessions(projectId)
client.createAiAgentSession(projectId, { title })
client.getAiAgentSession(projectId, sessionId)
client.queueAiAgentPrompt(projectId, { prompt, interrupt }, sessionId)
client.cancelAiAgentSession(projectId, sessionId)
```

Each session has its own SSE stream:

```ts
await client.streamAiAgentSession(projectId, sessionId, (event) => {
  // event.session is a full session snapshot
}, { signal })
```

The stream is authenticated with `fetch` so the SDK can send the bearer token. The backend also keeps runtime stream state in memory per session, while durable transcript and tool-call state live in the database.

## Prompt lifecycle

When a user sends a prompt, the backend creates an `AiAgentPrompt` row and broadcasts a `prompt-queued` event. The session drain loop picks queued prompts one at a time.

For a running prompt, the backend:

1. Marks the prompt `RUNNING`.
2. Adds the user message to the transcript.
3. Creates an empty assistant message.
4. Calls the model with project context and tool definitions.
5. Streams text deltas into the assistant message and broadcasts `text-delta` events.
6. Persists tool calls and tool results as they arrive.
7. Marks the prompt `COMPLETED`, `CANCELLED`, or `ERROR`.

`interrupt: true` aborts the active generation, marks queued/running prompts cancelled for that session, and puts the new prompt at the front of the queue.

## Project context

The agent prompt includes high-level project metadata, recent session messages, and up to a few instruction docs. The model can then inspect specific project data using read-only tools.

Read-only tools include:

- `listCharacters`
- `readCharacter`
- `listChapters`
- `readChapter`
- `grepChapter`
- `grepChapters`
- `listLocations`
- `readLocation`
- `listProjectDocs`
- `readProjectDoc`
- `listProjectFiles`
- `readFolder`
- `listAssets`
- `readAssetMetadata`
- `readAssetContent`
- `readStoryStructure`
- `listProjectAiSkills`
- `readProjectAiSkill`

The prompt tells the model to prefer summaries, grep, bounded reads, and lists before requesting full chapter text. This keeps the agent useful without loading the whole manuscript by default.

## Approval-gated mutations

Mutating tools do not directly edit the project during model generation. They create pending tool calls that the frontend must approve or reject.

Approval-required tools include:

- `createCharacter`
- `updateCharacter`
- `createChapter`
- `updateChapter`
- `createProjectDoc`
- `updateProjectDoc`
- `createFolder`
- `updateFolder`
- `deleteFolder`
- `updateAsset`

Folder and path mutations are approval-gated. A parent folder cannot contain duplicate child names across folders, docs, and foldered assets. Root docs and root folders appear in the file tree; root assets remain outside the tree unless moved into a folder.

The frontend renders pending calls in `AiAgentPanel.svelte`. Opening a pending call creates an in-memory approval document and opens `AiApprovalEditor.svelte`, which renders separate Monaco diff panes for fields such as chapter metadata, summary, manuscript content, character basics, character description, and document body.

Approval uses:

```ts
client.approveAiToolCall(projectId, toolCallId, { approved: true }, sessionId)
client.approveAiToolCall(projectId, toolCallId, { approved: false }, sessionId)
```

If approved, the backend executes the corresponding existing project use case. For example, `createChapter` runs `CreateChapterUseCase`, and `updateChapter` runs `UpdateChapterUseCase`. If rejected, the tool call is marked rejected and no project data changes.

After approval, the frontend reloads the manuscript project so newly created or updated chapters, characters, and docs are visible immediately.

## Assistive one-shot endpoints

Some AI features are not chat-session tools. They are direct request/response endpoints used by editor flows.

Continuity review posts an AI review activity onto a submission:

```ts
client.runContinuityReview(projectId, submissionId)
```

Rewrite suggestions return an original/suggested pair and rationale. Accepting a rewrite is a frontend editor action, not an AI persistence action:

```ts
client.createRewriteSuggestion(projectId, { text, mode, context })
```

Character dialogue returns suggested dialogue lines for a character and situation:

```ts
client.createCharacterDialogueSuggestion(projectId, { characterId, situation, count })
```

Outline expansion returns AI-draft outline text that should be previewed before users accept it:

```ts
client.createOutlineExpansion(projectId, { synopsis, targetLength, povCharacterId, locationId })
```

## Error handling

Model-call errors are persisted into the session status and broadcast as `error` events.

Approval execution errors are recorded on the `AiAgentToolCall` and surfaced as API errors so the frontend does not silently close an approval. This is important because approved mutations still run through normal project validation, including chapter title requirements, foreign-key ownership checks, and deleted-chapter checks.

The frontend displays `ai.sessionError` below the transcript. Approval diff tabs stay open when approval fails so users can inspect the failed proposal.

## Security and safety rules

- AI is disabled by default per project.
- Provider API keys are encrypted and never returned raw.
- Read tools only expose project data after authenticated project access checks.
- Mutating tools require explicit project write permission.
- The frontend must never execute AI mutations directly. It should always call the approval endpoint.
- Model output should be treated as untrusted content even when rendered as markdown.

## Operational notes

The backend Docker image should run Prisma migrations before starting the server:

```sh
pnpm exec prisma migrate deploy && node dist/src/server.js
```

Because session streaming runtime state is in memory, restarting the backend disconnects active SSE streams and abort controllers. Persisted messages, prompts, tool calls, and session status remain in the database and can be reloaded by the frontend.

For local gateway development, set backend provider credentials such as:

```env
AI_GATEWAY_API_KEY="..."
```

OpenAI-compatible mode can use project-level BYOK, or a compatible provider that does not require a per-project key.
