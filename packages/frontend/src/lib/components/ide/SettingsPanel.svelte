<script lang="ts">
  import { Eye, EyeOff, Image as ImageIcon, Keyboard } from 'lucide-svelte';
  import type { CoverOrientation, ProjectVisibility } from '@opentales/sdk';
  import { commandPalette } from '$lib/stores/commandPalette.svelte';
  import { editorTheme, type EditorThemeId } from '$lib/stores/editorTheme.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { preferences } from '$lib/stores/preferences.svelte';
  import PanelHeader from './PanelHeader.svelte';

  let coverInput: HTMLInputElement | null = $state(null);

  let title = $state('');
  let slug = $state('');
  let description = $state('');
  let genre = $state('');
  let perspective = $state('');
  let pov = $state('');
  let voice = $state('');
  let tone = $state('');
  let themesText = $state('');

  let lastSyncedProjectId = $state<string | null>(null);

  $effect(() => {
    const id = manuscript.projectId;
    if (id !== lastSyncedProjectId) {
      title = manuscript.projectMeta.title ?? '';
      description = manuscript.projectMeta.description ?? '';
      const summary = manuscript.projects.find((p) => p.id === id);
      slug = summary?.slug ?? '';
      genre = manuscript.structure.genre ?? '';
      perspective = manuscript.structure.perspective ?? '';
      pov = manuscript.structure.pov ?? '';
      voice = manuscript.structure.voice ?? '';
      tone = manuscript.structure.tone ?? '';
      themesText = (manuscript.structure.themes ?? []).join(', ');
      lastSyncedProjectId = id;
    }
  });

  function canEdit(): boolean {
    const role = manuscript.currentUserRole;
    return role === null || role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR';
  }

  async function setVisibility(next: ProjectVisibility) {
    if (manuscript.projectMeta.visibility === next) return;
    await manuscript.updateProject({ visibility: next });
  }

  async function setOrientation(next: CoverOrientation) {
    if (manuscript.projectMeta.coverOrientation === next) return;
    await manuscript.updateProject({ coverOrientation: next });
  }

  async function uploadCover(file: Blob) {
    await manuscript.setProjectCover(file);
  }

  function publicReadHref(): string | null {
    const meta = manuscript.projectMeta;
    if (meta.visibility !== 'public') return null;
    const summary = manuscript.projects.find((p) => p.id === manuscript.projectId);
    if (!summary) return null;
    if (!meta.orgSlug) return null;
    return `/read/${encodeURIComponent(meta.orgSlug)}/${encodeURIComponent(summary.slug)}`;
  }

  async function saveBasics(e: Event) {
    e.preventDefault();
    await manuscript.updateProject({
      title: title.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || null,
      genre: genre.trim() || null,
      perspective: perspective.trim() || null,
      pov: pov.trim() || null,
      voice: voice.trim() || null,
      tone: tone.trim() || null,
      themes: themesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    });
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Project Settings" />
  <div class="flex-1 overflow-y-auto">
    <section class="border-b border-border p-3 text-xs">
      <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Editor preferences
      </h3>
      <div class="mb-3">
        <span class="mb-1.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
          Theme
        </span>
        <div class="grid grid-cols-2 gap-1.5">
          {#each editorTheme.themes as t (t.id)}
            <button
              type="button"
              onclick={() => editorTheme.setTheme(t.id as EditorThemeId)}
              title={t.description}
              class={(editorTheme.current === t.id
                ? 'border-accent ring-1 ring-accent '
                : 'border-border hover:border-accent/60 ') +
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors'}
            >
              <span
                class="size-4 shrink-0 rounded-full border border-border"
                style="background: {t.background}; box-shadow: inset 0 0 0 2px {t.foreground}33"
              ></span>
              <span class="min-w-0 flex-1 truncate">
                <span class="block text-[11px] font-medium text-foreground">{t.label}</span>
                <span class="block truncate text-[10px] text-muted-foreground">
                  {t.description}
                </span>
              </span>
            </button>
          {/each}
        </div>
      </div>
      <button
        type="button"
        onclick={() => commandPalette.showShortcuts()}
        class="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Keyboard class="size-3.5" />
        Keyboard shortcuts
      </button>
    </section>

    {#if !manuscript.projectId}
      <div class="p-4 text-xs text-muted-foreground">No project loaded.</div>
    {:else}
      <section class="border-b border-border p-3 text-xs">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Cover
        </h3>
        <div
          class={(
            manuscript.projectMeta.coverOrientation === 'portrait'
              ? 'aspect-[2/3] w-32 '
              : 'aspect-[16/9] w-full '
          ) + 'mb-2 overflow-hidden rounded-md border border-border bg-muted'}
        >
          {#if manuscript.projectMeta.coverUrl}
            <img
              src={manuscript.projectMeta.coverUrl}
              alt="Project cover"
              class="size-full object-cover"
            />
          {:else}
            <div class="flex size-full items-center justify-center text-muted-foreground">
              <ImageIcon class="size-6" />
            </div>
          {/if}
        </div>
        <div class="flex gap-1.5">
          {#if canEdit()}
            <button
              type="button"
              onclick={() => coverInput?.click()}
              class="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
            >
              {manuscript.projectMeta.coverUrl ? 'Replace' : 'Upload'}
            </button>
            <input
              bind:this={coverInput}
              type="file"
              accept="image/*"
              hidden
              onchange={(e) => {
                const f = (e.currentTarget as HTMLInputElement).files?.[0];
                if (f) void uploadCover(f);
                if (coverInput) coverInput.value = '';
              }}
            />
            <div class="ml-auto flex overflow-hidden rounded-md border border-border text-[10px]">
              <button
                type="button"
                onclick={() => setOrientation('landscape')}
                class={'px-2 py-1 ' +
                  (manuscript.projectMeta.coverOrientation === 'landscape'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted')}
              >
                Landscape
              </button>
              <button
                type="button"
                onclick={() => setOrientation('portrait')}
                class={'px-2 py-1 ' +
                  (manuscript.projectMeta.coverOrientation === 'portrait'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted')}
              >
                Portrait
              </button>
            </div>
          {/if}
        </div>
      </section>

      <section class="border-b border-border p-3 text-xs">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Visibility
        </h3>
        <div class="flex gap-1.5">
          <button
            type="button"
            onclick={() => setVisibility('private')}
            disabled={!canEdit()}
            class={'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] ' +
              (manuscript.projectMeta.visibility === 'private'
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border text-muted-foreground hover:bg-muted')}
          >
            <EyeOff class="size-3.5" /> Private
          </button>
          <button
            type="button"
            onclick={() => setVisibility('public')}
            disabled={!canEdit()}
            class={'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] ' +
              (manuscript.projectMeta.visibility === 'public'
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border text-muted-foreground hover:bg-muted')}
          >
            <Eye class="size-3.5" /> Public
          </button>
        </div>
        {#if manuscript.projectMeta.visibility === 'public'}
          <p class="mt-2 text-[10px] text-muted-foreground">
            Only chapters with a published date are visible on the public read page.
          </p>
          {#if publicReadHref()}
            <a
              href={publicReadHref()}
              target="_blank"
              rel="noopener"
              class="mt-1 block truncate text-[10px] text-accent hover:underline"
            >
              {publicReadHref()}
            </a>
          {/if}
        {/if}
      </section>

      <form onsubmit={saveBasics} class="space-y-3 p-3 text-xs">
        <label class="block">
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Title</span>
          <input
            type="text"
            bind:value={title}
            disabled={!canEdit()}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Slug</span>
          <input
            type="text"
            bind:value={slug}
            disabled={!canEdit()}
            placeholder="my-project"
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Description</span>
          <textarea
            bind:value={description}
            disabled={!canEdit()}
            rows="3"
            class="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
          ></textarea>
        </label>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Genre</span>
            <input
              type="text"
              bind:value={genre}
              disabled={!canEdit()}
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Perspective</span>
            <input
              type="text"
              bind:value={perspective}
              disabled={!canEdit()}
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">POV</span>
            <input
              type="text"
              bind:value={pov}
              disabled={!canEdit()}
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Voice</span>
            <input
              type="text"
              bind:value={voice}
              disabled={!canEdit()}
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
            />
          </label>
          <label class="col-span-2 block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">Tone</span>
            <input
              type="text"
              bind:value={tone}
              disabled={!canEdit()}
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
            />
          </label>
          <label class="col-span-2 block">
            <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
              Themes (comma separated)
            </span>
            <input
              type="text"
              bind:value={themesText}
              disabled={!canEdit()}
              class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-60"
            />
          </label>
        </div>

        {#if canEdit()}
          <button
            type="submit"
            disabled={manuscript.saving}
            class="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
          >
            {manuscript.saving ? 'Saving…' : 'Save changes'}
          </button>
        {:else}
          <p class="text-[10px] text-muted-foreground">
            Your role ({manuscript.currentUserRole}) cannot edit project settings.
          </p>
        {/if}
      </form>

      <section class="border-t border-border p-3 text-xs">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Writing preferences
        </h3>
        <label class="mb-2 block">
          <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
            Daily word goal
          </span>
          <input
            type="number"
            min="0"
            step="50"
            value={preferences.dailyWordGoal}
            oninput={(e) =>
              preferences.setDailyWordGoal(Number((e.currentTarget as HTMLInputElement).value))}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
          />
          <span class="mt-1 block text-[10px] text-muted-foreground">
            Set to 0 to hide the goal indicator. Tracked locally per browser.
          </span>
        </label>
        <label class="mb-1 flex items-center gap-2">
          <input
            type="checkbox"
            checked={preferences.typewriterMode}
            onchange={(e) =>
              preferences.setTypewriterMode((e.currentTarget as HTMLInputElement).checked)}
            class="accent-accent"
          />
          <span>Typewriter mode (keep active line centered)</span>
        </label>
        <label class="mb-1 flex items-center gap-2">
          <input
            type="checkbox"
            checked={preferences.focusMode}
            onchange={(e) =>
              preferences.setFocusMode((e.currentTarget as HTMLInputElement).checked)}
            class="accent-accent"
          />
          <span>Focus mode (dim everything but current paragraph)</span>
        </label>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            checked={preferences.showMinimap}
            onchange={(e) =>
              preferences.setShowMinimap((e.currentTarget as HTMLInputElement).checked)}
            class="accent-accent"
          />
          <span>Show editor minimap</span>
        </label>
      </section>
    {/if}
  </div>
</div>
