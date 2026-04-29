<script lang="ts">
  import { Expand, Eye, X } from 'lucide-svelte';
  import { cn } from '$lib/utils';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import MonacoMarkdownEditor from './MonacoMarkdownEditor.svelte';

  interface Props {
    value: string;
    onChange: (next: string) => void;
    label: string;
    icon?: typeof Eye;
    contextLabel?: string;
    height?: string;
    embedded?: boolean;
    class?: string;
  }

  let {
    value,
    onChange,
    label,
    icon: Icon = Eye,
    contextLabel,
    height = 'h-36',
    embedded = false,
    class: className
  }: Props = $props();

  let expanded = $state(false);
  let preview = $state(false);

  function openExpandedEditor() {
    expanded = true;
    preview = false;
  }
</script>

<section class={cn(embedded ? '' : 'rounded-md border border-border bg-card', className)}>
  {#if !embedded}
    <header class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <div class="flex items-center gap-2">
        <Icon class="size-3.5 text-accent/80" />
        <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h3>
      </div>
      <button
        type="button"
        onclick={openExpandedEditor}
        title="Expand markdown editor"
        class="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Expand class="size-3" />
        Expand
      </button>
    </header>
  {:else}
    <div class="flex justify-end px-1 pb-1">
      <button
        type="button"
        onclick={openExpandedEditor}
        title="Expand markdown editor"
        aria-label="Expand {label} markdown editor"
        class="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Expand class="size-3" />
        Expand
      </button>
    </div>
  {/if}
  <div class={cn('min-h-0', height)}>
    <MonacoMarkdownEditor {value} {onChange} compact />
  </div>
</section>

{#if expanded}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
    <div
      class="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Edit {label}"
    >
      <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div class="flex items-center gap-2">
          <Icon class="size-4 text-accent" />
          <div>
            <h2 class="text-sm font-medium text-foreground">{label}</h2>
            {#if contextLabel}
              <p class="text-[11px] text-muted-foreground">Markdown editor for {contextLabel}</p>
            {/if}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            onclick={() => (preview = !preview)}
            class={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
              preview
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Eye class="size-3" />
            Preview
          </button>
          <button
            type="button"
            onclick={() => (expanded = false)}
            aria-label="Close expanded editor"
            class="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X class="size-4" />
          </button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1">
        <div class={cn('min-h-0', preview ? 'w-1/2 border-r border-border' : 'w-full')}>
          <MonacoMarkdownEditor {value} {onChange} />
        </div>
        {#if preview}
          <div class="w-1/2 overflow-y-auto bg-background px-10 py-8">
            <MarkdownPreview content={value} />
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
