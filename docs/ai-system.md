# AI system

OpenTales AI is an opt-in project assistant for manuscript-aware chat and a durable Novel Build runtime. Interactive sessions retain approval-gated mutations. Novel Builds use separately authorized, fenced sandbox branches and still require explicit owner review before main changes.

## Main pieces

| Area | Location | Responsibility |
| --- | --- | --- |
| Backend AI controller | `packages/backend/src/controllers/AiController.ts` | Exposes settings, assistive endpoints, agent sessions, SSE, prompts, cancellation, and approval routes. |
| Agent session use case | `packages/backend/src/useCases/ai/AiAgentSessionUseCase.ts` | Persists chat state, queues prompts, streams model output, records tool calls, and executes approved mutations. |
| AI settings use case | `packages/backend/src/useCases/ai/ProjectAiSettingsUseCase.ts` | Stores project-level provider configuration, encrypted credentials, and provider authorization state. |
| SDK client | `packages/sdk/src/client.ts` | Provides typed frontend calls for AI settings, assistive endpoints, agent sessions, streams, and approvals. |
| Frontend AI store | `packages/frontend/src/lib/stores/ai.svelte.ts` | Holds settings, docs, active session, session list, stream state, generated feature results, and errors. |
| Agent panel | `packages/frontend/src/lib/components/ide/AiAgentPanel.svelte` | Renders chat, session switching, queued prompts, pending approvals, and prompt input. |
| Approval diff UI | `packages/frontend/src/lib/components/ide/AiApprovalEditor.svelte` | Opens proposed mutations as multi-pane Monaco diffs before approval. |
| Novel Build worker | `packages/backend/src/useCases/ai/workflow/NovelBuildWorker.ts` | Claims persisted tasks, assembles context, invokes scoped agents, validates outputs, records traces/evals, and resumes after interruption. |
| Context assembler | `packages/backend/src/useCases/ai/context/ContextAssembler.ts` | Builds token-budgeted, branch-aware and time-aware context packs. |
| Build/story services | `packages/backend/src/useCases/novelBuild/` | Durable workflow, sandbox manuscript, canon/state, diagnostics, compilation, and human review. |

## Data model

The AI data model lives in `packages/backend/prisma/schema.prisma`.

`ProjectAiSettings` stores whether AI is enabled and how to reach the model provider.

`ProjectAiSkill` stores project-scoped Agent Skills. Each skill has a unique `name`, `description`, full markdown `content`, and an `enabled` flag. Enabled skills are disclosed to the agent as a compact catalog and loaded on demand through read-only tools.

`ProjectAiAgentSession` stores each chat session for a project. A project can have multiple sessions. Each session has a title, status, `MANUAL`/`AUTO` execution mode, active prompt, messages, queued prompts, tool calls, an optional active `BuildRun`, and an atomic counter for ordered session parts.

`AiAgentMessage` stores persisted transcript messages with roles: `USER`, `ASSISTANT`, `SYSTEM`, and `TOOL`.

`AiAgentPrompt` stores queued or running user prompts. Prompts can be queued normally or inserted ahead of the queue by interrupting the active run.

`AiAgentToolCall` stores model tool calls, including approval-required mutations. Immediate tools remain `RUNNING` until their output is persisted; approval-gated tools move through `PENDING_APPROVAL`/`APPROVED` before `EXECUTED`, `REJECTED`, or `ERROR`.

`AiAgentSessionPart` is the durable ordered execution trace for a chat session. Its atomic per-session sequence preserves contiguous assistant text, tool calls, tool results, and subtask start/finish activity in their original order. `AiAgentMessage` and `AiAgentToolCall` remain compatibility projections and canonical detail records; they are not used to reconstruct new-stream chronology from timestamps. `timelineInfo.mode` is `exact` for fully sequenced history, `approximate` for legacy timestamp projections, and `mixed` when both appear. It also reports server-side truncation and whether older parts exist.

Project docs are separate from chat state. `ProjectDoc` uses the versioned `Writing` system and can be read by the agent. Docs are organized by path-based folders; `kind` is metadata for filtering and internal behavior, not hierarchy. Docs with kind `INSTRUCTIONS` are automatically injected into the agent prompt as standing project guidance regardless of their folder.

## Provider configuration

AI must be enabled per project before calls can run. Settings are exposed through:

```ts
client.getProjectAiSettings(projectId)
client.updateProjectAiSettings(projectId, input)
client.startGithubCopilotAuth(projectId)
client.pollGithubCopilotAuth(projectId, input)
client.startCodexAuth(projectId)
client.pollCodexAuth(projectId, input)
```

Provider modes:

- `gateway`: Uses AI SDK model strings such as `openai/gpt-5.4`; credentials come from backend environment configuration.
- `openai-compatible`: Uses `@ai-sdk/openai-compatible` with project-level `model`, optional `baseUrl`, and optional encrypted project API key.
- `github-copilot`: Uses GitHub device authorization and the Copilot bearer-token transport.
- `codex`: Uses [OpenAI device authorization](https://learn.chatgpt.com/docs/auth#login-on-headless-devices) for ChatGPT subscription access. The backend encrypts the access token, refresh token, expiry, and ChatGPT account routing identifier, refreshes expiring sessions with one deduplicated refresh, and sends Responses API requests to the Codex backend with the required account and residency headers.

Codex models are derived from the cached models.dev OpenAI catalog and filtered through the subscription allow/deny policy documented in `CODEX.md`. They appear as `codex/<model-id>` in project settings, use the OpenAI Responses provider internally, and are costed at zero for Novel Build reservations because usage is covered by the connected ChatGPT subscription. Public API-key OpenAI usage remains separately priced.

The backend does not return raw API keys or OAuth credentials. It returns whether a credential exists. Sending `apiKey: null` clears a stored key or connected provider session, while omitting `apiKey` leaves the existing credential unchanged. Codex tokens cannot be entered manually; reconnect through the device flow.

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
client.createAiAgentSession(projectId, { title, buildRunId, approvalMode })
client.updateAiAgentSession(projectId, sessionId, { approvalMode })
client.getAiAgentSession(projectId, sessionId)
client.queueAiAgentPrompt(projectId, { prompt, interrupt, buildRunId }, sessionId)
client.cancelAiAgentSession(projectId, sessionId)
```

Execution mode is durable per session and is captured into every queued prompt:

- `manual` is the default. Project-changing tools pause as pending proposals, and `askUser` is available for genuine author decisions.
- `auto` requires project-admin permission. Available in-scope tools execute immediately, `askUser` is removed from the model toolset, and delegated subagent sessions inherit Auto mode. Tool capability, permission, scope, validation, idempotency, and database safety checks still apply.

The mode cannot change while a prompt is running or queued. Switching to Auto therefore never silently approves an already-pending proposal or changes the authority of queued work.

Each session has its own SSE stream:

```ts
await client.streamAiAgentSession(projectId, sessionId, (event) => {
  // event.session is a full session snapshot
}, { signal })
```

The stream is authenticated with `fetch` so the SDK can send the bearer token. SSE is only the live transport: lifecycle boundaries carry a full bounded session snapshot, while high-frequency `text-delta` events omit `session` and carry an incremental stable part patch. Reloads and reconnects render `session.timeline`, whose sequenced parts live in PostgreSQL. New subscribers are registered in buffered mode before their initial snapshot is read, preventing a newer delta from being overwritten by a late initial snapshot. Heartbeats and response-backpressure buffering keep long-lived connections observable and ordered.

Older durable activity is cursor-paged without loading the whole trace:

```ts
client.getAiAgentTimeline(projectId, { beforeSequence, limit }, sessionId)
```

The response returns ordered `parts`, `nextBeforeSequence`, `nextLegacyCursor`, and `hasMore`. Durable pages use the numeric sequence cursor. Pre-sequencing sessions return `limitation: 'legacy-history-best-effort'` and an opaque timestamp/ID cursor carrying its sequence anchor, so each older page remains globally ordered even when the caller sends only that cursor. Historic text/tool boundaries still cannot be recovered exactly.

Chat streaming remains an interactive transport. Novel Build execution does not depend on an SSE connection: task leases, traces, artifacts, checkpoints, and recovery state live in PostgreSQL.

## Prompt lifecycle

When a user sends a prompt, the backend creates an `AiAgentPrompt` row and broadcasts a `prompt-queued` event. The session drain loop picks queued prompts one at a time.

Each session has one in-process drain promise, and starting a prompt also uses a database compare-and-set over both the session and queued prompt. Concurrent submissions therefore cannot start the same prompt twice or run two model turns for one session.

For a running prompt, the backend:

1. Marks the prompt `RUNNING`.
2. Adds the user message to the transcript.
3. Creates an empty assistant message.
4. Calls the model with project context and tool definitions.
5. Buffers model tokens and coalesces contiguous deltas into one durable `text` part while continuing to update the compatibility assistant message at bounded intervals.
6. Closes that text part at every tool boundary, appends deduplicated `tool-call` and `tool-result` parts, and starts a new text part when prose resumes.
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
- `listBuildRuns`
- `getBuildState`

The prompt tells the model to prefer summaries, grep, bounded reads, and lists before requesting full chapter text. This keeps the agent useful without loading the whole manuscript by default.

## Agent questions

When the agent genuinely needs clarification, it can call `askUser` with one or more questions, concise answer options, and optional recommended choices. The call is persisted as a pending tool call, streamed to `AiAgentPanel.svelte`, and the model run waits until the user submits answers or dismisses the question.

The frontend renders each question with selectable choices plus a custom-answer field by default. Submitted answers are posted through:

```ts
client.answerAiQuestion(projectId, toolCallId, { answers }, sessionId)
```

Answers resolve the waiting tool call and are returned to the model as tool output so it can continue the same turn with the user's response in mind.

## Subagents

Primary agent runs can call the `task` tool to delegate focused work to a subagent. The tool creates or resumes a regular AI agent session, persists and broadcasts `subtask-started`/`subtask-finished` lifecycle parts on the parent timeline, and returns a `task_id` plus the final `<task_result>` text so the primary agent can continue with the result. This `task_id` is the child AI session ID, not a `BuildRun.id`.

An explicitly supplied session/prompt `buildRunId` is project-scoped and validated. Otherwise the session retains its active run or infers the most recent runnable build. Delegated task contracts resolve the current parent binding at invocation time and inherit that ID in `scope.buildRunId`, including a build created earlier in the same turn. Agents use the bounded-summary `listBuildRuns` tool instead of asking authors for opaque IDs; when no build exists, `startNovelBuild` defaults to Plan & Review, proposes creation through the normal approval gate, and binds the returned run to the session after approval.

Built-in subagents:

- `general` — general-purpose research and multi-step work.
- `explore` — fast project exploration using read-oriented tools.

Project-specific subagents can be defined as ProjectDocs whose path is under `agent/` or `agents/` and ends in `.md`, for example `agents/reviewer.md`. The markdown body becomes the subagent instructions. Optional frontmatter supports `description`, `mode`, `model`, `hidden`, and `name`.

```markdown
---
description: Reviews manuscript continuity and character consistency
mode: subagent
model: openai/gpt-5-mini
---
You are a continuity reviewer. Focus on contradictions, timeline drift, and character voice.
```

## Execution modes and mutations

In Manual mode, mutating tools create pending tool calls that the frontend must approve or reject. In Auto mode, the same tools execute immediately inside their existing capability and authorization boundaries and still persist their call/result lifecycle in the ordered session timeline.

Tools that require approval in Manual mode include:

- `askUser`
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
- `startNovelBuild`

Folder and path mutations follow the active execution mode. A parent folder cannot contain duplicate child names across folders, docs, and foldered assets. Root docs and root folders appear in the file tree; root assets remain outside the tree unless moved into a folder.

The frontend renders pending calls in `AiAgentPanel.svelte`. Opening a pending call creates an in-memory approval document and opens `AiApprovalEditor.svelte`, which renders separate Monaco diff panes for fields such as chapter metadata, summary, manuscript content, character basics, character description, and document body.

Approval uses:

```ts
client.approveAiToolCall(projectId, toolCallId, { approved: true }, sessionId)
client.approveAiToolCall(projectId, toolCallId, { approved: false }, sessionId)
```

If approved, the backend executes the corresponding existing project use case. For example, `createChapter` runs `CreateChapterUseCase`, and `updateChapter` runs `UpdateChapterUseCase`. Approval/rejection uses a database compare-and-set, so concurrent decisions cannot execute one call twice. If the backend restarted after approval, receipt/idempotency-backed build mutations can replay safely; unsafe CRUD is moved to an actionable error instead of being guessed or left wedged. If rejected, the tool call is marked rejected and no project data changes.

Session snapshots—including `pendingToolCalls`—bound tool inputs and outputs to small previews and report `inputTruncated`/`inputBytes` and `outputTruncated`/`outputBytes`; the full JSON remains in PostgreSQL and is available with `client.getAiAgentToolCall(projectId, toolCallId, sessionId)`. Approval UIs fetch that scoped detail before opening a truncated proposal. Parent task parts similarly bound large child results and retain the child session ID for full inspection. This prevents multi-megabyte values from being resent with every later lifecycle event.

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
- Codex refreshable OAuth sessions are encrypted at rest, never returned raw, and refreshed only through the fixed OpenAI token endpoint.
- Read tools only expose project data after authenticated project access checks.
- Mutating tools require explicit project write permission.
- The frontend must never execute AI mutations directly. It should always call the approval endpoint.
- Model output should be treated as untrusted content even when rendered as markdown.
- Manuscript, attachments, imported research, and web material are serialized as untrusted data rather than prompt authority.
- Durable task writes require the exact build/task/worker/lease generation and declared artifact, chapter, or scene scope.
- Build workers do not receive canonical chapter/scene mutation tools. Generated prose stays on build-bound writing branches until owner merge.
- Cost-bounded runs fail closed when model pricing is unknown; task duration/token/tool limits are enforced and accounted on failures.

## Operational notes

The backend Docker image should run Prisma migrations before starting the server:

```sh
pnpm exec prisma migrate deploy && node dist/src/server.js
```

Because connection/runtime handles are in memory, restarting the backend disconnects active SSE streams and abort controllers. Persisted messages, prompts, tool calls, ordered timeline parts, task lifecycle, active build binding, and session status remain in the database and can be reloaded by the frontend. The interactive model invocation itself is not resumable: a stale `RUNNING` prompt is finalized as an actionable error before new queued work proceeds, and fallback approval/question actions likewise finalize the orphaned turn. The Novel Build worker remains the durable execution mechanism for long-running work.

Novel Build workers are started by `server.ts` unless `NODE_ENV=test` or `AI_NOVEL_BUILD_WORKER_ENABLED=false`. On startup they recover expired leases and interrupted persisted traces. Configure model routing with `AI_MODEL_ROUTING_JSON`. Pricing is refreshed into a non-persistent TTL cache from models.dev; `AI_MODEL_PRICING_JSON` is an optional explicit override. See [`novel-build.md`](novel-build.md).

For local gateway development, set backend provider credentials such as:

```env
AI_GATEWAY_API_KEY="..."
```

OpenAI-compatible mode can use project-level BYOK, or a compatible provider that does not require a per-project key.
