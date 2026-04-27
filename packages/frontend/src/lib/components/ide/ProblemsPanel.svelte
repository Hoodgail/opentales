<script lang="ts">
  import { AlertCircle, AlertTriangle, Info, RefreshCw } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { runLint, type Diagnostic } from '$lib/lint/engine';
  import { allRules } from '$lib/lint/rules';
  import { cn } from '$lib/utils';
  import PanelHeader from './PanelHeader.svelte';

  const enabledRuleIds = $state<Set<string>>(
    new Set(allRules.filter((r) => r.defaultEnabled).map((r) => r.id))
  );

  const diagnostics = $derived(
    runLint(
      { chapters: manuscript.chapters, characters: manuscript.characters },
      { rules: allRules, enabled: enabledRuleIds }
    )
  );

  const grouped = $derived.by(() => {
    const map = new Map<string, Diagnostic[]>();
    for (const d of diagnostics) {
      const list = map.get(d.chapterId) ?? [];
      list.push(d);
      map.set(d.chapterId, list);
    }
    return Array.from(map.entries()).map(([chapterId, items]) => ({
      chapterId,
      title: items[0].chapterTitle || 'Manuscript',
      items
    }));
  });

  const counts = $derived({
    error: diagnostics.filter((d) => d.severity === 'error').length,
    warning: diagnostics.filter((d) => d.severity === 'warning').length,
    info: diagnostics.filter((d) => d.severity === 'info').length
  });

  function severityIcon(s: Diagnostic['severity']) {
    return s === 'error' ? AlertCircle : s === 'warning' ? AlertTriangle : Info;
  }

  function severityColor(s: Diagnostic['severity']): string {
    if (s === 'error') return 'text-destructive';
    if (s === 'warning') return 'text-amber-400';
    return 'text-muted-foreground';
  }

  function toggleRule(id: string) {
    if (enabledRuleIds.has(id)) enabledRuleIds.delete(id);
    else enabledRuleIds.add(id);
  }

  function openDiagnostic(d: Diagnostic) {
    if (!d.chapterId) return;
    const ch = manuscript.chapters.find((c) => c.id === d.chapterId);
    if (!ch) return;
    void manuscript.openTab({
      id: `tab-${ch.id}`,
      type: 'chapter',
      refId: ch.id,
      title: ch.title
    });
  }

  let configOpen = $state(false);
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Problems" />
  <div class="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px]">
    <span class="flex items-center gap-1 text-destructive">
      <AlertCircle class="size-3" /> {counts.error}
    </span>
    <span class="flex items-center gap-1 text-amber-400">
      <AlertTriangle class="size-3" /> {counts.warning}
    </span>
    <span class="flex items-center gap-1 text-muted-foreground">
      <Info class="size-3" /> {counts.info}
    </span>
    <button
      type="button"
      onclick={() => (configOpen = !configOpen)}
      class="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
    >
      Rules
    </button>
    <button
      type="button"
      onclick={() => {
        // Touching the set re-runs $derived so we don't need a manual rerun;
        // this button exists mostly so users feel something happened.
        const next = new Set(enabledRuleIds);
        enabledRuleIds.clear();
        for (const id of next) enabledRuleIds.add(id);
      }}
      title="Re-run lint"
      class="rounded-md p-1 text-muted-foreground hover:bg-muted"
    >
      <RefreshCw class="size-3.5" />
    </button>
  </div>

  {#if configOpen}
    <div class="space-y-1 border-b border-border bg-card/40 px-3 py-2 text-[11px]">
      {#each allRules as rule (rule.id)}
        <label class="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={enabledRuleIds.has(rule.id)}
            onchange={() => toggleRule(rule.id)}
            class="mt-0.5 accent-accent"
          />
          <span class="min-w-0 flex-1">
            <span class="text-foreground">{rule.label}</span>
            <span class="ml-1 text-muted-foreground">{rule.description}</span>
          </span>
        </label>
      {/each}
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto">
    {#if grouped.length === 0}
      <div class="px-4 py-12 text-center text-xs text-muted-foreground">
        No problems detected. Continuity holds — for now.
      </div>
    {/if}
    {#each grouped as group (group.chapterId || 'manuscript')}
      <div class="border-b border-border">
        <div
          class="bg-card/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {group.title}
        </div>
        {#each group.items as d (d.ruleId + d.message)}
          {@const Icon = severityIcon(d.severity)}
          <button
            type="button"
            onclick={() => openDiagnostic(d)}
            class="flex w-full items-start gap-2 border-b border-border/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50"
          >
            <Icon class={cn('mt-0.5 size-3.5 shrink-0', severityColor(d.severity))} />
            <span class="min-w-0 flex-1">
              <span class="text-foreground">{d.message}</span>
              {#if d.hint}
                <span class="block text-[11px] text-muted-foreground">{d.hint}</span>
              {/if}
              <span class="mt-0.5 block font-mono text-[10px] text-muted-foreground/70">
                {d.ruleId}{d.lineStart ? `  ·  line ${d.lineStart}` : ''}
              </span>
            </span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
</div>
