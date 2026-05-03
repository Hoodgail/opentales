<script lang="ts">
  import { ChevronDown, ChevronRight } from 'lucide-svelte';

  type IconLike = any;

  interface Props {
    title: string;
    icon?: IconLike;
    summary?: string;
    open?: boolean;
    children: import('svelte').Snippet;
  }

  let { title, icon: Icon, summary, open = false, children }: Props = $props();
  let expanded = $state(false);

  $effect(() => {
    expanded = open;
  });
</script>

<section class="border-b border-border text-xs">
  <button
    type="button"
    onclick={() => (expanded = !expanded)}
    class="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
  >
    {#if expanded}
      <ChevronDown class="size-3.5 text-muted-foreground" />
    {:else}
      <ChevronRight class="size-3.5 text-muted-foreground" />
    {/if}
    {#if Icon}
      <Icon class="size-3.5 text-muted-foreground" />
    {/if}
    <span class="min-w-0 flex-1">
      <span class="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </span>
      {#if summary}
        <span class="mt-0.5 block truncate text-[10px] text-muted-foreground/80">{summary}</span>
      {/if}
    </span>
  </button>
  {#if expanded}
    <div class="p-3 pt-0">
      {@render children()}
    </div>
  {/if}
</section>
