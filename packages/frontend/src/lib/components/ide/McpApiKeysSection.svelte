<script lang="ts">
  import { Check, Copy, KeyRound, Plus, Terminal, Trash2, X } from 'lucide-svelte';
  import type {
    CreateProjectMcpApiKeyResult,
    ProjectMcpApiKey,
    ProjectMcpApiKeyPermission,
    Role
  } from '@opentales/sdk';
  import { manuscript } from '$lib/stores/manuscript.svelte';

  let keys = $state<ProjectMcpApiKey[]>([]);
  let loading = $state(false);
  let creating = $state(false);
  let formOpen = $state(false);
  let name = $state('My writing agent');
  let permission = $state<ProjectMcpApiKeyPermission>('read-write');
  let expiresInDays = $state(90);
  let created = $state<CreateProjectMcpApiKeyResult | null>(null);
  let copied = $state<string | null>(null);
  let error = $state<string | null>(null);
  let loadedContext = $state<string | null>(null);
  let roleRequestProjectId = $state<string | null>(null);

  $effect(() => {
    const projectId = manuscript.projectId;
    const role = manuscript.currentUserRole;
    if (projectId && role === null && roleRequestProjectId !== projectId) {
      roleRequestProjectId = projectId;
      void manuscript.loadMembers();
      return;
    }
    const context = projectId ? `${projectId}:${role ?? 'unknown'}` : null;
    if (context === loadedContext) return;
    loadedContext = context;
    created = null;
    error = null;
    if (projectId && canManageRole(role)) void load(projectId);
    else keys = [];
  });

  function canManageRole(role: Role | null): boolean {
    return role === 'OWNER' || role === 'ADMIN';
  }

  function canManage(): boolean {
    return canManageRole(manuscript.currentUserRole);
  }

  async function load(projectId = manuscript.projectId) {
    if (!projectId || !canManage()) return;
    loading = true;
    error = null;
    try {
      keys = await manuscript.listProjectMcpApiKeys();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to load MCP API keys';
    } finally {
      loading = false;
    }
  }

  async function submit(event: Event) {
    event.preventDefault();
    if (!manuscript.projectId || creating) return;
    creating = true;
    error = null;
    try {
      const result = await manuscript.createProjectMcpApiKey({
        name: name.trim(),
        permission,
        expiresAt: expiresInDays > 0
          ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : null
      });
      if (!result) {
        error = manuscript.error ?? 'Failed to create MCP API key';
        return;
      }
      created = result;
      keys = [result.key, ...keys];
      formOpen = false;
      name = 'My writing agent';
    } finally {
      creating = false;
    }
  }

  async function revoke(key: ProjectMcpApiKey) {
    if (typeof window !== 'undefined' && !window.confirm(`Revoke “${key.name}”? Connected agents will stop working immediately.`)) return;
    error = null;
    const revoked = await manuscript.revokeProjectMcpApiKey(key.id);
    if (!revoked) {
      error = manuscript.error ?? 'Failed to revoke MCP API key';
      return;
    }
    keys = keys.map((candidate) => candidate.id === revoked.id ? revoked : candidate);
    if (created?.key.id === revoked.id) created = null;
  }

  async function copy(value: string, label: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    copied = label;
    setTimeout(() => {
      if (copied === label) copied = null;
    }, 1600);
  }

  function mcpEndpoint(): string {
    if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
      return `${window.location.origin}/mcp`;
    }
    const apiBase = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    return `${apiBase}/mcp`;
  }

  function codexCommand(secret: string): string {
    return [
      `export OPENTALES_MCP_KEY='${secret}'`,
      `codex mcp add opentales --url '${mcpEndpoint()}' --bearer-token-env-var OPENTALES_MCP_KEY`
    ].join('\n');
  }

  function claudeCommand(secret: string): string {
    return [
      `export OPENTALES_MCP_KEY='${secret}'`,
      `claude mcp add --transport http --header "Authorization: Bearer \${OPENTALES_MCP_KEY}" opentales '${mcpEndpoint()}'`
    ].join('\n');
  }

  function isActive(key: ProjectMcpApiKey): boolean {
    return !key.revokedAt && (!key.expiresAt || new Date(key.expiresAt).getTime() > Date.now());
  }

  function status(key: ProjectMcpApiKey): string {
    if (key.revokedAt) return 'Revoked';
    if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return 'Expired';
    return 'Active';
  }

  function dateLabel(value: string | null): string {
    return value ? new Date(value).toLocaleDateString() : 'Never';
  }
</script>

<div class="space-y-3 text-xs">
  <div>
    <p class="text-[11px] leading-relaxed text-muted-foreground">
      Connect Codex, Claude Code, hosted Claude, or another MCP client directly to this project.
      The endpoint loads the project tools, Agent Skills, author instructions, and agent prompts.
    </p>
    <div class="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-muted/40 p-1.5">
      <code class="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
        {mcpEndpoint()}
      </code>
      <button
        type="button"
        onclick={() => copy(mcpEndpoint(), 'endpoint')}
        class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Copy MCP endpoint"
      >
        {#if copied === 'endpoint'}<Check class="size-3" />{:else}<Copy class="size-3" />{/if}
      </button>
    </div>
    <p class="mt-2 rounded-md border border-border bg-muted/30 p-2 text-[10px] leading-relaxed text-muted-foreground">
      <strong class="text-foreground">Claude.ai:</strong> add only this server URL and leave custom
      client credentials empty. Claude will open OpenTales sign-in and project consent. API keys are
      for clients that support a Bearer-token environment variable or header.
    </p>
  </div>

  {#if !canManage()}
    <p class="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
      Owner or admin permission is required to create and revoke external-agent keys.
    </p>
  {:else}
    <div class="flex items-center justify-between">
      <div>
        <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Project keys
        </p>
        <p class="mt-0.5 text-[10px] text-muted-foreground">
          Keys stop working if their creator loses workspace access.
        </p>
      </div>
      <button
        type="button"
        onclick={() => (formOpen = !formOpen)}
        class="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {#if formOpen}<X class="size-3" /> Cancel{:else}<Plus class="size-3" /> New key{/if}
      </button>
    </div>

    {#if formOpen}
      <form onsubmit={submit} class="space-y-2 rounded-md border border-border bg-card p-2.5">
        <label class="block">
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Name</span>
          <input
            type="text"
            bind:value={name}
            maxlength="80"
            required
            placeholder="My writing agent"
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
          />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Access</span>
            <select
              bind:value={permission}
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
            >
              <option value="read-write">Read & write</option>
              <option value="read-only">Read only</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Expires</span>
            <select
              bind:value={expiresInDays}
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
              <option value={0}>Never</option>
            </select>
          </label>
        </div>
        <p class="text-[10px] leading-relaxed text-muted-foreground">
          Read & write exposes project-changing tools. Codex is configured to prompt on writes;
          Claude Code applies its normal MCP tool permissions.
        </p>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          class="w-full rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {creating ? 'Creating…' : 'Create API key'}
        </button>
      </form>
    {/if}

    {#if created}
      <section class="border-l-2 border-accent bg-accent/5 p-2.5" aria-live="polite">
        <div class="flex items-start gap-2">
          <KeyRound class="mt-0.5 size-3.5 shrink-0 text-accent" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <p class="text-[11px] font-semibold text-foreground">Copy this key now</p>
              <button
                type="button"
                onclick={() => (created = null)}
                class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Dismiss"
              ><X class="size-3" /></button>
            </div>
            <p class="mt-0.5 text-[10px] text-muted-foreground">
              The secret is shown once. OpenTales stores only its hash.
            </p>
            <div class="mt-2 flex items-center gap-1 rounded-md border border-accent/30 bg-background p-1.5">
              <code class="min-w-0 flex-1 break-all font-mono text-[10px] text-foreground">{created.secret}</code>
              <button
                type="button"
                onclick={() => copy(created!.secret, 'secret')}
                class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Copy API key"
              >
                {#if copied === 'secret'}<Check class="size-3" />{:else}<Copy class="size-3" />{/if}
              </button>
            </div>

            {#each [
              { id: 'codex', label: 'Codex', command: codexCommand(created.secret) },
              { id: 'claude', label: 'Claude Code', command: claudeCommand(created.secret) }
            ] as setup (setup.id)}
              <div class="mt-2">
                <div class="mb-1 flex items-center justify-between">
                  <span class="inline-flex items-center gap-1 text-[10px] font-medium text-foreground">
                    <Terminal class="size-3" /> {setup.label}
                  </span>
                  <button
                    type="button"
                    onclick={() => copy(setup.command, setup.id)}
                    class="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {#if copied === setup.id}<Check class="size-3" /> Copied{:else}<Copy class="size-3" /> Copy setup{/if}
                  </button>
                </div>
                <pre class="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-sidebar p-2 font-mono text-[9px] leading-relaxed text-foreground">{setup.command}</pre>
              </div>
            {/each}
          </div>
        </div>
      </section>
    {/if}

    {#if error}
      <p class="text-[11px] text-destructive" role="alert">{error}</p>
    {/if}

    {#if loading}
      <p class="text-[11px] text-muted-foreground">Loading project keys…</p>
    {:else if keys.length === 0}
      <p class="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
        No external agents are connected yet. Create a key, copy one setup command, and start working.
      </p>
    {:else}
      <ul class="space-y-1.5">
        {#each keys as key (key.id)}
          <li
            class="rounded-md border border-border p-2"
            class:bg-card={isActive(key)}
            class:opacity-60={!isActive(key)}
          >
            <div class="flex items-center gap-2">
              <KeyRound class="size-3 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{key.name}</span>
              <span class="text-[9px] uppercase tracking-wide text-muted-foreground">{status(key)}</span>
              {#if isActive(key)}
                <button
                  type="button"
                  onclick={() => revoke(key)}
                  class="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Revoke key"
                ><Trash2 class="size-3" /></button>
              {/if}
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
              <span>{key.prefix}…</span>
              <span>{key.permission === 'read-write' ? 'read + write' : 'read only'}</span>
              <span>expires {dateLabel(key.expiresAt)}</span>
              <span>last used {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'never'}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
