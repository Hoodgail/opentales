<script lang="ts">
  import { Check, Loader2, MessageSquare, Plus, Sparkles, X } from 'lucide-svelte';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';

  interface Props {
    onInsert: (line: string) => void;
    onClose: () => void;
  }

  let { onInsert, onClose }: Props = $props();

  const projectId = $derived(manuscript.projectId);
  const characters = $derived(manuscript.characters);

  let selectedCharacterId = $state('');
  let situation = $state('');
  let count = $state(5);

  function generate() {
    if (!projectId || !selectedCharacterId || !situation.trim()) return;
    void ai.createDialogue(projectId, selectedCharacterId, situation.trim(), count);
  }

  const selectedName = $derived(
    characters.find((c) => c.id === selectedCharacterId)?.name ?? '—'
  );
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
  <div
    class="mx-4 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
  >
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <div class="flex items-center gap-2">
        <MessageSquare class="size-4 text-accent" />
        <h2 class="text-sm font-medium text-foreground">Character Dialogue</h2>
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
      {#if !ai.dialogueResult && !ai.featureLoading}
        <div class="space-y-3">
          <label class="block text-xs">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Character</span>
            <select
              bind:value={selectedCharacterId}
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
            >
              <option value="" disabled>Select a character…</option>
              {#each characters as ch (ch.id)}
                <option value={ch.id}>{ch.name} — {ch.role}</option>
              {/each}
            </select>
          </label>
          <label class="block text-xs">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Situation</span>
            <textarea
              bind:value={situation}
              rows="3"
              placeholder="Describe the scene or conflict…"
              class="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
            ></textarea>
          </label>
          <label class="block text-xs">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Number of lines</span>
            <input
              type="number"
              bind:value={count}
              min="1"
              max="20"
              class="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onclick={generate}
            disabled={!selectedCharacterId || !situation.trim()}
            class="w-full rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            Generate dialogue
          </button>
        </div>
      {/if}

      {#if ai.featureLoading}
        <div class="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 class="size-4 animate-spin" />
          Generating lines for {selectedName}…
        </div>
      {/if}

      {#if ai.dialogueResult}
        <div>
          <p class="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            {ai.dialogueResult.characterName} — {ai.dialogueResult.lines.length} lines
          </p>
          <ul class="space-y-1.5">
            {#each ai.dialogueResult.lines as line, idx}
              <li class="group flex items-start gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
                <span class="flex-1 text-foreground/90">"{line}"</span>
                <button
                  type="button"
                  onclick={() => onInsert(line)}
                  title="Insert this line"
                  class="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                >
                  <Plus class="size-3.5" />
                </button>
              </li>
            {/each}
          </ul>
          {#if ai.dialogueResult.notes}
            <p class="mt-3 text-[11px] text-muted-foreground">{ai.dialogueResult.notes}</p>
          {/if}
          <div class="mt-3 flex gap-2">
            <button
              type="button"
              onclick={generate}
              class="flex-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <Sparkles class="mr-1 inline size-3" /> Regenerate
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
