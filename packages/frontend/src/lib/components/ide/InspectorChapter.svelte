<script lang="ts">
  import { Activity, Calendar, FileText, Hash, Target } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { Chapter, ChapterStatus } from '$lib/data/manuscript-types';
  import InspectorGroup from './InspectorGroup.svelte';
  import InspectorStat from './InspectorStat.svelte';

  interface Props {
    chapter: Chapter;
  }

  let { chapter }: Props = $props();

  const STATUSES: ChapterStatus[] = ['draft', 'in-progress', 'review', 'final'];

  const progress = $derived(Math.min(100, (chapter.wordCount / 5000) * 100));

  function setTitle(e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value;
    if (value !== chapter.title) {
      void manuscript.updateChapter(chapter.id, { title: value });
    }
  }

  function setStatus(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value as ChapterStatus;
    void manuscript.updateChapter(chapter.id, { status: value });
  }

  function setPov(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    void manuscript.updateChapter(chapter.id, { povCharacterId: value || undefined });
  }

  function setLocation(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    void manuscript.updateChapter(chapter.id, { locationId: value || undefined });
  }

  function setSummary(e: Event) {
    const value = (e.currentTarget as HTMLTextAreaElement).value;
    void manuscript.updateChapter(chapter.id, { summary: value });
  }

  async function togglePublished() {
    if (chapter.publishedAt) {
      await manuscript.updateChapter(chapter.id, { publishedAt: null });
    } else {
      await manuscript.updateChapter(chapter.id, { publishedAt: new Date().toISOString() });
    }
  }
</script>

<div class="p-3">
  <InspectorGroup title="Chapter">
    {#snippet children()}
      <div class="px-3 py-2">
        <label
          class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          for="chapter-title-{chapter.id}"
        >
          Title
        </label>
        <input
          id="chapter-title-{chapter.id}"
          value={chapter.title}
          onchange={setTitle}
          class="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-accent/60"
        />
      </div>
      <InspectorStat
        icon={Hash}
        label="Number"
        value={chapter.number === 0 ? 'Prologue' : `Ch. ${chapter.number}`}
      />
      <div class="flex items-center gap-3 px-3 py-2">
        <Activity class="size-3.5 shrink-0 text-muted-foreground" />
        <div class="flex-1 text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
        <select
          value={chapter.status}
          onchange={setStatus}
          class="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-accent/60"
        >
          {#each STATUSES as status (status)}
            <option value={status}>{status}</option>
          {/each}
        </select>
      </div>
      <InspectorStat
        icon={FileText}
        label="Word Count"
        value={chapter.wordCount.toLocaleString()}
        mono
      />
      <div class="px-3 py-2">
        <div class="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Progress to 5k</span>
          <span class="font-mono">{Math.round(progress)}%</span>
        </div>
        <div class="h-1 overflow-hidden rounded-full bg-muted">
          <div class="h-full bg-accent transition-all" style="width: {progress}%"></div>
        </div>
      </div>
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Connections">
    {#snippet children()}
      <div class="px-3 py-2">
        <label
          class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          for="chapter-pov-{chapter.id}"
        >
          POV Character
        </label>
        <select
          id="chapter-pov-{chapter.id}"
          value={chapter.povCharacterId ?? ''}
          onchange={setPov}
          class="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent/60"
        >
          <option value="">— None —</option>
          {#each manuscript.characters as character (character.id)}
            <option value={character.id}>{character.name}</option>
          {/each}
        </select>
      </div>
      <div class="border-t border-border px-3 py-2">
        <label
          class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          for="chapter-location-{chapter.id}"
        >
          Setting
        </label>
        <select
          id="chapter-location-{chapter.id}"
          value={chapter.locationId ?? ''}
          onchange={setLocation}
          class="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent/60"
        >
          <option value="">— None —</option>
          {#each manuscript.locations as location (location.id)}
            <option value={location.id}>{location.name}</option>
          {/each}
        </select>
      </div>
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Summary">
    {#snippet children()}
      <div class="px-3 py-2">
        <textarea
          value={chapter.summary}
          oninput={setSummary}
          rows={5}
          placeholder="A short synopsis of this chapter…"
          class="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs leading-relaxed text-foreground outline-none focus:border-accent/60"
        ></textarea>
      </div>
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Publishing">
    {#snippet children()}
      <div class="space-y-2 px-3 py-2 text-xs">
        <div class="flex items-center justify-between gap-2">
          <span class="text-muted-foreground">
            {chapter.publishedAt ? 'Published' : 'Draft (not public)'}
          </span>
          <button
            type="button"
            onclick={togglePublished}
            class={(chapter.publishedAt
              ? 'border-accent bg-accent text-accent-foreground'
              : 'border-border text-muted-foreground hover:bg-muted') +
              ' rounded-md border px-2 py-1 text-[11px]'}
          >
            {chapter.publishedAt ? 'Unpublish' : 'Publish'}
          </button>
        </div>
        {#if chapter.publishedAt}
          <p class="text-[10px] text-muted-foreground">
            Published {new Date(chapter.publishedAt).toLocaleString()}
          </p>
        {/if}
        {#if manuscript.projectMeta.visibility !== 'public'}
          <p class="text-[10px] text-muted-foreground">
            The project is private — make it public in Project Settings to expose published chapters.
          </p>
        {/if}
      </div>
    {/snippet}
  </InspectorGroup>

  <InspectorGroup title="Today">
    {#snippet children()}
      <InspectorStat icon={Calendar} label="Goal" value="1000 words" mono />
      <InspectorStat icon={Target} label="Streak" value="4 days" mono />
    {/snippet}
  </InspectorGroup>
</div>
