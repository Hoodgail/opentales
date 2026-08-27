<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Pane, Splitpanes, type IPaneSizingEvent } from "svelte-splitpanes";
  import ActivityBar from "$lib/components/ide/ActivityBar.svelte";
  import CommandPalette from "$lib/components/ide/CommandPalette.svelte";
  import EditorArea from "$lib/components/ide/EditorArea.svelte";
  import InspectorPanel from "$lib/components/ide/InspectorPanel.svelte";
  import MobileBottomNav from "$lib/components/ide/MobileBottomNav.svelte";
  import RenameSymbolSurface from "$lib/components/ide/RenameSymbolSurface.svelte";
  import ShortcutsOverlay from "$lib/components/ide/ShortcutsOverlay.svelte";
  import SidePanel from "$lib/components/ide/SidePanel.svelte";
  import StatusBar from "$lib/components/ide/StatusBar.svelte";
  import TitleBar from "$lib/components/ide/TitleBar.svelte";
  import Logo from "$lib/components/Logo.svelte";
  import { commandPalette } from "$lib/stores/commandPalette.svelte";
  import { manuscript } from "$lib/stores/manuscript.svelte";
  import {
    SIDE_PANEL_MAX_SIZE,
    SIDE_PANEL_MIN_SIZE,
    SIDE_PANEL_SNAP_SIZE,
    ui,
  } from "$lib/stores/ui.svelte";
  import { storyUi } from "$lib/stores/storyUi.svelte";
  import { viewport } from "$lib/stores/viewport.svelte";

  function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function handleGlobalKey(e: KeyboardEvent) {
    if (
      e.target instanceof HTMLElement &&
      e.target.classList.contains('splitpanes__splitter')
    ) {
      handleSplitKeydown(e);
      return;
    }
    // Cmd/Ctrl+K — toggle command palette (works even from typing targets).
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      commandPalette.toggle();
      return;
    }
    // ? — show shortcuts overlay (only when not typing).
    if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!isTypingTarget(e.target)) {
        e.preventDefault();
        commandPalette.showShortcuts();
      }
    }
  }

  // Auto-close mobile drawers when the active tab changes (e.g. user
  // tapped a chapter inside the side drawer — they should land on the
  // editor with the drawer dismissed).
  let lastActiveTabId: string | null = null;
  let sideDrawer: HTMLElement | undefined = $state();
  let inspectorDrawer: HTMLElement | undefined = $state();
  let desktopSplitHost: HTMLDivElement | undefined = $state();
  let previousDrawer: typeof ui.drawer = null;
  let drawerTrigger: HTMLElement | null = null;
  const wideWorkspace = $derived(
    ['build', 'story-bible', 'outline-studio', 'manuscript', 'publishing', 'revisions'].includes(
      manuscript.tabs.find((tab) => tab.id === manuscript.activeTabId)?.type ?? ''
    )
  );
  $effect(() => {
    const id = manuscript.activeTabId;
    if (
      viewport.mobile &&
      id &&
      id !== lastActiveTabId &&
      ui.drawer === "side"
    ) {
      ui.close();
      void tick().then(() => {
        document.querySelector<HTMLElement>(`[role="tab"][aria-selected="true"]`)?.focus();
      });
    }
    lastActiveTabId = id;
  });

  $effect(() => {
    const drawer = ui.drawer;
    if (!viewport.mobile || drawer === previousDrawer) return;
    if (drawer) {
      drawerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const panel = drawer === 'side' ? sideDrawer : inspectorDrawer;
      void tick().then(() => {
        panel?.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )?.focus();
      });
    } else if (previousDrawer) {
      const trigger = drawerTrigger;
      drawerTrigger = null;
      void tick().then(() => trigger?.isConnected && trigger.focus());
    }
    previousDrawer = drawer;
  });

  $effect(() => {
    const host = desktopSplitHost;
    const size = ui.sidePanelCollapsed ? 0 : ui.sidePanelSize;
    void tick().then(() => {
      const splitter = host?.querySelector<HTMLElement>(
        '.opentales-workspace-split > .splitpanes__splitter',
      );
      if (!splitter) return;
      splitter.tabIndex = 0;
      splitter.setAttribute('role', 'separator');
      splitter.setAttribute('aria-label', 'Resize side panel');
      splitter.setAttribute('aria-orientation', 'vertical');
      splitter.setAttribute('aria-valuemin', '0');
      splitter.setAttribute('aria-valuemax', String(SIDE_PANEL_MAX_SIZE));
      splitter.setAttribute('aria-valuenow', String(size));
    });
  });

  function handleDrawerKeydown(event: KeyboardEvent, drawer: 'side' | 'inspector') {
    if (event.key === 'Escape') {
      event.preventDefault();
      ui.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = drawer === 'side' ? sideDrawer : inspectorDrawer;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  let mode = $state<"login" | "register">("login");
  let emailOrUsername = $state("");
  let email = $state("");
  let username = $state("");
  let name = $state("");
  let password = $state("");

  onMount(() => {
    ui.hydrate();
    void manuscript.initialize();
  });

  function handleWorkspaceResized(event: CustomEvent<IPaneSizingEvent[]>) {
    const sidePane = event.detail[0];
    if (sidePane) ui.setSidePanelSize(sidePane.size);
  }

  function handleSplitKeydown(event: KeyboardEvent) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('splitpanes__splitter')) return;
    const current = ui.sidePanelCollapsed ? 0 : ui.sidePanelSize;
    if (event.key === 'Home') {
      event.preventDefault();
      ui.collapseSidePanel();
    } else if (event.key === 'End') {
      event.preventDefault();
      ui.setSidePanelSize(SIDE_PANEL_MAX_SIZE);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (current <= SIDE_PANEL_MIN_SIZE) ui.collapseSidePanel();
      else ui.setSidePanelSize(current - 2);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      ui.setSidePanelSize(current === 0 ? ui.sidePanelSize : current + 2);
    }
  }

  function submitAuth() {
    if (mode === "login") {
      void manuscript.login(emailOrUsername, password);
      return;
    }

    void manuscript.register({
      username,
      email,
      password,
      name: name.trim() || undefined,
    });
  }
</script>

<svelte:window onkeydown={handleGlobalKey} />

<CommandPalette />
<ShortcutsOverlay />
<RenameSymbolSurface />

<div
  class="pwa-shell flex flex-col overflow-visible bg-sidebar"
  inert={commandPalette.open || commandPalette.shortcutsOpen || storyUi.renameSymbolRequest ? true : undefined}
  aria-hidden={commandPalette.open || commandPalette.shortcutsOpen || Boolean(storyUi.renameSymbolRequest)}
>
  {#if manuscript.initializing}
    <div class="flex h-full items-center justify-center">
      <div
        class="rounded-md border border-border bg-card px-5 py-4 text-sm text-muted-foreground"
      >
        Loading manuscript...
      </div>
    </div>
  {:else if !manuscript.authenticated}
    <div class="flex h-full items-center justify-center px-4">
      <form
        class="w-full max-w-sm rounded-md border border-border bg-card p-5 shadow-xl"
        onsubmit={(e) => {
          e.preventDefault();
          submitAuth();
        }}
      >
        <div class="flex items-start gap-3">
          <Logo size={36} class="shrink-0" />
          <div class="min-w-0">
            <h1 class="text-lg font-semibold text-foreground">
              {mode === "login"
                ? "Sign in to OpenTales"
                : "Create an OpenTales account"}
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {mode === "login"
                ? "Use your email or username to open your manuscript workspace."
                : "Create a workspace with username, email, and password."}
            </p>
          </div>
        </div>

        {#if manuscript.error}
          <div
            class="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
          >
            {manuscript.error}
          </div>
        {/if}

        <div class="mt-5 space-y-3">
          {#if mode === "login"}
            <label class="block">
              <span
                class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Email or username
              </span>
              <input
                bind:value={emailOrUsername}
                autocomplete="username"
                required
                class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
              />
            </label>
          {:else}
            <label class="block">
              <span
                class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Username
              </span>
              <input
                bind:value={username}
                autocomplete="username"
                required
                minlength="3"
                class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
              />
            </label>
            <label class="block">
              <span
                class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Email
              </span>
              <input
                bind:value={email}
                type="email"
                autocomplete="email"
                required
                class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
              />
            </label>
            <label class="block">
              <span
                class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Display name
              </span>
              <input
                bind:value={name}
                autocomplete="name"
                class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
              />
            </label>
          {/if}

          <label class="block">
            <span
              class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Password
            </span>
            <input
              bind:value={password}
              type="password"
              autocomplete={mode === "login"
                ? "current-password"
                : "new-password"}
              required
              minlength="8"
              class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={manuscript.authenticating}
          class="mt-5 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-opacity disabled:opacity-60"
        >
          {manuscript.authenticating
            ? mode === "login"
              ? "Signing in..."
              : "Creating account..."
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>

        <button
          type="button"
          onclick={() => {
            mode = mode === "login" ? "register" : "login";
            password = "";
          }}
          class="mt-3 w-full rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-accent/60 hover:text-foreground"
        >
          {mode === "login" ? "Create an account" : "Use an existing account"}
        </button>
      </form>
    </div>
  {:else if manuscript.error && !manuscript.projectId}
    <div class="flex h-full items-center justify-center">
      <div class="w-full max-w-md rounded-md border border-border bg-card p-5">
        <h1 class="text-base font-semibold text-foreground">
          Backend unavailable
        </h1>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
          {manuscript.error}
        </p>
        <button
          type="button"
          onclick={() => void manuscript.initialize()}
          class="mt-4 rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground transition-colors hover:border-accent/60"
        >
          Retry
        </button>
      </div>
    </div>
  {:else}
    <TitleBar />
    {#if viewport.mobile}
      <!-- Mobile shell: full-bleed editor with slide-over side / inspector
           drawers and a bottom nav. Drawers and backdrop are siblings of
           the editor so they overlay it without nudging layout. -->
      <div class="relative flex min-h-0 flex-1">
        <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <EditorArea />
        </main>

        {#if ui.drawer !== null}
          <button
            type="button"
            onclick={() => ui.close()}
            aria-label="Close panel"
            tabindex="-1"
            class="fixed inset-x-0 z-30 cursor-default bg-black/40 backdrop-blur-[1px]"
            style="top: calc(env(safe-area-inset-top) + var(--app-titlebar-height)); bottom: var(--app-safe-bottom);"
          ></button>
        {/if}

        <div
          bind:this={sideDrawer}
          role="dialog"
          aria-modal={ui.drawer === "side" ? "true" : undefined}
          aria-label="Workspace navigation"
          onkeydown={(event) => handleDrawerKeydown(event, 'side')}
          class="fixed left-0 z-40 flex w-[88vw] max-w-[20rem] flex-col border-r border-border bg-sidebar shadow-2xl"
          style="top: calc(env(safe-area-inset-top) + var(--app-titlebar-height)); bottom: var(--app-safe-bottom); padding-left: env(safe-area-inset-left); padding-bottom: calc(var(--app-bottom-nav-height) + 20px);"
          style:translate={ui.drawer === "side" ? "0" : "-100%"}
          aria-hidden={ui.drawer !== "side"}
          inert={ui.drawer !== "side" ? true : undefined}
        >
          <SidePanel />
        </div>

        <div
          bind:this={inspectorDrawer}
          role="dialog"
          aria-modal={ui.drawer === "inspector" ? "true" : undefined}
          aria-label="Workspace inspector"
          onkeydown={(event) => handleDrawerKeydown(event, 'inspector')}
          class="fixed right-0 z-40 flex w-[88vw] max-w-[22rem] flex-col border-l border-border bg-sidebar shadow-2xl"
          style="top: calc(env(safe-area-inset-top) + var(--app-titlebar-height)); bottom: var(--app-safe-bottom); padding-right: env(safe-area-inset-right);"
          style:translate={ui.drawer === "inspector" ? "0" : "100%"}
          aria-hidden={ui.drawer !== "inspector"}
          inert={ui.drawer !== "inspector" ? true : undefined}
        >
          <InspectorPanel />
        </div>
      </div>
      <MobileBottomNav />
    {:else}
      <div class="flex min-h-0 flex-1">
        <ActivityBar />
        <div
          bind:this={desktopSplitHost}
          class="min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          <Splitpanes
            id="opentales-editor-split"
            theme="opentales-theme"
            class="opentales-workspace-split"
            pushOtherPanes={false}
            dblClickSplitter={true}
            on:resized={handleWorkspaceResized}
          >
            <Pane
              size={ui.sidePanelCollapsed ? 0 : ui.sidePanelSize}
              minSize={0}
              maxSize={SIDE_PANEL_MAX_SIZE}
              snapSize={SIDE_PANEL_SNAP_SIZE}
            >
              {#if !ui.sidePanelCollapsed}
                <SidePanel />
              {/if}
            </Pane>
            <Pane minSize={100 - SIDE_PANEL_MAX_SIZE}>
              <div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <EditorArea />
              </div>
            </Pane>
          </Splitpanes>
        </div>
        {#if !wideWorkspace}<InspectorPanel />{/if}
      </div>
      <StatusBar />
    {/if}
  {/if}
</div>
