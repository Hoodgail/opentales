<script lang="ts">
  const stats = [
    { k: 'Average draft', v: '92k', sub: 'words tracked' },
    { k: 'Keyboard-first', v: '40+', sub: 'shortcuts' },
    { k: 'Themes', v: '12', sub: 'editor presets' },
    { k: 'Local-first', v: '100%', sub: 'your data' }
  ];
</script>

<section class="border-b border-border/60">
  <div
    class="mx-auto grid w-full max-w-6xl grid-cols-2 divide-border/60 px-6 sm:grid-cols-4 sm:divide-x"
  >
    {#each stats as s, i (s.k)}
      <div
        class={'px-2 py-10 sm:px-6 ' +
          (i < 2 ? 'border-b border-border/60 sm:border-b-0' : '')}
      >
        <div class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {s.k}
        </div>
        <div class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{s.v}</div>
        <div class="mt-1 text-xs text-muted-foreground">{s.sub}</div>
      </div>
    {/each}
  </div>
</section>
