<script lang="ts">
  import { Bot, ChevronDown, Plus } from "lucide-svelte";
  import { tick } from "svelte";
  import type { AiAgentSessionSummary } from "@opentales/sdk";

  interface Props {
    title: string;
    sessions: AiAgentSessionSummary[];
    activeSessionId: string | null;
    loading: boolean;
    onCreate: () => void | Promise<void>;
    onSelect: (sessionId: string) => void | Promise<void>;
  }

  let {
    title,
    sessions,
    activeSessionId,
    loading,
    onCreate,
    onSelect,
  }: Props = $props();

  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLDivElement | undefined = $state();

  async function openMenu() {
    open = true;
    await tick();
    const items = menuItems();
    const active = items.find(
      (item) => item.dataset.sessionId === activeSessionId,
    );
    (active ?? items[0])?.focus();
  }

  function closeMenu(restoreFocus = false) {
    open = false;
    if (restoreFocus) void tick().then(() => triggerEl?.focus());
  }

  function toggleMenu() {
    if (open) closeMenu(true);
    else void openMenu();
  }

  function handleTriggerKey(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      void openMenu();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu(true);
    }
  }

  function handleMenuKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = menuItems();
    if (!items.length) return;
    event.preventDefault();
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    items[index]?.focus();
  }

  function menuItems(): HTMLElement[] {
    return Array.from(
      menuEl?.querySelectorAll<HTMLElement>("[data-session-menu-item]") ?? [],
    );
  }

  function chooseSession(sessionId: string) {
    closeMenu(true);
    void onSelect(sessionId);
  }

  function createSession() {
    closeMenu(true);
    void onCreate();
  }

  function sessionTime(value: string): string {
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
</script>

<div class="relative">
  <button
    bind:this={triggerEl}
    type="button"
    aria-label="Switch AI session"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls="ai-session-menu"
    onclick={toggleMenu}
    onkeydown={handleTriggerKey}
    title="Switch AI session"
    class="flex max-w-32 items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
  >
    <Bot class="size-3" />
    <span class="truncate">{title}</span>
    <ChevronDown class="size-3" />
  </button>
  {#if open}
    <button
      type="button"
      tabindex="-1"
      aria-label="Close session menu"
      class="fixed inset-0 z-10 cursor-default bg-transparent"
      onclick={() => closeMenu(true)}
    ></button>
    <div
      bind:this={menuEl}
      id="ai-session-menu"
      role="dialog"
      tabindex="-1"
      aria-labelledby="ai-session-menu-title"
      onkeydown={handleMenuKey}
      class="absolute right-0 top-7 z-20 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
    >
      <div
        class="flex items-center justify-between border-b border-border px-2 py-1.5"
      >
        <span
          id="ai-session-menu-title"
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >AI Sessions</span
        >
        <button
          type="button"
          data-session-menu-item
          onclick={createSession}
          disabled={loading}
          class="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <Plus class="size-3" /> New
        </button>
      </div>
      <div
        role="listbox"
        aria-label="AI sessions"
        class="max-h-72 overflow-y-auto p-1"
      >
        {#if loading && sessions.length === 0}
          <div class="px-2 py-3 text-center text-[11px] text-muted-foreground">
            Loading sessions…
          </div>
        {:else if sessions.length === 0}
          <div class="px-2 py-3 text-center text-[11px] text-muted-foreground">
            No sessions yet.
          </div>
        {:else}
          {#each sessions as session (session.id)}
            <button
              type="button"
              role="option"
              aria-selected={session.id === activeSessionId}
              data-session-menu-item
              data-session-id={session.id}
              onclick={() => chooseSession(session.id)}
              class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <span class="min-w-0">
                <span class="block truncate text-[11px] text-foreground"
                  >{session.title}</span
                >
                <span class="block truncate text-[10px] text-muted-foreground">
                  {session.messageCount} messages · {sessionTime(
                    session.updatedAt,
                  )} · {session.status} ·
                  <span class={session.approvalMode === "auto" ? "text-amber-400" : ""}
                    >{session.approvalMode === "auto" ? "Auto" : "Manual"}</span
                  >
                </span>
              </span>
              {#if session.id === activeSessionId}
                <span
                  aria-hidden="true"
                  class="size-1.5 shrink-0 rounded-full bg-accent"
                ></span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
