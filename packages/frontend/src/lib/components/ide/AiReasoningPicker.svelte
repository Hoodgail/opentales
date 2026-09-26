<script lang="ts">
  import { Check, ChevronDown, Zap } from 'lucide-svelte';
  import { tick } from 'svelte';
  import { floatingMenu } from '$lib/actions/floatingMenu';
  let { efforts, effort = null, supportsFast = false, serviceTier = 'standard', disabled = false, onSelect }: {
    efforts: string[];
    effort?: string | null;
    supportsFast?: boolean;
    serviceTier?: 'standard' | 'fast';
    disabled?: boolean;
    onSelect: (options: { reasoningEffort?: string | null; serviceTier?: 'standard' | 'fast' }) => void;
  } = $props();
  const uid = $props.id();
  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();
  const label = (value: string | null) => value === null ? 'Default' : value === 'xhigh' ? 'Extra high' : value[0].toUpperCase() + value.slice(1);
  function close(restore: boolean) { open = false; if (restore) void tick().then(() => trigger?.focus()); }
  async function toggle() { if (open) return close(true); open = true; await tick(); menu?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(); }
</script>
{#if efforts.length || supportsFast}
  <button bind:this={trigger} type="button" class="effort-trigger" {disabled} aria-label="Reasoning and speed" aria-haspopup="menu" aria-expanded={open} aria-controls={uid} onclick={toggle} onkeydown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) void toggle(); } }}>
    {#if serviceTier === 'fast'}<Zap size={12} class="text-accent" />{/if}{efforts.length ? label(effort) : serviceTier === 'fast' ? 'Fast' : 'Standard'}<ChevronDown size={11} />
  </button>
{/if}
{#if open}
<div bind:this={menu} use:floatingMenu={{ anchor: trigger!, placement: 'above', close }} role="menu" aria-label="Reasoning and speed" id={uid} tabindex="-1" class="effort-menu">
    {#if efforts.length}
      <p>Reasoning</p>
      {#each [null, ...efforts] as item (item)}
        <button type="button" role="menuitemradio" aria-checked={effort === item} data-menu-item onclick={() => { close(true); onSelect({ reasoningEffort: item }); }}><span>{label(item)}</span>{#if item === null}<small>Model default</small>{/if}{#if effort === item}<Check size={13} />{/if}</button>
      {/each}
    {/if}
    {#if supportsFast}
      <p class:separator={efforts.length > 0}>Service tier</p>
      <button type="button" role="menuitemradio" aria-checked={serviceTier === 'standard'} data-menu-item onclick={() => { close(true); onSelect({ serviceTier: 'standard' }); }}><span>Standard</span><small>Default</small>{#if serviceTier === 'standard'}<Check size={13} />{/if}</button>
      <button type="button" role="menuitemradio" aria-checked={serviceTier === 'fast'} data-menu-item onclick={() => { close(true); onSelect({ serviceTier: 'fast' }); }}><span>Fast<em>Priority processing · higher cost</em></span>{#if serviceTier === 'fast'}<Check size={13} />{/if}</button>
    {/if}
  </div>
{/if}
<style>
  .effort-trigger { display: inline-flex; align-items: center; gap: 5px; padding: 6px; border-radius: 7px; color: var(--muted-foreground); font-size: 11px; white-space: nowrap; }
  .effort-trigger:hover, .effort-trigger[aria-expanded='true'] { background: var(--muted); color: var(--foreground); }
  button:disabled { opacity: .4; cursor: not-allowed; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .effort-menu { width: 235px; padding: 5px; overflow-y: auto; background: var(--popover); border: 1px solid var(--border); border-radius: 11px; box-shadow: 0 16px 48px #0006; color: var(--foreground); font-family: var(--font-sans); }
  .effort-menu p { padding: 6px 7px; color: var(--muted-foreground); font-size: 10px; }
  .separator { border-top: 1px solid var(--border); margin-top: 6px; }
  .effort-menu button { display: flex; align-items: center; gap: 7px; width: 100%; padding: 7px; border-radius: 6px; text-align: left; font-size: 12px; }
  .effort-menu button:hover, .effort-menu button[aria-checked='true'] { background: var(--muted); }
  small { padding: 0 4px; border: 1px solid var(--border); border-radius: 4px; font-size: 9px; color: var(--muted-foreground); }
  em { display: block; margin-top: 2px; font-size: 10px; font-style: normal; color: var(--muted-foreground); }
  .effort-menu button :global(svg) { margin-left: auto; flex-shrink: 0; color: var(--accent); }
</style>
