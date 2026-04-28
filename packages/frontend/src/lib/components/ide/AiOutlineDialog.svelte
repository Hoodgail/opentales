<script lang="ts">
  import { Check, Loader2, Sparkles, X } from 'lucide-svelte';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    onAccept: (draft: string) => void;
    onClose: () => void;
  }

  let { onAccept, onClose }: Props = $props();

  const projectId = $derived(manuscript.projectId);

  let synopsis = $state('');
  let targetLength = $state<'short' | 'medium' | 'long'>('medium');
  let povCharacterId = $state('');
  let locationId = $state('');

  const lengths: { value: 'short' | 'medium' | 'long'; label: string }[] = [
    { value: 'short', label: 'Short' },
    { value: 'medium', label: 'Medium' },
    { value: 'long', label: 'Long' }
  ];

  function generate() {
    if (!projectId || !synopsis.trim()) return;
    void ai.createOutline(
      projectId,
      synopsis.trim(),
      targetLength,
      povCharacterId || undefined,
      locationId || undefined
    );
  }

  function accept() {
    if (ai.outlineResult?.draft) {
      onAccept(ai.outlineResult.draft);
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
  <div
    class="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
  >
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <div class="flex items-center gap-2">
        <Sparkles class="size-4 text-accent" />
        <h2 class="text-sm font-medium text-foreground">Outline Expansion</h2>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
      >
        <X class="size-4" />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      {#if !ai.outlineResult && !ai.featureLoading}
        <div class="space-y-3">
          <label class="block text-xs">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Synopsis</span>
            <textarea
              bind:value={synopsis}
              rows="4"
              placeholder="Describe what should happen in this chapter or section…"
              class="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
            ></textarea>
          </label>

          <div>
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Length</span>
            <div class="flex overflow-hidden rounded-md border border-border text-[10px]">
              {#each lengths as l (l.value)}
                <button
                  type="button"
                  onclick={() => (targetLength = l.value)}
                  class={'flex-1 px-2 py-1.5 ' +
                    (targetLength === l.value
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted')}
                >
                  {l.label}
                </button>
              {/each}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <label class="block text-xs">
              <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">POV Character</span>
              <select
                bind:value={povCharacterId}
                class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none"
              >
                <option value="">None</option>
                {#each manuscript.characters as ch (ch.id)}
                  <option value={ch.id}>{ch.name}</option>
                {/each}
              </select>
            </label>
            <label class="block text-xs">
              <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Location</span>
              <select
                bind:value={locationId}
                class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none"
              >
                <option value="">None</option>
                {#each manuscript.locations as loc (loc.id)}
                  <option value={loc.id}>{loc.name}</option>
                {/each}
              </select>
            </label>
          </div>

          <button
            type="button"
            onclick={generate}
            disabled={!synopsis.trim()}
            class="w-full rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            Expand outline
          </button>
        </div>
      {/if}

      {#if ai.featureLoading}
        <div class="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 class="size-4 animate-spin" />
          Expanding outline…
        </div>
      {/if}

      {#if ai.outlineResult}
        <div>
          <div class="mb-2 flex items-center gap-2">
            <span class="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              {ai.outlineResult.label}
            </span>
            <span class="text-[10px] text-muted-foreground">Requires review before use</span>
          </div>

          <div class="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-foreground whitespace-pre-wrap">
            {ai.outlineResult.draft}
          </div>

          {#if ai.outlineResult.notes}
            <p class="mt-2 text-[11px] text-muted-foreground">{ai.outlineResult.notes}</p>
          {/if}

          <div class="mt-3 flex gap-2">
            <button
              type="button"
              onclick={accept}
              class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-500"
            >
              <Check class="size-3.5" /> Accept & Edit
            </button>
            <button
              type="button"
              onclick={generate}
              class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              <Sparkles class="size-3.5" /> Regenerate
            </button>
          </div>
        </div>
      {/if}

      {#if ai.featureError}
        <p class="mt-3 text-[11px] text-destructive">{ai.featureError}</p>
      {/if}
    </div>
  </div>
</div>
