<script lang="ts">
  import {
    AlertTriangle,
    Archive,
    BookMarked,
    BookOpen,
    BookOpenText,
    Bot,
    FileText,
    GitBranch,
    History,
    Keyboard,
    MapPin,
    MessageSquare,
    Network,
    Palette,
    Replace,
    Search,
    Settings,
    Sparkles,
    StickyNote,
    Users,
    Workflow
  } from 'lucide-svelte';
  import { tick } from 'svelte';
  import { commandPalette } from '$lib/stores/commandPalette.svelte';
  import { editorTheme, type EditorThemeId } from '$lib/stores/editorTheme.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { storyIde } from '$lib/stores/storyIde.svelte';
  import { storyUi, type OutlineProjection } from '$lib/stores/storyUi.svelte';
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
  let dialogEl: HTMLDivElement | undefined = $state();
  let restoreFocus: HTMLElement | null = null;

  $effect(() => {
    if (commandPalette.open) {
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      query = '';
      activeIndex = 0;
      void tick().then(() => inputEl?.focus());
    }
  });

  function close() {
    commandPalette.hide();
    void tick().then(() => restoreFocus?.focus());
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
    out.push(viewCommand('build', 'Go to Novel Builds', Workflow));
    out.push(viewCommand('bible', 'Go to Story Bible', BookMarked));
    out.push(viewCommand('publishing', 'Go to Export & Import', Archive));
    out.push({
      id: 'action:export-manuscript', kind: 'action', title: 'Export manuscript…', subtitle: 'DOCX, PDF, EPUB, Markdown, text, HTML, or project archive', icon: Archive, keywords: 'publish compile download docx pdf epub export',
      run: () => { manuscript.setActiveView('publishing'); void manuscript.openTab({ id: 'tab-publishing', type: 'publishing', refId: 'publishing', title: 'Export & Import' }); close(); }
    });
    out.push({
      id: 'action:import-manuscript', kind: 'action', title: 'Import manuscript…', subtitle: 'Preview DOCX, Markdown, text, HTML, or OpenTales archive', icon: Archive, keywords: 'upload preview conflict docx markdown import',
      run: () => { manuscript.setActiveView('publishing'); void manuscript.openTab({ id: 'tab-publishing', type: 'publishing', refId: 'publishing', title: 'Export & Import' }); close(); }
    });
    out.push({
      id: 'action:new-chapter',
      kind: 'action',
      title: 'New chapter',
      subtitle: 'Create a chapter in the current project',
      icon: FileText,
      keywords: 'add chapter manuscript',
      run: async () => {
        await manuscript.createChapter({ title: 'Untitled Chapter', status: 'draft', content: '# Untitled Chapter\n\n' });
        close();
      }
    });

    out.push({
      id: 'action:continuous-manuscript',
      kind: 'action',
      title: 'Open continuous manuscript',
      subtitle: 'Read or edit every chapter as one manuscript',
      icon: BookOpenText,
      keywords: 'scrivenings continuous whole manuscript prose source',
      run: () => {
        void manuscript.openTab({
          id: 'tab-continuous-manuscript',
          type: 'manuscript',
          refId: 'manuscript',
          title: 'Continuous Manuscript'
        });
        close();
      }
    });
    out.push(viewCommand('characters', 'Go to Characters', Users));
    out.push(viewCommand('locations', 'Go to Locations', MapPin));
    out.push(viewCommand('outline', 'Go to Outline', BookOpen));
    out.push(viewCommand('search', 'Go to Search', Search));
    out.push(viewCommand('problems', 'Go to Problems', AlertTriangle));
    out.push(viewCommand('docs', 'Go to Docs & Notes', StickyNote));
    out.push(viewCommand('ai', 'Go to AI Agent', Bot));
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

    out.push({
      id: 'action:new-novel-build',
      kind: 'action',
      title: 'Start a Novel Build',
      subtitle: 'Compile one brainstorm into a durable story workflow',
      icon: Workflow,
      keywords: 'new build novel compile brainstorm autonomy',
      run: () => {
        storyIde.beginNew();
        manuscript.setActiveView('build');
        void manuscript.openTab({ id: 'tab-new-build', type: 'build', refId: 'new', title: 'New Novel Build' });
        close();
      }
    });

    const outlineViews: Array<{ id: OutlineProjection; label: string }> = [
      { id: 'hierarchy', label: 'Hierarchy' },
      { id: 'corkboard', label: 'Corkboard' },
      { id: 'plot-grid', label: 'Plot grid' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'arc', label: 'Character arcs' },
      { id: 'tension', label: 'Tension curve' }
    ];
    for (const view of outlineViews) {
      out.push({
        id: `action:outline-${view.id}`,
        kind: 'action',
        title: `Outline: ${view.label}`,
        subtitle: 'Open a synchronized projection of the story graph',
        icon: Network,
        keywords: `outline scenes ${view.id}`,
        run: () => {
          storyUi.setOutlineProjection(view.id);
          manuscript.setActiveView('outline');
          void manuscript.openTab({ id: 'tab-outline-studio', type: 'outline-studio', refId: storyIde.selectedRunId ?? 'outline', title: 'Semantic Outline' });
          close();
        }
      });
    }

    out.push({
      id: 'action:move-scene', kind: 'action', title: 'Move scene…', subtitle: 'Open the persisted Corkboard and drag a scene within its chapter', icon: GitBranch, keywords: 'reorder move scene corkboard',
      run: () => { storyUi.setOutlineProjection('corkboard'); manuscript.setActiveView('outline'); void manuscript.openTab({ id: 'tab-outline-studio', type: 'outline-studio', refId: storyIde.selectedRunId ?? 'outline', title: 'Semantic Outline' }); close(); }
    });

    if (storyIde.selectedRun) {
      out.push({
        id: 'action:compare-build', kind: 'action', title: 'Compare build branch with main', subtitle: storyIde.selectedRun.branchName, icon: GitBranch, keywords: 'diff semantic prose review merge snapshot',
        run: () => { storyUi.requestBuildSurface('comparison'); manuscript.setActiveView('build'); void manuscript.openTab({ id: `tab-build-${storyIde.selectedRun!.id}`, type: 'build', refId: storyIde.selectedRun!.id, title: 'Novel Build' }); close(); }
      });
    }

    out.push({
      id: 'action:compare-snapshot', kind: 'action', title: 'Compare with snapshot…', subtitle: 'Open immutable prose and semantic history', icon: History, keywords: 'revision history diff restore branch snapshot',
      run: () => { manuscript.setActiveView('revisions'); void manuscript.openTab({ id: 'tab-revisions', type: 'revisions', refId: 'revisions', title: 'Revisions' }); close(); }
    });

    const activeTab = manuscript.tabs.find((tab) => tab.id === manuscript.activeTabId);
    const activeChapter = activeTab?.type === 'chapter'
      ? manuscript.chapters.find((chapter) => chapter.id === activeTab.refId)
      : null;
    if (activeChapter) {
      const selectedSceneIndex = activeChapter.scenes.findIndex((scene) => scene.id === storyUi.selectedOutlineSceneId);
      out.push({
        id: 'action:new-scene-after-current',
        kind: 'action',
        title: 'New scene after current',
        subtitle: selectedSceneIndex >= 0 ? `Insert after ${activeChapter.scenes[selectedSceneIndex].title}` : `Append to ${activeChapter.title}`,
        icon: GitBranch,
        keywords: 'new scene metadata plan',
        run: async () => {
          await manuscript.createScene(activeChapter.id, { title: 'Untitled Scene', order: selectedSceneIndex >= 0 ? selectedSceneIndex + 1 : activeChapter.scenes.length, status: 'planned' });
          storyUi.setOutlineProjection('corkboard');
          void manuscript.openTab({ id: 'tab-outline-studio', type: 'outline-studio', refId: storyIde.selectedRunId ?? 'outline', title: 'Semantic Outline' });
          close();
        }
      });
    }

    const outlineSceneId = storyUi.selectedOutlineSceneId;
    const selectedScene = manuscript.chapters.flatMap((chapter) => chapter.scenes).find((scene) => scene.id === outlineSceneId);
    const selectedUnit = storyIde.units.find((unit) => unit.id === outlineSceneId || unit.sourceSceneId === outlineSceneId);
    if (outlineSceneId) {
      out.push({
        id: 'action:mark-setup', kind: 'action', title: 'Mark selected scene as setup', subtitle: selectedScene?.title ?? selectedUnit?.title ?? outlineSceneId, icon: GitBranch, keywords: 'setup promise clue foreshadow',
        run: async () => { await storyIde.markSceneAsSetup(outlineSceneId, selectedScene?.title ?? selectedUnit?.title ?? 'Story setup'); manuscript.setActiveView('bible'); close(); }
      });
    }
    const selectedSetup = storyUi.bibleSelection?.section === 'setups' ? storyIde.snapshot?.setupPayoffs.find((item) => item.id === storyUi.bibleSelection?.id) : null;
    if (selectedSetup && outlineSceneId) {
      out.push({
        id: 'action:link-payoff', kind: 'action', title: `Link payoff for ${selectedSetup.title}`, subtitle: selectedScene?.title ?? selectedUnit?.title ?? outlineSceneId, icon: GitBranch, keywords: 'payoff resolve setup link',
        run: async () => { await storyIde.linkPayoff(selectedSetup, outlineSceneId); manuscript.setActiveView('bible'); close(); }
      });
    }

    out.push({
      id: 'action:run-story-diagnostics',
      kind: 'action',
      title: 'Run story diagnostics',
      subtitle: 'Refresh continuity, chronology, story-state, and craft checks',
      icon: AlertTriangle,
      keywords: 'problems lint continuity diagnostics revision pass',
      run: () => {
        if (storyIde.selectedRunId) void storyIde.refreshSelected();
        manuscript.setActiveView('problems');
        close();
      }
    });

    const selectedChapter = manuscript.chapters.find((item) => item.id === manuscript.selectedId);
    const selectedCharacter = manuscript.characters.find((item) => item.id === manuscript.selectedId);
    const selectedLocation = manuscript.locations.find((item) => item.id === manuscript.selectedId);
    const renameTarget = selectedCharacter
      ? { targetType: 'character' as const, targetId: selectedCharacter.id, name: selectedCharacter.name, aliases: selectedCharacter.aliases }
      : selectedLocation
        ? { targetType: 'location' as const, targetId: selectedLocation.id, name: selectedLocation.name, aliases: selectedLocation.aliases }
        : null;
    const reference = selectedChapter
      ? { type: 'chapter', id: selectedChapter.id, title: selectedChapter.title }
      : selectedCharacter
        ? { type: 'character', id: selectedCharacter.id, title: selectedCharacter.name }
        : selectedLocation
          ? { type: 'location', id: selectedLocation.id, title: selectedLocation.name }
          : null;
    out.push({
      id: 'action:find-references',
      kind: 'action',
      title: reference ? `Find references to ${reference.title}` : 'Find references…',
      subtitle: reference ? 'Traverse the persistent story index' : 'Select a chapter, character, or location first',
      icon: Search,
      keywords: 'find references backlinks usages symbol',
      run: () => {
        if (reference) storyUi.requestReferences(reference.type, reference.id, reference.title);
        manuscript.setActiveView('search');
        close();
      }
    });

    if (renameTarget) {
      out.push({
        id: `action:rename-symbol:${renameTarget.targetType}:${renameTarget.targetId}`,
        kind: 'action',
        title: 'Rename symbol…',
        subtitle: `${renameTarget.name} · Preview every project-wide edit`,
        icon: Replace,
        keywords: `rename refactor symbol ${renameTarget.targetType} ${renameTarget.name}`,
        run: () => {
          close();
          void tick().then(() => storyUi.requestRenameSymbol(renameTarget));
        }
      });
    }

    // AI-related commands
    out.push({
      id: 'action:ai-dialogue',
      kind: 'action',
      title: 'AI: Generate character dialogue',
      subtitle: 'Create dialogue lines for a character',
      icon: MessageSquare,
      keywords: 'ai dialogue character speech',
      run: () => {
        manuscript.setActiveView('ai');
        close();
      }
    });
    out.push({
      id: 'action:ai-outline',
      kind: 'action',
      title: 'AI: Expand outline',
      subtitle: 'Expand a synopsis into a detailed outline',
      icon: Sparkles,
      keywords: 'ai outline expand synopsis',
      run: () => {
        manuscript.setActiveView('outline');
        close();
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
      void tick().then(() => document.getElementById(`command-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0)
        activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      void tick().then(() => document.getElementById(`command-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) void item.run();
    }
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !dialogEl) return;
    const focusable = [...dialogEl.querySelectorAll<HTMLElement>('input,button:not([disabled]),[tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
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
      bind:this={dialogEl}
      class="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="Command palette"
      onkeydown={trapFocus}
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
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-autocomplete="list"
          aria-activedescendant={filtered[activeIndex] ? `command-option-${activeIndex}` : undefined}
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
          <ul id="command-palette-results" role="listbox" aria-label="Commands">
            {#each filtered as item, idx (item.id)}
              {@const Icon = item.icon}
              <li>
                <button
                  id={`command-option-${idx}`}
                  role="option"
                  aria-selected={idx === activeIndex}
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
