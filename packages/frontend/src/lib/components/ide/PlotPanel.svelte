<script lang="ts">
  import { ChevronRight, Compass, Eye, Mic2, MountainSnow, Volume2, Zap } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import PanelHeader from './PanelHeader.svelte';

  const sections = $derived([
    { key: 'perspective', label: 'Perspective', icon: Eye, value: manuscript.structure.perspective },
    { key: 'voice', label: 'Voice', icon: Mic2, value: manuscript.structure.voice.split('.')[0] + '.' },
    { key: 'tone', label: 'Tone', icon: Volume2, value: manuscript.structure.tone },
    { key: 'climax', label: 'Climax', icon: MountainSnow, value: manuscript.structure.climax.split('\n')[0] }
  ]);

  function openStructure() {
    void manuscript.openTab({
      id: 'tab-structure',
      type: 'structure',
      refId: 'structure',
      title: 'Story Structure'
    });
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Plot Architecture" />

  <div class="flex-1 overflow-y-auto p-2">
    <button
      type="button"
      onclick={openStructure}
      class={cn(
        'mb-2 flex w-full flex-col gap-2 rounded-md border p-3 text-left transition-colors',
        manuscript.activeTabId === 'tab-structure'
          ? 'border-accent/60 bg-muted'
          : 'border-border bg-card hover:border-accent/40'
      )}
    >
      <div class="flex items-center gap-2">
        <Compass class="size-3.5 text-accent" />
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Logline
        </span>
      </div>
      <p class="text-xs leading-relaxed text-foreground/90">{manuscript.structure.logline}</p>
    </button>

    <div class="space-y-1">
      {#each sections as s (s.key)}
        <button
          type="button"
          onclick={openStructure}
          class="group flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-muted/50"
        >
          <s.icon class="mt-0.5 size-3.5 shrink-0 text-accent/80" />
          <div class="min-w-0 flex-1">
            <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {s.label}
            </div>
            <div class="mt-0.5 line-clamp-2 text-xs text-foreground/85">{s.value}</div>
          </div>
          <ChevronRight
            class="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          />
        </button>
      {/each}
    </div>

    <div class="mt-4">
      <div class="mb-1.5 flex items-center gap-2 px-2">
        <Zap class="size-3.5 text-accent/80" />
        <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Obstacles ({manuscript.structure.obstacles.length})
        </h3>
      </div>
      <div class="space-y-1">
        {#each manuscript.structure.obstacles as o (o.id)}
          <button
            type="button"
            onclick={openStructure}
            class="group flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-muted/50"
          >
            <span
              class={cn(
                'size-2 shrink-0 rounded-full',
                o.type === 'internal' && 'bg-accent',
                o.type === 'external' && 'bg-destructive/70',
                o.type === 'interpersonal' && 'bg-chart-4'
              )}
            ></span>
            <span class="flex-1 truncate text-xs text-foreground/85">{o.title}</span>
            <span class="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
              {o.type}
            </span>
          </button>
        {/each}
      </div>
    </div>

    <div class="mt-4">
      <div class="mb-1.5 px-2">
        <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Themes
        </h3>
      </div>
      <div class="flex flex-wrap gap-1 px-2">
        {#each manuscript.structure.themes as t (t)}
          <span
            class="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-foreground/80"
          >
            {t}
          </span>
        {/each}
      </div>
    </div>
  </div>
</div>
