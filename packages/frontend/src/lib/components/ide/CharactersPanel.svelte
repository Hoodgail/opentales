<script lang="ts">
  import { Plus, UserPlus } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import HeaderButton from './HeaderButton.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const roleColor: Record<string, string> = {
    Protagonist: 'bg-accent text-accent-foreground',
    Antagonist: 'bg-destructive/80 text-destructive-foreground',
    Mentor: 'bg-chart-4/80 text-background',
    Ally: 'bg-emerald-600/70 text-white'
  };

  function newCharacter() {
    void manuscript.createCharacter({ name: 'New Character', role: 'Supporting' });
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Characters">
    {#snippet actions()}
      <HeaderButton icon={Plus} label="New character" onclick={newCharacter} />
    {/snippet}
  </PanelHeader>

  <div class="flex-1 overflow-y-auto p-2">
    <div class="space-y-1">
      {#each manuscript.characters as c (c.id)}
        {@const tabId = `tab-${c.id}`}
        {@const isActive = manuscript.activeTabId === tabId || manuscript.selectedId === c.id}
        <button
          type="button"
          onclick={() => {
            void manuscript.setSelectedId(c.id);
            void manuscript.openTab({ id: tabId, type: 'character', refId: c.id, title: c.name });
          }}
          class={cn(
            'group flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors',
            isActive ? 'bg-muted' : 'hover:bg-muted/50'
          )}
        >
          <div
            class="relative size-9 shrink-0 overflow-hidden rounded-full border border-border bg-muted"
          >
            {#if c.avatar}
              <img src={c.avatar} alt="" class="size-full object-cover" />
            {:else}
              <div
                class="flex size-full items-center justify-center text-xs font-semibold text-muted-foreground"
              >
                {c.name.charAt(0)}
              </div>
            {/if}
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-foreground">{c.name}</div>
            <div class="truncate text-[11px] text-muted-foreground">{c.occupation}</div>
          </div>
          <span
            class={cn(
              'shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
              roleColor[c.role] ?? 'bg-muted-foreground/20 text-foreground/80'
            )}
          >
            {c.role}
          </span>
        </button>
      {/each}
    </div>

    <button
      type="button"
      onclick={newCharacter}
      class="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-2.5 text-xs text-muted-foreground transition-colors hover:border-accent/60 hover:text-foreground"
    >
      <UserPlus class="size-3.5" />
      New Character
    </button>
  </div>
</div>
