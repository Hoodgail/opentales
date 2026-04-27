<script lang="ts">
  interface Props {
    label: string;
    value: string;
  }

  let { label, value }: Props = $props();
</script>

<div
  class="flex items-center justify-between border-b border-border px-3 py-2 last:border-b-0"
>
  <span class="text-foreground/80">{label}</span>
  <span class="font-mono text-[11px] text-muted-foreground">{value}</span>
</div>
