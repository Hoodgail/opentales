# AI system

OpenTales AI is an opt-in project assistant for manuscript-aware chat and dynamic writing through tools. Agents run on an embedded **[OpenCode V2](https://opencode.ai/v2/docs/build/sdk)** host inside the backend: OpenCode owns the agent loop, transcript, subagents, skills, questions, compaction, and permissions; OpenTales owns identity, project authorization, the project tools, and the approval experience. Manual mode asks the author before each project change; admin-only Auto mode executes permitted changes immediately.

## Main pieces

| Area                   | Location                                                                 | Responsibility                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| OpenCode runtime       | `packages/backend/src/useCases/ai/opencode/host.ts`                      | Starts one in-memory `@opencode/sdk` host, fans its event bus out per project, and bridges tool permission requests.  |
| Project workspace      | `packages/backend/src/useCases/ai/opencode/workspace.ts`                 | Generates each project's `.opencode/` config (provider, agents, skills, permission policy) from OpenTales data.       |
| OpenTales plugin       | `packages/backend/src/useCases/ai/opencode/plugin.ts`                    | Registers every OpenTales tool, injects provider credentials per request, and adds project context each turn.         |
| Provider mapping       | `packages/backend/src/useCases/ai/opencode/providers.ts`                 | Maps gateway, OpenAI-compatible, GitHub Copilot, and Codex settings onto OpenCode providers and credential transports. |
| Agent use case         | `packages/backend/src/useCases/ai/OpencodeAgentUseCase.ts`               | Sessions, prompts, interrupts, approvals, questions, and the project SSE stream, mapped to stable SDK types.          |
| Backend AI controller  | `packages/backend/src/controllers/AiController.ts`                       | Exposes settings, assistive endpoints, agent sessions, events, approvals, and questions.                             |
| SDK client             | `packages/sdk/src/client.ts`                                             | Typed calls for AI settings, assistive endpoints, agent sessions, and the agent event stream.                         |
| Frontend agent store   | `packages/frontend/src/lib/stores/agent.svelte.ts`                       | Sessions, per-session transcripts (including subagent children), live streaming, approvals, and questions.           |
| Agent panel            | `packages/frontend/src/lib/components/ide/AiAgentPanel.svelte`           | Transcript, subagent drill-in, approval slips, questions, composer with agent/model/mode, mentions, and attachments. |
| Approval diff UI       | `packages/frontend/src/lib/components/ide/AiApprovalEditor.svelte`       | Opens a proposed change as multi-pane Monaco diffs and approves or rejects it.                                       |

## Architecture

```text
AiAgentPanel ──SDK──▶ AiController ──▶ OpencodeAgentUseCase
                                          │
                                          ▼
                              OpencodeRuntime (@opencode/sdk, in-memory)
                                ├─ instance per project workspace
                                │    data/opencode/projects/<projectId>/.opencode/
                                │      opencode.json  (provider, agents, permissions)
                                │      skills/<name>/SKILL.md (+ references/)
                                ├─ opentales plugin: OpenTales tools, credential hook, context hook
                                └─ opencode.db (sessions, messages, events)
```

- **Isolation.** OpenCode's HOME and XDG roots are redirected to `OPENCODE_DATA_DIR/home` (default `./data/opencode`), so the host never reads the server operator's `~/.claude`, `~/.config/opencode`, MCP servers, or skills.
- **Per-project agents.** Each project has its own workspace directory and so its own OpenCode instance, agents, skills, provider, and plugin instance. The workspace holds configuration only; manuscript data is reached exclusively through OpenTales tools.
- **Tool surface.** Agents get the OpenTales tools (the same objects the MCP server exposes) plus OpenCode's `question`, `skill`, and `subagent` tools. OpenCode's shell, file, glob/grep, web, code-mode, and MCP tools are denied by the base permission policy.
- **Secrets.** Provider credentials are never written to the workspace. The config carries a placeholder key and the plugin's `http.request` hook attaches the decrypted project credential (or refreshed Codex token) to each outbound model request.

## Data model

`ProjectAiSettings` stores whether AI is enabled and how to reach the model provider. `ProjectAiSkill` stores project-scoped Agent Skills. Project docs use the versioned `Writing` system; docs with kind `INSTRUCTIONS` are injected into every agent turn as standing author guidance.

Agent sessions, messages, tool calls, subagent sessions, pending permissions, and questions are persisted by OpenCode in `opencode.db`. Each root session records `opentalesProjectId`, `opentalesUserId`, and `approvalMode` in its metadata; subagent sessions inherit ownership from their root. The legacy `ProjectAiAgentSession`/`AiAgent*` Prisma tables are no longer written.

## Provider configuration

AI must be enabled per project before calls can run. Settings are exposed through:

```ts
client.getProjectAiSettings(projectId);
client.updateProjectAiSettings(projectId, input);
client.startGithubCopilotAuth(projectId);
client.pollGithubCopilotAuth(projectId, input);
client.startCodexAuth(projectId);
client.pollCodexAuth(projectId, input);
```

Provider modes:

- `gateway`: Model strings such as `openai/gpt-5.4` through the Vercel AI Gateway (`AI_GATEWAY_BASE_URL`, default `https://ai-gateway.vercel.sh/v1`); `AI_GATEWAY_API_KEY` comes from backend environment configuration.
- `openai-compatible`: Any OpenAI-compatible endpoint with project-level `model`, optional `baseUrl` (a bare origin such as `https://strata.yasui.io` gets `/v1` appended), and optional encrypted project API key.
- `github-copilot`: Uses GitHub device authorization and the Copilot bearer-token transport.
- `codex`: Uses [OpenAI device authorization](https://learn.chatgpt.com/docs/auth#login-on-headless-devices) for ChatGPT subscription access. The backend encrypts the access token, refresh token, expiry, and ChatGPT account routing identifier, refreshes expiring sessions with one deduplicated refresh, and sends Responses API requests to the Codex backend with the required account and residency headers.

Codex models are derived from the cached models.dev OpenAI catalog and filtered through the subscription allow/deny policy documented in `CODEX.md`. They appear as `codex/<model-id>` in project settings, use the OpenAI Responses provider internally, and use the connected ChatGPT subscription. Public API-key OpenAI usage remains separately priced.

The backend does not return raw API keys or OAuth credentials. It returns whether a credential exists. Sending `apiKey: null` clears a stored key or connected provider session, while omitting `apiKey` leaves the existing credential unchanged. Codex tokens cannot be entered manually; reconnect through the device flow.

## Agent skills

Projects can define reusable Agent Skills from the AI settings UI. The frontend edits skill markdown with `MonacoMarkdownEditor`, using the live collaboration system for skill content so co-authors see remote edits and presence like other project documents.

Skill management uses:

```ts
client.listProjectAiSkills(projectId);
client.createProjectAiSkill(projectId, input);
client.updateProjectAiSkill(projectId, skillId, input);
client.deleteProjectAiSkill(projectId, skillId);
```

During agent runs, enabled skills follow progressive disclosure. The system prompt includes only name and description in an `<available_skills>` catalog. When a task matches a skill, the agent activates it with `readProjectAiSkill`, which returns the full skill content wrapped in `<skill_content name="...">` tags.

## External MCP agents

Project owners and admins can create revocable read-only or read/write credentials under **Project Settings → External agents**. Codex, Claude Code, and other Streamable HTTP clients connect to `${FRONTEND_ORIGIN}/mcp`; the key resolves one fixed project and the creator's live workspace role on every request.

Hosted clients such as ChatGPT, Gemini, and Claude.ai connect through OAuth 2.1 with Dynamic Client Registration and PKCE S256. The browser consent flow signs the user into OpenTales, lists only accessible projects, and mints short-lived access plus rotating refresh tokens for the selected project and access level. API keys remain available for local clients that can supply a Bearer header; they are never OAuth client IDs.

The MCP adapter registers the same tool objects used by interactive OpenTales agents, so names, Zod schemas, bounded reads, mutation use cases, and permission checks do not drift. Skills, agent prompts, and author instruction docs are also available through MCP resources and prompt templates. `task` and `askUser` remain internal because external hosts own orchestration and user interaction. Full setup and security behavior are documented in [`mcp.md`](mcp.md).

The external story-writing harness also exposes optimistic prose tools. `readChapter`, `readScene`, `readProjectDoc`, `readSubmission` return the current branch/head tokens. `updateChapter`, `updateScene`, `updateProjectDoc`, `updateSubmission` accept full replacement for empty bodies or exact-string edits. `applyStoryPatch` batches up to 50 canonical/proposal changes atomically with an idempotent receipt.

## Agents

The workspace defines these agents:

- `writer` (default, primary): the OpenTales writing assistant.
- `planner` (primary): read-only planning; project changes are denied.
- `explore` (subagent): fast read-only research over the manuscript.
- `general` (subagent): OpenCode's general-purpose worker for multi-step delegated work.
- Built-in craft runners from `useCases/ai/agents/*.md` and project agents from docs in the root `agents/` folder (frontmatter: `description`, `mode`, `model`, `hidden`, `runtimeRole`). Explorer and researcher roles are read-only.

OpenCode's coding agents (`build`, `plan`) are disabled. Agents delegate with OpenCode's `subagent` tool, which creates a child session the panel can open. Pending approvals and questions from subagents surface on the root session.

## Skills

Built-in skills from `useCases/ai/skills/*` and enabled project skills are written to `.opencode/skills/<name>/SKILL.md` (built-in reference files are copied alongside). OpenCode advertises them to the model and loads one on demand through its `skill` tool; the author can also attach skills to a prompt. The `opentales-tools` skill is the operating manual for the project tools; its `references/tool-reference.md` is generated from the live schemas with `pnpm exec tsx scripts/generate-opentales-tool-reference.ts`.

## Agent sessions

```ts
client.getAiAgentCapabilities(projectId); // agents, skills, tools, default model
client.listAiAgentSessions(projectId);
client.createAiAgentSession(projectId, { approvalMode, agent });
client.updateAiAgentSession(projectId, sessionId, { approvalMode, title, agent, model });
client.deleteAiAgentSession(projectId, sessionId);
client.getAiAgentSession(projectId, sessionId); // summary + recent messages + pending permissions/questions
client.getAiAgentMessages(projectId, sessionId, { cursor, limit });
client.sendAiAgentPrompt(projectId, sessionId, { text, delivery, agent, model, attachments, references, skills });
client.interruptAiAgentSession(projectId, sessionId);
client.replyAiPermission(projectId, sessionId, requestId, { decision: 'once' | 'always' | 'reject', message });
client.answerAiQuestion(projectId, sessionId, questionId, { answers });
client.dismissAiQuestion(projectId, sessionId, questionId);
client.streamAiAgentEvents(projectId, onEvent, { signal });
```

Messages are `user`, `assistant` (ordered `text`, `reasoning`, and `tool` parts), or `system` markers (skill activation, compaction, agent/model switches). A `subagent` tool part carries `childSessionId`.

**Delivery.** `steer` (default) delivers a prompt at the next model step, redirecting an active run; `queue` waits for the current run to finish. The panel steers with ↵ and queues with ⌥↵ while the agent is running.

**Streaming.** One authenticated SSE stream per project carries activity for every session the caller owns, including subagent children: `connected`, `session.updated`, `message.updated`, `text.delta`, `reasoning.delta`, `tool.updated`, `permission.asked/replied`, `question.asked/closed`, `status`, and `usage`. The client reconnects with jittered backoff and resynchronizes the open session after reconnecting. Restarting the backend ends live streams; OpenCode persists transcripts, and an interrupted run can be resumed with a new prompt.

## Execution modes and approvals

Execution mode is stored on the root session and can change only while it is idle. `auto` requires project-admin permission.

- **Manual.** Every OpenTales tool that changes project data raises an OpenCode permission request (`action: opentales.write`, `resources: [toolName]`) carrying the proposed input. The tool call waits until the author decides. `once` approves this call, `always` saves an allow rule for that tool in the session, and `reject` returns an error to the model so nothing changes. Questions are available.
- **Auto.** Changes run immediately; the `question` tool is denied so runs never stall.

Capability, project permission (`project:write` for changes), scope, validation, optimistic-concurrency, and idempotency checks inside each tool apply in both modes. Replying to a permission requires `project:write`.

The panel shows pending changes as approval slips. **Review diff** builds a multi-pane Monaco diff (chapter details/summary/manuscript, character fields, document body, or raw input) and opens it in `AiApprovalEditor.svelte`. After a run finishes, the manuscript reloads so approved changes appear immediately.

## Questions

When the agent needs a decision it calls OpenCode's `question` tool. The question is rendered inline as a form with options and a custom answer; answers are keyed by field and returned to the model as the tool result. Dismissing cancels the question.

## Project context

Every turn receives the `writer` system prompt, the project metadata, up to five `INSTRUCTIONS` docs (bounded), and the current execution mode. `@` mentions add a machine-readable list of referenced items (type, id, path, line range) which the agent reads with its tools. File attachments are sent inline to the model.

Manuscript, attachments, imported research, and web material are untrusted data rather than prompt authority.

## Assistive one-shot endpoints

Some AI features are not chat-session tools. They are direct request/response endpoints used by editor flows. They run as short-lived, tool-less OpenCode sessions (`opencode/generate.ts`) against the same provider and credentials, and validate the JSON result with zod.

Continuity review posts an AI review activity onto a submission:

```ts
client.runContinuityReview(projectId, submissionId);
```

Rewrite suggestions return an original/suggested pair and rationale. Accepting a rewrite is a frontend editor action, not an AI persistence action:

```ts
client.createRewriteSuggestion(projectId, { text, mode, context });
```

Character dialogue returns suggested dialogue lines for a character and situation:

```ts
client.createCharacterDialogueSuggestion(projectId, {
  characterId,
  situation,
  count,
});
```

Outline expansion returns AI-draft outline text that should be previewed before users accept it:

```ts
client.createOutlineExpansion(projectId, {
  synopsis,
  targetLength,
  povCharacterId,
  locationId,
});
```

## Error handling

Model failures end the run with `status: error`; the panel shows a friendly message (for example, authentication failures point to AI settings) and the assistant message records the provider error. Provider retries surface as `status: retrying` with the attempt number. Tool errors, including rejected approvals and stale version tokens, are returned to the model as tool results so it can recover.

## Security and safety rules

- AI is disabled by default per project.
- Provider API keys are encrypted and never returned raw.
- Codex refreshable OAuth sessions are encrypted at rest, never returned raw, and refreshed only through the fixed OpenAI token endpoint.
- Read tools only expose project data after authenticated project access checks.
- Mutating tools require explicit project write permission.
- The frontend must never execute AI mutations directly. It should always call the approval endpoint.
- Model output should be treated as untrusted content even when rendered as markdown.
- Manuscript, attachments, imported research, and web material are serialized as untrusted data rather than prompt authority.

## Operational notes

```env
OPENCODE_DATA_DIR=./data/opencode   # workspaces, isolated home, opencode.db
AI_GATEWAY_API_KEY="..."            # gateway provider only
AI_GATEWAY_BASE_URL="..."           # optional gateway override
```

`OPENCODE_DATA_DIR` must be persistent storage in production (it holds session history). Workspaces are regenerated from the database whenever settings, agents, or skills change; they can be deleted safely.

Run the live harness test against a real model with:

```sh
OPENCODE_LIVE_DATABASE_URL=postgresql://… OPENCODE_LIVE_BASE_URL=https://strata.yasui.io \
OPENCODE_LIVE_API_KEY=… OPENCODE_LIVE_MODEL=gpt-6-luna \
pnpm --dir packages/backend vitest run src/useCases/ai/OpencodeAgentUseCase.live.test.ts
```

See [agentic writing](agentic-writing.md) for the document-based workflow.
