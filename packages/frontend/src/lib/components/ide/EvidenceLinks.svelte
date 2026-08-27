<script lang="ts">
  import { ExternalLink, FileSearch, Link2 } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';

  export interface EvidenceRef {
    id?: string;
    unitId?: string | null;
    chapterId?: string | null;
    sceneId?: string | null;
    artifactId?: string | null;
    refType?: string | null;
    refId?: string | null;
    title?: string | null;
    excerpt?: string | null;
    lineStart?: number | null;
    lineEnd?: number | null;
    sourceSpan?: unknown;
  }

  interface Props {
    evidence: EvidenceRef[];
    compact?: boolean;
    onArtifact?: (artifactId: string) => void;
    onReference?: (refType: string, refId: string) => void;
    onUnit?: (unitId: string, range?: { start?: number; end?: number }) => void;
  }

  let {
    evidence,
    compact = false,
    onArtifact = () => undefined,
    onReference = () => undefined,
    onUnit = () => undefined
  }: Props = $props();

  function lineFromOffset(chapterId: string | null | undefined, offset: number | undefined): number | undefined {
    if (!chapterId || offset === undefined) return undefined;
    const content = manuscript.chapters.find((chapter) => chapter.id === chapterId)?.content;
    return content === undefined ? undefined : content.slice(0, Math.max(0, offset)).split('\n').length;
  }

  function chapterForScene(sceneId: string | null | undefined): string | undefined {
    if (!sceneId) return undefined;
    return manuscript.chapters.find((chapter) => chapter.scenes.some((scene) => scene.id === sceneId))?.id;
  }

  function parsedSpan(item: EvidenceRef): { lineStart?: number; lineEnd?: number; excerpt?: string; chapterId?: string } {
    if (!item.sourceSpan || typeof item.sourceSpan !== 'object') return {};
    const span = item.sourceSpan as Record<string, unknown>;
    const chapterId = item.chapterId
      ?? (typeof span.chapterId === 'string' ? span.chapterId : undefined)
      ?? chapterForScene(item.sceneId ?? (typeof span.sceneId === 'string' ? span.sceneId : undefined));
    const start = typeof span.start === 'number' ? span.start : undefined;
    const end = typeof span.end === 'number' ? span.end : undefined;
    return {
      chapterId,
      lineStart: typeof span.lineStart === 'number' ? span.lineStart : lineFromOffset(chapterId, start),
      lineEnd: typeof span.lineEnd === 'number' ? span.lineEnd : lineFromOffset(chapterId, end),
      excerpt: typeof span.excerpt === 'string' ? span.excerpt : typeof span.quote === 'string' ? span.quote : undefined
    };
  }

  function chapterLabel(item: EvidenceRef): string {
    const span = parsedSpan(item);
    const chapter = manuscript.chapters.find((candidate) => candidate.id === (item.chapterId ?? span.chapterId));
    const line = item.lineStart ?? span.lineStart;
    const base = item.title || chapter?.title || (item.unitId ? 'Build-branch evidence' : 'Story evidence');
    return line ? `${base} · line ${line}` : base;
  }

  function open(item: EvidenceRef) {
    const span = parsedSpan(item);
    const rawSpan = item.sourceSpan && typeof item.sourceSpan === 'object'
      ? item.sourceSpan as Record<string, unknown>
      : {};
    const unitId = item.unitId ?? (typeof rawSpan.unitId === 'string' ? rawSpan.unitId : null);
    if (unitId) {
      onUnit(unitId, {
        start: typeof rawSpan.start === 'number' ? rawSpan.start : undefined,
        end: typeof rawSpan.end === 'number' ? rawSpan.end : undefined
      });
      return;
    }
    const chapterId = item.chapterId ?? span.chapterId ?? chapterForScene(item.sceneId);
    if (chapterId) {
      void manuscript.navigateToChapter(chapterId, {
        line: item.lineStart ?? span.lineStart,
        endLine: item.lineEnd ?? span.lineEnd
      });
      return;
    }
    if (item.artifactId) onArtifact(item.artifactId);
    else if (item.refType && item.refId) onReference(item.refType, item.refId);
  }
</script>

{#if evidence.length > 0}
  <div class={compact ? 'space-y-1' : 'space-y-1.5'} aria-label="Evidence">
    {#each evidence as item, index (item.id ?? `${item.chapterId}-${item.artifactId}-${index}`)}
      {@const span = parsedSpan(item)}
      {@const rawSpan = item.sourceSpan && typeof item.sourceSpan === 'object' ? item.sourceSpan as Record<string, unknown> : {}}
      {@const canOpen = Boolean(item.unitId || rawSpan.unitId || item.chapterId || item.sceneId || span.chapterId || item.artifactId || (item.refType && item.refId))}
      <button
        type="button"
        disabled={!canOpen}
        onclick={() => open(item)}
        class="group flex w-full items-start gap-2 border-l border-accent/35 py-1 pl-2 text-left outline-none transition-colors enabled:hover:border-accent disabled:cursor-default focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35"
      >
        {#if item.chapterId}
          <FileSearch class="mt-0.5 size-3 shrink-0 text-accent/80" />
        {:else}
          <Link2 class="mt-0.5 size-3 shrink-0 text-accent/80" />
        {/if}
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1 text-[10px] font-medium text-foreground/90">
            <span class="truncate">{chapterLabel(item)}</span>
            {#if canOpen}<ExternalLink class="size-2.5 shrink-0 opacity-0 group-hover:opacity-80 group-focus-visible:opacity-80" />{/if}
          </span>
          {#if item.excerpt || span.excerpt}
            <span class="mt-0.5 line-clamp-2 block font-serif text-[11px] italic leading-relaxed text-muted-foreground">“{item.excerpt ?? span.excerpt}”</span>
          {/if}
          {#if item.sceneId}
            <span class="mt-0.5 block font-mono text-[9px] text-muted-foreground/70">scene:{item.sceneId}</span>
          {/if}
        </span>
      </button>
    {/each}
  </div>
{/if}
