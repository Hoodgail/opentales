<script lang="ts">
  import { Archive, FileInput, FileOutput } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';

  function openPublishing() {
    void manuscript.openTab({ id: 'tab-publishing', type: 'publishing', refId: 'publishing', title: 'Export & Import' });
  }
</script>

<div class="flex h-full flex-col">
  <header class="border-b border-border px-4 py-3"><p class="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Publishing</p><h2 class="mt-1 text-xs font-semibold">Export & Import</h2></header>
  <div class="space-y-3 p-4 text-xs text-muted-foreground"><p>Build private, validated manuscript deliverables or preview external files before applying them.</p><button type="button" onclick={openPublishing} class="flex w-full items-center gap-2 rounded border border-border bg-card px-3 py-2 text-left text-foreground hover:border-accent/60"><Archive class="size-4 text-accent" /><span><strong class="block text-xs">Open publishing pipeline</strong><span class="text-[10px] text-muted-foreground">Formats, presets, history, import preview</span></span></button><div class="grid grid-cols-2 gap-2"><div class="rounded border border-border p-2"><FileOutput class="size-3.5 text-accent" /><p class="mt-1 text-[10px]">DOCX · PDF · EPUB · web · archive</p></div><div class="rounded border border-border p-2"><FileInput class="size-3.5 text-accent" /><p class="mt-1 text-[10px]">Preview, conflicts, versioned apply</p></div></div></div>
</div>
