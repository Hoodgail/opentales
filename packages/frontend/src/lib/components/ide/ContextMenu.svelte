<script lang="ts">
  import { tick } from 'svelte';
  import type { ContextMenuItem } from './contextMenuTypes';

  interface Props {
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
  }

  let { open, x, y, items, onClose }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  let position = $state({ x: 0, y: 0 });

  $effect(() => {
    if (!open) return;
    position = { x, y };
    void tick().then(adjustPosition);
  });

  function adjustPosition() {
    if (!menuEl || typeof window === 'undefined') return;
    const rect = menuEl.getBoundingClientRect();
    const margin = 8;
    let nx = position.x;
    let ny = position.y;
    if (nx + rect.width > window.innerWidth - margin) {
      nx = window.innerWidth - rect.width - margin;
    }
    if (ny + rect.height > window.innerHeight - margin) {
      ny = window.innerHeight - rect.height - margin;
    }
    position = { x: Math.max(margin, nx), y: Math.max(margin, ny) };
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }
</script>

{#if open}
  <button
    type="button"
    aria-label="Dismiss menu"
    tabindex="-1"
    class="fixed inset-0 z-[70] cursor-default"
    onclick={onClose}
    oncontextmenu={(e) => {
      e.preventDefault();
      onClose();
    }}
  ></button>
  <div
    bind:this={menuEl}
    role="menu"
    tabindex="-1"
    onkeydown={handleKey}
    class="fixed z-[71] min-w-[200px] overflow-hidden rounded-md border border-border bg-card shadow-2xl"
    style="left: {position.x}px; top: {position.y}px"
  >
    <ul class="py-1">
      {#each items as item (item.id)}
        {@const Icon = item.icon}
        <li>
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onclick={async () => {
              if (item.disabled) return;
              onClose();
              await item.onSelect();
            }}
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
            class:text-foreground={!item.danger && !item.disabled}
            class:text-destructive={item.danger && !item.disabled}
            class:text-muted-foreground={item.disabled}
            class:opacity-60={item.disabled}
            class:hover:bg-muted={!item.disabled}
          >
            {#if Icon}<Icon class="size-3.5 shrink-0 opacity-80" />{/if}
            <span class="flex-1">{item.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}
