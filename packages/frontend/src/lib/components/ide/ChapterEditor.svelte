<script lang="ts">
  import { Eye, Focus, Hash, MapPin, MessageSquare, MessagesSquare, Sparkles, Type, User } from 'lucide-svelte';
  import type { WritingAnnotationKind, WritingAnnotationThread } from '@opentales/sdk';
  import type { EditorTextSelection } from '$lib/editor-annotations';
  import { annotationMarkers } from '$lib/revision-ui';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { viewport } from '$lib/stores/viewport.svelte';
  import { revisions } from '$lib/stores/revisions.svelte';
  import type { Chapter, ChapterStatus } from '$lib/data/manuscript-types';
  import { cn } from '$lib/utils';
  import AiDialogueDialog from './AiDialogueDialog.svelte';
  import AiRewriteDialog from './AiRewriteDialog.svelte';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import MonacoMarkdownEditor from './MonacoMarkdownEditor.svelte';
  import EditorAnnotationsSidecar from './EditorAnnotationsSidecar.svelte';

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
  let lastPersistedContent = $state('');
  let selectedText = $state('');
  let showRewrite = $state(false);
  let showDialogue = $state(false);
  let annotationsOpen = $state(false);
  let annotationSelection = $state<EditorTextSelection | null>(null);
  let annotationReveal = $state<{ start: number; end: number; nonce: number } | null>(null);
  let loadedAnnotationChapterId = $state<string | null>(null);

  $effect(() => {
    const projectId = manuscript.projectId;
    if (projectId && loadedAnnotationChapterId !== chapter.id) {
      loadedAnnotationChapterId = chapter.id;
      void revisions.loadAnnotations(projectId, { chapterId: chapter.id });
    }
  });

  // When the active chapter switches, re-prime the local buffer with the
  // chapter's persisted content. This effect runs both on mount and on prop
  // changes since `chapter` is captured via `$derived`-style read access.
  $effect(() => {
    if (chapter.id !== lastChapterId) {
      lastChapterId = chapter.id;
      localContent = chapter.content;
    } else if (localContent === lastPersistedContent && chapter.content !== localContent) {
      localContent = chapter.content;
    }
    lastPersistedContent = chapter.content;
  });

  const pov = $derived(manuscript.characters.find((c) => c.id === chapter.povCharacterId));
  const location = $derived(manuscript.locations.find((l) => l.id === chapter.locationId));

  function handleChange(next: string) {
    localContent = next;
    void manuscript.updateChapterContent(chapter.id, next);
  }

  function handleSelection(text: string) {
    selectedText = text;
  }

  function navigateAnnotation(thread: WritingAnnotationThread) {
    revisions.selectAnnotation(thread.id);
    annotationReveal = { start: thread.start, end: thread.end, nonce: (annotationReveal?.nonce ?? 0) + 1 };
  }

  async function createAnnotation(kind: WritingAnnotationKind, body: string, suggestedReplacement: string | null) {
    if (!manuscript.projectId || !annotationSelection) return null;
    const persisted = await manuscript.flushChapterContent(chapter.id);
    if (!persisted?.branchId || !persisted.headVersionId) {
      revisions.reportAnnotationError('Save the latest chapter text before creating an annotation.');
      return null;
    }
    return revisions.createAnnotation(manuscript.projectId, {
      writingId: persisted.writingId,
      branchId: persisted.branchId,
      versionId: persisted.headVersionId,
      chapterId: chapter.id,
      kind,
      start: annotationSelection.start,
      end: annotationSelection.end,
      quote: annotationSelection.quote,
      body,
      suggestedReplacement
    });
  }

  async function acceptAnnotation(thread: WritingAnnotationThread) {
    if (manuscript.hasPendingChapterSave(chapter.id)) {
      const persisted = await manuscript.flushChapterContent(chapter.id);
      if (!persisted) {
        revisions.reportAnnotationError('The latest chapter text could not be saved. The suggestion was not applied.');
        return null;
      }
    }
    const current = manuscript.chapters.find((candidate) => candidate.id === chapter.id);
    if (!current?.headVersionId || thread.anchorVersionId !== current.headVersionId) {
      if (manuscript.projectId) await revisions.loadAnnotations(manuscript.projectId, { chapterId: chapter.id });
      revisions.reportAnnotationError('This suggestion is anchored to an older chapter version. Review the refreshed thread before applying it.');
      return null;
    }
    const accepted = await revisions.acceptSuggestion(thread, current.headVersionId);
    if (accepted && manuscript.projectId) await manuscript.refreshProject(manuscript.projectId);
    return accepted;
  }

  function openRewrite() {
    if (!selectedText.trim()) return;
    ai.clearFeatureResults();
    showRewrite = true;
  }

  function acceptRewrite(text: string) {
    localContent = localContent.replace(selectedText, text);
    void manuscript.updateChapterContent(chapter.id, localContent);
    showRewrite = false;
    selectedText = '';
  }

  function openDialogue() {
    ai.clearFeatureResults();
    showDialogue = true;
  }

  function insertDialogueLine(line: string) {
    const insertion = `\n"${line}"\n`;
    localContent += insertion;
    void manuscript.updateChapterContent(chapter.id, localContent);
  }
</script>

<div class="flex h-full flex-col bg-background">
  <!-- Breadcrumb / chapter header -->
  <div
    class="flex min-h-11 shrink-0 items-center justify-between gap-3 overflow-x-auto border-b border-border bg-sidebar/40 px-4 text-xs [scrollbar-width:none]"
  >
    <div class="flex min-w-0 items-center gap-3 text-muted-foreground">
      <Hash class="size-3.5" />
      <span class="font-mono">
        {chapter.number === 0
          ? 'Prologue'
          : `Chapter ${chapter.number.toString().padStart(2, '0')}`}
      </span>
      <span class="text-muted-foreground/50">/</span>
      <span class="max-w-[42vw] truncate text-foreground sm:max-w-none">{chapter.title}</span>
      <span
        class={cn(
          'ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
          statusColor[chapter.status]
        )}
      >
        {chapter.status === 'in-progress' ? 'Writing' : chapter.status}
      </span>
    </div>

    <div class="flex shrink-0 items-center gap-2 sm:gap-3">
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
        onclick={() => (annotationsOpen = !annotationsOpen)}
        aria-expanded={annotationsOpen}
        title="Comments, notes, and tracked suggestions"
        class={cn(
          'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
          viewport.mobile ? 'tap-target' : '',
          annotationsOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <MessagesSquare class="size-3" />
        Comments
        {#if revisions.annotations.filter((thread) => thread.status === 'open').length}<span class="rounded bg-accent/15 px-1 font-mono text-[9px] text-accent">{revisions.annotations.filter((thread) => thread.status === 'open').length}</span>{/if}
      </button>
      <button
        type="button"
        onclick={() => preferences.setTypewriterMode(!preferences.typewriterMode)}
        title="Typewriter mode (active line stays centered)"
        class={cn(
          'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
          viewport.mobile ? 'tap-target' : '',
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
          viewport.mobile ? 'tap-target' : '',
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
          viewport.mobile ? 'tap-target' : '',
          splitView
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Eye class="size-3" />
        Preview
      </button>
      {#if ai.settings?.enabled}
        <button
          type="button"
          onclick={openRewrite}
          disabled={!selectedText.trim()}
          title={selectedText.trim() ? 'AI Rewrite selection' : 'Select text to rewrite'}
          class={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
            viewport.mobile ? 'tap-target' : '',
            selectedText.trim()
              ? 'text-accent hover:bg-accent/10'
              : 'text-muted-foreground/40 cursor-not-allowed'
          )}
        >
          <Sparkles class="size-3" />
          Rewrite
        </button>
        <button
          type="button"
          onclick={openDialogue}
          title="Generate character dialogue"
          class={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
            viewport.mobile ? 'tap-target' : '',
            'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <MessageSquare class="size-3" />
          Dialogue
        </button>
      {/if}
    </div>
  </div>

  <!-- Editor + preview -->
  <div class="relative flex min-h-0 flex-1">
    <div class={cn('min-h-0 min-w-0 flex-1', splitView && !annotationsOpen ? 'w-1/2 border-r border-border' : 'w-full')} inert={annotationsOpen && viewport.mobile ? true : undefined} aria-hidden={annotationsOpen && viewport.mobile ? 'true' : undefined}>
      <MonacoMarkdownEditor
        value={localContent}
        onChange={handleChange}
        onSelectionChange={handleSelection}
        onSelectionRangeChange={(selection) => (annotationSelection = selection)}
        annotations={annotationMarkers(revisions.annotations.filter((thread) => thread.anchorVersionId === chapter.headVersionId))}
        activeAnnotationId={revisions.selectedAnnotationId}
        onAnnotationActivate={(id) => { annotationsOpen = true; revisions.selectAnnotation(id); }}
        revealOffset={annotationReveal}
        nativeSpellcheck={true}
        collaboration={{ kind: 'chapter', entityId: chapter.id, field: 'content' }}
        reveal={manuscript.navigationTarget?.chapterId === chapter.id
          ? manuscript.navigationTarget
          : null}
      />
    </div>
    {#if splitView && !annotationsOpen}
      <div class="w-1/2 overflow-y-auto bg-background px-10 py-8">
        <MarkdownPreview content={localContent} />
      </div>
    {/if}
    {#if annotationsOpen}
      <div class={cn('z-20 min-h-0 shrink-0', viewport.mobile ? 'absolute inset-0' : '')}>
        <EditorAnnotationsSidecar
          threads={revisions.annotations}
          selectedId={revisions.selectedAnnotationId}
          selection={annotationSelection}
          currentVersionId={chapter.headVersionId}
          loading={revisions.loadingAnnotations}
          busy={revisions.mutating}
          error={revisions.annotationError}
          onClose={() => (annotationsOpen = false)}
          onSelect={(id) => revisions.selectAnnotation(id)}
          onNavigate={navigateAnnotation}
          onCreate={createAnnotation}
          onReply={(thread, body) => revisions.reply(thread, body)}
          onResolve={(thread) => revisions.resolve(thread)}
          onReopen={(thread) => revisions.reopen(thread)}
          onAccept={acceptAnnotation}
          onReject={(thread) => revisions.rejectSuggestion(thread)}
        />
      </div>
    {/if}
  </div>
</div>

{#if showRewrite}
  <AiRewriteDialog
    text={selectedText}
    onAccept={acceptRewrite}
    onClose={() => (showRewrite = false)}
  />
{/if}

{#if showDialogue}
  <AiDialogueDialog
    onInsert={insertDialogueLine}
    onClose={() => (showDialogue = false)}
  />
{/if}
