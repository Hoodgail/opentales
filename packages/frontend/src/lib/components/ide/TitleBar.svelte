<script lang="ts">
  import {
    ChevronDown,
    FolderPlus,
    Maximize2,
    Menu,
    Minimize2,
    Minus,
    PanelRight,
    Radio,
    X
  } from 'lucide-svelte';
  import { onDestroy, onMount } from 'svelte';
  import Logo from '$lib/components/Logo.svelte';
  import { collaboration } from '$lib/stores/collaboration.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import { viewport } from '$lib/stores/viewport.svelte';
  import { electron } from '$lib/electron';

  const api = electron();

  let projectMenuOpen = $state(false);
  let creatingProject = $state(false);
  let collaboratorsOpen = $state(false);
  let newProjectTitle = $state('');
  let isMaximized = $state(false);
  let unsubscribe: (() => void) | undefined;

  const activeProject = $derived(
    manuscript.projects.find((p) => p.id === manuscript.projectId) ?? null
  );
  const activeCollaborators = $derived(
    collaboration.collaborators.filter(
      (presence, index, all) =>
        all.findIndex((candidate) => candidate.clientId === presence.clientId) === index
    )
  );

  $effect(() => {
    collaboration.connect(manuscript.projectId);
  });

  onMount(() => {
    if (!api.isElectron) return;
    void api.window.isMaximized().then((value) => (isMaximized = value));
    unsubscribe = api.window.onMaximizeChange((value) => (isMaximized = value));
  });

  onDestroy(() => {
    unsubscribe?.();
  });

  function toggleMenu() {
    projectMenuOpen = !projectMenuOpen;
    if (!projectMenuOpen) {
      creatingProject = false;
      newProjectTitle = '';
    }
  }

  async function selectProject(id: string) {
    projectMenuOpen = false;
    creatingProject = false;
    if (id !== manuscript.projectId) {
      await manuscript.switchProject(id);
    }
  }

  async function submitNewProject() {
    const title = newProjectTitle.trim();
    if (!title) return;
    const created = await manuscript.createNewProject({ title });
    newProjectTitle = '';
    creatingProject = false;
    projectMenuOpen = false;
    if (!created) return;
  }

  function handleBackdrop() {
    projectMenuOpen = false;
    collaboratorsOpen = false;
    creatingProject = false;
    newProjectTitle = '';
  }

  function minimize() {
    void api.window.minimize();
  }
  function toggleMaximize() {
    void api.window.toggleMaximize();
  }
  function close() {
    void api.window.close();
  }

  function initials(name: string | null, username: string): string {
    return (name ?? username).slice(0, 2).toUpperCase();
  }
</script>

<header
  class="relative flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-between border-b border-border bg-sidebar text-xs select-none"
  style="-webkit-app-region: drag;"
>
  <!-- Left: hamburger (mobile) + brand + project switcher -->
  <div class="flex items-center gap-2 pl-1 sm:gap-3 sm:pl-3" style="-webkit-app-region: no-drag;">
    {#if viewport.mobile}
      <button
        type="button"
        onclick={() => ui.toggle('side')}
        aria-label={ui.drawer === 'side' ? 'Close menu' : 'Open menu'}
        class="tap-target flex size-11 items-center justify-center rounded-md text-foreground/80 hover:bg-muted hover:text-foreground"
      >
        <Menu class="size-4" />
      </button>
    {/if}
    <div class="flex items-center gap-1.5">
      <Logo size={16} />
      <span class="hidden font-medium text-foreground/80 sm:inline">OpenTales</span>
    </div>
    <span class="hidden text-muted-foreground/40 sm:inline">/</span>
    <button
      type="button"
      onclick={toggleMenu}
      disabled={!manuscript.authenticated}
      class={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${viewport.mobile ? 'min-h-11' : ''}`}
    >
      <span class="max-w-[8rem] truncate font-medium sm:max-w-[18rem]">
        {activeProject?.title ?? manuscript.structure.title ?? 'No project'}
      </span>
      <ChevronDown class="size-3 text-muted-foreground" />
    </button>
  </div>

  <!-- Center: subtle status (hidden on mobile to free horizontal space) -->
  <div class="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-muted-foreground sm:block">
    {#if manuscript.saving}
      <span class="font-mono text-[10px] uppercase tracking-wider">Saving…</span>
    {:else if activeProject?.genre}
      <span class="font-mono text-[10px] uppercase tracking-wider">{activeProject.genre}</span>
    {/if}
  </div>

  <!-- Right: window controls + (mobile) inspector toggle -->
  <div
    class="flex items-center gap-1 pr-2 text-muted-foreground"
    style="-webkit-app-region: no-drag;"
  >
    {#if viewport.mobile}
      <button
        type="button"
        onclick={() => ui.toggle('inspector')}
        aria-label={ui.drawer === 'inspector' ? 'Close inspector' : 'Open inspector'}
        class="tap-target flex size-11 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
      >
        <PanelRight class="size-4" />
      </button>
    {/if}
    {#if activeCollaborators.length > 0}
      <div class="relative">
        <button
          type="button"
          onclick={() => (collaboratorsOpen = !collaboratorsOpen)}
          class="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Active collaborators"
        >
          <Radio class="size-3 text-emerald-400" />
          <div class="flex -space-x-1">
            {#each activeCollaborators.slice(0, 3) as presence (presence.clientId)}
              <span
                class="flex size-5 items-center justify-center rounded-full border border-sidebar bg-accent text-[9px] font-semibold text-accent-foreground"
                title={presence.user.name ?? presence.user.username}
              >
                {initials(presence.user.name, presence.user.username)}
              </span>
            {/each}
          </div>
          <span class="font-mono text-[10px]">{activeCollaborators.length}</span>
        </button>
      </div>
    {/if}
    {#if api.isElectron}
      <button
        type="button"
        onclick={minimize}
        class="rounded p-1.5 hover:bg-muted hover:text-foreground"
        aria-label="Minimize"
      >
        <Minus class="size-3.5" />
      </button>
      <button
        type="button"
        onclick={toggleMaximize}
        class="rounded p-1.5 hover:bg-muted hover:text-foreground"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      >
        {#if isMaximized}
          <Minimize2 class="size-3" />
        {:else}
          <Maximize2 class="size-3" />
        {/if}
      </button>
      <button
        type="button"
        onclick={close}
        class="rounded p-1.5 hover:bg-destructive hover:text-destructive-foreground"
        aria-label="Close"
      >
        <X class="size-3.5" />
      </button>
    {/if}
  </div>

  {#if projectMenuOpen}
    <button
      type="button"
      onclick={handleBackdrop}
      aria-label="Close project menu"
      tabindex="-1"
      class="fixed inset-0 z-30 cursor-default bg-transparent"
      style="-webkit-app-region: no-drag;"
    ></button>
    <div
      class="absolute left-2 right-2 top-[var(--app-titlebar-height)] z-40 max-w-[18rem] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg sm:left-32 sm:right-auto sm:w-72 sm:max-w-none sm:rounded-md"
      style="-webkit-app-region: no-drag;"
    >
      <div class="max-h-72 overflow-y-auto py-1">
        {#each manuscript.projects as project (project.id)}
          <button
            type="button"
            onclick={() => selectProject(project.id)}
            class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
            class:bg-muted={project.id === manuscript.projectId}
          >
            <span class="truncate text-foreground">{project.title}</span>
            <span class="font-mono text-[10px] text-muted-foreground">
              {project.genre || 'untitled'}
            </span>
          </button>
        {/each}
        {#if manuscript.projects.length === 0}
          <div class="px-3 py-2 text-xs italic text-muted-foreground">No projects yet.</div>
        {/if}
      </div>
      <div class="border-t border-border bg-muted/40 p-2">
        {#if creatingProject}
          <form
            class="flex items-center gap-2"
            onsubmit={(e) => {
              e.preventDefault();
              void submitNewProject();
            }}
          >
            <input
              bind:value={newProjectTitle}
              placeholder="Project title"
            class="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent/60"
          />
          <button
              type="submit"
              disabled={!newProjectTitle.trim()}
            class="rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:border-accent/60 disabled:opacity-50"
          >
              Create
            </button>
          </form>
        {:else}
          <button
            type="button"
            onclick={() => (creatingProject = true)}
            class="inline-flex w-full items-center gap-2 rounded px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FolderPlus class="size-3.5" />
            New project…
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if collaboratorsOpen}
    <button
      type="button"
      onclick={handleBackdrop}
      aria-label="Close collaborators menu"
      tabindex="-1"
      class="fixed inset-0 z-30 cursor-default bg-transparent"
      style="-webkit-app-region: no-drag;"
    ></button>
    <div
      class="absolute right-2 top-[var(--app-titlebar-height)] z-40 w-80 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
      style="-webkit-app-region: no-drag;"
    >
      <div class="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Live Connections
      </div>
      <div class="max-h-80 overflow-y-auto py-1">
        {#each activeCollaborators as presence (presence.clientId)}
          <div class="border-b border-border/60 px-3 py-2 last:border-0">
            <div class="flex items-center gap-2">
              <span class="flex size-7 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                {initials(presence.user.name, presence.user.username)}
              </span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-xs font-medium text-foreground">
                  {presence.user.name ?? presence.user.username}
                </div>
                <div class="truncate font-mono text-[10px] text-muted-foreground">
                  @{presence.user.username}
                </div>
              </div>
            </div>
            <div class="mt-2 truncate text-[11px] text-muted-foreground">
              {presence.location?.title ?? presence.document.kind} {presence.location?.field ? `· ${presence.location.field}` : ''}
            </div>
            <div class="mt-2 flex gap-1.5">
              <button
                type="button"
                disabled={!presence.location}
                onclick={() => {
                  if (presence.location) collaboration.goToLocation(presence.location);
                }}
                class="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:border-accent/60 disabled:opacity-50"
              >
                Go to location
              </button>
              <button
                type="button"
                onclick={() => collaboration.follow(presence.clientId)}
                class="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:border-accent/60"
              >
                {collaboration.followedClientId === presence.clientId ? 'Unfollow' : 'Follow'}
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</header>
