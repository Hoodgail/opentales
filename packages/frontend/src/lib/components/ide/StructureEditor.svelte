<script lang="ts">
  import { Compass, Eye, MountainSnow, Plus, ShieldAlert, Tag, Trash2, Volume2, Zap } from 'lucide-svelte';
  import type { ObstacleType } from '@opentales/sdk';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';

  const OBSTACLE_TYPES: ObstacleType[] = ['internal', 'external', 'interpersonal'];

  function addObstacle() {
    void manuscript.createObstacle({ title: 'New obstacle', type: 'internal' });
  }
</script>

<div class="flex h-full flex-col bg-background">
  <div
    class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-sidebar/40 px-4 text-xs text-muted-foreground"
  >
    <Compass class="size-3.5" />
    <span class="font-mono">Plot</span>
    <span class="text-muted-foreground/50">/</span>
    <span class="text-foreground">Story Structure</span>
  </div>

  <div class="flex-1 overflow-y-auto">
    <div class="mx-auto max-w-4xl p-8">
      <div class="mb-6">
        <input
          value={manuscript.structure.title}
          oninput={(e) =>
            void manuscript.updateStructure({
              title: (e.currentTarget as HTMLInputElement).value
            })}
          class="w-full bg-transparent font-serif text-3xl font-semibold tracking-tight text-foreground outline-none"
        />
        <div class="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{manuscript.structure.genre}</span>
          <span>·</span>
          <span>{manuscript.structure.perspective}</span>
        </div>
      </div>

      <!-- Logline -->
      <section class="rounded-md border border-border bg-card">
        <header class="flex items-center gap-2 border-b border-border px-3 py-2">
          <Tag class="size-3.5 text-accent/80" />
          <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Logline
          </h3>
        </header>
        <div class="p-3">
          <textarea
            value={manuscript.structure.logline}
            oninput={(e) =>
              void manuscript.updateStructure({
                logline: (e.currentTarget as HTMLTextAreaElement).value
              })}
            rows={3}
            class="w-full resize-none bg-transparent font-serif text-base italic leading-relaxed text-foreground/90 outline-none"
          ></textarea>
        </div>
      </section>

      <!-- Voice & POV grid -->
      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Eye class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Perspective
            </h3>
          </header>
          <div class="p-3">
            <div class="mb-2">
              <div
                class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                POV Type
              </div>
              <input
                value={manuscript.structure.perspective}
                oninput={(e) =>
                  void manuscript.updateStructure({
                    perspective: (e.currentTarget as HTMLInputElement).value
                  })}
                class="mt-1 w-full bg-transparent text-sm text-foreground/90 outline-none"
              />
            </div>
            <div>
              <div
                class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                POV Characters
              </div>
              <textarea
                value={manuscript.structure.pov}
                oninput={(e) =>
                  void manuscript.updateStructure({
                    pov: (e.currentTarget as HTMLTextAreaElement).value
                  })}
                rows={3}
                class="mt-1 w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none"
              ></textarea>
            </div>
          </div>
        </section>

        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Volume2 class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Voice & Tone
            </h3>
          </header>
          <div class="p-3">
            <div class="mb-2">
              <div
                class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Voice
              </div>
              <textarea
                value={manuscript.structure.voice}
                oninput={(e) =>
                  void manuscript.updateStructure({
                    voice: (e.currentTarget as HTMLTextAreaElement).value
                  })}
                rows={3}
                class="mt-1 w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none"
              ></textarea>
            </div>
            <div>
              <div
                class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Tone
              </div>
              <input
                value={manuscript.structure.tone}
                oninput={(e) =>
                  void manuscript.updateStructure({
                    tone: (e.currentTarget as HTMLInputElement).value
                  })}
                class="mt-1 w-full bg-transparent text-sm text-foreground/90 outline-none"
              />
            </div>
          </div>
        </section>
      </div>

      <!-- Themes -->
      <section class="mt-4 rounded-md border border-border bg-card">
        <header class="flex items-center gap-2 border-b border-border px-3 py-2">
          <Tag class="size-3.5 text-accent/80" />
          <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Themes
          </h3>
        </header>
        <div class="p-3">
          <div class="flex flex-wrap gap-1.5">
            {#each manuscript.structure.themes as t (t)}
              <span
                class="rounded border border-border bg-card px-2 py-1 text-xs text-foreground/85"
              >
                {t}
              </span>
            {/each}
          </div>
        </div>
      </section>

      <!-- Outline -->
      <section class="mt-4 rounded-md border border-border bg-card">
        <header class="flex items-center gap-2 border-b border-border px-3 py-2">
          <Compass class="size-3.5 text-accent/80" />
          <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Master Outline
          </h3>
        </header>
        <div class="p-3">
          <textarea
            value={manuscript.structure.outline}
            oninput={(e) =>
              void manuscript.updateStructure({
                outline: (e.currentTarget as HTMLTextAreaElement).value
              })}
            rows={14}
            class="w-full resize-none bg-transparent font-mono text-xs leading-relaxed text-foreground/90 outline-none"
          ></textarea>
        </div>
      </section>

      <!-- Obstacles -->
      <section class="mt-4 rounded-md border border-border bg-card">
        <header class="flex items-center justify-between border-b border-border px-3 py-2">
          <div class="flex items-center gap-2">
            <Zap class="size-3.5 text-accent/80" />
            <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Obstacles
            </h3>
          </div>
          <button
            type="button"
            onclick={addObstacle}
            class="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent/60 hover:text-foreground"
          >
            <Plus class="size-3" />
            Add
          </button>
        </header>
        <div class="p-3">
          {#if manuscript.structure.obstacles.length === 0}
            <p class="py-4 text-center text-xs italic text-muted-foreground">
              No obstacles yet. Add one to start mapping conflict.
            </p>
          {/if}
          <div class="space-y-3">
            {#each manuscript.structure.obstacles as o (o.id)}
              <div class="rounded border border-border bg-background/40 p-3">
                <div class="mb-2 flex items-center gap-2">
                  <select
                    value={o.type}
                    onchange={(e) =>
                      void manuscript.updateObstacle(o.id, {
                        type: (e.currentTarget as HTMLSelectElement).value as ObstacleType
                      })}
                    class={cn(
                      'rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider outline-none focus:border-accent/60',
                      o.type === 'internal' && 'bg-accent/20 text-accent',
                      o.type === 'external' && 'bg-destructive/20 text-destructive-foreground',
                      o.type === 'interpersonal' && 'bg-chart-4/20 text-chart-4'
                    )}
                  >
                    {#each OBSTACLE_TYPES as ot (ot)}
                      <option value={ot}>{ot}</option>
                    {/each}
                  </select>
                  <input
                    value={o.title}
                    onchange={(e) =>
                      void manuscript.updateObstacle(o.id, {
                        title: (e.currentTarget as HTMLInputElement).value
                      })}
                    class="flex-1 bg-transparent text-sm font-medium text-foreground outline-none"
                  />
                  <button
                    type="button"
                    onclick={() => void manuscript.deleteObstacle(o.id)}
                    title="Delete obstacle"
                    aria-label="Delete obstacle"
                    class="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive-foreground"
                  >
                    <Trash2 class="size-3.5" />
                  </button>
                </div>
                <textarea
                  value={o.description}
                  oninput={(e) =>
                    void manuscript.updateObstacle(o.id, {
                      description: (e.currentTarget as HTMLTextAreaElement).value
                    })}
                  rows={2}
                  placeholder="Describe the obstacle…"
                  class="w-full resize-none bg-transparent text-xs leading-relaxed text-foreground/80 outline-none"
                ></textarea>
                <div
                  class="mt-2 flex items-start gap-2 border-t border-border pt-2 text-xs"
                >
                  <ShieldAlert class="mt-0.5 size-3 shrink-0 text-emerald-400/70" />
                  <textarea
                    value={o.resolution}
                    oninput={(e) =>
                      void manuscript.updateObstacle(o.id, {
                        resolution: (e.currentTarget as HTMLTextAreaElement).value
                      })}
                    rows={2}
                    placeholder="How is it resolved?"
                    class="w-full resize-none bg-transparent text-muted-foreground outline-none"
                  ></textarea>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </section>

      <!-- Climax -->
      <section class="mt-4 rounded-md border border-border bg-card">
        <header class="flex items-center gap-2 border-b border-border px-3 py-2">
          <MountainSnow class="size-3.5 text-accent/80" />
          <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Climax
          </h3>
        </header>
        <div class="p-3">
          <textarea
            value={manuscript.structure.climax}
            oninput={(e) =>
              void manuscript.updateStructure({
                climax: (e.currentTarget as HTMLTextAreaElement).value
              })}
            rows={8}
            class="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none"
          ></textarea>
        </div>
      </section>
    </div>
  </div>
</div>
