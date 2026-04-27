<script lang="ts">
  import { FileText } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { Character } from '$lib/data/manuscript-types';
  import InspectorGroup from './InspectorGroup.svelte';
  import InspectorStat from './InspectorStat.svelte';

  interface Props {
    character: Character;
  }

  let { character }: Props = $props();

  const povChapters = $derived(
    manuscript.chapters.filter((c) => c.povCharacterId === character.id)
  );
</script>

<div class="p-3">
  <InspectorGroup title="Profile">
    {#snippet children()}
      <InspectorStat label="Role" value={character.role} />
      <InspectorStat label="Age" value={character.age} mono />
      <InspectorStat label="Occupation" value={character.occupation} />
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Traits">
    {#snippet children()}
      <div class="flex flex-wrap gap-1 p-3">
        {#each character.traits as t (t)}
          <span
            class="rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground/80"
          >
            {t}
          </span>
        {/each}
      </div>
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Appears In">
    {#snippet children()}
      <div class="px-3 py-2">
        {#each povChapters as c (c.id)}
          <button
            type="button"
            onclick={() =>
              void manuscript.openTab({
                id: `tab-${c.id}`,
                type: 'chapter',
                refId: c.id,
                title: c.title
              })}
            class="flex w-full items-center gap-2 rounded py-1 text-left text-xs text-foreground/80 hover:text-foreground"
          >
            <FileText class="size-3 text-muted-foreground" />
            <span class="truncate">
              Ch{c.number === 0 ? 'P' : c.number} — {c.title}
            </span>
          </button>
        {/each}
      </div>
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Relationships">
    {#snippet children()}
      {#each character.relationships as r (r.characterId)}
        {@const other = manuscript.characters.find((c) => c.id === r.characterId)}
        {#if other}
          <button
            type="button"
            onclick={() =>
              void manuscript.openTab({
                id: `tab-${other.id}`,
                type: 'character',
                refId: other.id,
                title: other.name
              })}
            class="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
          >
            <div
              class="size-7 shrink-0 overflow-hidden rounded-full border border-border bg-muted"
            >
              {#if other.avatar}
                <img src={other.avatar} alt="" class="size-full object-cover" />
              {/if}
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium text-foreground">{other.name}</div>
              <div class="text-[10px] uppercase tracking-wide text-muted-foreground">
                {r.type}
              </div>
            </div>
          </button>
        {/if}
      {/each}
    {/snippet}
  </InspectorGroup>
</div>
