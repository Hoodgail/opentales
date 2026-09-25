<script lang="ts">
  import { Brain, ChevronRight, Feather, Paperclip, TriangleAlert } from "lucide-svelte";
  import type { AiAgentMessage, AiAgentSession } from "@opentales/sdk";
  import AiMarkdown from "../AiMarkdown.svelte";
  import AgentToolRow from "./AgentToolRow.svelte";
  import { cn } from "$lib/utils";

  interface Props {
    session: AiAgentSession;
    running: boolean;
    onOpenChild: (sessionId: string) => void;
    onLoadEarlier: () => void;
  }

  let { session, running, onOpenChild, onLoadEarlier }: Props = $props();

  type Assistant = Extract<AiAgentMessage, { role: "assistant" }>;
  let openReasoning = $state<Record<string, boolean>>({});

  const lastAssistantId = $derived(
    [...session.messages].reverse().find((m) => m.role === "assistant")?.id ?? null,
  );
  const awaitingFirstToken = $derived(
    running && session.messages[session.messages.length - 1]?.role === "user",
  );

  function time(iso: string) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  /** Consecutive steps of one agent read as a single turn under one byline. */
  function continuesTurn(index: number): boolean {
    const message = session.messages[index];
    const previous = session.messages[index - 1];
    return message?.role === "assistant" && previous?.role === "assistant" && previous.agent === message.agent;
  }

  function isStreaming(message: Assistant) {
    return running && message.id === lastAssistantId && !message.completedAt;
  }
</script>

<ol class="agent-transcript space-y-5 px-3.5 pb-6 pt-4" aria-live="polite">
  {#if session.hasEarlierMessages}
    <li class="flex justify-center">
      <button
        type="button"
        onclick={onLoadEarlier}
        class="rounded-full border border-border px-3 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-accent/40 hover:text-foreground"
      >
        Earlier pages
      </button>
    </li>
  {/if}

  {#each session.messages as message, messageIndex (message.id)}
    {#if message.role === "user"}
      <li class="agent-rise flex flex-col items-end">
        <div class="max-w-[92%] rounded-2xl rounded-br-sm border border-border/80 bg-muted/60 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          <p class="whitespace-pre-wrap break-words">{message.text.replace(/\n\n<referenced_project_items>[\s\S]*<\/referenced_project_items>$/, "")}</p>
          {#if message.files.length}
            <div class="mt-1.5 flex flex-wrap gap-1">
              {#each message.files as file, i (i)}
                <span class="inline-flex items-center gap-1 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  <Paperclip class="size-2.5" />{file.name ?? file.mime}
                </span>
              {/each}
            </div>
          {/if}
        </div>
        <span class="mt-1 pr-1 font-mono text-[9px] text-muted-foreground/60">{time(message.createdAt)}</span>
      </li>
    {:else if message.role === "assistant"}
      <li class={cn("agent-rise", continuesTurn(messageIndex) && "-mt-3.5")}>
        {#if !continuesTurn(messageIndex)}
        <div class="mb-1.5 flex items-center gap-1.5">
          <Feather class="size-3 text-accent" />
          <span class="font-mono text-[9.5px] uppercase tracking-[0.16em] text-accent/90">{message.agent || "agent"}</span>
          {#if message.model}
            <span class="truncate font-mono text-[9px] text-muted-foreground/60">{message.model.model}</span>
          {/if}
        </div>
        {/if}
        <div class="space-y-1.5">
          {#each message.parts as part, index (part.type === "tool" ? part.id : `${part.type}-${index}`)}
            {#if part.type === "text"}
              {#if part.text.trim()}
                <div class="agent-prose">
                  <AiMarkdown content={part.text} streaming={isStreaming(message) && index === message.parts.length - 1} />
                </div>
              {/if}
            {:else if part.type === "reasoning"}
              {#if part.text.trim()}
                {@const key = `${message.id}-${index}`}
                <button
                  type="button"
                  onclick={() => (openReasoning[key] = !openReasoning[key])}
                  class="flex items-center gap-1 font-mono text-[10px] italic text-muted-foreground/70 hover:text-muted-foreground"
                >
                  <ChevronRight class={cn("size-3 transition-transform", openReasoning[key] && "rotate-90")} />
                  <Brain class="size-3" /> thinking
                </button>
                {#if openReasoning[key]}
                  <p class="ml-4 whitespace-pre-wrap border-l border-border pl-2.5 text-[11px] italic leading-relaxed text-muted-foreground">{part.text}</p>
                {/if}
              {/if}
            {:else}
              <AgentToolRow {part} {onOpenChild} />
            {/if}
          {/each}
          {#if message.error}
            <p class="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              <TriangleAlert class="mt-0.5 size-3 shrink-0" />{message.error}
            </p>
          {/if}
        </div>
      </li>
    {:else if message.kind !== "idle"}
      <li class="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
        <span class="h-px flex-1 bg-border"></span>
        {message.text}
        <span class="h-px flex-1 bg-border"></span>
      </li>
    {/if}
  {/each}

  {#if awaitingFirstToken}
    <li class="flex items-center gap-2 pl-0.5" aria-label="Agent is thinking">
      <span class="agent-quill"><Feather class="size-3.5 text-accent" /></span>
      <span class="agent-ink-line"></span>
    </li>
  {/if}
</ol>
