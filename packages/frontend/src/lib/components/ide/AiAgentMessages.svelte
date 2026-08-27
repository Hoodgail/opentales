<script lang="ts">
  import {
    Bot,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    CircleAlert,
    Clock3,
    FileText,
    GitBranch,
    Loader2,
    Paperclip,
    User,
    Wrench,
    X,
    XCircle,
  } from "lucide-svelte";
  import type { AiAgentSession, AiAgentToolCall } from "@opentales/sdk";
  import {
    buildAgentTimeline,
    timelineFidelityNotice,
    type AgentTaskActivity,
  } from "$lib/ai-agent-timeline";
  import AiMarkdown from "./AiMarkdown.svelte";
  import AiAgentQuestions from "./AiAgentQuestions.svelte";

  interface Props {
    session: AiAgentSession | null;
    isRunning: boolean;
    toolLabel: (name: string) => string;
    toolStatusLabel: (status: AiAgentToolCall["status"]) => string;
    onOpenSession?: (sessionId: string) => void;
    onApproveTool?: (toolCallId: string) => void;
    onRejectTool?: (toolCallId: string) => void;
    onOpenApproval?: (toolCall: AiAgentToolCall) => void;
    onSubmitQuestion?: (
      toolCall: AiAgentToolCall,
      answers: string[][],
    ) => void | Promise<void>;
    toolActionStates?: Record<string, "approving" | "rejecting" | "answering">;
    toolActionErrors?: Record<string, string>;
    onLoadToolDetail?: (toolCall: AiAgentToolCall) => Promise<AiAgentToolCall>;
    canLoadEarlier?: boolean;
    loadingEarlier?: boolean;
    earlierError?: string | null;
    onLoadEarlier?: () => void | Promise<void>;
  }

  let {
    session,
    isRunning,
    toolLabel,
    toolStatusLabel,
    onOpenSession,
    onApproveTool,
    onRejectTool,
    onOpenApproval,
    onSubmitQuestion,
    toolActionStates = {},
    toolActionErrors = {},
    onLoadToolDetail,
    canLoadEarlier = false,
    loadingEarlier = false,
    earlierError,
    onLoadEarlier,
  }: Props = $props();

  let expandedItems = $state<Record<string, boolean>>({});
  let loadedToolCalls = $state<Record<string, AiAgentToolCall>>({});
  let loadingToolDetails = $state<Record<string, boolean>>({});
  let toolDetailErrors = $state<Record<string, string>>({});
  let detailSessionId = $state<string | null>(null);
  const timelineItems = $derived(buildAgentTimeline(session));
  const lastTimelineItem = $derived(timelineItems.at(-1));
  const showWorking = $derived(
    isRunning &&
      !(
        lastTimelineItem?.kind === "text" &&
        lastTimelineItem.streaming &&
        lastTimelineItem.content
      ) &&
      !(
        lastTimelineItem?.kind === "tool" &&
        (lastTimelineItem.toolCall.status === "pending-approval" ||
          lastTimelineItem.toolCall.status === "approved" ||
          lastTimelineItem.toolCall.status === "running")
      ) &&
      !(lastTimelineItem?.kind === "task" && lastTimelineItem.task.status === "running"),
  );
  const liveStatus = $derived(statusAnnouncement(lastTimelineItem, isRunning));
  const fidelityNotice = $derived(timelineFidelityNotice(session));

  $effect(() => {
    const nextSessionId = session?.id ?? null;
    if (detailSessionId === nextSessionId) return;
    detailSessionId = nextSessionId;
    loadedToolCalls = {};
    loadingToolDetails = {};
    toolDetailErrors = {};
    expandedItems = {};
  });

  function toggleItem(id: string) {
    expandedItems = { ...expandedItems, [id]: !expandedItems[id] };
  }

  async function toggleToolItem(id: string, toolCall: AiAgentToolCall) {
    const expanding = !expandedItems[id];
    toggleItem(id);
    if (expanding && toolPreviewTruncated(toolCall) && !loadedToolCalls[toolCall.id]) {
      await loadFullToolCall(toolCall);
    }
  }

  function toolPreviewTruncated(toolCall: AiAgentToolCall): boolean {
    const bounded = toolCall as AiAgentToolCall & { inputTruncated?: boolean };
    return Boolean(bounded.inputTruncated || bounded.outputTruncated);
  }

  function toolPreviewLabel(toolCall: AiAgentToolCall): string {
    const bounded = toolCall as AiAgentToolCall & { inputTruncated?: boolean };
    if (bounded.inputTruncated && bounded.outputTruncated)
      return "Input and result previews truncated.";
    if (bounded.inputTruncated) return "Input preview truncated.";
    return "Result preview truncated.";
  }

  async function loadFullToolCall(
    toolCall: AiAgentToolCall,
  ): Promise<AiAgentToolCall | null> {
    if (loadedToolCalls[toolCall.id]) return loadedToolCalls[toolCall.id];
    if (!onLoadToolDetail || loadingToolDetails[toolCall.id]) return null;
    const requestedSessionId = detailSessionId;
    loadingToolDetails = { ...loadingToolDetails, [toolCall.id]: true };
    const nextErrors = { ...toolDetailErrors };
    delete nextErrors[toolCall.id];
    toolDetailErrors = nextErrors;
    try {
      const detail = await onLoadToolDetail(toolCall);
      if (detailSessionId !== requestedSessionId) return null;
      loadedToolCalls = { ...loadedToolCalls, [toolCall.id]: detail };
      return detail;
    } catch (error) {
      if (detailSessionId !== requestedSessionId) return null;
      toolDetailErrors = {
        ...toolDetailErrors,
        [toolCall.id]:
          error instanceof Error ? error.message : "Failed to load the full result",
      };
      return null;
    } finally {
      if (detailSessionId === requestedSessionId) {
        const nextLoading = { ...loadingToolDetails };
        delete nextLoading[toolCall.id];
        loadingToolDetails = nextLoading;
      }
    }
  }

  async function reviewToolCall(toolCall: AiAgentToolCall) {
    if (!onOpenApproval) return;
    let detail = loadedToolCalls[toolCall.id] ?? toolCall;
    if (toolCall.inputTruncated) {
      const loaded = await loadFullToolCall(toolCall);
      if (!loaded) return;
      detail = loaded;
    }
    onOpenApproval(detail);
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function outputSummary(output: unknown): string | null {
    if (output === null || output === undefined) return null;
    if (typeof output === "string") return firstLine(output);
    if (Array.isArray(output))
      return `${output.length} result${output.length === 1 ? "" : "s"}`;
    if (typeof output === "object") {
      const keys = Object.keys(output as Record<string, unknown>);
      return keys.length ? keys.slice(0, 3).join(", ") : "Completed";
    }
    return String(output);
  }

  function firstLine(value: string): string {
    const line = value.trim().split("\n", 1)[0] ?? "";
    return line.length > 72 ? `${line.slice(0, 69)}…` : line;
  }

  function toolTone(status: AiAgentToolCall["status"]): string {
    if (status === "error" || status === "rejected")
      return "border-destructive/30 bg-destructive/5";
    if (status === "pending-approval")
      return "border-amber-500/30 bg-amber-500/5";
    if (status === "executed")
      return "border-emerald-500/25 bg-emerald-500/5";
    return "border-border/80 bg-muted/20";
  }

  function taskTone(status: AgentTaskActivity["status"]): string {
    if (status === "error" || status === "cancelled")
      return "border-destructive/30 bg-destructive/5";
    if (status === "completed")
      return "border-emerald-500/25 bg-emerald-500/5";
    return "border-accent/30 bg-accent/5";
  }

  function taskStatusLabel(
    status: AgentTaskActivity["status"],
    historicalStart = false,
  ): string {
    if (historicalStart) return "started";
    if (status === "completed") return "completed";
    if (status === "error") return "failed";
    if (status === "cancelled") return "cancelled";
    return "running";
  }

  function taskOutputTruncated(task: AgentTaskActivity): boolean {
    return Boolean(
      (task as AgentTaskActivity & { outputTruncated?: boolean }).outputTruncated,
    );
  }

  function formatted(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2) ?? "";
  }

  function statusAnnouncement(
    item: (typeof timelineItems)[number] | undefined,
    running: boolean,
  ): string {
    if (!running) return "Agent is idle";
    if (item?.kind === "task" && item.task.status === "running")
      return `${item.task.description} is running with ${item.task.subagentType}`;
    if (item?.kind === "tool") {
      if (item.toolCall.status === "pending-approval")
        return `${toolLabel(item.toolCall.toolName)} is waiting for approval`;
      if (item.toolCall.status === "approved")
        return `${toolLabel(item.toolCall.toolName)} is running`;
      if (item.toolCall.status === "running")
        return `${toolLabel(item.toolCall.toolName)} is running`;
    }
    if (item?.kind === "text" && item.streaming) return "Agent is responding";
    return "Agent is working";
  }
</script>

{#snippet executionRail()}
  <span
    aria-hidden="true"
    class="absolute bottom-[-0.8rem] left-[0.68rem] top-5 w-px bg-border/70"
  ></span>
{/snippet}

{#snippet assistantIcon()}
  <span
    class="absolute left-0 top-0.5 z-[1] flex size-[1.4rem] items-center justify-center rounded-md border border-accent/25 bg-sidebar text-accent"
  >
    <Bot class="size-3.5" />
  </span>
{/snippet}

{#if !session || (timelineItems.length === 0 && !isRunning)}
  <div class="flex flex-col items-center justify-center gap-2 p-6 text-center">
    <Bot class="size-6 text-muted-foreground/40" />
    <p class="max-w-52 text-[11px] leading-relaxed text-muted-foreground">
      Ask about your manuscript, request rewrites, or explore your story.
    </p>
  </div>
{:else}
  <span class="sr-only" role="status" aria-live="polite">{liveStatus}</span>
  {#if fidelityNotice || canLoadEarlier || earlierError}
    <div
      role="note"
      class="mx-3 mt-3 rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground"
    >
      <div class="flex items-start gap-1.5">
        <Clock3 class="mt-0.5 size-3 shrink-0" />
        <span class="min-w-0 flex-1">{fidelityNotice ?? "Earlier activity is available."}</span>
        {#if canLoadEarlier && onLoadEarlier}
          <button
            type="button"
            disabled={loadingEarlier}
            class="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background/70 px-1.5 py-0.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
            onclick={() => void onLoadEarlier?.()}
          >
            {#if loadingEarlier}<Loader2
                class="size-3 motion-safe:animate-spin"
              />{/if}
            {loadingEarlier ? "Loading…" : "Load earlier activity"}
          </button>
        {/if}
      </div>
      {#if earlierError}
        <p role="alert" class="mt-1 text-destructive">{earlierError}</p>
      {/if}
    </div>
  {/if}
  <ol
    aria-label="Agent activity"
    aria-busy={isRunning}
    class="space-y-3 p-3"
  >
    {#each timelineItems as item (item.id)}
      {#if item.kind === "message"}
        {@const msg = item.message}
        {#if msg.role === "user"}
          <li data-timeline-kind="message">
            <article class="group flex flex-col items-end gap-1.5">
              {#if msg.attachments?.length}
                <div class="flex max-w-[86%] flex-wrap justify-end gap-1.5">
                  {#each msg.attachments as attachment (attachment.id)}
                    {#if attachment.url}
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex max-w-48 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <Paperclip class="size-3 shrink-0" />
                        <span class="truncate">{attachment.name}</span>
                        <span class="shrink-0 opacity-70"
                          >{formatBytes(attachment.sizeBytes)}</span
                        >
                      </a>
                    {:else}
                      <span
                        class="inline-flex max-w-48 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground"
                      >
                        <Paperclip class="size-3 shrink-0" />
                        <span class="truncate">{attachment.name}</span>
                        <span class="shrink-0 opacity-70"
                          >{formatBytes(attachment.sizeBytes)}</span
                        >
                      </span>
                    {/if}
                  {/each}
                </div>
              {/if}
              <div
                class="max-w-[86%] rounded-lg border border-border bg-muted/45 px-3 py-2 shadow-sm"
              >
                <div
                  class="mb-1 flex items-center justify-between gap-3 text-[10px] text-muted-foreground"
                >
                  <span class="inline-flex items-center gap-1"
                    ><User class="size-3" /> You</span
                  >
                  {#if msg.model}<span class="truncate">{msg.model}</span>{/if}
                </div>
                <p
                  class="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground"
                >
                  {msg.content}
                </p>
              </div>
            </article>
          </li>
        {:else if msg.role === "assistant"}
          {#if msg.content}
            <li data-timeline-kind="text" class="relative pl-8">
              {@render executionRail()}
              {@render assistantIcon()}
              <article class="min-w-0">
                <AiMarkdown content={msg.content} />
              </article>
            </li>
          {/if}
        {:else if msg.role === "system"}
          <li
            data-timeline-kind="message"
            class="rounded-md bg-muted/20 px-3 py-1 text-[10px] italic text-muted-foreground"
          >
            {msg.content}
          </li>
        {/if}
      {:else if item.kind === "text"}
        <li data-timeline-kind="text" class="relative pl-8">
          {@render executionRail()}
          {@render assistantIcon()}
          <article class="min-w-0">
            <AiMarkdown
              content={item.content}
              streaming={isRunning && item.streaming}
            />
            {#if isRunning && item.streaming}
              <span
                aria-hidden="true"
                class="mt-1 inline-block h-3.5 w-1.5 rounded-sm bg-accent/60 motion-safe:animate-pulse"
              ></span>
            {/if}
          </article>
        </li>
      {:else if item.kind === "tool"}
        {@const baseToolCall = item.toolCall}
        {@const tc = loadedToolCalls[baseToolCall.id] ?? baseToolCall}
        {@const summary = outputSummary(tc.output)}
        {@const detailId = `agent-tool-detail-${item.id}`}
        {@const actionState = toolActionStates[tc.id]}
        {@const actionError = toolActionErrors[tc.id]}
        {@const actionBusy = Boolean(actionState)}
        <li data-timeline-kind="tool" class="relative pl-8">
          {@render executionRail()}
          <span
            aria-hidden="true"
            class="absolute left-0 top-1 z-[1] flex size-[1.4rem] items-center justify-center rounded-md border border-border bg-sidebar text-muted-foreground"
          >
            <Wrench class="size-3" />
          </span>
          <article class={`rounded-md border ${toolTone(tc.status)}`}>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              aria-expanded={Boolean(expandedItems[item.id])}
              aria-controls={detailId}
              aria-label={`${toolLabel(tc.toolName)}, ${toolStatusLabel(tc.status)}. ${expandedItems[item.id] ? "Hide" : "Show"} details`}
              onclick={() => void toggleToolItem(item.id, baseToolCall)}
            >
              <span class="min-w-0 flex-1 truncate">
                <span class="font-medium text-foreground/85"
                  >{toolLabel(tc.toolName)}</span
                >
                {#if summary}<span> · {summary}</span>{/if}
                {#if tc.error}<span class="text-destructive">
                    · {firstLine(tc.error)}</span
                  >{/if}
              </span>
              <span
                class="inline-flex shrink-0 items-center gap-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
              >
                {#if tc.status === "executed"}
                  <CheckCircle2 class="size-2.5 text-emerald-500" />
                {:else if tc.status === "error" || tc.status === "rejected"}
                  <XCircle class="size-2.5 text-destructive" />
                {:else if tc.status === "pending-approval"}
                  <Clock3 class="size-2.5 text-amber-500" />
                {:else}
                  <Loader2 class="size-2.5 motion-safe:animate-spin" />
                {/if}
                {toolStatusLabel(tc.status)}
              </span>
              {#if expandedItems[item.id]}
                <ChevronDown class="size-3 shrink-0" />
              {:else}
                <ChevronRight class="size-3 shrink-0" />
              {/if}
            </button>
            {#if expandedItems[item.id]}
              <div id={detailId} class="grid gap-2 border-t border-border/60 p-2">
                <div>
                  <div
                    class="mb-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground"
                  >
                    Input
                  </div>
                  <pre
                    class="max-h-44 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-2 text-[10px] leading-relaxed text-foreground/80">{formatted(
                      tc.input,
                    )}</pre
                  >
                </div>
                {#if tc.output !== null && tc.output !== undefined}
                  <div>
                    <div
                      class="mb-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground"
                    >
                      Result
                    </div>
                    <pre
                      class="max-h-44 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-2 text-[10px] leading-relaxed text-foreground/80">{formatted(
                        tc.output,
                      )}</pre
                    >
                  </div>
                {/if}
                {#if toolPreviewTruncated(baseToolCall) && !loadedToolCalls[baseToolCall.id]}
                  <div
                    class="flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground"
                  >
                    {#if loadingToolDetails[baseToolCall.id]}
                      <span class="inline-flex items-center gap-1.5"
                        ><Loader2 class="size-3 motion-safe:animate-spin" /> Loading
                        full result…</span
                      >
                    {:else}
                      <span>{toolPreviewLabel(baseToolCall)}</span>
                      {#if onLoadToolDetail}
                        <button
                          type="button"
                          class="rounded border border-border bg-background px-2 py-1 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          onclick={() => void loadFullToolCall(baseToolCall)}
                        >
                          Load full result
                        </button>
                      {/if}
                    {/if}
                  </div>
                {/if}
                {#if toolDetailErrors[baseToolCall.id]}
                  <p
                    role="alert"
                    class="rounded bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive"
                  >
                    {toolDetailErrors[baseToolCall.id]}
                  </p>
                {/if}
              </div>
            {/if}
            {#if tc.status === "pending-approval" && tc.toolName === "askUser" && onSubmitQuestion && onRejectTool}
              <AiAgentQuestions
                inline
                questions={[tc]}
                onSubmit={onSubmitQuestion}
                onDismiss={onRejectTool}
                submitting={actionBusy}
                error={actionError}
              />
            {:else if tc.status === "pending-approval" && onApproveTool && onRejectTool}
              <div
                class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-2.5 py-1.5"
              >
                {#if onOpenApproval}
                  <button
                    type="button"
                    disabled={actionBusy || loadingToolDetails[baseToolCall.id]}
                    class="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50"
                    onclick={() => void reviewToolCall(baseToolCall)}
                  >
                    {#if loadingToolDetails[baseToolCall.id]}<Loader2
                        class="size-3 motion-safe:animate-spin"
                      />{:else}<FileText class="size-3" />{/if}
                    {loadingToolDetails[baseToolCall.id]
                      ? "Loading proposal…"
                      : "Review change"}
                  </button>
                {:else}
                  <span class="text-[10px] text-muted-foreground"
                    >Review required</span
                  >
                {/if}
                <div class="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    disabled={actionBusy}
                    class="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                    onclick={() => onRejectTool?.(tc.id)}
                  >
                    {#if actionState === "rejecting"}<Loader2
                        class="size-3 motion-safe:animate-spin"
                      />{:else}<X class="size-3" />{/if}
                    {actionState === "rejecting" ? "Rejecting…" : "Reject"}
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy}
                    class="inline-flex items-center gap-1 rounded border border-emerald-500/30 px-2 py-1 text-[10px] text-emerald-500 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    onclick={() => onApproveTool?.(tc.id)}
                  >
                    {#if actionState === "approving"}<Loader2
                        class="size-3 motion-safe:animate-spin"
                      />{:else}<Check class="size-3" />{/if}
                    {actionState === "approving" ? "Approving…" : "Approve"}
                  </button>
                </div>
              </div>
              {#if actionError}
                <p
                  role="alert"
                  class="border-t border-destructive/20 bg-destructive/10 px-2.5 py-1.5 text-[10px] text-destructive"
                >
                  {actionError}
                </p>
              {/if}
              {#if toolDetailErrors[baseToolCall.id] && !expandedItems[item.id]}
                <p
                  role="alert"
                  class="border-t border-destructive/20 bg-destructive/10 px-2.5 py-1.5 text-[10px] text-destructive"
                >
                  {toolDetailErrors[baseToolCall.id]}
                </p>
              {/if}
            {/if}
          </article>
        </li>
      {:else if item.kind === "task"}
        {@const task = item.task}
        {@const summary = outputSummary(task.output)}
        {@const detailId = `agent-task-detail-${item.id}`}
        <li data-timeline-kind="task" class="relative pl-8">
          {@render executionRail()}
          <span
            aria-hidden="true"
            class="absolute left-0 top-1 z-[1] flex size-[1.4rem] items-center justify-center rounded-md border border-accent/30 bg-sidebar text-accent"
          >
            <GitBranch class="size-3" />
          </span>
          <article class={`rounded-md border ${taskTone(task.status)}`}>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              aria-expanded={Boolean(expandedItems[item.id])}
              aria-controls={detailId}
              aria-label={`${task.description}, ${taskStatusLabel(task.status, item.historicalStart)} by ${task.subagentType}. ${expandedItems[item.id] ? "Hide" : "Show"} details`}
              onclick={() => toggleItem(item.id)}
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[11px] font-medium text-foreground/90"
                  >{task.description}</span
                >
                <span
                  class="block truncate font-mono text-[9px] text-muted-foreground"
                  >@{task.subagentType}{#if summary} · {summary}{/if}{#if taskOutputTruncated(
                      task,
                    )} · preview truncated{/if}</span
                >
              </span>
              <span
                class="inline-flex shrink-0 items-center gap-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground"
              >
                {#if item.historicalStart}
                  <Clock3 class="size-2.5 text-accent" />
                {:else if task.status === "completed"}
                  <CheckCircle2 class="size-2.5 text-emerald-500" />
                {:else if task.status === "error"}
                  <CircleAlert class="size-2.5 text-destructive" />
                {:else if task.status === "cancelled"}
                  <XCircle class="size-2.5 text-destructive" />
                {:else}
                  <Loader2 class="size-2.5 motion-safe:animate-spin" />
                {/if}
                {taskStatusLabel(task.status, item.historicalStart)}
              </span>
              {#if expandedItems[item.id]}
                <ChevronDown class="size-3 shrink-0" />
              {:else}
                <ChevronRight class="size-3 shrink-0" />
              {/if}
            </button>
            {#if expandedItems[item.id]}
              <div
                id={detailId}
                class="grid gap-2 border-t border-border/60 p-2 text-[10px]"
              >
                <div class="flex min-w-0 items-center justify-between gap-3">
                  <span class="text-muted-foreground">Subagent session</span>
                  <code class="truncate text-foreground/80">{task.sessionId}</code>
                </div>
                {#if onOpenSession}
                  <button
                    type="button"
                    class="justify-self-start rounded border border-border bg-background/70 px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onclick={() => onOpenSession?.(task.sessionId)}
                  >
                    Open task session
                  </button>
                {/if}
                {#if taskOutputTruncated(task)}
                  <p class="rounded bg-muted/30 px-2 py-1.5 text-muted-foreground">
                    Task output preview truncated. Open the task session for the
                    full result.
                  </p>
                {/if}
                {#if task.output !== null && task.output !== undefined}
                  <pre
                    class="max-h-44 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-2 text-[10px] leading-relaxed text-foreground/80">{formatted(
                      task.output,
                    )}</pre
                  >
                {/if}
                {#if task.error}
                  <p class="rounded bg-destructive/10 p-2 text-destructive">
                    {task.error}
                  </p>
                {/if}
              </div>
            {/if}
          </article>
        </li>
      {/if}
    {/each}

    {#if showWorking}
      <li
        data-timeline-kind="working"
        class="relative flex items-center gap-2 pl-8 text-[11px] text-muted-foreground"
      >
        {@render executionRail()}
        <span
          aria-hidden="true"
          class="absolute left-0 top-0 z-[1] flex size-[1.4rem] items-center justify-center rounded-md border border-border bg-sidebar"
        >
          <Loader2 class="size-3 motion-safe:animate-spin" />
        </span>
        <span>Working…</span>
      </li>
    {/if}
  </ol>
{/if}
