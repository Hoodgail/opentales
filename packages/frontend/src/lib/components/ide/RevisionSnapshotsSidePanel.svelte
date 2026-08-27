<script lang="ts">
  import { Camera, History, LoaderCircle } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { revisions } from '$lib/stores/revisions.svelte';

  let loadedProjectId = $state<string | null>(null);
  $effect(() => {
    const projectId = manuscript.projectId;
    if (projectId && loadedProjectId !== projectId) {
      loadedProjectId = projectId;
      void revisions.loadSnapshots(projectId);
    }
  });

  function open(snapshotId?: string) {
    if (snapshotId && manuscript.projectId) void revisions.selectSnapshot(manuscript.projectId, snapshotId);
    void manuscript.openTab({ id: 'tab-revisions', type: 'revisions', refId: snapshotId ?? 'revisions', title: 'Revisions' });
  }
</script>

<div class="flex h-full flex-col">
  <header class="border-b border-border px-4 py-3"><p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">History</p><h2 class="mt-1 text-xs font-semibold">Revisions & snapshots</h2></header>
  <div class="border-b border-border p-3"><button type="button" onclick={() => open()} class="flex w-full items-center gap-2 rounded border border-border bg-card px-3 py-2 text-left text-foreground hover:border-accent/60"><History class="size-4 text-accent" /><span><strong class="block text-xs">Open revision workspace</strong><span class="text-[10px] text-muted-foreground">Create, compare, branch, or restore</span></span></button></div>
  <div class="min-h-0 flex-1 overflow-y-auto p-2">{#if revisions.loadingSnapshots && !revisions.snapshots.length}<div class="flex items-center gap-2 p-3 text-[10px] text-muted-foreground"><LoaderCircle class="size-3 motion-safe:animate-spin" />Loading history…</div>{:else if !revisions.snapshots.length}<div class="p-5 text-center"><Camera class="mx-auto size-5 text-muted-foreground/40" /><p class="mt-2 text-[10px] text-muted-foreground">No named snapshots yet.</p></div>{:else}<p class="mb-2 px-1 text-[9px] uppercase tracking-wide text-muted-foreground">Recent</p>{#each revisions.snapshots.slice(0, 12) as snapshot (snapshot.id)}<button type="button" onclick={() => open(snapshot.id)} class="mb-1 w-full rounded px-2 py-2 text-left hover:bg-muted/40"><span class="block truncate text-[11px] text-foreground">{snapshot.label}</span><span class="font-mono text-[9px] uppercase text-muted-foreground">{snapshot.scope} · {snapshot.heads.length} heads</span></button>{/each}{/if}</div>
</div>
