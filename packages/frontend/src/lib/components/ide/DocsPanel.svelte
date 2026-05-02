<script lang="ts">
  import {
    BookText,
    ChevronDown,
    ChevronRight,
    FileText,
    Folder,
    FolderPlus,
    Image,
    Lightbulb,
    Loader2,
    MessageSquare,
    Pencil,
    Plus,
    ScrollText,
    Sparkles,
    Trash2
  } from 'lucide-svelte';
  import type { ProjectDoc, ProjectDocKind, ProjectFolder, ProjectTreeAsset } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import ContextMenu from './ContextMenu.svelte';
  import type { ContextMenuItem } from './contextMenuTypes';
  import HeaderButton from './HeaderButton.svelte';
  import PanelHeader from './PanelHeader.svelte';

  type DragItem = { type: 'folder' | 'doc' | 'asset'; id: string };

  const projectId = $derived(manuscript.projectId);
  const fileTree = $derived(ai.fileTree);
  const docs = $derived(fileTree.docs);
  const folders = $derived(fileTree.folders);
  const assets = $derived(fileTree.assets);

  let loadedProjectId = $state<string | null>(null);
  let filter = $state<ProjectDocKind | 'all'>('all');
  let openFolders = $state<Record<string, boolean>>({});
  let menuOpen = $state(false);
  let menuPos = $state({ x: 0, y: 0 });
  let menuItems = $state<ContextMenuItem[]>([]);
  let dragging = $state<DragItem | null>(null);

  const kindSections: { kind: ProjectDocKind | 'all'; label: string }[] = [
    { kind: 'all', label: 'All' },
    { kind: 'instructions', label: 'Instructions' },
    { kind: 'note', label: 'Notes' },
    { kind: 'brainstorm', label: 'Brainstorms' },
    { kind: 'reference', label: 'Reference' },
    { kind: 'other', label: 'Other' }
  ];

  const kindIcons: Record<ProjectDocKind, typeof FileText> = {
    instructions: Sparkles,
    note: MessageSquare,
    brainstorm: Lightbulb,
    reference: BookText,
    other: ScrollText
  };

  $effect(() => {
    const pid = projectId;
    if (pid && loadedProjectId !== pid) {
      loadedProjectId = pid;
      void ai.loadFileTree(pid);
    }
  });

  const visibleDocs = $derived(filter === 'all' ? docs : docs.filter((doc) => doc.kind === filter));
  const rootFolders = $derived(folders.filter((folder) => !folder.parentFolderId).sort(sortByOrderName));
  const rootDocs = $derived(visibleDocs.filter((doc) => !doc.folderId).sort(sortByOrderTitle));

  function sortByOrderName(a: { order: number; name: string }, b: { order: number; name: string }) {
    return a.order - b.order || a.name.localeCompare(b.name);
  }

  function sortByOrderTitle(a: { order?: number; title: string }, b: { order?: number; title: string }) {
    return (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title);
  }

  function childFolders(folderId: string) {
    return folders.filter((folder) => folder.parentFolderId === folderId).sort(sortByOrderName);
  }

  function childDocs(folderId: string) {
    return visibleDocs.filter((doc) => doc.folderId === folderId).sort(sortByOrderTitle);
  }

  function childAssets(folderId: string) {
    return assets.filter((asset) => asset.folderId === folderId).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  function setFilter(next: ProjectDocKind | 'all') {
    filter = next;
  }

  function openMenu(e: MouseEvent, items: ContextMenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    menuItems = items;
    menuPos = { x: e.clientX, y: e.clientY };
    menuOpen = true;
  }

  async function createNew(folderId: string | null = null) {
    if (!projectId) return;
    const doc = await ai.createDoc(projectId, { title: 'Untitled Doc', kind: 'note', folderId });
    if (doc) openDoc(doc);
  }

  async function createFolder(parentFolderId: string | null = null) {
    if (!projectId) return;
    const name = window.prompt('Folder name', 'New Folder')?.trim();
    if (!name) return;
    const folder = await ai.createFolder(projectId, { name, parentFolderId });
    if (folder) openFolders[folder.id] = true;
  }

  async function renameDoc(doc: ProjectDoc) {
    if (!projectId) return;
    const title = window.prompt('Rename document', doc.title)?.trim();
    if (!title || title === doc.title) return;
    const updated = await ai.updateDoc(projectId, doc.id, { title });
    if (updated) updateTabTitle(doc.id, updated.title);
  }

  async function renameFolder(folder: ProjectFolder) {
    if (!projectId) return;
    const name = window.prompt('Rename folder', folder.name)?.trim();
    if (!name || name === folder.name) return;
    await ai.updateFolder(projectId, folder.id, { name });
  }

  async function renameAsset(asset: ProjectTreeAsset) {
    if (!projectId) return;
    const name = window.prompt('Rename asset', asset.name)?.trim();
    if (!name || name === asset.name) return;
    await ai.updateAsset(projectId, asset.id, { name });
  }

  async function deleteDocConfirm(doc: ProjectDoc) {
    if (!projectId) return;
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    await ai.deleteDoc(projectId, doc.id);
    void manuscript.closeTab(`tab-doc-${doc.id}`);
  }

  async function deleteFolderConfirm(folder: ProjectFolder) {
    if (!projectId) return;
    if (!window.confirm(`Delete folder "${folder.name}" and everything inside it?`)) return;
    await ai.deleteFolder(projectId, folder.id);
  }

  async function deleteAssetConfirm(asset: ProjectTreeAsset) {
    if (!projectId) return;
    if (!window.confirm(`Delete asset "${asset.name}"?`)) return;
    await ai.deleteAsset(projectId, asset.id);
  }

  function openDoc(doc: ProjectDoc) {
    void manuscript.openTab({ id: `tab-doc-${doc.id}`, type: 'doc', refId: doc.id, title: doc.title });
  }

  function updateTabTitle(docId: string, title: string) {
    const tab = manuscript.tabs.find((t) => t.id === `tab-doc-${docId}`);
    if (tab) tab.title = title;
  }

  function toggleFolder(folderId: string) {
    openFolders[folderId] = !(openFolders[folderId] ?? true);
  }

  function folderMenuItems(folder: ProjectFolder): ContextMenuItem[] {
    return [
      { id: 'new-doc', label: 'New doc', icon: Plus, onSelect: () => createNew(folder.id) },
      { id: 'new-folder', label: 'New folder', icon: FolderPlus, onSelect: () => createFolder(folder.id) },
      { id: 'rename', label: 'Rename folder...', icon: Pencil, onSelect: () => renameFolder(folder) },
      { id: 'move-root', label: 'Move to root', icon: Folder, disabled: !folder.parentFolderId, onSelect: () => moveItem({ type: 'folder', id: folder.id }, null) },
      { id: 'delete', label: 'Delete folder', icon: Trash2, danger: true, onSelect: () => deleteFolderConfirm(folder) }
    ];
  }

  function docMenuItems(doc: ProjectDoc): ContextMenuItem[] {
    return [
      { id: 'rename', label: 'Rename...', icon: Pencil, onSelect: () => renameDoc(doc) },
      { id: 'move-root', label: 'Move to root', icon: Folder, disabled: !doc.folderId, onSelect: () => moveItem({ type: 'doc', id: doc.id }, null) },
      { id: 'delete', label: 'Delete document', icon: Trash2, danger: true, onSelect: () => deleteDocConfirm(doc) }
    ];
  }

  function assetMenuItems(asset: ProjectTreeAsset): ContextMenuItem[] {
    return [
      { id: 'rename', label: 'Rename...', icon: Pencil, onSelect: () => renameAsset(asset) },
      { id: 'move-root', label: 'Remove from tree', icon: Folder, onSelect: () => moveItem({ type: 'asset', id: asset.id }, null) },
      { id: 'delete', label: 'Delete asset', icon: Trash2, danger: true, onSelect: () => deleteAssetConfirm(asset) }
    ];
  }

  async function moveItem(item: DragItem, folderId: string | null) {
    if (!projectId) return;
    if (item.type === 'doc') await ai.updateDoc(projectId, item.id, { folderId });
    if (item.type === 'folder') await ai.updateFolder(projectId, item.id, { parentFolderId: folderId });
    if (item.type === 'asset') await ai.updateAsset(projectId, item.id, { folderId });
  }

  function startDrag(item: DragItem, e: DragEvent) {
    dragging = item;
    e.dataTransfer?.setData('application/opentales-tree-item', JSON.stringify(item));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function draggedItem(e: DragEvent): DragItem | null {
    if (dragging) return dragging;
    const raw = e.dataTransfer?.getData('application/opentales-tree-item');
    if (!raw) return null;
    try { return JSON.parse(raw) as DragItem; } catch { return null; }
  }

  function canDrop(item: DragItem | null, folderId: string | null) {
    if (!item) return false;
    if (item.type !== 'folder') return true;
    if (item.id === folderId) return false;
    const target = folderId ? folders.find((folder) => folder.id === folderId) : null;
    const source = folders.find((folder) => folder.id === item.id);
    return !target || !source || !target.path.startsWith(`${source.path}/`);
  }

  async function dropOn(folderId: string | null, e: DragEvent) {
    e.preventDefault();
    const item = draggedItem(e);
    dragging = null;
    if (!canDrop(item, folderId) || !item) return;
    await moveItem(item, folderId);
  }
</script>

<div role="tree" tabindex="-1" class="flex h-full flex-col" ondragover={(e) => { if (canDrop(draggedItem(e), null)) e.preventDefault(); }} ondrop={(e) => dropOn(null, e)}>
  <PanelHeader title="Docs & Notes">
    {#snippet actions()}
      <HeaderButton icon={FolderPlus} label="New folder" onclick={() => createFolder(null)} />
      <HeaderButton icon={Plus} label="New doc" onclick={() => createNew(null)} />
    {/snippet}
  </PanelHeader>

  <div class="flex gap-0.5 overflow-x-auto border-b border-border px-2 py-1 [scrollbar-width:none]">
    {#each kindSections as sec (sec.kind)}
      <button type="button" onclick={() => setFilter(sec.kind)} class={cn('shrink-0 rounded px-2 py-1 text-[10px] transition-colors', filter === sec.kind ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>{sec.label}</button>
    {/each}
  </div>

  <div class="flex-1 overflow-y-auto py-1">
    {#if ai.docsLoading}
      <div class="flex items-center gap-2 p-4 text-[11px] text-muted-foreground"><Loader2 class="size-3.5 animate-spin" />Loading docs...</div>
    {:else if rootFolders.length === 0 && rootDocs.length === 0}
      <div class="p-4 text-center text-[11px] text-muted-foreground">
        <p class="mb-3">No docs yet.</p>
        <button type="button" onclick={() => createNew(null)} class="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-foreground/80 hover:border-accent/60 hover:text-foreground"><Plus class="size-3.5" />New Doc</button>
      </div>
    {:else}
      {#each rootFolders as folder (folder.id)}
        {@render folderRow(folder, 0)}
      {/each}
      {#each rootDocs as doc (doc.id)}
        {@render docRow(doc, 0)}
      {/each}
    {/if}

    {#if ai.docsError}<p class="px-3 py-2 text-[11px] text-destructive">{ai.docsError}</p>{/if}
  </div>

  <ContextMenu open={menuOpen} x={menuPos.x} y={menuPos.y} items={menuItems} onClose={() => (menuOpen = false)} />

  <div class="border-t border-border bg-sidebar/60 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
    <div class="flex items-center justify-between"><span>Docs</span><span class="font-mono">{docs.length}</span></div>
  </div>
</div>

{#snippet folderRow(folder: ProjectFolder, depth: number)}
  {@const expanded = openFolders[folder.id] ?? true}
  <div>
    <button
      type="button"
      draggable="true"
      ondragstart={(e) => startDrag({ type: 'folder', id: folder.id }, e)}
      ondragover={(e) => { if (canDrop(draggedItem(e), folder.id)) e.preventDefault(); }}
      ondrop={(e) => dropOn(folder.id, e)}
      onclick={() => toggleFolder(folder.id)}
      oncontextmenu={(e) => openMenu(e, folderMenuItems(folder))}
      class="flex w-full items-center gap-1 px-2 py-1 text-left text-xs text-foreground/80 hover:bg-muted/50"
      style={`padding-left: ${8 + depth * 14}px`}
    >
      {#if expanded}<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />{:else}<ChevronRight class="size-3.5 shrink-0 text-muted-foreground" />{/if}
      <Folder class="size-3.5 shrink-0 text-accent/80" />
      <span class="flex-1 truncate font-medium">{folder.name}</span>
    </button>
    {#if expanded}
      {#each childFolders(folder.id) as child (child.id)}{@render folderRow(child, depth + 1)}{/each}
      {#each childDocs(folder.id) as doc (doc.id)}{@render docRow(doc, depth + 1)}{/each}
      {#each childAssets(folder.id) as asset (asset.id)}{@render assetRow(asset, depth + 1)}{/each}
    {/if}
  </div>
{/snippet}

{#snippet docRow(doc: ProjectDoc, depth: number)}
  {@const isActive = manuscript.activeTabId === `tab-doc-${doc.id}`}
  {@const Icon = kindIcons[doc.kind] ?? FileText}
  <button
    type="button"
    draggable="true"
    ondragstart={(e) => startDrag({ type: 'doc', id: doc.id }, e)}
    onclick={() => openDoc(doc)}
    oncontextmenu={(e) => openMenu(e, docMenuItems(doc))}
    class={cn('group flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors', isActive ? 'bg-muted text-foreground' : 'text-foreground/75 hover:bg-muted/50 hover:text-foreground')}
    style={`padding-left: ${27 + depth * 14}px`}
  >
    <Icon class={cn('size-3.5 shrink-0', doc.kind === 'instructions' ? 'text-accent/70' : 'text-muted-foreground')} />
    <span class="min-w-0 flex-1 truncate">{doc.title}</span>
    {#if doc.kind === 'instructions'}<span class="rounded bg-accent/15 px-1 text-[9px] text-accent">AI</span>{/if}
  </button>
{/snippet}

{#snippet assetRow(asset: ProjectTreeAsset, depth: number)}
  <button
    type="button"
    draggable="true"
    ondragstart={(e) => startDrag({ type: 'asset', id: asset.id }, e)}
    oncontextmenu={(e) => openMenu(e, assetMenuItems(asset))}
    class="group flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-xs text-foreground/75 transition-colors hover:bg-muted/50 hover:text-foreground"
    style={`padding-left: ${27 + depth * 14}px`}
  >
    <Image class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate">{asset.name}</span>
  </button>
{/snippet}
