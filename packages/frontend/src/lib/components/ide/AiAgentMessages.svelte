<script lang="ts">
  import { Bot, ChevronDown, ChevronRight, FileText, Loader2, Paperclip, User, Wrench } from 'lucide-svelte';
  import type { AiAgentMessage, AiAgentSession, AiAgentToolCall } from '@opentales/sdk';
  import AiMarkdown from './AiMarkdown.svelte';

  interface Props {
    session: AiAgentSession | null;
    isRunning: boolean;
    activeAssistantMessage: AiAgentMessage | null;
    showThinking: boolean;
    toolForMessage: (msg: AiAgentMessage) => AiAgentToolCall | undefined;
    toolLabel: (name: string) => string;
    toolStatusLabel: (status: AiAgentToolCall['status']) => string;
  }

  let {
    session,
    isRunning,
    activeAssistantMessage,
    showThinking,
    toolForMessage,
    toolLabel,
    toolStatusLabel
  }: Props = $props();

  let expandedTools = $state<Record<string, boolean>>({});

  function firstLine(value: string | undefined, fallback: string): string {
    return value?.split('\n').find((line) => line.trim())?.trim() ?? fallback;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

{#if !session || session.messages.length === 0}
  <div class="flex flex-col items-center justify-center gap-2 p-6 text-center">
    <Bot class="size-6 text-muted-foreground/40" />
    <p class="max-w-52 text-[11px] leading-relaxed text-muted-foreground">
      Ask about your manuscript, request rewrites, or explore your story.
    </p>
  </div>
{:else}
  <div class="space-y-3 p-3">
    {#each session.messages as msg (msg.id)}
      {#if msg.role === 'user'}
        <article class="group flex flex-col items-end gap-1.5">
          {#if msg.attachments?.length}
            <div class="flex max-w-[86%] flex-wrap justify-end gap-1.5">
              {#each msg.attachments as attachment (attachment.id)}
                <a
                  href={attachment.url ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex max-w-48 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <Paperclip class="size-3 shrink-0" />
                  <span class="truncate">{attachment.name}</span>
                  <span class="shrink-0 opacity-70">{formatBytes(attachment.sizeBytes)}</span>
                </a>
              {/each}
            </div>
          {/if}
          <div class="max-w-[86%] rounded-lg border border-border bg-muted/45 px-3 py-2 shadow-sm">
            <div class="mb-1 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
              <span class="inline-flex items-center gap-1"><User class="size-3" /> You</span>
              {#if msg.model}<span class="truncate">{msg.model}</span>{/if}
            </div>
            <p class="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">{msg.content}</p>
          </div>
        </article>
      {:else if msg.role === 'assistant'}
        {#if msg.content || msg.id !== activeAssistantMessage?.id || !isRunning}
          <article class="group flex gap-2">
            <div class="mt-1 flex size-5 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent">
              <Bot class="size-3.5" />
            </div>
            <div class="min-w-0 flex-1">
              <AiMarkdown content={msg.content} streaming={isRunning && msg.id === activeAssistantMessage?.id} />
              {#if isRunning && msg.id === activeAssistantMessage?.id}
                <span class="mt-1 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-accent/60"></span>
              {/if}
            </div>
          </article>
        {/if}
      {:else if msg.role === 'tool'}
        {@const tc = toolForMessage(msg)}
        <div class="rounded-md border border-border/70 bg-muted/20 text-[11px] text-muted-foreground">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
            onclick={() => tc && (expandedTools[tc.id] = !expandedTools[tc.id])}
          >
            <Wrench class="size-3 shrink-0 text-muted-foreground/80" />
            <span class="min-w-0 flex-1 truncate">{tc ? toolLabel(tc.toolName) : firstLine(msg.content, 'Tool call')}</span>
            {#if tc}
              <span class="rounded-full bg-background px-1.5 py-0.5 text-[10px]">{toolStatusLabel(tc.status)}</span>
              {#if expandedTools[tc.id]}<ChevronDown class="size-3" />{:else}<ChevronRight class="size-3" />{/if}
            {/if}
          </button>
          {#if tc && expandedTools[tc.id]}
            <pre class="mx-2 mb-2 max-h-40 overflow-auto rounded bg-background/70 p-2 text-[10px] leading-relaxed">{JSON.stringify(tc.input, null, 2)}</pre>
          {/if}
        </div>
      {:else if msg.role === 'system'}
        <div class="rounded-md bg-muted/20 px-3 py-1 text-[10px] italic text-muted-foreground">{msg.content}</div>
      {/if}
    {/each}

    {#if showThinking}
      <div class="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
        <Loader2 class="size-3.5 animate-spin" />
        <span>Thinking...</span>
      </div>
    {/if}
  </div>
{/if}
