<script lang="ts">
  import { FileText } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { Location } from '$lib/data/manuscript-types';
  import InspectorGroup from './InspectorGroup.svelte';
  import InspectorStat from './InspectorStat.svelte';

  interface Props {
    location: Location;
  }

  let { location }: Props = $props();

  const usedIn = $derived(manuscript.chapters.filter((c) => c.locationId === location.id));
</script>

<div class="p-3">
  <InspectorGroup title="Setting">
    {#snippet children()}
      <InspectorStat label="Type" value={location.type} />
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Atmosphere">
    {#snippet children()}
      <p class="px-3 py-2 text-xs leading-relaxed text-foreground/80">{location.atmosphere}</p>
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Used In">
    {#snippet children()}
      <div class="px-3 py-2">
        {#if usedIn.length === 0}
          <div class="text-[11px] italic text-muted-foreground">No scenes set here yet.</div>
        {/if}
        {#each usedIn as c (c.id)}
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
</div>
