<script lang="ts">
  import {
    BookOpen,
    FileText,
    Keyboard,
    MapPin,
    Palette,
    Search,
    Settings,
    Users
  } from 'lucide-svelte';
  import { tick } from 'svelte';
  import { commandPalette } from '$lib/stores/commandPalette.svelte';
  import { editorTheme, type EditorThemeId } from '$lib/stores/editorTheme.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { ActivityView } from '$lib/data/manuscript-types';
  import type { IconComponent } from './contextMenuTypes';

  type CommandKind = 'chapter' | 'character' | 'location' | 'view' | 'theme' | 'action';

  interface CommandItem {
    id: string;
    kind: CommandKind;
    title: string;
    subtitle?: string;
    icon: IconComponent;
    keywords?: string;
    run: () => void | Promise<void>;
  }

  let query = $state('');
  let activeIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (commandPalette.open) {
      query = '';
      activeIndex = 0;
      void tick().then(() => inputEl?.focus());
    }
  });

  function close() {
    commandPalette.hide();
  }

  function viewCommand(view: ActivityView, title: string, icon: IconComponent): CommandItem {
    return {
      id: `view:${view}`,
      kind: 'view',
      title,
      subtitle: 'Open panel',
      icon,
      keywords: `panel ${view}`,
      run: () => {
        manuscript.setActiveView(view);
        close();
      }
    };
  }

  function themeCommand(id: EditorThemeId, label: string, description: string): CommandItem {
    return {
      id: `theme:${id}`,
      kind: 'theme',
      title: `Theme: ${label}`,
      subtitle: description,
      icon: Palette,
      keywords: 'theme color',
      run: () => {
        editorTheme.setTheme(id);
        close();
      }
    };
  }

  let commands = $derived.by<CommandItem[]>(() => {
    const out: CommandItem[] = [];

    for (const ch of manuscript.chapters) {
      out.push({
        id: `chapter:${ch.id}`,
        kind: 'chapter',
        title: ch.title,
        subtitle:
          ch.number === 0 ? 'Prologue' : `Chapter ${ch.number} · ${ch.wordCount.toLocaleString()} words`,
        icon: FileText,
        keywords: `chapter ${ch.title}`,
        run: () => {
          void manuscript.setSelectedId(ch.id);
          void manuscript.openTab({
            id: `tab-${ch.id}`,
            type: 'chapter',
            refId: ch.id,
            title: ch.title
          });
          close();
        }
      });
    }

    for (const c of manuscript.characters) {
      out.push({
        id: `character:${c.id}`,
        kind: 'character',
        title: c.name,
        subtitle: c.role ?? 'Character',
        icon: Users,
        keywords: `character ${c.name}`,
        run: () => {
          void manuscript.setSelectedId(c.id);
          void manuscript.openTab({
            id: `tab-${c.id}`,
            type: 'character',
            refId: c.id,
            title: c.name
          });
          close();
        }
      });
    }

    for (const loc of manuscript.locations) {
      out.push({
        id: `location:${loc.id}`,
        kind: 'location',
        title: loc.name,
        subtitle: 'Location',
        icon: MapPin,
        keywords: `location ${loc.name}`,
        run: () => {
          void manuscript.setSelectedId(loc.id);
          void manuscript.openTab({
            id: `tab-${loc.id}`,
            type: 'location',
            refId: loc.id,
            title: loc.name
          });
          close();
        }
      });
    }

    out.push(viewCommand('explorer', 'Go to Manuscript', BookOpen));
    out.push(viewCommand('characters', 'Go to Characters', Users));
    out.push(viewCommand('locations', 'Go to Locations', MapPin));
    out.push(viewCommand('outline', 'Go to Outline', BookOpen));
    out.push(viewCommand('search', 'Go to Search', Search));
    out.push(viewCommand('members', 'Go to Members', Users));
    out.push(viewCommand('settings', 'Go to Settings', Settings));

    for (const t of editorTheme.themes) {
      out.push(themeCommand(t.id, t.label, t.description));
    }

    out.push({
      id: 'action:shortcuts',
      kind: 'action',
      title: 'Show keyboard shortcuts',
      subtitle: 'Press ? anywhere',
      icon: Keyboard,
      keywords: 'help shortcuts cheatsheet',
      run: () => {
        close();
        commandPalette.showShortcuts();
      }
    });

    return out;
  });

  let filtered = $derived.by<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 30);
    const tokens = q.split(/\s+/);
    const scored: { cmd: CommandItem; score: number }[] = [];
    for (const cmd of commands) {
      const haystack = `${cmd.title} ${cmd.subtitle ?? ''} ${cmd.keywords ?? ''}`.toLowerCase();
      let score = 0;
      let matchAll = true;
      for (const tok of tokens) {
        const idx = haystack.indexOf(tok);
        if (idx < 0) {
          matchAll = false;
          break;
        }
        score += 100 - Math.min(idx, 50) + tok.length;
      }
      if (matchAll) scored.push({ cmd, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 50).map((s) => s.cmd);
  });

  $effect(() => {
    if (filtered.length === 0) activeIndex = 0;
    else if (activeIndex >= filtered.length) activeIndex = filtered.length - 1;
  });

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) activeIndex = (activeIndex + 1) % filtered.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0)
        activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) void item.run();
    }
  }

  function kindLabel(kind: CommandKind): string {
    switch (kind) {
      case 'chapter':
        return 'Chapter';
      case 'character':
        return 'Character';
      case 'location':
        return 'Location';
      case 'view':
        return 'Panel';
      case 'theme':
        return 'Theme';
      case 'action':
        return 'Action';
    }
  }
</script>

{#if commandPalette.open}
  <div
    class="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 px-4 pt-[15vh] backdrop-blur-sm"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') close();
    }}
  >
    <div
      class="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search class="size-4 text-muted-foreground" />
        <input
          bind:this={inputEl}
          bind:value={query}
          onkeydown={handleKey}
          placeholder="Jump to chapter, character, command…"
          class="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          autocomplete="off"
          spellcheck="false"
        />
        <kbd
          class="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >Esc</kbd>
      </div>

      <div class="max-h-[60vh] overflow-y-auto py-1">
        {#if filtered.length === 0}
          <div class="px-3 py-6 text-center text-sm text-muted-foreground">
            No matches.
          </div>
        {:else}
          <ul role="listbox">
            {#each filtered as item, idx (item.id)}
              {@const Icon = item.icon}
              <li>
                <button
                  type="button"
                  onclick={() => void item.run()}
                  onmouseenter={() => (activeIndex = idx)}
                  class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
                  class:bg-accent={idx === activeIndex}
                  class:text-accent-foreground={idx === activeIndex}
                  class:hover:bg-muted={idx !== activeIndex}
                >
                  <Icon class="size-4 shrink-0 opacity-70" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate">{item.title}</div>
                    {#if item.subtitle}
                      <div
                        class="truncate text-[11px]"
                        class:text-accent-foreground={idx === activeIndex}
                        class:opacity-80={idx === activeIndex}
                        class:text-muted-foreground={idx !== activeIndex}
                      >
                        {item.subtitle}
                      </div>
                    {/if}
                  </div>
                  <span
                    class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                    class:bg-accent-foreground={idx === activeIndex}
                    class:text-accent={idx === activeIndex}
                  >
                    {kindLabel(item.kind)}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div
        class="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground"
      >
        <span>
          <kbd class="rounded border border-border bg-background px-1">↑</kbd>
          <kbd class="rounded border border-border bg-background px-1">↓</kbd>
          to navigate
        </span>
        <span>
          <kbd class="rounded border border-border bg-background px-1">↵</kbd>
          to select
        </span>
      </div>
    </div>
  </div>
{/if}
