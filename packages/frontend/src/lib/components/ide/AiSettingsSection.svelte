<script lang="ts">
  import { Bot, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, ShieldOff, Sparkles } from 'lucide-svelte';
  import type { AiProviderKind } from '@opentales/sdk';
  import { aiAgent } from '$lib/stores/aiAgent.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';

  let enabled = $state(false);
  let providerKind = $state<AiProviderKind>('gateway');
  let model = $state('');
  let baseUrl = $state('');
  let apiKey = $state('');
  let showApiKey = $state(false);
  let saving = $state(false);
  let saveMessage = $state<string | null>(null);
  let lastSyncedProjectId = $state<string | null>(null);

  // Whenever the active project (or its loaded settings) changes, copy server
  // values into the form. The API key is write-only — the form starts empty
  // and `hasApiKey` tells the user whether one is already stored.
  $effect(() => {
    const settings = aiAgent.settings;
    const projectId = aiAgent.attachedProjectId;
    if (!settings || !projectId) return;
    if (lastSyncedProjectId === projectId) return;
    enabled = settings.enabled;
    providerKind = settings.providerKind;
    model = settings.model;
    baseUrl = settings.baseUrl ?? '';
    apiKey = '';
    saveMessage = null;
    lastSyncedProjectId = projectId;
  });

  function canEdit(): boolean {
    const role = manuscript.currentUserRole;
    return role === null || role === 'OWNER' || role === 'ADMIN';
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!canEdit() || saving) return;
    saving = true;
    saveMessage = null;
    const trimmedKey = apiKey.trim();
    const updated = await aiAgent.updateSettings({
      enabled,
      providerKind,
      model: model.trim() || aiAgent.settings?.model || 'openai/gpt-5-mini',
      baseUrl: providerKind === 'openai-compatible' ? baseUrl.trim() || null : null,
      // Only send apiKey when the user explicitly typed a replacement.
      ...(trimmedKey ? { apiKey: trimmedKey } : {})
    });
    if (updated) {
      saveMessage = 'Saved';
      apiKey = '';
    }
    saving = false;
  }

  async function clearApiKey() {
    if (!canEdit() || saving) return;
    if (!confirm('Clear the stored API key for this project?')) return;
    saving = true;
    const updated = await aiAgent.updateSettings({ apiKey: null });
    if (updated) {
      apiKey = '';
      saveMessage = 'API key cleared';
    }
    saving = false;
  }
</script>

<section class="border-t border-border p-3 text-xs">
  <h3 class="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
    <Sparkles class="size-3 text-accent" />
    Project AI
  </h3>

  {#if !manuscript.projectId}
    <p class="text-[11px] text-muted-foreground">Open a project to configure AI.</p>
  {:else if !aiAgent.settings}
    <p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Loader2 class="size-3 animate-spin" /> Loading AI settings…
    </p>
  {:else}
    <form onsubmit={handleSubmit} class="space-y-3">
      <label class="flex items-start gap-2 rounded-md border border-border bg-card/40 p-2.5">
        <input
          type="checkbox"
          bind:checked={enabled}
          disabled={!canEdit()}
          class="mt-0.5 accent-accent"
        />
        <span class="flex-1">
          <span class="block font-medium text-foreground">Enable AI assistance</span>
          <span class="block text-[10px] text-muted-foreground">
            Allows rewrite, continuity reviews, dialogue, outline expansion, and the project agent
            for this project. AI never auto-applies changes.
          </span>
        </span>
        {#if enabled}
          <ShieldCheck class="size-4 shrink-0 text-emerald-400" />
        {:else}
          <ShieldOff class="size-4 shrink-0 text-muted-foreground" />
        {/if}
      </label>

      <div>
        <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
          Provider
        </span>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={!canEdit()}
            onclick={() => (providerKind = 'gateway')}
            class={'flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left ' +
              (providerKind === 'gateway'
                ? 'border-accent bg-accent/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted')}
          >
            <span class="flex items-center gap-1.5 text-[11px] font-medium">
              <Bot class="size-3" /> Gateway
            </span>
            <span class="text-[10px] leading-tight">
              Uses backend credentials (AI_GATEWAY_API_KEY).
            </span>
          </button>
          <button
            type="button"
            disabled={!canEdit()}
            onclick={() => (providerKind = 'openai-compatible')}
            class={'flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left ' +
              (providerKind === 'openai-compatible'
                ? 'border-accent bg-accent/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted')}
          >
            <span class="flex items-center gap-1.5 text-[11px] font-medium">
              <KeyRound class="size-3" /> OpenAI-compatible
            </span>
            <span class="text-[10px] leading-tight">
              Custom base URL + your own API key (BYOK).
            </span>
          </button>
        </div>
      </div>

      <label class="block">
        <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
          Model
        </span>
        <input
          type="text"
          bind:value={model}
          disabled={!canEdit()}
          placeholder={providerKind === 'gateway' ? 'openai/gpt-5-mini' : 'gpt-4o-mini'}
          class="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground outline-none focus:border-accent disabled:opacity-60"
        />
        <span class="mt-1 block text-[10px] text-muted-foreground">
          {providerKind === 'gateway'
            ? 'AI SDK gateway model string, e.g. openai/gpt-5-mini, anthropic/claude-opus-4.6.'
            : 'Model name as expected by your OpenAI-compatible provider.'}
        </span>
      </label>

      {#if providerKind === 'openai-compatible'}
        <label class="block">
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
            Base URL
          </span>
          <input
            type="url"
            bind:value={baseUrl}
            disabled={!canEdit()}
            placeholder="https://api.openai.com/v1"
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-accent disabled:opacity-60"
          />
          <span class="mt-1 block text-[10px] text-muted-foreground">
            Leave empty to use OpenAI's default endpoint.
          </span>
        </label>

        <div>
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
            API key
          </span>
          <div class="flex items-stretch gap-1.5">
            <div class="relative flex-1">
              <input
                type={showApiKey ? 'text' : 'password'}
                bind:value={apiKey}
                disabled={!canEdit()}
                autocomplete="off"
                placeholder={aiAgent.settings.hasApiKey ? '•••••••• stored' : 'sk-…'}
                class="w-full rounded-md border border-border bg-background py-1.5 pl-2 pr-7 font-mono text-[11px] text-foreground outline-none focus:border-accent disabled:opacity-60"
              />
              <button
                type="button"
                onclick={() => (showApiKey = !showApiKey)}
                class="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
                title={showApiKey ? 'Hide' : 'Show'}
              >
                {#if showApiKey}
                  <EyeOff class="size-3" />
                {:else}
                  <Eye class="size-3" />
                {/if}
              </button>
            </div>
            {#if aiAgent.settings.hasApiKey}
              <button
                type="button"
                onclick={clearApiKey}
                disabled={!canEdit() || saving}
                class="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Clear
              </button>
            {/if}
          </div>
          <span class="mt-1 block text-[10px] text-muted-foreground">
            {aiAgent.settings.hasApiKey
              ? 'A key is already stored. Type a new value to replace it, or use Clear.'
              : 'Stored encrypted on the server. The backend never returns this key after saving.'}
          </span>
        </div>
      {/if}

      {#if !canEdit()}
        <p class="text-[10px] text-muted-foreground">
          Only owners and admins can change AI settings.
        </p>
      {/if}

      <div class="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canEdit() || saving}
          class="rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save AI settings'}
        </button>
        {#if saveMessage}
          <span class="text-[10px] text-emerald-400">{saveMessage}</span>
        {/if}
      </div>

      {#if aiAgent.error}
        <p class="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive-foreground">
          {aiAgent.error}
        </p>
      {/if}
    </form>
  {/if}
</section>
