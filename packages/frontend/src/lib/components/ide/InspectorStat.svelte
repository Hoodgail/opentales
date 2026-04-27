<script lang="ts">
  import { cn } from '$lib/utils';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type IconLike = any;

  interface Props {
    icon?: IconLike;
    label: string;
    value: string;
    mono?: boolean;
  }

  let { icon: Icon, label, value, mono = false }: Props = $props();
</script>

<div
  class="flex items-center justify-between border-b border-border px-3 py-2 text-xs last:border-b-0"
>
  <span class="flex items-center gap-2 text-muted-foreground">
    {#if Icon}<Icon class="size-3" />{/if}
    {label}
  </span>
  <span class={cn('text-foreground', mono && 'font-mono text-[11px]')}>{value}</span>
</div>
