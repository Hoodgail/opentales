<script lang="ts">
  import {
    Bot,
    Check,
    ChevronDown,
    ChevronRight,
    CircleStop,
    Loader2,
    Send,
    Sparkles,
    User,
    X,
    Zap
  } from 'lucide-svelte';
  import { tick, untrack } from 'svelte';
  import type { AiAgentMessage, AiAgentToolCall } from '@opentales/sdk';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import { cn } from '$lib/utils';
  import PanelHeader from './PanelHeader.svelte';

  let prompt = $state('');
  let scrollEl: HTMLDivElement | undefined = $state();

  const projectId = $derived(manuscript.projectId);
  const session = $derived(ai.session);
  const isRunning = $derived(session?.status === 'running');
  const isIdle = $derived(!session || session.status === 'idle');
  const aiEnabled = $derived(ai.settings?.enabled ?? false);

  // Auto-scroll on new content
  $effect(() => {
    const _ = ai.streamedText;
    const __ = session?.messages?.length;
    void tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  // Hydrate session + start stream when project is loaded and AI is enabled
  $effect(() => {
    const pid = projectId;
    if (!pid) return;
    void ai.loadSettings(pid);
  });

  $effect(() => {
    const pid = projectId;
    if (!pid || !aiEnabled) return;
    untrack(() => {
      void ai.loadSession(pid);
      void ai.startStream(pid);
      void ai.loadToolManifest(pid);
    });

    return () => ai.stopStream();
  });

  function send() {
    if (!projectId || !prompt.trim()) return;
    void ai.queuePrompt(projectId, prompt.trim());
    prompt = '';
  }

  function interrupt() {
    if (!projectId || !prompt.trim()) return;
    void ai.queuePrompt(projectId, prompt.trim(), true);
    prompt = '';
  }

  function cancel() {
    if (!projectId) return;
    void ai.cancelSession(projectId);
  }

  function approve(toolCallId: string) {
    if (!projectId) return;
    void ai.approveToolCall(projectId, toolCallId, true);
  }

  function reject(toolCallId: string) {
    if (!projectId) return;
    void ai.approveToolCall(projectId, toolCallId, false);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Collapsible tool call rows
  let expandedTools = $state<Record<string, boolean>>({});

  function toggleTool(id: string) {
    expandedTools[id] = !expandedTools[id];
  }

  const READ_TOOLS = new Set([
    'listCharacters',
    'readCharacter',
    'listChapters',
    'readChapter',
    'grepChapter',
    'grepChapters',
    'listLocations',
    'readLocation',
    'listProjectDocs',
    'readProjectDoc',
    'readStoryStructure'
  ]);

  function isReadTool(name: string) {
    return READ_TOOLS.has(name);
  }

  function toolLabel(name: string): string {
    const map: Record<string, string> = {
      listCharacters: 'Listed characters',
      readCharacter: 'Read character',
      listChapters: 'Listed chapters',
      readChapter: 'Read chapter',
      grepChapter: 'Searched chapter',
      grepChapters: 'Searched chapters',
      listLocations: 'Listed locations',
      readLocation: 'Read location',
      listProjectDocs: 'Listed docs',
      readProjectDoc: 'Read doc',
      readStoryStructure: 'Read story structure',
      updateCharacter: 'Update character',
      createCharacter: 'Create character',
      updateChapter: 'Update chapter',
      createProjectDoc: 'Create doc',
      updateProjectDoc: 'Update doc'
    };
    return map[name] ?? name;
  }

  function readModeLabel(input: unknown): string {
    if (!input || typeof input !== 'object') return '';
    const i = input as Record<string, unknown>;
    if (i.full) return 'full text';
    if (i.startLine || i.endLine) return `lines ${i.startLine ?? '?'}–${i.endLine ?? '?'}`;
    if (i.offset !== undefined || i.length !== undefined) return `offset ${i.offset}+${i.length}`;
    return 'summary';
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="AI Agent">
    {#snippet actions()}
      {#if isRunning}
        <button
          type="button"
          onclick={cancel}
          title="Cancel generation"
          class="flex size-6 items-center justify-center rounded text-destructive hover:bg-muted"
        >
          <CircleStop class="size-3.5" />
        </button>
      {/if}
    {/snippet}
  </PanelHeader>

  {#if !aiEnabled}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
      <div
        class="flex size-10 items-center justify-center rounded-lg border border-border bg-muted"
      >
        <Sparkles class="size-5 text-muted-foreground" />
      </div>
      <p class="text-xs text-muted-foreground">
        AI features are disabled for this project.
      </p>
      <button
        type="button"
        onclick={() => void manuscript.setActiveView('settings')}
        class="rounded-md border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-muted"
      >
        Open Settings
      </button>
    </div>
  {:else}
    <!-- Transcript -->
    <div bind:this={scrollEl} class="flex-1 overflow-y-auto">
      {#if !session || session.messages.length === 0}
        <div class="flex flex-col items-center justify-center gap-2 p-6 text-center">
          <Bot class="size-6 text-muted-foreground/40" />
          <p class="text-[11px] text-muted-foreground">
            Ask about your manuscript, request rewrites, or explore your story.
          </p>
        </div>
      {:else}
        <div class="space-y-1 p-2">
          {#each session.messages as msg (msg.id)}
            {#if msg.role === 'user'}
              <div class="flex gap-2 rounded-md bg-muted/30 px-3 py-2">
                <User class="mt-0.5 size-3.5 shrink-0 text-accent" />
                <p class="min-w-0 flex-1 text-xs text-foreground whitespace-pre-wrap">
                  {msg.content}
                </p>
              </div>
            {:else if msg.role === 'assistant'}
              <div class="flex gap-2 px-3 py-2">
                <Bot class="mt-0.5 size-3.5 shrink-0 text-accent" />
                <div class="min-w-0 flex-1 text-xs text-foreground/90 whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            {:else if msg.role === 'system'}
              <div class="px-3 py-1 text-[10px] italic text-muted-foreground">
                {msg.content}
              </div>
            {/if}
          {/each}

          <!-- Streamed delta (while running) -->
          {#if isRunning && ai.streamedText}
            <div class="flex gap-2 px-3 py-2">
              <Bot class="mt-0.5 size-3.5 shrink-0 text-accent animate-pulse" />
              <div class="min-w-0 flex-1 text-xs text-foreground/90 whitespace-pre-wrap">
                {ai.streamedText}
                <span class="inline-block w-1.5 h-3.5 bg-accent/60 animate-pulse rounded-sm"></span>
              </div>
            </div>
          {:else if isRunning}
            <div class="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
              <Loader2 class="size-3.5 animate-spin" />
              <span>Thinking…</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Pending tool calls (need approval) -->
      {#if session?.pendingToolCalls && session.pendingToolCalls.length > 0}
        <div class="space-y-2 border-t border-border p-2">
          {#each session.pendingToolCalls as tc (tc.id)}
            {#if tc.status === 'pending-approval'}
              <div class="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                <div class="flex items-center gap-2 text-xs">
                  <Zap class="size-3.5 text-amber-400" />
                  <span class="font-medium text-amber-300">{toolLabel(tc.toolName)}</span>
                  <span class="text-[10px] text-muted-foreground">requires approval</span>
                </div>
                <button
                  type="button"
                  onclick={() => toggleTool(tc.id)}
                  class="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {#if expandedTools[tc.id]}
                    <ChevronDown class="size-3" /> Hide input
                  {:else}
                    <ChevronRight class="size-3" /> Show input
                  {/if}
                </button>
                {#if expandedTools[tc.id]}
                  <pre class="mt-1 max-h-32 overflow-auto rounded bg-background/60 p-2 text-[10px] text-foreground/80">{JSON.stringify(tc.input, null, 2)}</pre>
                {/if}
                <div class="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    onclick={() => approve(tc.id)}
                    class="inline-flex items-center gap-1 rounded-md bg-emerald-600/80 px-2.5 py-1 text-[11px] text-white hover:bg-emerald-500"
                  >
                    <Check class="size-3" /> Approve
                  </button>
                  <button
                    type="button"
                    onclick={() => reject(tc.id)}
                    class="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    <X class="size-3" /> Reject
                  </button>
                </div>
              </div>
            {/if}
          {/each}
        </div>
      {/if}

      <!-- Queue -->
      {#if session?.queue && session.queue.filter((q) => q.status === 'queued').length > 0}
        <div class="border-t border-border p-2">
          <p class="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Queued</p>
          {#each session.queue.filter((q) => q.status === 'queued') as q (q.id)}
            <div class="rounded bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
              {q.prompt}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Error -->
    {#if ai.sessionError}
      <div class="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
        {ai.sessionError}
      </div>
    {/if}

    <!-- Input -->
    <div class="border-t border-border bg-sidebar/60 p-2">
      <div class="flex gap-1.5">
        <textarea
          bind:value={prompt}
          onkeydown={handleKey}
          placeholder="Ask about your manuscript…"
          rows="1"
          class="flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-accent"
        ></textarea>
        <div class="flex flex-col gap-1">
          <button
            type="button"
            onclick={send}
            disabled={!prompt.trim()}
            title="Send"
            class="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground disabled:opacity-40 hover:bg-accent/90"
          >
            <Send class="size-3.5" />
          </button>
          {#if isRunning}
            <button
              type="button"
              onclick={interrupt}
              disabled={!prompt.trim()}
              title="Interrupt & send"
              class="flex size-7 items-center justify-center rounded-md border border-amber-500/40 text-amber-400 disabled:opacity-40 hover:bg-amber-500/10"
            >
              <Zap class="size-3.5" />
            </button>
          {/if}
        </div>
      </div>
      <div class="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {#if ai.streaming}
            <span class="inline-flex items-center gap-1">
              <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Connected
            </span>
          {:else}
            <span class="inline-flex items-center gap-1">
              <span class="size-1.5 rounded-full bg-muted-foreground"></span>
              Disconnected
            </span>
          {/if}
        </span>
        <span>
          {session?.status ?? 'idle'}
        </span>
      </div>
    </div>
  {/if}
</div>
