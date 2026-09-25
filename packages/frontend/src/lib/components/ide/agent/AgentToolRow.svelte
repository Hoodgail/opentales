<script lang="ts">
  import { ChevronRight, CornerDownRight, GitBranch, Loader2, TriangleAlert } from "lucide-svelte";
  import type { AiAgentPart } from "@opentales/sdk";
  import { toolLabel } from "$lib/ai-approval";
  import { cn } from "$lib/utils";

  type ToolPart = Extract<AiAgentPart, { type: "tool" }>;

  interface Props {
    part: ToolPart;
    onOpenChild?: (sessionId: string) => void;
  }

  let { part, onOpenChild }: Props = $props();
  let open = $state(false);

  const status = $derived(part.state.status);
  const live = $derived(status === "running" || status === "streaming");
  const input = $derived(
    part.state.status === "streaming" ? null : (part.state.input as Record<string, unknown>),
  );
  const output = $derived(
    part.state.status === "completed"
      ? part.state.output
      : part.state.status === "error"
        ? part.state.error
        : "",
  );
  const subject = $derived(subjectOf(part.name, input));
  const isSubagent = $derived(part.name === "subagent");

  function subjectOf(name: string, value: Record<string, unknown> | null): string {
    if (!value) return "";
    if (name === "subagent") return String(value.description ?? value.agent ?? "");
    if (name === "skill") return String(value.id ?? "");
    for (const key of ["title", "name", "query", "pattern", "path", "chapterId", "docId", "characterId", "sceneId"]) {
      const v = value[key];
      if (typeof v === "string" && v.trim()) return v.length > 48 ? `${v.slice(0, 48)}…` : v;
    }
    return "";
  }

  function duration(): string {
    if (!part.startedAt || !part.completedAt) return "";
    const ms = Date.parse(part.completedAt) - Date.parse(part.startedAt);
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  function pretty(value: unknown): string {
    if (typeof value === "string") {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  }
</script>

<div
  class={cn(
    "group/tool relative ml-1 border-l pl-3 transition-colors",
    status === "error" ? "border-destructive/50" : live ? "border-accent/70" : "border-border",
  )}
>
  <span
    class={cn(
      "absolute -left-[3.5px] top-[9px] size-[6px] rounded-full ring-2 ring-background",
      status === "error" ? "bg-destructive" : live ? "agent-pulse bg-accent" : "bg-muted-foreground/50",
    )}
  ></span>
  <button
    type="button"
    onclick={() => (open = !open)}
    aria-expanded={open}
    class="flex w-full min-w-0 items-center gap-1.5 rounded py-1 text-left font-mono text-[10.5px] leading-tight text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
  >
    <ChevronRight class={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
    <span class={cn("shrink-0", live ? "text-foreground" : status === "error" ? "text-destructive" : "")}>
      {toolLabel(part.name)}
    </span>
    {#if subject}
      <span class="min-w-0 truncate text-muted-foreground/70">· {subject}</span>
    {/if}
    <span class="ml-auto flex shrink-0 items-center gap-1 pl-2 text-[9.5px] text-muted-foreground/60">
      {#if live}
        <Loader2 class="size-3 motion-safe:animate-spin text-accent" />
      {:else if status === "error"}
        <TriangleAlert class="size-3 text-destructive" />
      {:else}
        {duration()}
      {/if}
    </span>
  </button>

  {#if isSubagent && part.childSessionId}
    <button
      type="button"
      onclick={() => onOpenChild?.(part.childSessionId!)}
      class="mb-1 ml-4 inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/5 px-2 py-0.5 font-mono text-[10px] text-accent hover:border-accent/50 hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <GitBranch class="size-3" />
      {String(input?.agent ?? "subagent")} session
      <CornerDownRight class="size-3 opacity-60" />
    </button>
  {/if}

  {#if open}
    <div class="mb-2 ml-4 space-y-1.5 text-[10.5px]">
      {#if part.state.status === "streaming"}
        <pre class="agent-code">{part.state.input || "…"}</pre>
      {:else}
        <div>
          <p class="agent-label">input</p>
          <pre class="agent-code">{pretty(input)}</pre>
        </div>
      {/if}
      {#if output}
        <div>
          <p class={cn("agent-label", status === "error" && "text-destructive/80")}>
            {status === "error" ? "error" : "output"}
          </p>
          <pre class={cn("agent-code", status === "error" && "text-destructive/90")}>{pretty(output)}</pre>
        </div>
      {/if}
    </div>
  {/if}
</div>
