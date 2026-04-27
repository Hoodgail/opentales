<script lang="ts">
  import { Eye, Focus, Hash, MapPin, Type, User } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import type { Chapter, ChapterStatus } from '$lib/data/manuscript-types';
  import { cn } from '$lib/utils';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import MonacoMarkdownEditor from './MonacoMarkdownEditor.svelte';

  interface Props {
    chapter: Chapter;
  }

  let { chapter }: Props = $props();

  const statusColor: Record<ChapterStatus, string> = {
    draft: 'bg-muted-foreground/30 text-muted-foreground',
    'in-progress': 'bg-accent/20 text-accent',
    review: 'bg-chart-4/20 text-chart-4',
    final: 'bg-emerald-500/20 text-emerald-400'
  };

  let splitView = $state(false);
  let localContent = $state('');
  let lastChapterId = $state<string | null>(null);

  // When the active chapter switches, re-prime the local buffer with the
  // chapter's persisted content. This effect runs both on mount and on prop
  // changes since `chapter` is captured via `$derived`-style read access.
  $effect(() => {
    if (chapter.id !== lastChapterId) {
      lastChapterId = chapter.id;
      localContent = chapter.content;
    }
  });

  const pov = $derived(manuscript.characters.find((c) => c.id === chapter.povCharacterId));
  const location = $derived(manuscript.locations.find((l) => l.id === chapter.locationId));

  function handleChange(next: string) {
    localContent = next;
    void manuscript.updateChapterContent(chapter.id, next);
  }
</script>

<div class="flex h-full flex-col bg-background">
  <!-- Breadcrumb / chapter header -->
  <div
    class="flex h-10 shrink-0 items-center justify-between border-b border-border bg-sidebar/40 px-4 text-xs"
  >
    <div class="flex items-center gap-3 text-muted-foreground">
      <Hash class="size-3.5" />
      <span class="font-mono">
        {chapter.number === 0
          ? 'Prologue'
          : `Chapter ${chapter.number.toString().padStart(2, '0')}`}
      </span>
      <span class="text-muted-foreground/50">/</span>
      <span class="text-foreground">{chapter.title}</span>
      <span
        class={cn(
          'ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
          statusColor[chapter.status]
        )}
      >
        {chapter.status === 'in-progress' ? 'Writing' : chapter.status}
      </span>
    </div>

    <div class="flex items-center gap-3">
      {#if pov}
        <div class="flex items-center gap-1.5 text-muted-foreground">
          <User class="size-3" />
          <span>POV: {pov.name}</span>
        </div>
      {/if}
      {#if location}
        <div class="flex items-center gap-1.5 text-muted-foreground">
          <MapPin class="size-3" />
          <span>{location.name}</span>
        </div>
      {/if}
      <button
        type="button"
        onclick={() => preferences.setTypewriterMode(!preferences.typewriterMode)}
        title="Typewriter mode (active line stays centered)"
        class={cn(
          'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
          preferences.typewriterMode
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Type class="size-3" />
        Typewriter
      </button>
      <button
        type="button"
        onclick={() => preferences.setFocusMode(!preferences.focusMode)}
        title="Focus mode (dim everything but the current paragraph)"
        class={cn(
          'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
          preferences.focusMode
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Focus class="size-3" />
        Focus
      </button>
      <button
        type="button"
        onclick={() => (splitView = !splitView)}
        class={cn(
          'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
          splitView
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Eye class="size-3" />
        Preview
      </button>
    </div>
  </div>

  <!-- Editor + preview -->
  <div class="flex min-h-0 flex-1">
    <div class={cn('min-h-0', splitView ? 'w-1/2 border-r border-border' : 'w-full')}>
      <MonacoMarkdownEditor value={localContent} onChange={handleChange} />
    </div>
    {#if splitView}
      <div class="w-1/2 overflow-y-auto bg-background px-10 py-8">
        <MarkdownPreview content={localContent} />
      </div>
    {/if}
  </div>
</div>
