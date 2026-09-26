<script lang="ts">
  import { ExternalLink, Eye, EyeOff, Key, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-svelte';
  import { aiModelChoices, type AiModelCatalog, type AiProviderKind } from '@opentales/sdk';
  import AiModelPicker from './AiModelPicker.svelte';
  import { ai, api } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';

  const CODEX_POLLING_SAFETY_MARGIN_SECONDS = 3;

  const projectId = $derived(manuscript.projectId);
  const settings = $derived(ai.settings);
  const copilotConnected = $derived(Boolean(settings?.providerKind === 'github-copilot' && settings.hasApiKey));
  const codexConnected = $derived(Boolean(settings?.providerKind === 'codex' && settings.hasApiKey));
  const openAiCompatibleKeyStored = $derived(
    Boolean(settings?.providerKind === 'openai-compatible' && settings.hasApiKey)
  );

  let enabled = $state(false);
  let providerKind = $state<AiProviderKind>('gateway');
  let model = $state('');
  let baseUrl = $state('');
  let apiKeyInput = $state('');
  let showKey = $state(false);
  let keyDirty = $state(false);
  let clearKey = $state(false);
  let saving = $state(false);
  let lastSyncedId = $state<string | null>(null);
  let selectedSkillId = $state<string | null>(null);
  let previewCatalog = $state<AiModelCatalog | null>(null);
  let referenceCatalog = $state<AiModelCatalog | null>(null);
  let discoveryLoading = $state(false);
  let discoveryError = $state<string | null>(null);
  let discoveryRevision = 0;
  const customEndpoint = $derived(providerKind === 'openai-compatible' && Boolean(baseUrl.trim()));
  const sameEndpoint = $derived(settings?.providerKind === 'openai-compatible' && baseUrl.trim().replace(/\/+$/, '') === (settings.baseUrl ?? '').replace(/\/+$/, ''));
  const savedEndpoint = $derived(sameEndpoint && !keyDirty && !clearKey);
  const catalog = $derived(customEndpoint
    ? previewCatalog ?? (savedEndpoint && ai.modelCatalog?.source === 'provider' ? ai.modelCatalog : null)
    : referenceCatalog ?? (ai.modelCatalog?.source === 'models.dev' ? ai.modelCatalog : null));
  const choices = $derived(aiModelChoices(catalog, providerKind));
  const selectedModel = $derived(choices.find((choice) => choice.id === model)?.model);
  const catalogError = $derived(discoveryError ?? (customEndpoint && savedEndpoint ? ai.modelCatalogError : null));
  let copilotAuth = $state<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    interval: number;
  } | null>(null);
  let copilotConnecting = $state(false);
  let copilotStatus = $state<string | null>(null);
  let copilotPollTimeout: ReturnType<typeof setTimeout> | null = null;
  let codexAuth = $state<{
    deviceAuthId: string;
    userCode: string;
    verificationUri: string;
    interval: number;
    expiresAt: number;
  } | null>(null);
  let codexConnecting = $state(false);
  let codexStatus = $state<string | null>(null);
  let codexPollTimeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const pid = projectId;
    if (pid && pid !== lastSyncedId) {
      void ai.loadSettings(pid);
      void ai.loadModelCatalog(pid);
      void ai.loadSkills(pid);
      referenceCatalog = null;
      void api.listAiModels(pid, { source: 'catalog' }).then((value) => {
        if (projectId === pid) referenceCatalog = value;
      }).catch(() => undefined);
      lastSyncedId = pid;
    }
  });

  $effect(() => {
    if (!selectedSkillId && ai.skills[0]) selectedSkillId = ai.skills[0].id;
  });

  $effect(() => {
    if (settings) {
      enabled = settings.enabled;
      providerKind = settings.providerKind;
      model = settings.model;
      baseUrl = settings.baseUrl ?? '';
      apiKeyInput = '';
      keyDirty = false;
      clearKey = false;
    }
  });

  $effect(() => {
    return () => {
      stopCopilotPolling();
      stopCodexPolling();
    };
  });

  $effect(() => {
    const kind = providerKind;
    if (kind !== 'github-copilot' && (copilotConnecting || copilotAuth)) {
      stopCopilotPolling();
      copilotAuth = null;
    }
    if (kind !== 'codex' && (codexConnecting || codexAuth)) {
      stopCodexPolling();
      codexAuth = null;
    }
  });

  $effect(() => {
    // Invalidate an in-flight preview whenever its endpoint or credentials change.
    void [projectId, providerKind, baseUrl, apiKeyInput, keyDirty, clearKey];
    discoveryRevision += 1;
    previewCatalog = null;
    discoveryError = null;
    discoveryLoading = false;
  });

  async function discoverModels() {
    if (!projectId || !canEdit() || !baseUrl.trim()) return;
    const revision = ++discoveryRevision;
    discoveryLoading = true;
    discoveryError = null;
    previewCatalog = null;
    try {
      const result = await api.discoverAiModels(projectId, {
        baseUrl: baseUrl.trim(),
        ...(clearKey ? { apiKey: null } : keyDirty ? { apiKey: apiKeyInput.trim() || null } : {})
      });
      if (revision !== discoveryRevision) return;
      previewCatalog = result;
      if (!aiModelChoices(result, 'openai-compatible').some((choice) => choice.id === model)) model = '';
    } catch (error) {
      if (revision === discoveryRevision) discoveryError = error instanceof Error ? error.message : 'Could not load provider models.';
    } finally {
      if (revision === discoveryRevision) discoveryLoading = false;
    }
  }

  function canEdit(): boolean {
    const role = manuscript.currentUserRole;
    return role === null || role === 'OWNER' || role === 'ADMIN';
  }

  async function save(e: Event) {
    e.preventDefault();
    if (!projectId || saving) return;
    saving = true;

    const input: Record<string, unknown> = {
      enabled,
      providerKind,
      model: model.trim()
    };

    if (providerKind === 'openai-compatible') {
      input.baseUrl = baseUrl.trim() || null;
    }

    if (providerKind === 'github-copilot' || providerKind === 'codex') {
      input.baseUrl = null;
    }

    // Key handling: only send when explicitly changed
    if (clearKey) {
      input.apiKey = null;
    } else if (keyDirty && apiKeyInput.trim()) {
      input.apiKey = apiKeyInput.trim();
    }
    // Otherwise omit apiKey to keep existing
    if (clearKey) {
      stopCopilotPolling();
      stopCodexPolling();
    }

    try {
      const saved = await ai.updateSettings(projectId, input);
      if (saved) {
        keyDirty = false;
        clearKey = false;
        apiKeyInput = '';
      }
    } finally {
      saving = false;
    }
  }

  async function connectCopilot() {
    if (!projectId || !canEdit() || copilotConnecting) return;
    stopCopilotPolling();
    copilotConnecting = true;
    copilotStatus = null;

    const result = await ai.startGithubCopilotAuth(projectId);
    if (!result) {
      copilotConnecting = false;
      return;
    }

    copilotAuth = result;
    copilotStatus = `Enter code ${result.userCode} in GitHub, then keep this panel open.`;
    scheduleCopilotPoll(result.interval);
  }

  async function pollCopilotAuth() {
    if (!projectId || !copilotAuth) return;
    const result = await ai.pollGithubCopilotAuth(projectId, copilotAuth.deviceCode);
    if (!result) {
      copilotConnecting = false;
      return;
    }

    if (result.status === 'authorized') {
      providerKind = 'github-copilot';
      model = result.settings?.model ?? (model || 'gpt-5');
      clearKey = false;
      keyDirty = false;
      apiKeyInput = '';
      copilotStatus = 'GitHub Copilot connected.';
      copilotConnecting = false;
      copilotAuth = null;
      return;
    }

    if (result.status === 'failed') {
      copilotStatus = result.message ?? 'GitHub authorization failed.';
      copilotConnecting = false;
      return;
    }

    const interval = result.interval ?? (result.status === 'slow_down' ? copilotAuth.interval + 5 : copilotAuth.interval);
    copilotAuth = { ...copilotAuth, interval };
    copilotStatus = result.status === 'slow_down' ? 'GitHub asked us to slow down polling.' : 'Waiting for GitHub authorization...';
    scheduleCopilotPoll(interval);
  }

  function scheduleCopilotPoll(intervalSeconds: number) {
    stopCopilotPolling(false);
    copilotPollTimeout = setTimeout(() => {
      void pollCopilotAuth();
    }, Math.max(1, intervalSeconds) * 1000);
  }

  function stopCopilotPolling(resetStatus = true) {
    if (copilotPollTimeout) clearTimeout(copilotPollTimeout);
    copilotPollTimeout = null;
    if (resetStatus) copilotConnecting = false;
  }

  async function connectCodex() {
    if (!projectId || !canEdit() || codexConnecting) return;
    stopCodexPolling();
    codexConnecting = true;
    codexStatus = null;

    const result = await ai.startCodexAuth(projectId);
    if (!result) {
      codexConnecting = false;
      return;
    }

    codexAuth = {
      ...result,
      expiresAt: Date.now() + result.expiresIn * 1000
    };
    codexStatus = `Enter code ${result.userCode} with OpenAI, then keep this panel open.`;
    scheduleCodexPoll(result.interval);
  }

  async function pollCodexAuth() {
    if (!projectId || !codexAuth) return;
    if (Date.now() >= codexAuth.expiresAt) {
      codexStatus = 'This Codex code expired. Start a new connection.';
      codexConnecting = false;
      codexAuth = null;
      return;
    }
    const result = await ai.pollCodexAuth(projectId, codexAuth.deviceAuthId, codexAuth.userCode);
    if (!result) {
      codexConnecting = false;
      return;
    }

    if (result.status === 'authorized') {
      providerKind = 'codex';
      model = result.settings?.model ?? 'codex/gpt-5.4';
      clearKey = false;
      keyDirty = false;
      apiKeyInput = '';
      codexStatus = 'Codex connected with your ChatGPT account.';
      codexConnecting = false;
      codexAuth = null;
      return;
    }
    if (result.status === 'failed') {
      codexStatus = result.message ?? 'Codex authorization failed.';
      codexConnecting = false;
      return;
    }

    const interval = result.interval ?? codexAuth.interval;
    codexAuth = { ...codexAuth, interval };
    codexStatus = 'Waiting for OpenAI authorization…';
    scheduleCodexPoll(interval);
  }

  function scheduleCodexPoll(intervalSeconds: number) {
    stopCodexPolling(false);
    codexPollTimeout = setTimeout(() => {
      void pollCodexAuth();
    }, Math.max(1, intervalSeconds + CODEX_POLLING_SAFETY_MARGIN_SECONDS) * 1000);
  }

  function stopCodexPolling(resetStatus = true) {
    if (codexPollTimeout) clearTimeout(codexPollTimeout);
    codexPollTimeout = null;
    if (resetStatus) codexConnecting = false;
  }

  function selectProviderKind(next: AiProviderKind) {
    if (!canEdit() || next === providerKind) return;
    providerKind = next;
    model = settings?.providerKind === next ? settings.model : '';
    clearKey = false;
    keyDirty = false;
    apiKeyInput = '';
  }

  function formatCost(value: number | null | undefined): string | null {
    if (typeof value !== 'number') return null;
    return `$${value.toFixed(value < 1 ? 3 : 2)}/M`;
  }

  async function createSkill() {
    if (!projectId || !canEdit()) return;
    const name = nextSkillName();
    const created = await ai.createSkill(projectId, {
      name,
      description: 'Use this skill when the project needs specialized AI guidance.',
      content: defaultSkillContent(name)
    });
    if (created) selectedSkillId = created.id;
  }

  async function deleteSkill(skillId = selectedSkillId) {
    if (!projectId || !skillId || !canEdit()) return;
    const deletingId = skillId;
    selectedSkillId = ai.skills.find((skill) => skill.id !== deletingId)?.id ?? null;
    await manuscript.closeTab(`tab-ai-skill-${deletingId}`);
    await ai.deleteSkill(projectId, deletingId);
  }

  async function toggleSkill(skillId: string) {
    if (!projectId || !canEdit()) return;
    const skill = ai.skills.find((candidate) => candidate.id === skillId);
    if (!skill) return;
    await ai.updateSkill(projectId, skill.id, { enabled: !skill.enabled });
  }

  function nextSkillName(): string {
    const base = 'new-skill';
    const names = new Set(ai.skills.map((skill) => skill.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base}-${index}`)) index += 1;
    return `${base}-${index}`;
  }

  function defaultSkillContent(name: string): string {
    return `---\nname: ${name}\ndescription: Use this skill when the project needs specialized AI guidance.\n---\n\n# ${name}\n\nDescribe when and how the agent should use this skill.`;
  }

  function openSkill(skillId = selectedSkillId) {
    const skill = ai.skills.find((candidate) => candidate.id === skillId);
    if (!skill) return;
    selectedSkillId = skill.id;
    void manuscript.openTab({
      id: `tab-ai-skill-${skill.id}`,
      type: 'ai-skill',
      refId: skill.id,
      title: skill.name
    });
  }
</script>

<div class="space-y-4">
  {#if ai.settingsLoading}
    <div class="flex items-center gap-2 py-4 text-muted-foreground">
      <Loader2 class="size-3.5 animate-spin" />
      <span>Loading AI settings…</span>
    </div>
  {:else if !settings}
    <p class="py-2 text-muted-foreground">No AI settings available.</p>
  {:else}
    <form onsubmit={save} class="space-y-3">
      <!-- Enable toggle -->
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          bind:checked={enabled}
          disabled={!canEdit()}
          class="accent-accent"
        />
        <span>Enable AI features</span>
      </label>

      {#if enabled}
        <!-- Provider kind -->
        <div>
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
            Provider
          </span>
          <div class="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border text-[10px]">
            <button
              type="button"
              onclick={() => selectProviderKind('gateway')}
              aria-pressed={providerKind === 'gateway'}
              disabled={!canEdit()}
              class={'px-2 py-1.5 ' +
                (providerKind === 'gateway'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted')}
            >
              Gateway
            </button>
            <button
              type="button"
              onclick={() => selectProviderKind('openai-compatible')}
              aria-pressed={providerKind === 'openai-compatible'}
              disabled={!canEdit()}
              class={'px-2 py-1.5 ' +
                (providerKind === 'openai-compatible'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted')}
            >
              OpenAI Compatible
            </button>
            <button
              type="button"
              onclick={() => selectProviderKind('github-copilot')}
              aria-pressed={providerKind === 'github-copilot'}
              disabled={!canEdit()}
              class={'px-2 py-1.5 ' +
                (providerKind === 'github-copilot'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted')}
            >
              Copilot
            </button>
            <button
              type="button"
              onclick={() => selectProviderKind('codex')}
              aria-pressed={providerKind === 'codex'}
              disabled={!canEdit()}
              class={'px-2 py-1.5 ' +
                (providerKind === 'codex'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted')}
            >
              Codex
            </button>
          </div>
        </div>

        {#if providerKind === 'github-copilot'}
          <div class="rounded-md border border-border bg-card/40 p-2 text-[11px]">
            <div class="mb-2 flex items-center gap-1.5 font-medium text-foreground">
              <Key class="size-3.5" /> GitHub Copilot
            </div>
            <p class="text-muted-foreground">
              Connect with GitHub device auth. OpenTales stores the OAuth token encrypted and uses it as the Copilot bearer token.
            </p>
            <div class="mt-2 flex items-center gap-2">
              {#if copilotConnected && !copilotConnecting}
                <span class="flex items-center gap-1 text-emerald-400">
                  <Key class="size-3" /> Connected
                </span>
              {/if}
              {#if canEdit()}
                <button
                  type="button"
                  onclick={connectCopilot}
                  disabled={copilotConnecting}
                  class="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted disabled:opacity-60"
                >
                  {#if copilotConnecting}<Loader2 class="size-3 animate-spin" />{/if}
                  {copilotConnected ? 'Reconnect' : 'Connect'}
                </button>
                {#if copilotConnected}
                  <button
                    type="button"
                    onclick={() => (clearKey = true)}
                    class="rounded border border-destructive/40 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10"
                  >
                    Clear token
                  </button>
                {/if}
              {/if}
            </div>

            {#if copilotAuth}
              <div class="mt-2 rounded border border-border bg-background p-2">
                <div class="text-[10px] uppercase tracking-wide text-muted-foreground">GitHub code</div>
                <div class="mt-1 font-mono text-lg tracking-[0.16em] text-foreground">{copilotAuth.userCode}</div>
                <a
                  href={copilotAuth.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  class="mt-1 inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                >
                  Open GitHub device page <ExternalLink class="size-3" />
                </a>
              </div>
            {/if}

            {#if clearKey}
              <span class="mt-1 block text-[10px] text-amber-400">Copilot token will be cleared on save.</span>
            {/if}
            {#if copilotStatus}
              <span class="mt-1 block text-[10px] text-muted-foreground">{copilotStatus}</span>
            {/if}
          </div>
        {/if}

        {#if providerKind === 'codex'}
          <div class="rounded-md border border-border bg-card/40 p-2 text-[11px]">
            <div class="mb-2 flex items-center gap-1.5 font-medium text-foreground">
              <Sparkles class="size-3.5" /> Codex with ChatGPT
            </div>
            <p class="text-muted-foreground">
              Connect your ChatGPT subscription with OpenAI device authorization. OpenTales encrypts the refreshable session and sends model requests through the Codex Responses endpoint.
            </p>
            <p class="mt-1 text-[10px] text-muted-foreground">
              Device code login must be allowed in your ChatGPT security settings.
            </p>
            <div class="mt-2 flex items-center gap-2">
              {#if codexConnected && !codexConnecting && !clearKey}
                <span class="flex items-center gap-1 text-emerald-400">
                  <Key class="size-3" /> Connected
                </span>
              {/if}
              {#if canEdit()}
                <button
                  type="button"
                  onclick={connectCodex}
                  disabled={codexConnecting}
                  class="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted disabled:opacity-60"
                >
                  {#if codexConnecting}<Loader2 class="size-3 animate-spin" />{/if}
                  {codexConnected ? 'Reconnect' : 'Connect with ChatGPT'}
                </button>
                {#if codexConnected}
                  <button
                    type="button"
                    onclick={() => {
                      clearKey = true;
                      stopCodexPolling();
                    }}
                    class="rounded border border-destructive/40 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10"
                  >
                    Disconnect
                  </button>
                {/if}
              {/if}
            </div>

            {#if codexAuth}
              <div class="mt-2 rounded border border-accent/40 border-l-2 border-l-accent bg-background p-2">
                <div class="text-[10px] uppercase tracking-wide text-muted-foreground">OpenAI code</div>
                <div class="mt-1 font-mono text-lg tracking-[0.16em] text-foreground" aria-label={`OpenAI device code ${codexAuth.userCode}`}>
                  {codexAuth.userCode}
                </div>
                <a
                  href={codexAuth.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  class="mt-1 inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                >
                  Open OpenAI device page <ExternalLink class="size-3" />
                </a>
              </div>
            {/if}

            {#if clearKey}
              <span class="mt-1 block text-[10px] text-amber-400">Codex will be disconnected on save.</span>
            {/if}
            {#if codexStatus}
              <span class="mt-1 block text-[10px] text-muted-foreground" role="status" aria-live="polite">{codexStatus}</span>
            {/if}
          </div>
        {/if}

        {#if providerKind === 'openai-compatible'}
          <!-- Base URL -->
          <label class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
              Base URL
            </span>
            <input
              type="url"
              bind:value={baseUrl}
              disabled={!canEdit()}
              placeholder="https://api.openai.com/v1"
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
            />
            <span class="mt-0.5 block text-[10px] text-muted-foreground">
              Leave empty for OpenAI default.
            </span>
          </label>

          <!-- API key -->
          <div>
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
              API key
            </span>
            {#if openAiCompatibleKeyStored && !keyDirty && !clearKey}
              <div class="flex items-center gap-1.5">
                <span class="flex items-center gap-1 text-emerald-400">
                  <Key class="size-3" />
                  <span class="text-[10px]">Key stored</span>
                </span>
                {#if canEdit()}
                  <button
                    type="button"
                    onclick={() => (keyDirty = true)}
                    class="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onclick={() => (clearKey = true)}
                    class="rounded border border-destructive/40 px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10"
                  >
                    Clear
                  </button>
                {/if}
              </div>
            {:else}
              <div class="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  aria-label="API key"
                  bind:value={apiKeyInput}
                  disabled={!canEdit()}
                  placeholder={clearKey ? 'Key will be cleared' : 'sk-…'}
                  oninput={() => {
                    keyDirty = true;
                    clearKey = false;
                  }}
                  class="w-full rounded-md border border-border bg-background px-2 py-1.5 pr-8 text-foreground outline-none focus:border-accent disabled:opacity-60"
                />
                <button
                  type="button"
                  onclick={() => (showKey = !showKey)}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {#if showKey}
                    <EyeOff class="size-3.5" />
                  {:else}
                    <Eye class="size-3.5" />
                  {/if}
                </button>
              </div>
              {#if clearKey}
                <span class="mt-0.5 block text-[10px] text-amber-400">
                  Key will be cleared on save.
                </span>
              {/if}
            {/if}
          </div>
        {/if}

        <div class="rounded-xl border border-border bg-card/40 p-2.5">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-[10px] uppercase tracking-wide text-muted-foreground">Model</span>
            {#if customEndpoint}
              <button type="button" onclick={discoverModels} disabled={!canEdit() || discoveryLoading} class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-muted disabled:opacity-50">
                {#if discoveryLoading}<Loader2 class="size-3 motion-safe:animate-spin" />{/if}
                {discoveryLoading ? 'Loading…' : 'Load models'}
              </button>
            {/if}
          </div>
          <AiModelPicker {choices} value={model} placement="below" loading={discoveryLoading || (savedEndpoint && ai.modelCatalogLoading)} error={catalogError} disabled={!canEdit()} onSelect={(id) => { model = id; }} onRefresh={customEndpoint ? () => void discoverModels() : undefined} />
          {#if customEndpoint}
            <p class="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
              {#if catalog} {choices.length} models from your provider. Missing details are filled from models.dev.
              {:else}Load models from this endpoint to choose an available model.{/if}
            </p>
            {#if !sameEndpoint && openAiCompatibleKeyStored && !keyDirty}
              <p class="mt-1 text-[10px] text-muted-foreground">Enter the new endpoint's API key using Replace above.</p>
            {/if}
          {/if}
          {#if selectedModel}
            <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px]">
              <dt class="text-muted-foreground">Context</dt><dd>{selectedModel.context?.toLocaleString() ?? 'Not reported'}</dd>
              <dt class="text-muted-foreground">Max input</dt><dd>{selectedModel.maxInput?.toLocaleString() ?? 'Not reported'}</dd>
              <dt class="text-muted-foreground">Input / output</dt><dd>{formatCost(selectedModel.cost?.input) ?? '—'} / {formatCost(selectedModel.cost?.output) ?? '—'}</dd>
              <dt class="text-muted-foreground">Vision / tools</dt><dd>{selectedModel.supportsVision === null ? 'Unknown' : selectedModel.supportsVision ? 'Yes' : 'No'} / {selectedModel.supportsTools === null ? 'Unknown' : selectedModel.supportsTools ? 'Yes' : 'No'}</dd>
            </dl>
          {/if}
          {#if catalogError}<p class="mt-2 text-[10px] text-destructive" role="alert">{catalogError}</p>{/if}
          {#if !customEndpoint}
            <details class="mt-2 text-[10px] text-muted-foreground">
              <summary class="cursor-pointer">Enter a model ID manually</summary>
              <input aria-label="Model ID" bind:value={model} disabled={!canEdit()} placeholder="Model ID" class="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent" />
            </details>
          {/if}
        </div>
      {/if}

      {#if canEdit()}
        <button
          type="submit"
          disabled={saving || (enabled && !model.trim())}
          class="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save AI settings'}
        </button>
      {:else}
        <p class="text-[10px] text-muted-foreground">
          Admin permission required to change AI settings.
        </p>
      {/if}

      {#if ai.settingsError}
        <p class="text-[11px] text-destructive">{ai.settingsError}</p>
      {/if}
    </form>
  {/if}

  <div class="border-t border-border pt-3">
    <div class="mb-2 flex items-center justify-between gap-2">
      <div>
        <h4 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Agent Skills
        </h4>
        <p class="mt-0.5 text-[10px] text-muted-foreground">
          Project-scoped skills are disclosed to the agent and can be activated during chat.
        </p>
      </div>
      {#if canEdit()}
        <button
          type="button"
          onclick={createSkill}
          class="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] hover:bg-muted"
        >
          <Plus class="size-3" /> Skill
        </button>
      {/if}
    </div>

    {#if ai.skillsLoading}
      <div class="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 class="size-3.5 animate-spin" />
        <span>Loading skills…</span>
      </div>
    {:else if ai.skills.length === 0}
      <p class="rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground">
        No skills yet. Add a skill to give the agent reusable project-specific workflows.
      </p>
    {:else}
      <div class="space-y-2">
        <div class="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
          {#each ai.skills as skill (skill.id)}
            <div
              class={'group flex items-center gap-0.5 rounded ' +
                (selectedSkillId === skill.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')}
            >
              <button
                type="button"
                onclick={() => (selectedSkillId = skill.id)}
                ondblclick={() => openSkill(skill.id)}
                class="min-w-0 flex-1 px-2 py-1.5 text-left"
              >
                <span class="block truncate text-[11px] font-medium">{skill.name}</span>
                <span class="block truncate text-[10px] opacity-75">
                  {skill.enabled ? 'Enabled' : 'Disabled'} · {skill.description}
                </span>
              </button>
              <button
                type="button"
                onclick={() => toggleSkill(skill.id)}
                disabled={!canEdit()}
                class="flex h-6 shrink-0 items-center rounded px-1 text-[9px] opacity-70 hover:bg-background/20 hover:opacity-100 disabled:opacity-40"
                title={skill.enabled ? 'Disable skill' : 'Enable skill'}
              >
                {skill.enabled ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onclick={() => openSkill(skill.id)}
                class="flex size-6 shrink-0 items-center justify-center rounded opacity-70 hover:bg-background/20 hover:opacity-100"
                title="Open skill editor"
              >
                <Pencil class="size-3" />
              </button>
              {#if canEdit()}
                <button
                  type="button"
                  onclick={() => deleteSkill(skill.id)}
                  class="mr-1 flex size-6 shrink-0 items-center justify-center rounded opacity-70 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                  title="Delete skill"
                >
                  <Trash2 class="size-3" />
                </button>
              {/if}
            </div>
          {/each}
        </div>

        {#if selectedSkillId}
          {@const selectedSkill = ai.skills.find((skill) => skill.id === selectedSkillId)}
          {#if selectedSkill}
            <div class="rounded-md border border-border bg-card/40 p-2">
              <div class="mb-2 min-w-0">
                <div class="truncate text-[11px] font-medium text-foreground">{selectedSkill.name}</div>
                <p class="mt-0.5 line-clamp-3 text-[10px] text-muted-foreground">
                  {selectedSkill.description}
                </p>
              </div>
              <button
                type="button"
                onclick={() => openSkill()}
                class="inline-flex w-full items-center justify-center gap-1 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90"
              >
                <Pencil class="size-3" /> Open full skill editor
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    {#if ai.skillsError}
      <p class="mt-2 text-[11px] text-destructive">{ai.skillsError}</p>
    {/if}
  </div>
</div>
