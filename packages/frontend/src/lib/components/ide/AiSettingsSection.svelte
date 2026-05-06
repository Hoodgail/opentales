<script lang="ts">
  import { ExternalLink, Eye, EyeOff, Key, Loader2, Pencil, Plus, Trash2 } from 'lucide-svelte';
  import type { AiModelCatalogModel, AiModelCatalogProvider, AiProviderKind } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';

  const projectId = $derived(manuscript.projectId);
  const settings = $derived(ai.settings);
  const copilotConnected = $derived(Boolean(settings?.providerKind === 'github-copilot' && settings.hasApiKey));
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
  let modelSearch = $state('');
  let showAllModels = $state(false);
  let copilotAuth = $state<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    interval: number;
  } | null>(null);
  let copilotConnecting = $state(false);
  let copilotStatus = $state<string | null>(null);
  let copilotPollTimeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const pid = projectId;
    if (pid && pid !== lastSyncedId) {
      void ai.loadSettings(pid);
      void ai.loadModelCatalog(pid);
      void ai.loadSkills(pid);
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
    return () => stopCopilotPolling();
  });

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

    if (providerKind === 'github-copilot') {
      input.baseUrl = null;
    }

    // Key handling: only send when explicitly changed
    if (clearKey) {
      input.apiKey = null;
    } else if (keyDirty && apiKeyInput.trim()) {
      input.apiKey = apiKeyInput.trim();
    }
    // Otherwise omit apiKey to keep existing
    if (clearKey) stopCopilotPolling();

    try {
      await ai.updateSettings(projectId, input);
      keyDirty = false;
      clearKey = false;
      apiKeyInput = '';
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

  function providerModelId(provider: AiModelCatalogProvider, item: AiModelCatalogModel): string {
    return provider.id === 'github-copilot' || provider.id === 'openai' ? item.id : `${provider.id}/${item.id}`;
  }

  function selectCatalogModel(provider: AiModelCatalogProvider, item: AiModelCatalogModel) {
    if (!canEdit()) return;
    model = providerModelId(provider, item);
    if (provider.id === 'github-copilot') providerKind = 'github-copilot';
    else if (provider.id === 'openai') providerKind = 'openai-compatible';
    else providerKind = 'gateway';
  }

  function providerVisibleForCurrentKind(provider: AiModelCatalogProvider): boolean {
    if (providerKind === 'github-copilot') return provider.id === 'github-copilot';
    if (providerKind === 'openai-compatible') return provider.id === 'openai';
    return provider.id !== 'github-copilot';
  }

  function filteredModels(provider: AiModelCatalogProvider): AiModelCatalogModel[] {
    const query = modelSearch.trim().toLowerCase();
    return provider.models
      .filter((item) => showAllModels || item.visible || item.id === model || providerModelId(provider, item) === model)
      .filter((item) => item.status !== 'deprecated')
      .filter((item) => {
        if (!query) return true;
        return `${provider.name} ${provider.id} ${item.name} ${item.id}`.toLowerCase().includes(query);
      })
      .slice(0, showAllModels ? 50 : 12);
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
          <div class="flex overflow-hidden rounded-md border border-border text-[10px]">
            <button
              type="button"
              onclick={() => (providerKind = 'gateway')}
              disabled={!canEdit()}
              class={'flex-1 px-2 py-1.5 ' +
                (providerKind === 'gateway'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted')}
            >
              Gateway
            </button>
            <button
              type="button"
              onclick={() => (providerKind = 'openai-compatible')}
              disabled={!canEdit()}
              class={'flex-1 px-2 py-1.5 ' +
                (providerKind === 'openai-compatible'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted')}
            >
              OpenAI Compatible
            </button>
            <button
              type="button"
              onclick={() => (providerKind = 'github-copilot')}
              disabled={!canEdit()}
              class={'flex-1 px-2 py-1.5 ' +
                (providerKind === 'github-copilot'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted')}
            >
              Copilot
            </button>
          </div>
        </div>

        <!-- Model -->
        <div class="block">
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
            Model
          </span>
          <input
            type="text"
            bind:value={model}
            disabled={!canEdit()}
            placeholder={providerKind === 'gateway' ? 'openai/gpt-5.4' : providerKind === 'github-copilot' ? 'gpt-5' : 'gpt-4o'}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
          />
          <div class="mt-2 rounded-md border border-border bg-card/30 p-2">
            <div class="mb-2 flex items-center gap-2">
              <input
                type="search"
                bind:value={modelSearch}
                placeholder="Search models or providers"
                class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-accent"
              />
              <button
                type="button"
                onclick={() => (showAllModels = !showAllModels)}
                class="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
              >
                {showAllModels ? 'Latest' : 'All'}
              </button>
            </div>
            {#if ai.modelCatalogLoading}
              <div class="flex items-center gap-2 py-2 text-[11px] text-muted-foreground">
                <Loader2 class="size-3 animate-spin" /> Loading model catalog...
              </div>
            {:else if ai.modelCatalog && ai.modelCatalog.providers.length > 0}
              <div class="max-h-72 space-y-2 overflow-y-auto pr-1">
                {#each ai.modelCatalog.providers.filter(providerVisibleForCurrentKind) as provider (provider.id)}
                  {@const items = filteredModels(provider)}
                  {#if items.length > 0}
                    <div>
                      <div class="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>{provider.name}</span>
                        {#if provider.popular}<span>Popular</span>{/if}
                      </div>
                      <div class="space-y-1">
                        {#each items as item (item.id)}
                          {@const selected = item.id === model || providerModelId(provider, item) === model}
                          <button
                            type="button"
                            onclick={() => selectCatalogModel(provider, item)}
                            disabled={!canEdit()}
                            class={'w-full rounded border px-2 py-1.5 text-left text-[11px] ' +
                              (selected
                                ? 'border-accent bg-accent/15 text-foreground'
                                : 'border-border hover:bg-muted')}
                          >
                            <span class="flex items-center justify-between gap-2">
                              <span class="min-w-0 truncate font-medium">{item.name}</span>
                              <span class="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground">
                                {#if item.latest}<span class="rounded bg-accent/20 px-1 text-accent">Latest</span>{/if}
                                {#if item.cost?.input === 0}<span class="rounded bg-emerald-500/15 px-1 text-emerald-400">Free</span>{/if}
                              </span>
                            </span>
                            <span class="mt-0.5 block truncate text-[10px] text-muted-foreground">
                              {providerModelId(provider, item)}
                              {#if item.context} · {Math.round(item.context / 1000)}k context{/if}
                              {#if formatCost(item.cost?.input)} · in {formatCost(item.cost?.input)}{/if}
                              {#if formatCost(item.cost?.output)} / out {formatCost(item.cost?.output)}{/if}
                              {#if item.supportsVision} · vision{/if}
                              {#if item.supportsTools} · tools{/if}
                            </span>
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {:else}
              <p class="py-2 text-[11px] text-muted-foreground">Model catalog unavailable. You can still enter a model manually.</p>
            {/if}
            {#if ai.modelCatalogError}
              <p class="mt-2 text-[10px] text-destructive">{ai.modelCatalogError}</p>
            {/if}
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
      {/if}

      {#if canEdit()}
        <button
          type="submit"
          disabled={saving}
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
