<script lang="ts">
  // lucide-svelte 1.x still ships legacy `SvelteComponentTyped` typings, which
  // do not satisfy Svelte 5's `Component` interface. Accept both shapes here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type IconLike = any;

  interface Props {
    icon: IconLike;
    label: string;
    onclick?: () => void;
  }

  let { icon: Icon, label, onclick }: Props = $props();
</script>

<button
  type="button"
  {onclick}
  title={label}
  class="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
>
  <Icon class="size-3.5" />
  <span class="sr-only">{label}</span>
</button>
