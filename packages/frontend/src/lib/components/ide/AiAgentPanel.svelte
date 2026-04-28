<script lang="ts">
  import {
    AlertCircle,
    Bot,
    Loader2,
    Send,
    Settings as SettingsIcon,
    Sparkles,
    StopCircle,
    User,
    Zap
  } from 'lucide-svelte';
  import { tick } from 'svelte';
  import type { AiAgentMessage, AiAgentToolCall } from '@opentales/sdk';
  import { aiAgent } from '$lib/stores/aiAgent.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import AiToolCallCard from './AiToolCallCard.svelte';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import PanelHeader from './PanelHeader.svelte';

  let prompt = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let scrollEl: HTMLDivElement | undefined = $state();
  let lastMessageCount = $state(0);
  let lastTextLen = $state(0);

  // Group tool calls by surrounding assistant messages so they render in order.
  // Sorted oldest -> newest by createdAt.
  type Row =
    | { kind: 'message'; message: AiAgentMessage }
    | { kind: 'tool'; call: AiAgentToolCall }
    | { kind: 'streaming'; text: string };

  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    const session = aiAgent.session;
    if (!session) return out;

    const messages = [...session.messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const calls = [...session.pendingToolCalls].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    let mi = 0;
    let ci = 0;
    while (mi < messages.length || ci < calls.length) {
      const m = messages[mi];
      const c = calls[ci];
      if (m && (!c || new Date(m.createdAt).getTime() <= new Date(c.createdAt).getTime())) {
        out.push({ kind: 'message', message: m });
        mi++;
      } else if (c) {
        out.push({ kind: 'tool', call: c });
        ci++;
      }
    }

    if (session.status === 'running' && aiAgent.textBuffer) {
      out.push({ kind: 'streaming', text: aiAgent.textBuffer });
    }

    return out;
  });

  const queue = $derived(aiAgent.session?.queue ?? []);
  const status = $derived(aiAgent.session?.status ?? 'idle');
  const isRunning = $derived(status === 'running');
  const sessionEmpty = $derived(rows.length === 0 && queue.length === 0);

  $effect(() => {
    // Attach to whichever project is currently loaded.
    const id = manuscript.projectId;
    if (id && aiAgent.attachedProjectId !== id) {
      void aiAgent.attach(id);
    }
    if (!id && aiAgent.attachedProjectId) {
      aiAgent.detach();
    }
  });

  // Auto-scroll to the bottom whenever new content arrives.
  $effect(() => {
    const session = aiAgent.session;
    const totalMessages = session?.messages.length ?? 0;
    const buffer = aiAgent.textBuffer.length;
    if (totalMessages !== lastMessageCount || buffer !== lastTextLen) {
      lastMessageCount = totalMessages;
      lastTextLen = buffer;
      void tick().then(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
  });

  async function send(interrupt = false) {
    const value = prompt.trim();
    if (!value) return;
    prompt = '';
    await aiAgent.queuePrompt(value, { interrupt });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(false);
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send(true);
    }
  }

  function relTime(iso: string): string {
    const ts = new Date(iso).getTime();
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  function openSettings() {
    void manuscript.setActiveView('settings');
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="AI agent">
    {#snippet actions()}
      <div class="flex items-center gap-1.5">
        <span
          class={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider',
            isRunning
              ? 'bg-accent/20 text-accent'
              : status === 'error'
                ? 'bg-destructive/20 text-destructive-foreground'
                : 'bg-muted text-muted-foreground'
          )}
        >
          {#if isRunning}
            <Loader2 class="size-2.5 animate-spin" />
          {:else}
            <span
              class={cn(
                'size-1.5 rounded-full',
                aiAgent.connected
                  ? 'bg-emerald-500'
                  : aiAgent.connecting
                    ? 'bg-amber-400'
                    : 'bg-muted-foreground/50'
              )}
            ></span>
          {/if}
          {status}
        </span>
        <button
          type="button"
          onclick={openSettings}
          title="AI settings"
          class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <SettingsIcon class="size-3.5" />
        </button>
      </div>
    {/snippet}
  </PanelHeader>

  {#if !aiAgent.attachedProjectId}
    <div class="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
      Open a project to use the AI agent.
    </div>
  {:else if aiAgent.settings && !aiAgent.settings.enabled}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-xs text-muted-foreground">
      <div class="flex size-10 items-center justify-center rounded-md border border-border bg-card">
        <Bot class="size-5 text-muted-foreground" />
      </div>
      <div class="max-w-[18rem]">
        <p class="text-sm text-foreground">AI is disabled for this project.</p>
        <p class="mt-1 text-[11px] text-muted-foreground">
          Enable it in Project Settings, choose a provider and model, and the agent will appear here.
        </p>
      </div>
      <button
        type="button"
        onclick={openSettings}
        class="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-foreground hover:bg-muted"
      >
        <SettingsIcon class="size-3.5" /> Open AI settings
      </button>
    </div>
  {:else}
    <div bind:this={scrollEl} class="flex-1 overflow-y-auto px-3 py-3">
      {#if sessionEmpty}
        <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
          <div class="flex size-10 items-center justify-center rounded-md border border-border bg-card">
            <Sparkles class="size-5 text-accent" />
          </div>
          <div class="max-w-[18rem]">
            <p class="text-sm font-medium text-foreground">Ask the project agent</p>
            <p class="mt-1 text-[11px] text-muted-foreground">
              The agent can read characters, chapters, locations, story structure, and project docs.
              Mutations always require your approval before they apply.
            </p>
          </div>
        </div>
      {:else}
        <ul class="space-y-3">
          {#each rows as row, i (i)}
            {#if row.kind === 'message'}
              {@const m = row.message}
              {#if m.role === 'system'}
                <li class="rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {m.content}
                </li>
              {:else}
                <li class="flex gap-2.5">
                  <div
                    class={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full border border-border',
                      m.role === 'user'
                        ? 'bg-accent/10 text-accent'
                        : m.role === 'tool'
                          ? 'bg-amber-500/10 text-amber-300'
                          : 'bg-card text-foreground'
                    )}
                  >
                    {#if m.role === 'user'}
                      <User class="size-3.5" />
                    {:else if m.role === 'tool'}
                      <Zap class="size-3.5" />
                    {:else}
                      <Bot class="size-3.5" />
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span>{m.role}</span>
                      <span>· {relTime(m.createdAt)}</span>
                    </div>
                    <div
                      class={cn(
                        'mt-1 rounded-md border border-border bg-card/40 px-3 py-2 text-xs leading-relaxed text-foreground/90',
                        m.role === 'user' && 'border-accent/30'
                      )}
                    >
                      {#if m.role === 'assistant'}
                        <MarkdownPreview content={m.content} />
                      {:else}
                        <p class="whitespace-pre-wrap">{m.content}</p>
                      {/if}
                    </div>
                  </div>
                </li>
              {/if}
            {:else if row.kind === 'tool'}
              <li>
                <AiToolCallCard call={row.call} />
              </li>
            {:else}
              <li class="flex gap-2.5">
                <div
                  class="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground"
                >
                  <Bot class="size-3.5" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>assistant</span>
                    <span class="inline-flex items-center gap-1 text-accent">
                      <Loader2 class="size-2.5 animate-spin" /> streaming
                    </span>
                  </div>
                  <div class="mt-1 rounded-md border border-accent/30 bg-card/40 px-3 py-2 text-xs leading-relaxed text-foreground/90">
                    <MarkdownPreview content={row.text} />
                  </div>
                </div>
              </li>
            {/if}
          {/each}
        </ul>
      {/if}

      {#if queue.length > 0}
        <div class="mt-4 rounded-md border border-border bg-card/40 px-2.5 py-1.5 text-xs">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Queued prompts
            </span>
            {#if isRunning}
              <button
                type="button"
                onclick={() => void aiAgent.cancel()}
                class="inline-flex items-center gap-1 rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
              >
                <StopCircle class="size-3" /> Cancel
              </button>
            {/if}
          </div>
          <ul class="space-y-1">
            {#each queue as q (q.id)}
              <li class="flex items-baseline gap-2">
                <span
                  class={cn(
                    'inline-block size-1.5 rounded-full',
                    q.status === 'running' ? 'bg-accent' : 'bg-muted-foreground/60'
                  )}
                ></span>
                <span class="line-clamp-2 flex-1 text-foreground/90">{q.prompt}</span>
                <span class="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                  {q.status}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if aiAgent.error}
        <div
          class="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive-foreground"
        >
          <AlertCircle class="mt-0.5 size-3.5 shrink-0" />
          <div class="flex-1">
            {aiAgent.error}
          </div>
          <button
            type="button"
            onclick={() => aiAgent.clearError()}
            class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      {/if}
    </div>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        void send(false);
      }}
      class="border-t border-border px-3 py-2"
    >
      <div
        class="flex items-end gap-2 rounded-md border border-border bg-background px-2 py-1.5 focus-within:border-accent"
      >
        <textarea
          bind:this={textareaEl}
          bind:value={prompt}
          rows={2}
          placeholder="Ask the agent — Enter to queue, Cmd+Enter to interrupt"
          onkeydown={onKey}
          class="min-h-[2.25rem] flex-1 resize-none bg-transparent py-0.5 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
        ></textarea>
        <div class="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            disabled={!prompt.trim() || !isRunning}
            onclick={() => void send(true)}
            title="Steer now (interrupt active prompt)"
            class="inline-flex size-7 items-center justify-center rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-30"
          >
            <Zap class="size-3.5" />
          </button>
          <button
            type="submit"
            disabled={!prompt.trim()}
            title="Queue prompt (Enter)"
            class="inline-flex size-7 items-center justify-center rounded bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send class="size-3.5" />
          </button>
        </div>
      </div>
      <div class="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          Enter — queue · Shift+Enter — newline · Cmd/Ctrl+Enter — steer now
        </span>
        {#if isRunning}
          <button
            type="button"
            onclick={() => void aiAgent.cancel()}
            class="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
          >
            <StopCircle class="size-3" /> Cancel run
          </button>
        {/if}
      </div>
    </form>
  {/if}
</div>
