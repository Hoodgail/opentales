<script lang="ts">
  import { RefreshCw, RotateCcw, Trash2 } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import HeaderButton from './HeaderButton.svelte';
  import PanelHeader from './PanelHeader.svelte';

  onMount(() => {
    void manuscript.loadTrash();
  });

  function relTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function daysUntilPurge(iso: string): number {
    const ms = new Date(iso).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }

  async function restore(id: string) {
    await manuscript.restoreTrashChapter(id);
  }

  async function purge(id: string, title: string) {
    if (typeof window !== 'undefined' && !window.confirm(`Permanently delete "${title}"? This cannot be undone.`)) {
      return;
    }
    await manuscript.purgeTrashChapter(id);
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Trash">
    {#snippet actions()}
      <HeaderButton
        icon={RefreshCw}
        label="Refresh trash"
        onclick={() => void manuscript.loadTrash(true)}
      />
    {/snippet}
  </PanelHeader>
  <p class="px-3 pt-2 text-[11px] text-muted-foreground">
    {manuscript.trash.length} item{manuscript.trash.length === 1 ? '' : 's'} • auto-purge after 30 days
  </p>

  <div class="flex-1 overflow-y-auto px-3 py-2">
    {#if manuscript.trashLoading && manuscript.trash.length === 0}
      <p class="px-2 py-3 text-xs text-muted-foreground">Loading…</p>
    {:else if manuscript.trash.length === 0}
      <p class="px-2 py-3 text-xs text-muted-foreground">
        Trash is empty. Deleted chapters appear here for 30 days before they are permanently removed.
      </p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each manuscript.trash as item (item.id)}
          <li
            class="rounded-md border border-border/60 bg-background/40 px-3 py-2"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2">
                  <span class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Ch {item.number}
                  </span>
                  <span class="truncate text-xs font-medium text-foreground">
                    {item.title}
                  </span>
                </div>
                <div class="mt-0.5 text-[11px] text-muted-foreground">
                  {item.wordCount.toLocaleString()} words • deleted {relTime(item.deletedAt)} • purges in {daysUntilPurge(item.purgesAt)}d
                </div>
              </div>
            </div>
            <div class="mt-2 flex items-center justify-end gap-1">
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                onclick={() => void restore(item.id)}
              >
                <RotateCcw class="size-3" /> Restore
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                onclick={() => void purge(item.id, item.title)}
              >
                <Trash2 class="size-3" /> Delete forever
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
