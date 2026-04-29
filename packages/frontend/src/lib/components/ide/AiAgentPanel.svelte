<script lang="ts">
  import {
    Bot,
    Check,
    ChevronDown,
    ChevronRight,
    CircleStop,
    FileText,
    Loader2,
    Plus,
    Send,
    Sparkles,
    User,
    X,
    Zap
  } from 'lucide-svelte';
  import { tick, untrack } from 'svelte';
  import type { AiAgentMessage, AiAgentToolCall } from '@opentales/sdk';
  import { setAiApprovalDoc } from '$lib/data/ai-approval-docs';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import PanelHeader from './PanelHeader.svelte';

  let prompt = $state('');
  let scrollEl: HTMLDivElement | undefined = $state();
  let sessionMenuOpen = $state(false);

  const projectId = $derived(manuscript.projectId);
  const session = $derived(ai.session);
  const isRunning = $derived(session?.status === 'running');
  const aiEnabled = $derived(ai.settings?.enabled ?? false);
  const activeAssistantMessage = $derived(session ? latestAssistantMessage(session.messages) : null);
  const showThinking = $derived(isRunning && !activeAssistantMessage?.content);

  // Auto-scroll on new content
  $effect(() => {
    const _ = activeAssistantMessage?.content;
    const __ = session?.messages?.length;
    void tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  function latestAssistantMessage(messages: AiAgentMessage[]): AiAgentMessage | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') return messages[index];
    }
    return null;
  }

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
      void ai.loadSessions(pid);
      void ai.startStream(pid);
      void ai.loadToolManifest(pid);
      void ai.loadDocs(pid, { limit: 100 });
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
    const pid = projectId;
    void ai.approveToolCall(pid, toolCallId, true).then(() => manuscript.loadProject(pid));
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

  function createSession() {
    if (!projectId) return;
    void ai.createSession(projectId, 'New chat');
    sessionMenuOpen = false;
  }

  function selectSession(sessionId: string) {
    if (!projectId) return;
    void ai.selectSession(projectId, sessionId);
    sessionMenuOpen = false;
  }

  function sessionTime(value: string): string {
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Collapsible tool call rows
  let expandedTools = $state<Record<string, boolean>>({});

  function toggleTool(id: string) {
    expandedTools[id] = !expandedTools[id];
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
      createChapter: 'Create chapter',
      createProjectDoc: 'Create doc',
      updateProjectDoc: 'Update doc'
    };
    return map[name] ?? name;
  }

  function toolSummary(tc: AiAgentToolCall): string {
    const input = inputRecord(tc.input);
    if (tc.toolName === 'updateChapter') {
      const chapter = manuscript.chapters.find((c) => c.id === textInput(input, 'chapterId'));
      return chapter?.title ?? firstLine(textInput(input, 'title'), 'Unknown chapter');
    }
    if (tc.toolName === 'createChapter') return firstLine(textInput(input, 'title'), 'New chapter');
    if (tc.toolName === 'updateCharacter') {
      const character = manuscript.characters.find((c) => c.id === textInput(input, 'characterId'));
      return character?.name ?? firstLine(textInput(input, 'name'), 'Unknown character');
    }
    if (tc.toolName === 'createCharacter') return firstLine(textInput(input, 'name'), 'New character');
    if (tc.toolName === 'updateProjectDoc') {
      const doc = ai.docs.find((d) => d.id === textInput(input, 'docId'));
      return doc?.title ?? firstLine(textInput(input, 'title'), 'Unknown doc');
    }
    if (tc.toolName === 'createProjectDoc') return firstLine(textInput(input, 'title'), 'New doc');
    return 'Review proposed tool input';
  }

  type JsonRecord = Record<string, unknown>;

  function inputRecord(input: unknown): JsonRecord {
    return input && typeof input === 'object' && !Array.isArray(input) ? (input as JsonRecord) : {};
  }

  function textInput(input: JsonRecord, key: string): string | undefined {
    const value = input[key];
    return typeof value === 'string' ? value : undefined;
  }

  function stringArrayInput(input: JsonRecord, key: string): string[] | undefined {
    const value = input[key];
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value
      : undefined;
  }

  function contentEditInput(input: JsonRecord): { oldString: string; newString: string; replaceAll?: boolean } | undefined {
    const value = input.contentEdit;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const edit = value as JsonRecord;
    const oldString = textInput(edit, 'oldString');
    const newString = textInput(edit, 'newString');
    if (oldString === undefined || newString === undefined) return undefined;
    return {
      oldString,
      newString,
      replaceAll: typeof edit.replaceAll === 'boolean' ? edit.replaceAll : undefined
    };
  }

  function applyContentEdit(content: string, edit: ReturnType<typeof contentEditInput>): string {
    if (!edit?.oldString) return content;
    return edit.replaceAll
      ? content.split(edit.oldString).join(edit.newString)
      : content.replace(edit.oldString, edit.newString);
  }

  function displayValue(value: unknown): string {
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
    if (typeof value === 'string') return value.trim() || 'Empty';
    if (value === null || value === undefined) return 'None';
    return String(value);
  }

  function firstLine(value: string | undefined, fallback: string): string {
    return value?.split('\n').find((line) => line.trim())?.trim() ?? fallback;
  }

  function chapterMeta(input: {
    title?: string;
    status?: string;
    povCharacterId?: string;
    locationId?: string;
  }) {
    const pov = manuscript.characters.find((c) => c.id === input.povCharacterId)?.name ?? input.povCharacterId;
    const location = manuscript.locations.find((l) => l.id === input.locationId)?.name ?? input.locationId;
    return [
      `Title: ${displayValue(input.title)}`,
      `Status: ${displayValue(input.status)}`,
      `POV: ${displayValue(pov)}`,
      `Location: ${displayValue(location)}`
    ].join('\n');
  }

  function characterBasics(input: {
    name?: string;
    role?: string;
    age?: string;
    occupation?: string;
    traits?: string[];
  }) {
    return [
      `Name: ${displayValue(input.name)}`,
      `Role: ${displayValue(input.role)}`,
      `Age: ${displayValue(input.age)}`,
      `Occupation: ${displayValue(input.occupation)}`,
      `Traits: ${displayValue(input.traits)}`
    ].join('\n');
  }

  function docMeta(input: { title?: string; kind?: string }) {
    return [`Title: ${displayValue(input.title)}`, `Kind: ${displayValue(input.kind)}`].join('\n');
  }

  function buildApprovalDoc(tc: AiAgentToolCall) {
    const input = inputRecord(tc.input);
    const title = toolLabel(tc.toolName);

    if (tc.toolName === 'updateChapter') {
      const chapter = manuscript.chapters.find((c) => c.id === textInput(input, 'chapterId'));
      if (!chapter) return null;
      const contentEdit = contentEditInput(input);
      const modified = {
        title: textInput(input, 'title') ?? chapter.title,
        status: textInput(input, 'status') ?? chapter.status,
        povCharacterId: textInput(input, 'povCharacterId') ?? chapter.povCharacterId,
        locationId: textInput(input, 'locationId') ?? chapter.locationId,
        summary: textInput(input, 'summary') ?? chapter.summary,
        content: applyContentEdit(chapter.content, contentEdit)
      };
      return {
        targetLabel: chapter.title,
        title: `AI: ${title}`,
        panes: [
          {
            id: 'chapter-meta',
            title: 'Chapter Details',
            description: 'Title, status, POV, and location',
            original: chapterMeta(chapter),
            modified: chapterMeta(modified),
            language: 'markdown'
          },
          {
            id: 'chapter-summary',
            title: 'Summary',
            description: 'Synopsis and intent for the chapter',
            original: chapter.summary,
            modified: modified.summary ?? '',
            language: 'markdown'
          },
          {
            id: 'chapter-content',
            title: 'Manuscript',
            description: 'Full chapter prose',
            original: chapter.content,
            modified: modified.content ?? '',
            language: 'markdown'
          }
        ]
      };
    }

    if (tc.toolName === 'createChapter') {
      const modified = {
        title: textInput(input, 'title'),
        status: textInput(input, 'status'),
        povCharacterId: textInput(input, 'povCharacterId'),
        locationId: textInput(input, 'locationId'),
        summary: textInput(input, 'summary'),
        content: textInput(input, 'content')
      };
      return {
        targetLabel: textInput(input, 'title') ?? 'New chapter',
        title: `AI: ${title}`,
        panes: [
          {
            id: 'chapter-meta',
            title: 'Chapter Details',
            description: 'Title, status, POV, and location',
            original: '',
            modified: chapterMeta(modified),
            language: 'markdown'
          },
          {
            id: 'chapter-summary',
            title: 'Summary',
            description: 'Synopsis and intent for the chapter',
            original: '',
            modified: modified.summary ?? '',
            language: 'markdown'
          },
          {
            id: 'chapter-content',
            title: 'Manuscript',
            description: 'Full chapter prose',
            original: '',
            modified: modified.content ?? '',
            language: 'markdown'
          }
        ]
      };
    }

    if (tc.toolName === 'updateCharacter') {
      const character = manuscript.characters.find((c) => c.id === textInput(input, 'characterId'));
      if (!character) return null;
      const modified = {
        name: textInput(input, 'name') ?? character.name,
        role: textInput(input, 'role') ?? character.role,
        age: textInput(input, 'age') ?? character.age,
        occupation: textInput(input, 'occupation') ?? character.occupation,
        traits: stringArrayInput(input, 'traits') ?? character.traits,
        description: textInput(input, 'description') ?? character.description,
        appearance: textInput(input, 'appearance') ?? character.appearance,
        motivation: textInput(input, 'motivation') ?? character.motivation,
        arc: textInput(input, 'arc') ?? character.arc
      };
      return {
        targetLabel: character.name,
        title: `AI: ${title}`,
        panes: [
          {
            id: 'character-basics',
            title: 'Basics',
            description: 'Name, role, age, occupation, and traits',
            original: characterBasics(character),
            modified: characterBasics(modified),
            language: 'markdown'
          },
          {
            id: 'character-description',
            title: 'Description',
            description: 'Core identity and backstory notes',
            original: character.description,
            modified: modified.description ?? '',
            language: 'markdown'
          },
          {
            id: 'character-appearance',
            title: 'Appearance',
            description: 'Physical presentation and visual cues',
            original: character.appearance,
            modified: modified.appearance ?? '',
            language: 'markdown'
          },
          {
            id: 'character-motivation-arc',
            title: 'Motivation & Arc',
            description: 'Driving wants and transformation',
            original: `## Motivation\n${character.motivation}\n\n## Character Arc\n${character.arc}`,
            modified: `## Motivation\n${modified.motivation ?? ''}\n\n## Character Arc\n${modified.arc ?? ''}`,
            language: 'markdown'
          }
        ]
      };
    }

    if (tc.toolName === 'createCharacter') {
      const modified = {
        name: textInput(input, 'name'),
        role: textInput(input, 'role'),
        age: textInput(input, 'age'),
        occupation: textInput(input, 'occupation'),
        traits: stringArrayInput(input, 'traits'),
        description: textInput(input, 'description'),
        appearance: textInput(input, 'appearance'),
        motivation: textInput(input, 'motivation'),
        arc: textInput(input, 'arc')
      };
      return {
        targetLabel: textInput(input, 'name') ?? 'New character',
        title: `AI: ${title}`,
        panes: [
          {
            id: 'character-basics',
            title: 'Basics',
            description: 'Name, role, age, occupation, and traits',
            original: '',
            modified: characterBasics(modified),
            language: 'markdown'
          },
          {
            id: 'character-description',
            title: 'Description',
            description: 'Core identity and backstory notes',
            original: '',
            modified: modified.description ?? '',
            language: 'markdown'
          },
          {
            id: 'character-appearance',
            title: 'Appearance',
            description: 'Physical presentation and visual cues',
            original: '',
            modified: modified.appearance ?? '',
            language: 'markdown'
          },
          {
            id: 'character-motivation-arc',
            title: 'Motivation & Arc',
            description: 'Driving wants and transformation',
            original: '',
            modified: `## Motivation\n${modified.motivation ?? ''}\n\n## Character Arc\n${modified.arc ?? ''}`,
            language: 'markdown'
          }
        ]
      };
    }

    if (tc.toolName === 'updateProjectDoc') {
      const doc = ai.docs.find((d) => d.id === textInput(input, 'docId'));
      if (!doc) return null;
      const contentEdit = contentEditInput(input);
      const modified = {
        title: textInput(input, 'title') ?? doc.title,
        kind: textInput(input, 'kind') ?? doc.kind,
        content: applyContentEdit(doc.content, contentEdit)
      };
      return {
        targetLabel: doc.title,
        title: `AI: ${title}`,
        panes: [
          {
            id: 'doc-meta',
            title: 'Document Details',
            description: 'Title and document kind',
            original: docMeta(doc),
            modified: docMeta(modified),
            language: 'markdown'
          },
          {
            id: 'doc-content',
            title: 'Content',
            description: 'Document body',
            original: doc.content,
            modified: modified.content ?? '',
            language: 'markdown'
          }
        ]
      };
    }

    if (tc.toolName === 'createProjectDoc') {
      const modified = {
        title: textInput(input, 'title'),
        kind: textInput(input, 'kind'),
        content: textInput(input, 'content')
      };
      return {
        targetLabel: textInput(input, 'title') ?? 'New doc',
        title: `AI: ${title}`,
        panes: [
          {
            id: 'doc-meta',
            title: 'Document Details',
            description: 'Title and document kind',
            original: '',
            modified: docMeta(modified),
            language: 'markdown'
          },
          {
            id: 'doc-content',
            title: 'Content',
            description: 'Document body',
            original: '',
            modified: modified.content ?? '',
            language: 'markdown'
          }
        ]
      };
    }

    return {
      targetLabel: title,
      title: `AI: ${title}`,
      panes: [
        {
          id: 'raw-input',
          title: 'Raw Input',
          description: 'Unrecognized tool payload',
          original: '',
          modified: JSON.stringify(tc.input, null, 2),
          language: 'json'
        }
      ]
    };
  }

  function openApprovalDoc(tc: AiAgentToolCall) {
    const doc = buildApprovalDoc(tc);
    if (!doc) return;
    const id = tc.id;
    setAiApprovalDoc({ id, sessionId: session?.id ?? ai.activeSessionId ?? '', toolCall: tc, ...doc });
    void manuscript.openTab({
      id: `tab-ai-approval-${id}`,
      type: 'ai-approval',
      refId: id,
      title: doc.title
    });
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="AI Agent">
    {#snippet actions()}
      <div class="relative">
        <button
          type="button"
          onclick={() => (sessionMenuOpen = !sessionMenuOpen)}
          title="Switch AI session"
          class="flex max-w-32 items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Bot class="size-3" />
          <span class="truncate">{session?.title ?? 'Sessions'}</span>
          <ChevronDown class="size-3" />
        </button>
        {#if sessionMenuOpen}
          <button
            type="button"
            aria-label="Close session menu"
            class="fixed inset-0 z-10 cursor-default bg-transparent"
            onclick={() => (sessionMenuOpen = false)}
          ></button>
          <div class="absolute right-0 top-7 z-20 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
            <div class="flex items-center justify-between border-b border-border px-2 py-1.5">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AI Sessions</span>
              <button
                type="button"
                onclick={createSession}
                class="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground hover:bg-accent/90"
              >
                <Plus class="size-3" /> New
              </button>
            </div>
            <div class="max-h-72 overflow-y-auto p-1">
              {#if ai.sessions.length === 0}
                <div class="px-2 py-3 text-center text-[11px] text-muted-foreground">No sessions yet.</div>
              {:else}
                {#each ai.sessions as s (s.id)}
                  <button
                    type="button"
                    onclick={() => selectSession(s.id)}
                    class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <span class="min-w-0">
                      <span class="block truncate text-[11px] text-foreground">{s.title}</span>
                      <span class="block truncate text-[10px] text-muted-foreground">
                        {s.messageCount} messages · {sessionTime(s.updatedAt)} · {s.status}
                      </span>
                    </span>
                    {#if s.id === ai.activeSessionId}
                      <span class="size-1.5 shrink-0 rounded-full bg-accent"></span>
                    {/if}
                  </button>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      </div>
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
              {#if msg.content || msg.id !== activeAssistantMessage?.id || !isRunning}
                <div class="flex gap-2 px-3 py-2">
                  <Bot class="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <div class="min-w-0 flex-1 text-xs text-foreground/90 whitespace-pre-wrap">
                    {msg.content}
                    {#if isRunning && msg.id === activeAssistantMessage?.id}
                      <span class="inline-block w-1.5 h-3.5 bg-accent/60 animate-pulse rounded-sm"></span>
                    {/if}
                  </div>
                </div>
              {/if}
            {:else if msg.role === 'system'}
              <div class="px-3 py-1 text-[10px] italic text-muted-foreground">
                {msg.content}
              </div>
            {/if}
          {/each}

          {#if showThinking}
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
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 text-xs">
                      <Zap class="size-3.5 text-amber-400" />
                      <span class="font-medium text-amber-300">{toolLabel(tc.toolName)}</span>
                      <span class="text-[10px] text-muted-foreground">requires approval</span>
                    </div>
                    <p class="mt-1 truncate text-[11px] text-muted-foreground">{toolSummary(tc)}</p>
                  </div>
                  <button
                    type="button"
                    onclick={() => openApprovalDoc(tc)}
                    class="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/30 bg-background/70 px-2 py-1 text-[10px] text-amber-200 hover:bg-amber-500/10"
                  >
                    <FileText class="size-3" /> Open diff
                  </button>
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
