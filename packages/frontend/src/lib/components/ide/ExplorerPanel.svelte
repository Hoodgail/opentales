<script lang="ts">
  import {
    ChevronDown,
    ChevronRight,
    Clipboard,
    Copy,
    FileText,
    FilePlus,
    FolderOpen,
    FolderPlus,
    Pencil,
    Plus,
    Trash2
  } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { Chapter, ChapterStatus } from '$lib/data/manuscript-types';
  import { cn } from '$lib/utils';
  import ContextMenu from './ContextMenu.svelte';
  import type { ContextMenuItem } from './contextMenuTypes';
  import HeaderButton from './HeaderButton.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const statusDot: Record<ChapterStatus, string> = {
    draft: 'bg-muted-foreground/40',
    'in-progress': 'bg-accent',
    review: 'bg-chart-4',
    final: 'bg-emerald-500/70'
  };

  const statusLabel: Record<ChapterStatus, string> = {
    draft: 'Draft',
    'in-progress': 'Writing',
    review: 'Review',
    final: 'Final'
  };

  const openActs = $state<Record<string, boolean>>({
    'act-1': true,
    'act-2': true,
    'act-3': true
  });

  function toggle(id: string) {
    openActs[id] = !(openActs[id] ?? true);
  }

  const totalWords = $derived(
    manuscript.chapters.reduce((s, c) => s + c.wordCount, 0)
  );

  const orphanChapters = $derived(
    manuscript.chapters.filter(
      (c) => !manuscript.acts.some((act) => act.chapterIds.includes(c.id))
    )
  );

  async function newAct() {
    const next = manuscript.acts.length + 1;
    const created = await manuscript.createAct(`Act ${next}`);
    if (created) openActs[created.id] = true;
  }

  function newChapterInAct(actId: string | null) {
    void manuscript.createChapter({
      title: 'Untitled Chapter',
      ...(actId ? { actId } : {})
    });
    if (actId) openActs[actId] = true;
  }

  function newChapter() {
    const firstAct = manuscript.acts[0];
    newChapterInAct(firstAct?.id ?? null);
  }

  let menuOpen = $state(false);
  let menuPos = $state({ x: 0, y: 0 });
  let menuItems = $state<ContextMenuItem[]>([]);

  function openMenu(e: MouseEvent, items: ContextMenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    menuItems = items;
    menuPos = { x: e.clientX, y: e.clientY };
    menuOpen = true;
  }

  async function renameChapter(chapter: Chapter) {
    const next = window.prompt('Rename chapter', chapter.title)?.trim();
    if (!next || next === chapter.title) return;
    await manuscript.updateChapter(chapter.id, { title: next });
  }

  async function duplicateChapter(chapter: Chapter): Promise<void> {
    const parentAct = manuscript.acts.find((a) => a.chapterIds.includes(chapter.id));
    await manuscript.createChapter({
      title: `${chapter.title} (copy)`,
      content: chapter.content,
      summary: chapter.summary,
      status: chapter.status,
      ...(chapter.povCharacterId ? { povCharacterId: chapter.povCharacterId } : {}),
      ...(chapter.locationId ? { locationId: chapter.locationId } : {}),
      ...(parentAct ? { actId: parentAct.id } : {})
    });
  }

  async function copyChapterMarkdown(chapter: Chapter) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    const heading = `# ${chapter.title}\n\n`;
    await navigator.clipboard.writeText(heading + (chapter.content ?? ''));
  }

  async function deleteChapterConfirm(chapter: Chapter) {
    if (!window.confirm(`Move "${chapter.title}" to trash?`)) return;
    await manuscript.deleteChapter(chapter.id);
  }

  function chapterMenuItems(chapter: Chapter): ContextMenuItem[] {
    return [
      {
        id: 'rename',
        label: 'Rename…',
        icon: Pencil,
        onSelect: () => renameChapter(chapter)
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        icon: Copy,
        onSelect: () => duplicateChapter(chapter)
      },
      {
        id: 'copy-md',
        label: 'Copy as markdown',
        icon: Clipboard,
        onSelect: () => copyChapterMarkdown(chapter)
      },
      {
        id: 'delete',
        label: 'Delete chapter',
        icon: Trash2,
        danger: true,
        onSelect: () => deleteChapterConfirm(chapter)
      }
    ];
  }

  async function renameActHandler(actId: string, current: string) {
    const next = window.prompt('Rename act', current)?.trim();
    if (!next || next === current) return;
    await manuscript.renameAct(actId, next);
  }

  async function deleteActHandler(actId: string, title: string) {
    if (!window.confirm(`Delete act "${title}"? Chapters inside will be unfiled.`)) return;
    await manuscript.deleteAct(actId);
  }

  function actMenuItems(actId: string, title: string): ContextMenuItem[] {
    return [
      {
        id: 'rename',
        label: 'Rename act…',
        icon: Pencil,
        onSelect: () => renameActHandler(actId, title)
      },
      {
        id: 'new-chapter',
        label: 'New chapter in act',
        icon: FilePlus,
        onSelect: () => {
          newChapterInAct(actId);
        }
      },
      {
        id: 'delete-act',
        label: 'Delete act',
        icon: Trash2,
        danger: true,
        onSelect: () => deleteActHandler(actId, title)
      }
    ];
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Manuscript">
    {#snippet actions()}
      <HeaderButton icon={FolderPlus} label="New act" onclick={newAct} />
      <HeaderButton icon={Plus} label="New chapter" onclick={newChapter} />
    {/snippet}
  </PanelHeader>

  <div class="flex-1 overflow-y-auto py-1">
    {#each manuscript.acts as act (act.id)}
      {@const expanded = openActs[act.id] ?? true}
      {@const actChapters = act.chapterIds
        .map((id) => manuscript.chapters.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))}
      {@const actWords = actChapters.reduce((sum, c) => sum + c.wordCount, 0)}
      <div class="select-none">
        <button
          type="button"
          onclick={() => toggle(act.id)}
          oncontextmenu={(e) => openMenu(e, actMenuItems(act.id, act.title))}
          class="flex w-full items-center gap-1 px-2 py-1 text-left text-xs text-foreground/80 hover:bg-muted/50"
        >
          {#if expanded}
            <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
          {:else}
            <ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />
          {/if}
          <FolderOpen class="size-3.5 shrink-0 text-accent/80" />
          <span class="flex-1 truncate font-medium uppercase tracking-wide">{act.title}</span>
          <span class="font-mono text-[10px] text-muted-foreground">
            {actWords.toLocaleString()}
          </span>
        </button>

        {#if expanded}
          <div>
            {#if actChapters.length === 0}
              <div class="ml-7 py-1 text-[11px] italic text-muted-foreground">No chapters yet</div>
            {/if}
            {#each actChapters as ch (ch.id)}
              {@const tabId = `tab-${ch.id}`}
              {@const isActive = manuscript.activeTabId === tabId}
              {@const isSelected = manuscript.selectedId === ch.id}
              <button
                type="button"
                onclick={() => {
                  void manuscript.setSelectedId(ch.id);
                  void manuscript.openTab({ id: tabId, type: 'chapter', refId: ch.id, title: ch.title });
                }}
                oncontextmenu={(e) => openMenu(e, chapterMenuItems(ch))}
                class={cn(
                  'group flex w-full items-center gap-2 px-2 py-1 pl-7 text-left text-xs transition-colors',
                  isActive
                    ? 'bg-muted text-foreground'
                    : isSelected
                      ? 'bg-muted/40 text-foreground'
                      : 'text-foreground/75 hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <FileText class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="flex-1 truncate">
                  <span class="font-mono text-muted-foreground">
                    {ch.number === 0 ? 'P' : ch.number.toString().padStart(2, '0')}
                  </span>
                  <span class="ml-2">{ch.title}</span>
                </span>
                <span
                  class={cn('size-1.5 shrink-0 rounded-full', statusDot[ch.status])}
                  title={statusLabel[ch.status]}
                ></span>
              </button>
            {/each}
            <button
              type="button"
              onclick={() => newChapterInAct(act.id)}
              class="flex w-full items-center gap-2 px-2 py-1 pl-7 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <FilePlus class="size-3.5 shrink-0" />
              New chapter
            </button>
          </div>
        {/if}
      </div>
    {/each}

    {#if orphanChapters.length > 0}
      <div class="mt-2 border-t border-border/50 pt-2">
        <div class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Unfiled chapters
        </div>
        {#each orphanChapters as ch (ch.id)}
          {@const tabId = `tab-${ch.id}`}
          {@const isActive = manuscript.activeTabId === tabId}
          {@const isSelected = manuscript.selectedId === ch.id}
          <button
            type="button"
            onclick={() => {
              void manuscript.setSelectedId(ch.id);
              void manuscript.openTab({ id: tabId, type: 'chapter', refId: ch.id, title: ch.title });
            }}
            oncontextmenu={(e) => openMenu(e, chapterMenuItems(ch))}
            class={cn(
              'group flex w-full items-center gap-2 px-2 py-1 pl-7 text-left text-xs transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : isSelected
                  ? 'bg-muted/40 text-foreground'
                  : 'text-foreground/75 hover:bg-muted/50 hover:text-foreground'
            )}
          >
            <FileText class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="flex-1 truncate">
              <span class="font-mono text-muted-foreground">
                {ch.number === 0 ? 'P' : ch.number.toString().padStart(2, '0')}
              </span>
              <span class="ml-2">{ch.title}</span>
            </span>
            <span
              class={cn('size-1.5 shrink-0 rounded-full', statusDot[ch.status])}
              title={statusLabel[ch.status]}
            ></span>
          </button>
        {/each}
      </div>
    {/if}

    <ContextMenu
      open={menuOpen}
      x={menuPos.x}
      y={menuPos.y}
      items={menuItems}
      onClose={() => (menuOpen = false)}
    />

    {#if manuscript.acts.length === 0 && orphanChapters.length === 0}
      <div class="px-3 py-6 text-center text-[11px] text-muted-foreground">
        <p class="mb-3">No acts yet. Create one to start outlining your manuscript.</p>
        <button
          type="button"
          onclick={newAct}
          class="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-foreground/80 transition-colors hover:border-accent/60 hover:text-foreground"
        >
          <FolderPlus class="size-3.5" />
          New Act
        </button>
      </div>
    {/if}
  </div>

  <div
    class="border-t border-border bg-sidebar/60 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground"
  >
    <div class="flex items-center justify-between">
      <span>Total</span>
      <span class="font-mono">
        {totalWords.toLocaleString()} words
      </span>
    </div>
  </div>
</div>
