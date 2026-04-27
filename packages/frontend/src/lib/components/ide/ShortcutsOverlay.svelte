<script lang="ts">
  import { X } from 'lucide-svelte';
  import { commandPalette } from '$lib/stores/commandPalette.svelte';

  interface Shortcut {
    keys: string[];
    label: string;
  }

  interface Group {
    title: string;
    shortcuts: Shortcut[];
  }

  // Render Cmd or Ctrl based on platform — best-effort, defaults to Ctrl on SSR.
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';

  const groups: Group[] = [
    {
      title: 'General',
      shortcuts: [
        { keys: [mod, 'K'], label: 'Open command palette' },
        { keys: ['?'], label: 'Open this shortcuts overlay' },
        { keys: ['Esc'], label: 'Close palette / overlay' }
      ]
    },
    {
      title: 'Navigation',
      shortcuts: [
        { keys: [mod, '1'], label: 'Manuscript explorer' },
        { keys: [mod, '2'], label: 'Characters' },
        { keys: [mod, '3'], label: 'Locations' },
        { keys: [mod, '4'], label: 'Outline' },
        { keys: [mod, ','], label: 'Settings' }
      ]
    },
    {
      title: 'Editor',
      shortcuts: [
        { keys: [mod, 'S'], label: 'Save (autosaves are continuous)' },
        { keys: [mod, '/'], label: 'Toggle line comment' },
        { keys: [mod, 'F'], label: 'Find in chapter' },
        { keys: [mod, 'Shift', 'F'], label: 'Find across manuscript' }
      ]
    },
    {
      title: 'Explorer (right-click)',
      shortcuts: [
        { keys: ['Right-click'], label: 'Open context menu' },
        { keys: ['F2'], label: 'Rename selected item' }
      ]
    }
  ];
</script>

{#if commandPalette.shortcutsOpen}
  <div
    class="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) commandPalette.hideShortcuts();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') commandPalette.hideShortcuts();
    }}
  >
    <div
      class="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <header class="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 class="text-sm font-semibold text-foreground">Keyboard shortcuts</h2>
        <button
          type="button"
          onclick={() => commandPalette.hideShortcuts()}
          class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <X class="size-4" />
        </button>
      </header>

      <div class="max-h-[70vh] overflow-y-auto p-4">
        <div class="grid gap-6 md:grid-cols-2">
          {#each groups as group (group.title)}
            <section>
              <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.title}
              </h3>
              <ul class="space-y-1.5 text-sm">
                {#each group.shortcuts as s, i (i)}
                  <li class="flex items-center justify-between gap-3">
                    <span class="text-foreground/85">{s.label}</span>
                    <span class="flex items-center gap-1">
                      {#each s.keys as key (key)}
                        <kbd
                          class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                        >
                          {key}
                        </kbd>
                      {/each}
                    </span>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      </div>

      <footer
        class="border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground"
      >
        Tip — press <kbd class="rounded border border-border bg-background px-1">{mod}</kbd>+<kbd
          class="rounded border border-border bg-background px-1"
        >K</kbd> to open the command palette from anywhere.
      </footer>
    </div>
  </div>
{/if}
