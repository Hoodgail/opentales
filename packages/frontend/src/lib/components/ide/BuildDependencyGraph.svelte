<script lang="ts">
  import {
    AlertTriangle,
    Ban,
    Check,
    Circle,
    Clock3,
    LoaderCircle,
    RotateCcw
  } from 'lucide-svelte';
  import {
    BUILD_GRAPH_NODE_HEIGHT,
    BUILD_GRAPH_NODE_WIDTH,
    layoutBuildGraph
  } from '$lib/story-ide-model';
  import { cn } from '$lib/utils';

  export interface BuildGraphTask {
    id: string;
    key: string;
    type: string;
    phase: string;
    status: string;
    dependencyIds: string[];
    progress: number;
    attempts?: number;
    maxAttempts?: number;
  }

  interface Props {
    tasks: BuildGraphTask[];
    selectedId?: string | null;
    onSelect?: (task: BuildGraphTask) => void;
  }

  let { tasks, selectedId = null, onSelect = () => undefined }: Props = $props();
  const layout = $derived(layoutBuildGraph(tasks));
  const byId = $derived(new Map(tasks.map((task) => [task.id, task])));

  function statusIcon(status: string) {
    if (status === 'done' || status === 'completed') return Check;
    if (status === 'running') return LoaderCircle;
    if (status === 'review') return Clock3;
    if (status === 'failed') return AlertTriangle;
    if (status === 'cancelled') return Ban;
    if (status === 'ready') return RotateCcw;
    return Circle;
  }

  function statusClasses(status: string): string {
    if (status === 'done' || status === 'completed') return 'border-emerald-500/45 text-emerald-300';
    if (status === 'running') return 'border-accent/70 text-accent';
    if (status === 'review') return 'border-sky-400/50 text-sky-300';
    if (status === 'failed') return 'border-destructive/70 text-destructive-foreground';
    if (status === 'cancelled') return 'border-border text-muted-foreground line-through';
    if (status === 'ready') return 'border-foreground/25 text-foreground';
    return 'border-border text-muted-foreground';
  }

  function edgePath(edge: (typeof layout.edges)[number]): string {
    const midpoint = edge.x1 + Math.max(26, (edge.x2 - edge.x1) / 2);
    return `M ${edge.x1} ${edge.y1} C ${midpoint} ${edge.y1}, ${midpoint} ${edge.y2}, ${edge.x2} ${edge.y2}`;
  }
</script>

<section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-labelledby="build-graph-heading">
  <div class="flex items-center justify-between border-b border-border/70 px-3 py-2">
    <div>
      <h2 id="build-graph-heading" class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Dependency graph
      </h2>
      <p class="mt-0.5 text-[10px] text-muted-foreground/70">Edges show durable task prerequisites.</p>
    </div>
    <div class="font-mono text-[10px] text-muted-foreground">{tasks.length} tasks</div>
  </div>

  {#if layout.hasCycle}
    <div class="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive-foreground" role="alert">
      <AlertTriangle class="size-3.5" />
      The workflow contains a dependency cycle. Tasks in the final lane cannot be scheduled safely.
    </div>
  {/if}

  {#if tasks.length === 0}
    <div class="flex flex-1 items-center justify-center px-5 py-16 text-center text-xs text-muted-foreground">
      The compiler has not emitted a task graph yet.
    </div>
  {:else}
    <div class="build-graph-scroll min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--border)_55%,transparent)_1px,transparent_1px)] [background-size:20px_20px]" aria-label="Scrollable build dependency graph">
      <div class="relative" style:width={`${layout.width}px`} style:height={`${layout.height}px`}>
        <svg
          class="pointer-events-none absolute inset-0 overflow-visible"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden="true"
        >
          <defs>
            <marker id="build-edge-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 z" fill="color-mix(in oklch, var(--muted-foreground) 55%, transparent)" />
            </marker>
          </defs>
          {#each layout.edges as edge (`${edge.from}-${edge.to}`)}
            <path
              d={edgePath(edge)}
              fill="none"
              stroke="color-mix(in oklch, var(--muted-foreground) 40%, transparent)"
              stroke-width="1.25"
              marker-end="url(#build-edge-arrow)"
            />
          {/each}
        </svg>

        {#each layout.nodes as node (node.id)}
          {@const task = byId.get(node.id)}
          {#if task}
            {@const Icon = statusIcon(task.status)}
            <button
              type="button"
              onclick={() => onSelect(task)}
              aria-pressed={selectedId === task.id}
              class={cn(
                'group absolute flex flex-col overflow-hidden rounded border bg-sidebar text-left shadow-[0_8px_20px_rgba(0,0,0,.22)] outline-none transition-[border-color,background-color,transform] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:hover:-translate-y-0.5',
                statusClasses(task.status),
                selectedId === task.id && 'border-accent bg-accent/8 ring-1 ring-accent/25'
              )}
              style:left={`${node.x}px`}
              style:top={`${node.y}px`}
              style:width={`${BUILD_GRAPH_NODE_WIDTH}px`}
              style:height={`${BUILD_GRAPH_NODE_HEIGHT}px`}
            >
              <span class="flex min-h-0 flex-1 items-start gap-2 px-2.5 pt-2">
                <Icon class={cn('mt-0.5 size-3.5 shrink-0', task.status === 'running' && 'motion-safe:animate-spin')} />
                <span class="min-w-0">
                  <span class="block truncate text-[11px] font-medium text-foreground">{task.key || task.type}</span>
                  <span class="mt-0.5 block truncate font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{task.phase} · {task.status}</span>
                </span>
              </span>
              <span class="h-1 w-full bg-muted" aria-hidden="true">
                <span
                  class={cn(
                    'block h-full transition-[width] duration-300 motion-reduce:transition-none',
                    task.status === 'failed' ? 'bg-destructive' : 'bg-accent'
                  )}
                  style:width={`${Math.max(0, Math.min(100, task.status === 'done' ? 100 : task.progress ?? 0))}%`}
                ></span>
              </span>
            </button>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .build-graph-scroll {
    scrollbar-color: color-mix(in oklch, var(--muted-foreground) 40%, transparent) transparent;
    scrollbar-width: thin;
  }
</style>
