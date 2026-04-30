<script lang="ts">
  import {
    BookOpen,
    Bot,
    Compass,
    FileText,
    Inbox,
    MapPin,
    Search,
    Settings,
    StickyNote,
    UserCog,
    Users,
  } from "lucide-svelte";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { manuscript } from "$lib/stores/manuscript.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import type { ActivityView } from "$lib/data/manuscript-types";
  import { cn } from "$lib/utils";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Item = { id: ActivityView; label: string; icon: any };

  const items: Item[] = [
    { id: "explorer", label: "Manuscript", icon: FileText },
    { id: "characters", label: "Characters", icon: Users },
    { id: "locations", label: "Settings", icon: MapPin },
    { id: "plot", label: "Plot", icon: Compass },
    { id: "outline", label: "Outline", icon: BookOpen },
    { id: "search", label: "Search", icon: Search },
    { id: "inbox", label: "Drafts", icon: Inbox },
    { id: "docs", label: "Docs", icon: StickyNote },
    { id: "ai", label: "AI", icon: Bot },
    { id: "members", label: "Members", icon: UserCog },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  function activate(id: ActivityView) {
    void manuscript.setActiveView(id);
    ui.open("side");
  }
</script>

{#if ui.drawer === "side"}
  <div
    class="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3"
    style="bottom: var(--app-safe-bottom);"
    transition:fly={{ y: 24, duration: 220, easing: cubicOut }}
  >
    <div
      class="pointer-events-auto relative w-full max-w-[32rem] overflow-hidden rounded-2xl border border-border bg-sidebar/85 shadow-2xl backdrop-blur-xl supports-[backdrop-filter]:bg-sidebar/70"
    >
      <!-- edge fade hints to suggest horizontal scroll -->
      <div
        class="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-sidebar to-transparent"
      ></div>
      <div
        class="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-sidebar to-transparent"
      ></div>

      <nav
        class="flex h-14 items-center gap-1 overflow-x-auto px-3 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"
        aria-label="Sections"
      >
        {#each items as item (item.id)}
          {@const active = manuscript.activeView === item.id}
          <button
            type="button"
            onclick={() => activate(item.id)}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            title={item.label}
            class={cn(
              "group flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-all duration-200 ease-out",
              active
                ? "bg-accent/15 text-accent px-3"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            )}
          >
            <item.icon
              class={cn("size-5 transition-transform", active && "scale-110")}
              strokeWidth={active ? 2.25 : 1.75}
            />
            {#if active}
              <span class="leading-none whitespace-nowrap">{item.label}</span>
            {/if}
          </button>
        {/each}
      </nav>
    </div>
  </div>
{/if}

<style>
  nav::-webkit-scrollbar {
    display: none;
  }
</style>
