<script lang="ts">
  import { Compass, Eye, MountainSnow, Plus, ShieldAlert, Tag, Trash2, Volume2, Zap } from 'lucide-svelte';
  import type { ObstacleType } from '@opentales/sdk';
  import { liveTextField } from '$lib/actions/liveTextField';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import ExpandableMarkdownEditor from './ExpandableMarkdownEditor.svelte';

  const OBSTACLE_TYPES: ObstacleType[] = ['internal', 'external', 'interpersonal'];

  const themesText = $derived(manuscript.structure.themes.join('\n'));

  function addObstacle() {
    void manuscript.createObstacle({ title: 'New obstacle', type: 'internal' });
  }

  function updateThemes(next: string) {
    void manuscript.updateStructure({
      themes: next
        .split('\n')
        .map((theme) => theme.trim())
        .filter(Boolean)
    });
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
          use:liveTextField={{
            document: { kind: 'structure', entityId: manuscript.projectId ?? 'structure', field: 'title' },
            getValue: () => manuscript.structure.title,
            onRemoteValue: (value) => manuscript.updateStructure({ title: value })
          }}
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
      <ExpandableMarkdownEditor
        value={manuscript.structure.logline}
        onChange={(next) => void manuscript.updateStructure({ logline: next })}
        label="Logline"
        icon={Tag}
        contextLabel={manuscript.structure.title}
        height="h-28"
        collaboration={{ kind: 'structure', entityId: manuscript.projectId ?? 'structure', field: 'logline' }}
      />

      <!-- Voice & POV grid -->
      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ExpandableMarkdownEditor
          value={manuscript.structure.perspective}
          onChange={(next) => void manuscript.updateStructure({ perspective: next })}
          label="POV Type"
          icon={Eye}
          contextLabel={manuscript.structure.title}
          height="h-28"
          collaboration={{ kind: 'structure', entityId: manuscript.projectId ?? 'structure', field: 'perspective' }}
        />

        <ExpandableMarkdownEditor
          value={manuscript.structure.pov}
          onChange={(next) => void manuscript.updateStructure({ pov: next })}
          label="POV Characters"
          icon={Eye}
          contextLabel={manuscript.structure.title}
          height="h-28"
          collaboration={{ kind: 'structure', entityId: manuscript.projectId ?? 'structure', field: 'pov' }}
        />

        <ExpandableMarkdownEditor
          value={manuscript.structure.voice}
          onChange={(next) => void manuscript.updateStructure({ voice: next })}
          label="Voice"
          icon={Volume2}
          contextLabel={manuscript.structure.title}
          height="h-28"
          collaboration={{ kind: 'structure', entityId: manuscript.projectId ?? 'structure', field: 'voice' }}
        />

        <ExpandableMarkdownEditor
          value={manuscript.structure.tone}
          onChange={(next) => void manuscript.updateStructure({ tone: next })}
          label="Tone"
          icon={Volume2}
          contextLabel={manuscript.structure.title}
          height="h-28"
          collaboration={{ kind: 'structure', entityId: manuscript.projectId ?? 'structure', field: 'tone' }}
        />
      </div>

      <!-- Themes -->
      <ExpandableMarkdownEditor
        value={themesText}
        onChange={updateThemes}
        label="Themes"
        icon={Tag}
        contextLabel={manuscript.structure.title}
        height="h-32"
        class="mt-4"
        collaboration={{ kind: 'structure', entityId: manuscript.projectId ?? 'structure', field: 'themes' }}
      />

      <!-- Outline -->
      <ExpandableMarkdownEditor
        value={manuscript.structure.outline}
        onChange={(next) => void manuscript.updateStructure({ outline: next })}
        label="Master Outline"
        icon={Compass}
        contextLabel={manuscript.structure.title}
        height="h-80"
        class="mt-4"
        collaboration={{ kind: 'structure', entityId: manuscript.projectId ?? 'structure', field: 'outline' }}
      />

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
                    use:liveTextField={{
                      document: { kind: 'obstacle', entityId: o.id, field: 'title' },
                      getValue: () => o.title,
                      onRemoteValue: (value) => manuscript.updateObstacle(o.id, { title: value })
                    }}
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
                <div class="overflow-hidden rounded border border-border/60">
                  <ExpandableMarkdownEditor
                    value={o.description}
                    onChange={(next) => void manuscript.updateObstacle(o.id, { description: next })}
                    label="Description"
                    icon={Zap}
                    contextLabel={o.title}
                    height="h-20"
                    class="border-0"
                    collaboration={{ kind: 'obstacle', entityId: o.id, field: 'description' }}
                  />
                </div>
                <div
                  class="mt-2 flex items-start gap-2 border-t border-border pt-2 text-xs"
                >
                  <ShieldAlert class="mt-0.5 size-3 shrink-0 text-emerald-400/70" />
                  <div class="min-w-0 flex-1 overflow-hidden rounded border border-border/60">
                    <ExpandableMarkdownEditor
                      value={o.resolution}
                      onChange={(next) => void manuscript.updateObstacle(o.id, { resolution: next })}
                      label="Resolution"
                      icon={ShieldAlert}
                      contextLabel={o.title}
                      height="h-20"
                      class="border-0"
                      collaboration={{ kind: 'obstacle', entityId: o.id, field: 'resolution' }}
                    />
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </section>

      <!-- Climax -->
      <ExpandableMarkdownEditor
        value={manuscript.structure.climax}
        onChange={(next) => void manuscript.updateStructure({ climax: next })}
        label="Climax"
        icon={MountainSnow}
        contextLabel={manuscript.structure.title}
        height="h-52"
        class="mt-4"
        collaboration={{ kind: 'structure', entityId: manuscript.projectId ?? 'structure', field: 'climax' }}
      />
    </div>
  </div>
</div>
