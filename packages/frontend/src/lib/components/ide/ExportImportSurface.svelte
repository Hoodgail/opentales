<script lang="ts">
  import { Archive, Check, Download, FileInput, FileOutput, RefreshCw, ShieldCheck, Trash2, Upload } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import type { ProjectExportFormat, ProjectExportPreset } from '@opentales/sdk';
  import { exportImport } from '$lib/stores/exportImport.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';

  let format = $state<ProjectExportFormat>('docx');
  let preset = $state<ProjectExportPreset>('standard-manuscript');
  let target = $state<'main' | 'build'>('main');
  let buildRunId = $state('');
  let authorName = $state('');
  let includeTitlePage = $state(true);
  let includeAssets = $state(false);
  let confirmConflicts = $state(false);
  let restoreStructuredState = $state(false);
  let restoreBuildRunId = $state('');
  let fileInput: HTMLInputElement | undefined = $state();

  const projectId = $derived(manuscript.projectId);
  const canExport = $derived(Boolean(projectId && (target === 'main' || buildRunId) && !exportImport.busy));
  const canApply = $derived(Boolean(exportImport.preview?.status === 'previewed' && (!exportImport.preview.conflicts.length || confirmConflicts) && (!restoreStructuredState || restoreBuildRunId) && !exportImport.busy));

  onMount(() => {
    if (!projectId) return;
    void Promise.all([exportImport.load(projectId), storyIde.loadRuns(projectId)]).then(() => {
      if (!buildRunId && storyIde.selectedRunId) buildRunId = storyIde.selectedRunId;
    });
  });

  async function generate() {
    if (!projectId || !canExport) return;
    await exportImport.createExport({
      idempotencyKey: crypto.randomUUID(),
      format,
      preset,
      target: target === 'main' ? { kind: 'main' } : { kind: 'build', buildRunId },
      options: { authorName: authorName.trim() || undefined, includeTitlePage, includeAssets, chapterNumbering: true }
    });
  }

  async function previewFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    confirmConflicts = false;
    await exportImport.previewFile(file);
  }

  async function applyImport() {
    if (!canApply) return;
    const applied = await exportImport.applyPreview({
      confirmConflicts,
      restoreStructuredState,
      targetBuildRunId: restoreStructuredState ? restoreBuildRunId : null
    });
    if (applied?.status === 'applied') await manuscript.refreshProject(projectId ?? undefined);
  }

  function size(value: number | null): string {
    if (value === null) return '—';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<div class="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
  <header class="border-b border-border bg-sidebar/70 px-6 py-5">
    <div class="mx-auto flex max-w-6xl items-start justify-between gap-4">
      <div><p class="font-mono text-[9px] uppercase tracking-[0.18em] text-accent">Publishing pipeline</p><h1 class="mt-1 text-xl font-semibold">Export & Import</h1><p class="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Generate verified private deliverables from main or an isolated Novel Build, or preview external manuscripts before any versioned project change.</p></div>
      <div class="flex items-center gap-2 rounded border border-border bg-card px-3 py-2 text-[10px] text-muted-foreground"><ShieldCheck class="size-4 text-accent" /> Private authenticated files</div>
    </div>
  </header>

  <main class="mx-auto grid w-full max-w-6xl gap-5 p-6 xl:grid-cols-2">
    {#if exportImport.error}<div class="xl:col-span-2 flex items-start justify-between gap-3 border-l-2 border-destructive bg-destructive/8 px-4 py-3 text-xs text-destructive-foreground" role="alert"><span>{exportImport.error}</span><button type="button" onclick={exportImport.clearError} class="underline">Dismiss</button></div>{/if}
    {#if exportImport.progress}<div class="xl:col-span-2 flex items-center gap-2 border border-accent/30 bg-accent/8 px-4 py-3 text-xs" role="status"><RefreshCw class="size-3.5 animate-spin text-accent" />{exportImport.progress}</div>{/if}

    <section class="rounded-lg border border-border bg-card p-5" aria-labelledby="export-heading">
      <div class="flex items-center gap-2"><FileOutput class="size-4 text-accent" /><h2 id="export-heading" class="text-sm font-semibold">Create export</h2></div>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <label class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Format<select bind:value={format} class="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs normal-case text-foreground"><option value="docx">DOCX manuscript</option><option value="pdf">PDF submission</option><option value="epub">EPUB 3</option><option value="markdown">Markdown bundle</option><option value="text">Plain text</option><option value="html">HTML</option><option value="project-archive">OpenTales project archive</option></select></label>
        <label class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Preset<select bind:value={preset} class="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs normal-case text-foreground"><option value="standard-manuscript">Standard manuscript</option><option value="reading-copy">Reading copy</option><option value="ebook">E-book</option><option value="web">Web</option><option value="archive">Archive</option></select></label>
        <label class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Source<select bind:value={target} class="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs normal-case text-foreground"><option value="main">Main manuscript</option><option value="build">Novel Build branch</option></select></label>
        {#if target === 'build'}<label class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Build<select bind:value={buildRunId} class="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs normal-case text-foreground"><option value="">Choose a build…</option>{#each storyIde.runs as run (run.id)}<option value={run.id}>{run.objective} · {run.status}</option>{/each}</select></label>{:else}<label class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Author<input bind:value={authorName} placeholder="Project owner" class="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs normal-case text-foreground" /></label>{/if}
      </div>
      <div class="mt-4 flex flex-wrap gap-4 text-xs"><label class="flex items-center gap-2"><input type="checkbox" bind:checked={includeTitlePage} /> Title page</label>{#if format === 'project-archive'}<label class="flex items-center gap-2"><input type="checkbox" bind:checked={includeAssets} /> Include project asset bytes</label>{/if}</div>
      <button type="button" disabled={!canExport} onclick={() => void generate()} class="mt-5 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"><FileOutput class="size-3.5" /> Generate & validate</button>
    </section>

    <section class="rounded-lg border border-border bg-card p-5" aria-labelledby="import-heading">
      <div class="flex items-center gap-2"><FileInput class="size-4 text-accent" /><h2 id="import-heading" class="text-sm font-semibold">Import manuscript</h2></div>
      <p class="mt-2 text-xs leading-relaxed text-muted-foreground">DOCX, Markdown, text, HTML, and OpenTales archives are parsed into a read-only preview first. Conflicting chapters are never overwritten without confirmation.</p>
      <input bind:this={fileInput} type="file" class="sr-only" accept=".docx,.md,.markdown,.txt,.html,.htm,.zip,.json" onchange={(event) => void previewFile(event)} />
      <button type="button" disabled={exportImport.busy} onclick={() => fileInput?.click()} class="mt-5 inline-flex items-center gap-2 rounded border border-border bg-background px-4 py-2 text-xs font-semibold hover:border-accent/60 disabled:opacity-40"><Upload class="size-3.5" /> Choose file & preview</button>
      {#if exportImport.preview}<div class="mt-4 border-t border-border pt-4"><div class="flex items-center justify-between"><h3 class="text-xs font-semibold">{exportImport.preview.filename}</h3><span class="font-mono text-[9px] uppercase text-muted-foreground">{exportImport.preview.format} · {size(exportImport.preview.sizeBytes)}</span></div>{#if exportImport.preview.status === 'applied'}<p class="mt-3 flex items-center gap-2 rounded border border-accent/30 bg-accent/8 px-3 py-2 text-xs"><Check class="size-3.5 text-accent" /> Import applied as versioned project changes.</p>{/if}<ul class="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs">{#each exportImport.preview.chapters as chapter (chapter.sourceId ?? `${chapter.number}-${chapter.title}`)}<li class="flex justify-between gap-3 border-l border-border pl-3"><span>{chapter.number}. {chapter.title}</span><span class="text-muted-foreground">{chapter.body.trim().split(/\s+/).filter(Boolean).length} words</span></li>{/each}</ul>{#if exportImport.preview.conflicts.length}<div class="mt-3 rounded border border-accent/30 bg-accent/8 p-3 text-[10px]"><p class="font-semibold">{exportImport.preview.conflicts.length} conflict(s)</p>{#each exportImport.preview.conflicts as conflict}<p class="mt-1 text-muted-foreground">{conflict.message}</p>{/each}<label class="mt-2 flex items-center gap-2 text-foreground"><input type="checkbox" bind:checked={confirmConflicts} /> Confirm versioned overwrite of matched chapters</label></div>{/if}<label class="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" bind:checked={restoreStructuredState} /> Restore archive story artifacts and canon</label>{#if restoreStructuredState}<select bind:value={restoreBuildRunId} class="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-xs"><option value="">Target authorized build…</option>{#each storyIde.runs as run (run.id)}<option value={run.id}>{run.objective}</option>{/each}</select>{/if}<button type="button" disabled={!canApply} onclick={() => void applyImport()} class="mt-4 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"><Check class="size-3.5" /> Apply versioned import</button></div>{/if}
    </section>

    <section class="rounded-lg border border-border bg-card p-5 xl:col-span-2" aria-labelledby="history-heading">
      <div class="flex items-center gap-2"><Archive class="size-4 text-accent" /><h2 id="history-heading" class="text-sm font-semibold">Export history</h2></div>
      {#if !exportImport.exports.length}<p class="mt-4 text-xs text-muted-foreground">No exports yet.</p>{:else}<div class="mt-4 overflow-x-auto"><table class="w-full min-w-[700px] text-left text-xs"><thead class="font-mono text-[9px] uppercase tracking-wide text-muted-foreground"><tr><th class="pb-2">File</th><th>Source</th><th>Format</th><th>Size</th><th>Status</th><th class="text-right">Actions</th></tr></thead><tbody>{#each exportImport.exports as item (item.id)}<tr class="border-t border-border"><td class="py-3"><p class="font-medium">{item.filename}</p><p class="font-mono text-[9px] text-muted-foreground">{item.checksum?.slice(0, 12) ?? 'no checksum'}…</p></td><td>{item.target === 'build' ? 'Build branch' : 'Main'}</td><td class="uppercase">{item.format}</td><td>{size(item.sizeBytes)}</td><td><span class="rounded border border-border px-2 py-1 text-[9px] uppercase">{item.status}</span></td><td><div class="flex justify-end gap-1">{#if item.status === 'ready'}<button type="button" title="Download" aria-label={`Download ${item.filename}`} onclick={() => void exportImport.download(item)} class="rounded p-2 hover:bg-muted"><Download class="size-3.5" /></button><button type="button" title="Regenerate" aria-label={`Regenerate ${item.filename}`} onclick={() => void exportImport.regenerate(item)} class="rounded p-2 hover:bg-muted"><RefreshCw class="size-3.5" /></button><button type="button" title="Delete" aria-label={`Delete ${item.filename}`} onclick={() => void exportImport.remove(item)} class="rounded p-2 text-destructive hover:bg-destructive/10"><Trash2 class="size-3.5" /></button>{/if}</div></td></tr>{/each}</tbody></table></div>{/if}
    </section>
  </main>
</div>
