<script lang="ts">
  import { FileText, Hash, MapPin, Users } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import InspectorGroup from './InspectorGroup.svelte';
  import InspectorStat from './InspectorStat.svelte';

  const total = $derived(manuscript.chapters.reduce((s, c) => s + c.wordCount, 0));
  const inProgress = $derived(
    manuscript.chapters.filter((c) => c.status === 'in-progress').length
  );
  const final = $derived(manuscript.chapters.filter((c) => c.status === 'final').length);
  const draft = $derived(manuscript.chapters.filter((c) => c.status === 'draft').length);
</script>

<div class="p-3">
  <InspectorGroup title="Project">
    {#snippet children()}
      <InspectorStat icon={FileText} label="Words" value={total.toLocaleString()} mono />
      <InspectorStat
        icon={Hash}
        label="Chapters"
        value={manuscript.chapters.length.toString()}
        mono
      />
      <InspectorStat
        icon={Users}
        label="Characters"
        value={manuscript.characters.length.toString()}
        mono
      />
      <InspectorStat
        icon={MapPin}
        label="Settings"
        value={manuscript.locations.length.toString()}
        mono
      />
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Status">
    {#snippet children()}
      <div class="px-3 py-2 text-xs">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-muted-foreground">Final</span>
          <span class="font-mono text-foreground">{final}</span>
        </div>
        <div class="mb-2 flex items-center justify-between">
          <span class="text-muted-foreground">Writing</span>
          <span class="font-mono text-foreground">{inProgress}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Draft</span>
          <span class="font-mono text-foreground">{draft}</span>
        </div>
      </div>
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Themes">
    {#snippet children()}
      <div class="flex flex-wrap gap-1 p-3">
        {#each manuscript.structure.themes as t (t)}
          <span
            class="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-foreground/80"
          >
            {t}
          </span>
        {/each}
      </div>
    {/snippet}
  </InspectorGroup>
</div>
