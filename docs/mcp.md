# External agents over MCP

OpenTales exposes each project as a remote [Model Context Protocol](https://modelcontextprotocol.io/) server. A project owner or admin creates a scoped bearer key in **Project Settings → External agents**, then connects Codex, Claude Code, or another Streamable HTTP client to:

```text
https://<frontend-origin>/mcp
```

Production frontend hosts proxy `/mcp` to the Express backend. The backend endpoint is also available directly at `<backend-origin>/mcp` when a deployment does not use the frontend proxy.

## Create a key

1. Open the project the agent should access.
2. Open **Project Settings → External agents**.
3. Choose **New key**, a private label, read-only or read/write access, and an expiry.
4. Copy the bearer secret and one of the generated setup commands. The secret is shown once.

Keys are permanently bound to the active project and its workspace. The agent never receives or selects a `projectId`. OpenTales stores a SHA-256 hash rather than the bearer secret, displays only its prefix later, and supports immediate revocation. A key also stops working when it expires, its project is deleted, or its creator is no longer a member of the workspace. Current membership permissions remain authoritative after issuance, so demoting the creator also reduces what the key can do.

Only project owners and admins can list, create, or revoke keys. Read/write is a capability ceiling, not a permission bypass: every tool still calls the existing use case and applies its normal `VIEWER`, `EDITOR`, `ADMIN`, or `OWNER` check.

## Connect Codex

The settings UI generates these commands with the real endpoint and one-time secret:

```bash
export OPENTALES_MCP_KEY='otmcp_...'
codex mcp add opentales \
  --url 'https://tale.yasui.io/mcp' \
  --bearer-token-env-var OPENTALES_MCP_KEY
```

For manual configuration, add this to `~/.codex/config.toml` or a trusted project's `.codex/config.toml`:

```toml
[mcp_servers.opentales]
url = "https://tale.yasui.io/mcp"
bearer_token_env_var = "OPENTALES_MCP_KEY"
default_tools_approval_mode = "writes"
```

`default_tools_approval_mode = "writes"` lets reads run normally and asks locally before a tool annotated as mutating is called. See the [official Codex MCP documentation](https://developers.openai.com/codex/extend/mcp) for all client options.

## Connect Claude Code

```bash
export OPENTALES_MCP_KEY='otmcp_...'
claude mcp add --transport http \
  --header "Authorization: Bearer ${OPENTALES_MCP_KEY}" \
  opentales 'https://tale.yasui.io/mcp'
```

A project-shareable `.mcp.json` can reference an environment variable without committing the secret:

```json
{
  "mcpServers": {
    "opentales": {
      "type": "http",
      "url": "https://tale.yasui.io/mcp",
      "headers": {
        "Authorization": "Bearer ${OPENTALES_MCP_KEY}"
      }
    }
  }
}
```

See the [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for local, project, and user configuration scopes.

## Connect Claude.ai

Hosted Claude uses OAuth rather than a fixed API-key header:

1. Add `https://opentales.hoodgail.me/mcp` as a custom connector.
2. Leave custom client ID and client secret empty. Claude dynamically registers itself.
3. OpenTales opens `/authorize`, where you sign in, select exactly one project, and approve read-only or read/write access.
4. Claude exchanges a one-time PKCE authorization code for a one-hour access token and rotating refresh token.

Never paste an `otmcp_...` key into Claude's OAuth client ID field. API keys identify a project credential; OAuth client IDs identify the connecting application. If a key appears in an authorization URL, revoke it immediately and recreate the connector without custom credentials.

OpenTales publishes RFC 9728 protected-resource metadata and RFC 8414 authorization-server metadata, supports Dynamic Client Registration, requires PKCE S256, validates exact redirect URIs, binds tokens to the canonical MCP resource, hashes codes/tokens at rest, and rechecks the user's live workspace membership on every MCP request. Removing the connector can revoke its token; expiry, project deletion, membership removal, and role demotion also reduce or remove access.

## Exposed capabilities

The server adapts the tool definitions in `packages/backend/src/useCases/ai/tools` directly, preserving their names, Zod input schemas, descriptions, pagination, bounded-read behavior, and use-case permission checks. Read/write keys receive every project-applicable tool. Read-only keys receive all read and diagnostic tools, with mutations removed from `tools/list`.

The following runtime-only capabilities are intentionally not remote workspace tools:

- `task` and `askUser` depend on an OpenTales-managed interactive agent session. External hosts already own delegation and user interaction, so the server exposes agent prompts instead.
- `applyBuildUnitPatch`, `compileBuildManuscript`, and `reportTaskResult` require a fenced durable-worker lease. Public agents use Novel Build creation, state, artifact, checkpoint, and monitoring tools while the backend worker owns persisted tasks.

Mutations called through a read/write key execute immediately on the server after any approval enforced by the MCP host. Tool annotations identify reads and destructive operations so compatible clients can apply local approval policy. The result must confirm a change before an agent claims it succeeded.

### Resources

| URI | Contents |
| --- | --- |
| `opentales://project` | Bound project and workspace metadata |
| `opentales://skills/{name}` | Full enabled built-in or project Agent Skill, including bundled references |
| `opentales://agents/{name}` | Built-in or project-defined agent prompt |
| `opentales://instructions/{id}` | Author-owned project `INSTRUCTIONS` document |

### Prompts

| Prompt | Purpose |
| --- | --- |
| `opentales_workspace` | Load project identity, author instructions, and the skill catalog for a task |
| `opentales_agent` | Apply one named built-in or project agent prompt |
| `opentales_skill` | Activate one full Agent Skill and its references for a task |

The MCP initialization response also includes concise server-wide guidance. It tells agents to treat manuscript and imported material as data, use lists/grep/bounded reads first, load matching skills progressively, resolve opaque IDs themselves, and leave persisted Novel Build tasks to the durable worker.

## HTTP and deployment behavior

The endpoint uses stateless Streamable HTTP and accepts MCP `POST`, `GET`, and protocol-defined methods at one path. Every request requires:

```http
Authorization: Bearer otmcp_...
Accept: application/json, text/event-stream
```

Native Codex and Claude Code clients normally omit `Origin`. When a browser sends it, the backend requires an exact origin from `MCP_ALLOWED_ORIGINS`, preventing cross-origin and DNS-rebinding-style access. Configure a comma-separated list in the backend environment:

```env
MCP_ALLOWED_ORIGINS="https://tale.yasui.io,https://opentales.hoodgail.me"
MCP_PUBLIC_URL="https://opentales.hoodgail.me/mcp"
MCP_OAUTH_ISSUER="https://opentales.hoodgail.me"
```

Tool text responses are capped at 100,000 characters by default. Oversized results return a valid structured preview with instructions to use pagination, filters, grep, or bounded reads. Operators can change the cap with `MCP_MAX_TOOL_RESPONSE_CHARS`.

Local development proxies `http://localhost:5173/mcp` to `http://localhost:4000/mcp`. The production Nginx image performs the same proxy to the backend service with response buffering disabled; `vercel.json` places the MCP rewrite before the SPA fallback.

## Key-management API

These JWT-authenticated editor routes back the settings UI:

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/projects/:projectId/mcp-api-keys` | List safe key metadata |
| `POST` | `/projects/:projectId/mcp-api-keys` | Create a key and return its secret once |
| `DELETE` | `/projects/:projectId/mcp-api-keys/:keyId` | Revoke a key immediately |

The TypeScript SDK exposes `listProjectMcpApiKeys`, `createProjectMcpApiKey`, and `revokeProjectMcpApiKey` for these routes.

OAuth discovery, registration, and token routes are public protocol endpoints at `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`, `/register`, `/token`, and `/revoke`. The authenticated consent UI calls `/oauth/authorize/context` and `/oauth/authorize` through the SDK.
