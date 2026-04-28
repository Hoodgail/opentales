<script lang="ts">
  import { Eye, EyeOff, Key, Loader2, Sparkles } from 'lucide-svelte';
  import type { AiProviderKind } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';

  const projectId = $derived(manuscript.projectId);
  const settings = $derived(ai.settings);

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

  $effect(() => {
    const pid = projectId;
    if (pid && pid !== lastSyncedId) {
      void ai.loadSettings(pid);
      lastSyncedId = pid;
    }
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

    // Key handling: only send when explicitly changed
    if (clearKey) {
      input.apiKey = null;
    } else if (keyDirty && apiKeyInput.trim()) {
      input.apiKey = apiKeyInput.trim();
    }
    // Otherwise omit apiKey to keep existing

    await ai.updateSettings(projectId, input);
    saving = false;
    keyDirty = false;
    clearKey = false;
    apiKeyInput = '';
  }
</script>

<section class="border-b border-border p-3 text-xs">
  <h3
    class="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
  >
    <Sparkles class="size-3.5" />
    AI Configuration
  </h3>

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
          </div>
        </div>

        <!-- Model -->
        <label class="block">
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
            Model
          </span>
          <input
            type="text"
            bind:value={model}
            disabled={!canEdit()}
            placeholder={providerKind === 'gateway' ? 'openai/gpt-5.4' : 'gpt-4o'}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
          />
        </label>

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
            {#if settings.hasApiKey && !keyDirty && !clearKey}
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
</section>
