<script lang="ts">
  import { Check, CheckCheck, GitCompare, Loader2, X } from "lucide-svelte";
  import type { AiAgentPermissionRequest } from "@opentales/sdk";
  import { toolLabel } from "$lib/ai-approval";

  interface Props {
    request: AiAgentPermissionRequest;
    busy?: "approving" | "rejecting" | "answering" | "dismissing";
    error?: string;
    fromSubagent?: boolean;
    onReview: () => void;
    onApprove: () => void;
    onAlways: () => void;
    onReject: () => void;
  }

  let { request, busy, error, fromSubagent = false, onReview, onApprove, onAlways, onReject }: Props = $props();

  const summary = $derived(describe(request.toolInput));

  function describe(input: Record<string, unknown>): string {
    for (const key of ["title", "name", "docId", "chapterId", "characterId", "sceneId", "locationId"]) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    const keys = Object.keys(input);
    return keys.length ? keys.slice(0, 3).join(", ") : "no fields";
  }
</script>

<article class="agent-slip agent-rise relative rounded-lg border border-amber-400/30 bg-card/95 p-2.5 pl-3">
  <div class="flex items-start gap-2">
    <GitCompare class="mt-0.5 size-3.5 shrink-0 text-amber-300" />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <p class="flex-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-amber-300/90">
          Proposed change{fromSubagent ? " · subagent" : ""}
        </p>
        <button
          type="button"
          onclick={onReview}
          class="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          review diff →
        </button>
      </div>
      <p class="mt-0.5 truncate text-[12px] text-foreground">
        {toolLabel(request.toolName)} <span class="text-muted-foreground">· {summary}</span>
      </p>
      {#if request.message}
        <p class="mt-1 text-[11px] text-muted-foreground">{request.message}</p>
      {/if}
    </div>
  </div>
  {#if error}
    <p role="alert" class="mt-1.5 text-[11px] text-destructive">{error}</p>
  {/if}
  <div class="mt-2 flex items-center gap-1">
    <span class="flex-1"></span>
    <button
      type="button"
      onclick={onReject}
      disabled={Boolean(busy)}
      class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {#if busy === "rejecting"}<Loader2 class="size-3 motion-safe:animate-spin" />{:else}<X class="size-3" />{/if}
      Reject
    </button>
    <button
      type="button"
      onclick={onAlways}
      disabled={Boolean(busy)}
      title={`Allow every ${toolLabel(request.toolName).toLowerCase()} in this session`}
      class="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 px-2 py-0.5 text-[10.5px] text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
    >
      <CheckCheck class="size-3" /> Always
    </button>
    <button
      type="button"
      onclick={onApprove}
      disabled={Boolean(busy)}
      class="inline-flex items-center gap-1 rounded-md bg-emerald-600/90 px-2 py-0.5 text-[10.5px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
    >
      {#if busy === "approving"}<Loader2 class="size-3 motion-safe:animate-spin" />{:else}<Check class="size-3" />{/if}
      Approve
    </button>
  </div>
</article>
