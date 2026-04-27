<script lang="ts">
  import { ImagePlus, Plus } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import HeaderButton from './HeaderButton.svelte';
  import PanelHeader from './PanelHeader.svelte';

  function newLocation() {
    void manuscript.createLocation({ name: 'New Setting', type: 'Location' });
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Settings & Locations">
    {#snippet actions()}
      <HeaderButton icon={Plus} label="New setting" onclick={newLocation} />
    {/snippet}
  </PanelHeader>

  <div class="flex-1 overflow-y-auto p-2">
    <div class="space-y-2">
      {#each manuscript.locations as l (l.id)}
        {@const tabId = `tab-${l.id}`}
        {@const isActive = manuscript.activeTabId === tabId || manuscript.selectedId === l.id}
        <button
          type="button"
          onclick={() => {
            void manuscript.setSelectedId(l.id);
            void manuscript.openTab({ id: tabId, type: 'location', refId: l.id, title: l.name });
          }}
          class={cn(
            'group flex w-full overflow-hidden rounded-md border text-left transition-all',
            isActive
              ? 'border-accent/60 bg-muted'
              : 'border-border bg-card hover:border-accent/40 hover:bg-muted/50'
          )}
        >
          <div class="relative h-16 w-20 shrink-0 overflow-hidden bg-muted">
            {#if l.image}
              <img src={l.image} alt="" class="size-full object-cover" />
            {:else}
              <div class="flex size-full items-center justify-center text-muted-foreground">
                <ImagePlus class="size-4" />
              </div>
            {/if}
            <div class="absolute inset-0 bg-gradient-to-t from-background/60 via-transparent"></div>
          </div>
          <div class="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
            <div class="truncate text-sm font-medium text-foreground">{l.name}</div>
            <div class="truncate text-[11px] text-muted-foreground">{l.type}</div>
          </div>
        </button>
      {/each}
    </div>

    <button
      type="button"
      onclick={newLocation}
      class="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-2.5 text-xs text-muted-foreground transition-colors hover:border-accent/60 hover:text-foreground"
    >
      <Plus class="size-3.5" />
      New Setting
    </button>
  </div>
</div>
