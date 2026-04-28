<script lang="ts">
  import { Check, Loader2, Sparkles, X } from 'lucide-svelte';
  import type { AiRewriteMode } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    text: string;
    context?: string;
    onAccept: (text: string) => void;
    onClose: () => void;
  }

  let { text, context, onAccept, onClose }: Props = $props();

  const projectId = $derived(manuscript.projectId);
  const modes: { id: AiRewriteMode; label: string; description: string }[] = [
    { id: 'tighter', label: 'Tighter', description: 'Trim the fat, sharpen the prose' },
    { id: 'softer', label: 'Softer', description: 'Gentler voice, less abrupt' },
    { id: 'more-visceral', label: 'Visceral', description: 'Sensory, physical, immediate' },
    { id: 'more-lyrical', label: 'Lyrical', description: 'Rhythmic, poetic, flowing' }
  ];

  let selectedMode = $state<AiRewriteMode>('tighter');

  function generate() {
    if (!projectId) return;
    void ai.createRewrite(projectId, text, selectedMode, context);
  }

  function accept() {
    if (ai.rewriteResult?.suggested) {
      onAccept(ai.rewriteResult.suggested);
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
  <div
    class="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <div class="flex items-center gap-2">
        <Sparkles class="size-4 text-accent" />
        <h2 class="text-sm font-medium text-foreground">Rewrite Suggestion</h2>
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
      <!-- Mode selector -->
      <div class="mb-4">
        <p class="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Style</p>
        <div class="grid grid-cols-2 gap-1.5">
          {#each modes as mode (mode.id)}
            <button
              type="button"
              onclick={() => (selectedMode = mode.id)}
              class={cn(
                'rounded-md border px-3 py-2 text-left text-xs transition-colors',
                selectedMode === mode.id
                  ? 'border-accent bg-accent/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-accent/40'
              )}
            >
              <span class="block font-medium">{mode.label}</span>
              <span class="block text-[10px] text-muted-foreground">{mode.description}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Original text -->
      <div class="mb-4">
        <p class="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Original</p>
        <div class="rounded-md border border-border bg-background/50 p-3 text-xs text-foreground/80">
          {text}
        </div>
      </div>

      {#if !ai.rewriteResult && !ai.featureLoading}
        <button
          type="button"
          onclick={generate}
          class="w-full rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent/90"
        >
          Generate rewrite
        </button>
      {/if}

      {#if ai.featureLoading}
        <div class="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 class="size-4 animate-spin" />
          Generating…
        </div>
      {/if}

      {#if ai.rewriteResult}
        <!-- Suggested text -->
        <div class="mb-3">
          <p class="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Suggested ({ai.rewriteResult.mode})
          </p>
          <div class="rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-foreground">
            {ai.rewriteResult.suggested}
          </div>
        </div>

        {#if ai.rewriteResult.rationale}
          <div class="mb-4">
            <p class="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Rationale</p>
            <p class="text-[11px] text-muted-foreground">{ai.rewriteResult.rationale}</p>
          </div>
        {/if}

        <div class="flex gap-2">
          <button
            type="button"
            onclick={accept}
            class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-500"
          >
            <Check class="size-3.5" /> Accept
          </button>
          <button
            type="button"
            onclick={generate}
            class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
          >
            <Sparkles class="size-3.5" /> Regenerate
          </button>
        </div>
      {/if}

      {#if ai.featureError}
        <p class="mt-3 text-[11px] text-destructive">{ai.featureError}</p>
      {/if}
    </div>
  </div>
</div>
