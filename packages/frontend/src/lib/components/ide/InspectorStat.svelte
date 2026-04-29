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
  class="flex items-start justify-between gap-3 border-b border-border px-3 py-2 text-xs last:border-b-0"
  title={`${label}: ${value}`}
>
  <span class="flex shrink-0 items-center gap-2 text-muted-foreground">
    {#if Icon}<Icon class="size-3 shrink-0" />{/if}
    <span class="truncate">{label}</span>
  </span>
  <span
    class={cn(
      'min-w-0 flex-1 break-words text-right text-foreground',
      mono && 'font-mono text-[11px]'
    )}
  >
    {value}
  </span>
</div>
