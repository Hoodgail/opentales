<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    actions?: Snippet;
  }

  let { title, actions }: Props = $props();
</script>

<div class="flex h-9 shrink-0 items-center justify-between border-b border-border bg-sidebar px-3">
  <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
    {title}
  </h2>
  <div class="flex items-center gap-0.5">
    {#if actions}{@render actions()}{/if}
  </div>
</div>
