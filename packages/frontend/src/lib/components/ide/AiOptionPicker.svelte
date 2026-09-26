<script lang="ts">
  import { Check, ChevronDown } from 'lucide-svelte';
  import { tick, type Snippet } from 'svelte';
  import { floatingMenu } from '$lib/actions/floatingMenu';
  let { label, value, options, disabled = false, onSelect, icon }: {
    label: string;
    value: string;
    options: { id: string; name: string; description?: string | null }[];
    disabled?: boolean;
    onSelect: (id: string) => void;
    icon?: Snippet;
  } = $props();
  const uid = $props.id();
  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();
  function close(restore: boolean) { open = false; if (restore) void tick().then(() => trigger?.focus()); }
  async function toggle() {
    if (open) return close(true);
    open = true;
    await tick();
    (menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[data-menu-item]'))?.focus();
  }
</script>
<button bind:this={trigger} type="button" class="option-trigger" {disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={uid} onclick={toggle} onkeydown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) void toggle(); } }}>
  {#if icon}{@render icon()}{/if}<span>{options.find((option) => option.id === value)?.name ?? value}</span><ChevronDown size={11} />
</button>
{#if open}
<div bind:this={menu} use:floatingMenu={{ anchor: trigger!, placement: 'above', close }} role="menu" aria-label={label} id={uid} tabindex="-1" class="option-menu">
    <p>{label}</p>
    {#each options as option (option.id)}
      <button type="button" role="menuitemradio" aria-checked={value === option.id} data-menu-item onclick={() => { close(true); onSelect(option.id); }}>
        <span><span class="option-name">{option.name}</span>{#if option.description}<small>{option.description}</small>{/if}</span>{#if option.id === value}<Check size={13} />{/if}
      </button>
    {/each}
  </div>
{/if}
<style>
  .option-trigger { display: inline-flex; align-items: center; gap: 5px; padding: 6px; border-radius: 7px; color: var(--muted-foreground); font-size: 11px; white-space: nowrap; }
  .option-trigger:hover, .option-trigger[aria-expanded='true'] { background: var(--muted); color: var(--foreground); }
  button:disabled { opacity: .4; cursor: not-allowed; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .option-menu { width: 240px; padding: 5px; overflow-y: auto; background: var(--popover); border: 1px solid var(--border); border-radius: 11px; box-shadow: 0 16px 48px #0006; color: var(--foreground); font-family: var(--font-sans); }
  .option-menu p { padding: 5px 7px 8px; color: var(--muted-foreground); font-size: 10px; }
  .option-menu button { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 7px; border-radius: 6px; text-align: left; }
  .option-menu button:hover, .option-menu button[aria-checked='true'] { background: var(--muted); }
  .option-name { display: block; font-size: 12px; }
  small { display: block; margin-top: 3px; color: var(--muted-foreground); font-size: 10px; line-height: 1.45; }
  .option-menu :global(svg) { flex-shrink: 0; color: var(--accent); }
</style>
