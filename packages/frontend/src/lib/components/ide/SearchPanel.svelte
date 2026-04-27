<script lang="ts">
  import { FileText, MapPin, Search, Users } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import PanelHeader from './PanelHeader.svelte';

  let q = $state('');

  type Result = {
    id: string;
    type: 'chapter' | 'character' | 'location';
    title: string;
    snippet: string;
  };

  const results = $derived.by<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: Result[] = [];

    for (const c of manuscript.chapters) {
      const text = `${c.title} ${c.summary} ${c.content}`.toLowerCase();
      const idx = text.indexOf(needle);
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        out.push({
          id: c.id,
          type: 'chapter',
          title: `Ch${c.number}: ${c.title}`,
          snippet: '…' + text.slice(start, start + 90) + '…'
        });
      }
    }
    for (const c of manuscript.characters) {
      if (`${c.name} ${c.description} ${c.traits.join(' ')}`.toLowerCase().includes(needle)) {
        out.push({
          id: c.id,
          type: 'character',
          title: c.name,
          snippet: c.description.slice(0, 90) + '…'
        });
      }
    }
    for (const l of manuscript.locations) {
      if (`${l.name} ${l.description}`.toLowerCase().includes(needle)) {
        out.push({
          id: l.id,
          type: 'location',
          title: l.name,
          snippet: l.description.slice(0, 90) + '…'
        });
      }
    }
    return out;
  });

  function openResult(r: Result) {
    if (r.type === 'chapter') {
      const ch = manuscript.chapters.find((c) => c.id === r.id);
      if (ch) void manuscript.openTab({ id: `tab-${ch.id}`, type: 'chapter', refId: ch.id, title: ch.title });
    } else if (r.type === 'character') {
      const c = manuscript.characters.find((x) => x.id === r.id);
      if (c) void manuscript.openTab({ id: `tab-${c.id}`, type: 'character', refId: c.id, title: c.name });
    } else {
      const l = manuscript.locations.find((x) => x.id === r.id);
      if (l) void manuscript.openTab({ id: `tab-${l.id}`, type: 'location', refId: l.id, title: l.name });
    }
  }

  function iconFor(t: Result['type']) {
    return t === 'chapter' ? FileText : t === 'character' ? Users : MapPin;
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Search" />
  <div class="border-b border-border p-2">
    <div class="relative">
      <Search
        class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        bind:value={q}
        placeholder="Search manuscript..."
        class="h-8 w-full rounded-md border border-border bg-input/60 pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/60 focus:ring-1 focus:ring-accent/40"
      />
    </div>
  </div>
  <div class="flex-1 overflow-y-auto p-2">
    {#if q.trim() === ''}
      <div class="py-12 text-center text-xs text-muted-foreground">
        Search across chapters, characters, and settings.
      </div>
    {:else if results.length === 0}
      <div class="py-12 text-center text-xs text-muted-foreground">No results found.</div>
    {/if}
    <div class="space-y-1">
      {#each results as r (r.type + '-' + r.id)}
        {@const Icon = iconFor(r.type)}
        <button
          type="button"
          onclick={() => openResult(r)}
          class="flex w-full gap-2 rounded-md p-2 text-left hover:bg-muted/50"
        >
          <Icon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs font-medium text-foreground">{r.title}</div>
            <div class="truncate text-[11px] text-muted-foreground">{r.snippet}</div>
          </div>
        </button>
      {/each}
    </div>
  </div>
</div>
