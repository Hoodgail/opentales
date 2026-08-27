<script lang="ts">
  import {
    AlertTriangle,
    ArrowRight,
    Check,
    FileDiff,
    LoaderCircle,
    Replace,
    Search,
    X
  } from 'lucide-svelte';
  import { onMount, tick } from 'svelte';
  import {
    normalizeRenameInput,
    occurrenceCounts,
    renameInputError,
    type ApplyRenameSymbolInput,
    type ApplyRenameSymbolResult,
    type RenameSymbolInput,
    type RenameSymbolOccurrence,
    type RenameSymbolPreview,
    type RenameSymbolScope,
    type RenameSymbolTarget
  } from '$lib/rename-symbol-ui';

  interface BuildOption {
    id: string;
    branchName: string;
    status: string;
  }

  interface Props {
    target: RenameSymbolTarget;
    builds?: BuildOption[];
    activeBuildId?: string | null;
    onPreview: (input: RenameSymbolInput) => Promise<RenameSymbolPreview>;
    onApply: (input: ApplyRenameSymbolInput) => Promise<ApplyRenameSymbolResult>;
    onApplied?: (result: ApplyRenameSymbolResult) => unknown | Promise<unknown>;
    onNavigate?: (occurrence: RenameSymbolOccurrence) => unknown | Promise<unknown>;
    onClose: () => void;
  }

  let {
    target,
    builds = [],
    activeBuildId = null,
    onPreview,
    onApply,
    onApplied = () => undefined,
    onNavigate = () => undefined,
    onClose
  }: Props = $props();

  let dialog: HTMLDivElement | undefined = $state();
  let newName = $state('');
  let scope = $state<RenameSymbolScope>('main');
  let buildRunId = $state('');
  let caseSensitive = $state(true);
  let includedAliases = $state<string[]>([]);
  let preview = $state<RenameSymbolPreview | null>(null);
  let previewInput = $state<RenameSymbolInput | null>(null);
  let result = $state<ApplyRenameSymbolResult | null>(null);
  let reviewed = $state(false);
  let applyKey = $state('');
  let busy = $state<'preview' | 'apply' | null>(null);
  let error = $state<string | null>(null);
  const restoreFocus = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

  const counts = $derived(preview ? occurrenceCounts(preview.occurrences) : []);
  const selectedBuild = $derived(builds.find((build) => build.id === buildRunId) ?? null);
  const validationError = $derived(renameInputError(currentInput(), target.name));

  onMount(() => {
    newName = target.name;
    buildRunId = activeBuildId ?? builds[0]?.id ?? '';
    includedAliases = [...target.aliases];
    void tick().then(() => dialog?.querySelector<HTMLInputElement>('input[name="new-name"]')?.focus());
  });

  function currentInput(): RenameSymbolInput {
    return normalizeRenameInput({
      targetType: target.targetType,
      targetId: target.targetId,
      newName,
      scope,
      ...(scope === 'main' ? {} : { buildRunId }),
      caseSensitive,
      includeAliases: includedAliases
    });
  }

  function invalidatePreview() {
    preview = null;
    previewInput = null;
    result = null;
    reviewed = false;
    applyKey = '';
    error = null;
  }

  function setScope(next: RenameSymbolScope) {
    scope = next;
    if (next === 'all') buildRunId = '';
    else if (next === 'build' && !buildRunId) buildRunId = activeBuildId ?? builds[0]?.id ?? '';
    invalidatePreview();
  }

  function toggleAlias(alias: string, checked: boolean) {
    includedAliases = checked
      ? [...includedAliases, alias]
      : includedAliases.filter((candidate) => candidate !== alias);
    invalidatePreview();
  }

  async function requestPreview() {
    const input = currentInput();
    const invalid = renameInputError(input, target.name);
    if (invalid) {
      error = invalid;
      return;
    }
    busy = 'preview';
    error = null;
    try {
      preview = await onPreview(input);
      previewInput = input;
      reviewed = false;
      applyKey = mutationKey();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Rename preview failed.';
    } finally {
      busy = null;
    }
  }

  function mutationKey(): string {
    return globalThis.crypto?.randomUUID?.() ?? `rename-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function applyRename() {
    if (!preview || !previewInput || !reviewed || preview.conflicts.length > 0) return;
    busy = 'apply';
    error = null;
    try {
      const applied = await onApply({
        ...previewInput,
        confirm: true,
        previewHash: preview.previewHash,
        expectedHeads: preview.expectedHeads,
        expectedRevisions: preview.expectedRevisions,
        expectedEntityUpdatedAt: preview.expectedEntityUpdatedAt,
        idempotencyKey: applyKey || (applyKey = mutationKey())
      });
      result = applied;
      try {
        await onApplied(applied);
      } catch (caught) {
        error = `Rename applied, but the workspace could not refresh: ${caught instanceof Error ? caught.message : 'refresh the project to see every change.'}`;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Rename failed. Review a fresh preview and try again.';
      reviewed = false;
    } finally {
      busy = null;
    }
  }

  function close() {
    if (busy) return;
    onClose();
    void tick().then(() => restoreFocus?.isConnected && restoreFocus.focus());
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function kindLabel(kind: string): string {
    return kind.replace(/-/g, ' ');
  }
</script>

<div
  class="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
  role="presentation"
  onclick={(event) => event.target === event.currentTarget && close()}
>
  <div
    bind:this={dialog}
    role="dialog"
    aria-modal="true"
    aria-labelledby="rename-symbol-title"
    aria-describedby="rename-symbol-description"
    tabindex="-1"
    onkeydown={handleKeydown}
    class="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-2xl sm:max-h-[88vh] sm:max-w-4xl sm:rounded-lg"
  >
    <header class="flex shrink-0 items-start gap-3 border-b border-border bg-sidebar px-4 py-3 sm:px-5">
      <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded border border-accent/30 bg-accent/10">
        <Replace class="size-4 text-accent" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="font-mono text-[9px] uppercase tracking-[0.16em] text-accent">Project refactor · {target.targetType}</p>
        <h2 id="rename-symbol-title" class="mt-0.5 truncate text-sm font-semibold text-foreground">Rename {target.name}</h2>
        <p id="rename-symbol-description" class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">Preview every persisted edit before changing the symbol or manuscript.</p>
      </div>
      <button type="button" onclick={close} disabled={Boolean(busy)} aria-label="Close rename symbol dialog" class="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"><X class="size-4" /></button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if result}
        <section class="border-b border-emerald-500/30 bg-emerald-500/8 px-4 py-4 sm:px-5" aria-live="polite">
          <div class="flex items-start gap-3"><span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-400/15"><Check class="size-4 text-emerald-300" /></span><div><h3 class="text-sm font-semibold text-foreground">Renamed {preview?.oldName ?? target.name} to {newName.trim()}</h3><p class="mt-1 text-[11px] text-muted-foreground">The project was refreshed after applying {result.appliedOccurrences ?? preview?.occurrences.length ?? 0} occurrence{(result.appliedOccurrences ?? preview?.occurrences.length ?? 0) === 1 ? '' : 's'}.</p></div></div>
        </section>
      {:else}
        <form id="rename-symbol-form" class="border-b border-border p-4 sm:p-5" onsubmit={(event) => { event.preventDefault(); void requestPreview(); }}>
          <div class="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <label class="block"><span class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">New name</span><div class="relative"><ArrowRight class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input name="new-name" bind:value={newName} oninput={invalidatePreview} required maxlength="200" autocomplete="off" spellcheck="false" class="h-10 w-full rounded border border-border bg-input/60 pl-8 pr-3 text-sm text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></div></label>
            <fieldset><legend class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Scope</legend><div class="grid grid-cols-3 overflow-hidden rounded border border-border bg-input/40">{#each [{ value: 'main', label: 'Main' }, { value: 'build', label: 'Build' }, { value: 'all', label: 'All' }] as option}<label class="relative"><input class="peer sr-only" type="radio" name="rename-scope" value={option.value} checked={scope === option.value} onchange={() => setScope(option.value as RenameSymbolScope)} /><span class="flex h-10 cursor-pointer items-center justify-center border-r border-border text-[11px] text-muted-foreground outline-none peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-accent">{option.label}</span></label>{/each}</div></fieldset>
          </div>

          {#if scope !== 'main'}
            <label class="mt-4 block"><span class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{scope === 'build' ? 'Build branch' : 'Build branches'}</span><select bind:value={buildRunId} onchange={invalidatePreview} required={scope === 'build'} class="h-10 w-full rounded border border-border bg-input/60 px-3 text-xs text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"><option value="">{scope === 'all' ? 'Every build branch' : 'Choose a build'}</option>{#each builds as build (build.id)}<option value={build.id}>{build.branchName} · {build.status}</option>{/each}</select>{#if builds.length === 0 && scope === 'build'}<p class="mt-1 text-[10px] text-amber-300">No build branch is available. Choose Main manuscript.</p>{:else if scope === 'all'}<p class="mt-1 text-[9px] text-muted-foreground">Leave this on Every build branch to rename main and every isolated build.</p>{/if}</label>
          {/if}

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label class="flex min-h-10 items-center gap-2 rounded border border-border bg-input/30 px-3 text-[11px] text-foreground"><input type="checkbox" bind:checked={caseSensitive} onchange={invalidatePreview} class="size-3.5 accent-[var(--accent)]" /><span><strong class="font-medium">Match case</strong><span class="block text-[9px] text-muted-foreground">Leave similarly spelled words unchanged.</span></span></label>
            <div class="rounded border border-border bg-input/30 px-3 py-2"><p class="text-[10px] font-medium text-foreground">Aliases included</p>{#if target.aliases.length === 0}<p class="mt-0.5 text-[9px] text-muted-foreground">This symbol has no aliases.</p>{:else}<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">{#each target.aliases as alias (alias)}<label class="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"><input type="checkbox" checked={includedAliases.includes(alias)} onchange={(event) => toggleAlias(alias, event.currentTarget.checked)} class="size-3 accent-[var(--accent)]" /><span>{alias}</span></label>{/each}</div>{/if}</div>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-2"><button type="submit" disabled={Boolean(busy) || Boolean(validationError)} class="inline-flex h-9 items-center gap-1.5 rounded bg-accent px-3 text-[11px] font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">{#if busy === 'preview'}<LoaderCircle class="size-3.5 motion-safe:animate-spin" />{:else}<Search class="size-3.5" />{/if}{preview ? 'Refresh preview' : 'Review changes'}</button>{#if validationError}<span class="text-[10px] text-muted-foreground">{validationError}</span>{/if}</div>
        </form>
      {/if}

      {#if error}<div class="border-b border-destructive/35 bg-destructive/8 px-4 py-3 text-[11px] text-destructive-foreground" role="alert">{error}</div>{/if}

      {#if preview}
        <section aria-labelledby="rename-proof-heading" class="p-4 sm:p-5">
          <div class="flex flex-wrap items-start gap-3"><div><h3 id="rename-proof-heading" class="text-xs font-semibold text-foreground">Change proof</h3><p class="mt-0.5 text-[10px] text-muted-foreground">{preview.totalOccurrences} occurrence{preview.totalOccurrences === 1 ? '' : 's'} across {preview.expectedHeads.length} writing head{preview.expectedHeads.length === 1 ? '' : 's'}{selectedBuild ? ` · ${selectedBuild.branchName}` : ''}</p>{#if preview.truncated}<p class="mt-1 text-[9px] text-amber-300">Showing the first {preview.occurrences.length} changes. All {preview.totalOccurrences} will be applied.</p>{/if}</div><div class="ml-auto flex flex-wrap justify-end gap-1">{#each counts as count (count.kind)}<span class="rounded border border-border bg-sidebar px-2 py-1 font-mono text-[9px] text-muted-foreground">{count.count} {kindLabel(count.kind)}</span>{/each}</div></div>

          {#if preview.conflicts.length > 0}<div class="mt-3 rounded border border-amber-500/40 bg-amber-500/8 p-3" role="alert"><div class="flex items-center gap-2 text-[11px] font-medium text-amber-200"><AlertTriangle class="size-3.5" />Resolve conflicts before applying</div><ul class="mt-2 list-disc space-y-1 pl-5 text-[10px] leading-relaxed text-amber-100/80">{#each preview.conflicts as conflict}<li>{conflict}</li>{/each}</ul></div>
          {:else if preview.occurrences.length === 0}<div class="mt-3 rounded border border-border bg-sidebar/50 p-4 text-[11px] text-muted-foreground">No prose mentions match these options. Applying will still rename the {target.targetType} definition.</div>{/if}

          {#if preview.occurrences.length > 0}<div class="mt-4 space-y-3">{#each preview.occurrences as occurrence, index (occurrence.id)}<article class="overflow-hidden rounded border border-border bg-sidebar/35"><header class="flex items-center gap-2 border-b border-border px-3 py-2"><FileDiff class="size-3.5 text-accent" /><span class="min-w-0 truncate font-mono text-[9px] uppercase text-muted-foreground">{kindLabel(occurrence.kind)} · {occurrence.title} · {occurrence.field} · change {index + 1}</span><button type="button" onclick={() => void onNavigate(occurrence)} class="ml-auto shrink-0 rounded border border-border px-2 py-1 text-[9px] text-foreground outline-none hover:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent">Open</button></header><div class="grid md:grid-cols-2"><div class="border-b border-red-500/20 bg-red-500/7 p-3 md:border-b-0 md:border-r"><span class="font-mono text-[9px] uppercase text-red-300">Before</span><p class="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-foreground/80">{occurrence.beforeSnippet}</p></div><div class="bg-emerald-500/7 p-3"><span class="font-mono text-[9px] uppercase text-emerald-300">After</span><p class="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-foreground/80">{occurrence.afterSnippet}</p></div></div></article>{/each}</div>{/if}
        </section>
      {/if}
    </div>

    <footer class="flex shrink-0 flex-col gap-3 border-t border-border bg-sidebar px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      {#if preview && !result}<label class="flex min-w-0 flex-1 items-start gap-2 text-[10px] leading-relaxed text-muted-foreground"><input type="checkbox" bind:checked={reviewed} class="mt-0.5 size-3.5 shrink-0 accent-[var(--accent)]" /><span>I reviewed this exact preview and want to rename <strong class="font-medium text-foreground">{preview.oldName}</strong> to <strong class="font-medium text-foreground">{newName.trim()}</strong>.</span></label>{:else}<div class="flex-1"></div>{/if}
      <div class="flex justify-end gap-2"><button type="button" onclick={close} disabled={Boolean(busy)} class="h-9 rounded border border-border px-3 text-[11px] text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">{result ? 'Done' : 'Cancel'}</button>{#if preview && !result}<button type="button" onclick={() => void applyRename()} disabled={!reviewed || preview.conflicts.length > 0 || Boolean(busy)} class="inline-flex h-9 items-center gap-1.5 rounded bg-accent px-3 text-[11px] font-semibold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45">{#if busy === 'apply'}<LoaderCircle class="size-3.5 motion-safe:animate-spin" />{/if}Apply rename</button>{/if}</div>
    </footer>
  </div>
</div>
