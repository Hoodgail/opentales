<script lang="ts">
  import { Check, ChevronDown, Cpu, Eye, Globe, Loader2, RefreshCw, Search, Star, Wrench } from 'lucide-svelte';
  import { tick } from 'svelte';
  import type { AiModelChoice } from '@opentales/sdk';
  import { floatingMenu } from '$lib/actions/floatingMenu';

  let { choices, value, loading = false, error = null, disabled = false, placement = 'above', onSelect, onRefresh }: {
    choices: AiModelChoice[];
    value: string;
    loading?: boolean;
    error?: string | null;
    disabled?: boolean;
    placement?: 'above' | 'below';
    onSelect: (id: string) => void | Promise<void>;
    onRefresh?: () => void;
  } = $props();
  const uid = $props.id();
  let open = $state(false);
  let query = $state('');
  let filter = $state('all');
  let favorites = $state<string[]>([]);
  let trigger = $state<HTMLButtonElement>();
  let search = $state<HTMLInputElement>();
  const selected = $derived(choices.find((choice) => choice.id === value));
  const vendors = $derived([...new Set(choices.map((choice) => choice.model.vendor ?? choice.provider.name))]);
  const filtered = $derived(choices.filter((choice) => {
    const vendor = choice.model.vendor ?? choice.provider.name;
    return (filter === 'all' || (filter === 'favorites' ? favorites.includes(choice.id) : vendor === filter))
      && `${choice.id} ${choice.model.name} ${vendor}`.toLowerCase().includes(query.trim().toLowerCase());
  }));

  async function toggle() {
    if (open) return close(true);
    query = '';
    filter = 'all';
    try { const stored = JSON.parse(localStorage.getItem('opentales.ai.favoriteModels') ?? '[]'); favorites = Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []; } catch { favorites = []; }
    open = true;
    await tick();
    search?.focus();
  }
  function close(restore: boolean) { open = false; if (restore) void tick().then(() => trigger?.focus()); }
  function choose(id: string) { close(true); void onSelect(id); }
  function favorite(id: string) {
    favorites = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    try { localStorage.setItem('opentales.ai.favoriteModels', JSON.stringify(favorites)); } catch { /* Storage can be disabled. */ }
  }
  function count(value: number) { return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
</script>

<button bind:this={trigger} type="button" class="model-trigger" {disabled} aria-label="Choose model" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${uid}-models`} onclick={toggle} onkeydown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) void toggle(); } }} title={value || 'Choose model'}>
  <Cpu size={14} strokeWidth={1.6} />
  <span>{selected?.model.name ?? (value || 'Choose model')}</span>
  <ChevronDown size={12} />
</button>
{#if open}
<div use:floatingMenu={{ anchor: trigger!, placement, close }} id={`${uid}-models`} role="dialog" aria-label="Model picker" tabindex="-1" class="model-menu">
    <nav class="vendor-rail" aria-label="Filter models">
      <button type="button" class:active={filter === 'all'} aria-label="All models" title="All models" onclick={() => (filter = 'all')}><Globe size={17} /></button>
      <button type="button" class:active={filter === 'favorites'} aria-label="Favorite models" title="Favorite models" onclick={() => (filter = 'favorites')}><Star size={17} /></button>
      <span class="rail-divider"></span>
      {#each vendors as vendor (vendor)}
        <button type="button" class:active={filter === vendor} aria-label={`Filter ${vendor}`} title={vendor} onclick={() => (filter = vendor)}><span class="vendor-initial">{vendor.slice(0, 2)}</span></button>
      {/each}
    </nav>
    <div class="model-main">
      <label class="model-search"><Search size={14} /><input bind:this={search} bind:value={query} placeholder="Search models…" aria-label="Search models" />{#if onRefresh}<button type="button" onclick={onRefresh} aria-label="Refresh models" disabled={loading}><RefreshCw size={13} /></button>{/if}</label>
      <div class="model-results" role="listbox" aria-label="Available models" aria-busy={loading}>
        {#if loading}
          <p class="picker-message"><Loader2 size={14} class="motion-safe:animate-spin" /> Loading models…</p>
        {:else if error}
          <p class="picker-message picker-error" role="alert">{error}</p>
        {:else if !filtered.length}
          <p class="picker-message">{choices.length ? 'No matching models.' : 'No models available. Load models in AI settings.'}</p>
        {:else}
          {#each filtered as choice (choice.id)}
            <div class="model-row" class:selected={choice.id === value}>
              <button type="button" role="option" aria-selected={choice.id === value} data-menu-item onclick={() => choose(choice.id)} class="model-option" title={choice.id}>
                <span class="model-name">{choice.model.name}{#if choice.id === value}<Check size={13} />{/if}</span>
                <span class="model-detail"><span>{choice.model.vendor ?? choice.provider.name}</span>{#if choice.model.context}<span>· {count(choice.model.context)} context</span>{/if}{#if choice.model.supportsVision}<Eye size={11} aria-label="Vision" />{/if}{#if choice.model.supportsTools}<Wrench size={11} aria-label="Tools" />{/if}</span>
              </button>
              <button type="button" class="favorite" class:starred={favorites.includes(choice.id)} aria-label={`${favorites.includes(choice.id) ? 'Unfavorite' : 'Favorite'} ${choice.model.name}`} aria-pressed={favorites.includes(choice.id)} onclick={() => favorite(choice.id)}><Star size={13} fill={favorites.includes(choice.id) ? 'currentColor' : 'none'} /></button>
            </div>
          {/each}
        {/if}
      </div>
      <footer>{filtered.length} {filtered.length === 1 ? 'model' : 'models'}<span>↑ ↓ to navigate · Esc to close</span></footer>
    </div>
  </div>
{/if}

<style>
  .model-trigger { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0; padding: 6px 7px; border-radius: 7px; color: var(--muted-foreground); font-size: 11px; text-align: left; }
  .model-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .model-trigger :global(svg) { flex-shrink: 0; }
  .model-trigger:hover, .model-trigger[aria-expanded='true'] { background: var(--muted); color: var(--foreground); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .model-menu { display: flex; width: 360px; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: var(--popover); color: var(--foreground); box-shadow: 0 18px 55px #0006; font-family: var(--font-sans); }
  .vendor-rail { display: flex; width: 43px; flex-shrink: 0; flex-direction: column; align-items: center; gap: 4px; padding: 9px 4px; border-right: 1px solid var(--border); overflow-y: auto; }
  .vendor-rail button { display: grid; place-items: center; width: 32px; min-height: 32px; border-radius: 7px; color: var(--muted-foreground); }
  .vendor-rail .active { color: var(--accent); background: color-mix(in oklch, var(--accent) 12%, transparent); box-shadow: inset 2px 0 var(--accent); }
  .vendor-initial { font-family: var(--font-mono); text-transform: uppercase; font-size: 11px; }
  .rail-divider { width: 22px; border-top: 1px solid var(--border); margin: 3px 0; }
  .model-main { display: flex; flex: 1; min-width: 0; flex-direction: column; }
  .model-search { display: flex; align-items: center; gap: 7px; margin: 4px 10px 5px; min-height: 39px; border-bottom: 1px solid var(--accent); color: var(--muted-foreground); }
  .model-search input { width: 100%; min-width: 0; background: transparent; padding: 6px 0; font-size: 12px; color: var(--foreground); outline: none; }
  .model-search button { padding: 4px; }
  .model-results { min-height: 70px; max-height: 310px; overflow-y: auto; padding: 0 5px 5px; }
  .model-row { display: flex; align-items: center; border-radius: 7px; }
  .model-row:hover, .model-row.selected { background: var(--muted); }
  .model-option { flex: 1; min-width: 0; padding: 8px 7px; text-align: left; border-radius: 7px; }
  .model-name { display: flex; align-items: center; gap: 7px; font-size: 12px; overflow-wrap: anywhere; }
  .model-name :global(svg) { flex-shrink: 0; color: var(--accent); }
  .model-detail { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 3px; font-size: 10px; color: var(--muted-foreground); }
  .favorite { padding: 9px; color: var(--muted-foreground); border-radius: 5px; opacity: .55; }
  .favorite.starred { color: var(--accent); opacity: 1; }
  .picker-message { display: flex; align-items: center; gap: 6px; padding: 18px 10px; color: var(--muted-foreground); font-size: 11px; line-height: 1.6; }
  .picker-error { color: var(--destructive); }
  footer { display: flex; justify-content: space-between; flex-shrink: 0; gap: 8px; border-top: 1px solid var(--border); padding: 7px 10px; font-size: 9px; color: var(--muted-foreground); }
</style>
