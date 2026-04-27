<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    children?: Snippet;
  }

  let { title, children }: Props = $props();
</script>

<div class="mb-4">
  <h3
    class="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
  >
    {title}
  </h3>
  <div class="overflow-hidden rounded-md border border-border bg-card">
    {#if children}{@render children()}{/if}
  </div>
</div>
