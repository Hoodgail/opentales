<script lang="ts">
  import {
    ArrowLeft,
    ArrowUp,
    AtSign,
    BookOpenText,
    CircleStop,
    Feather,
    GitBranch,
    Hand,
    Loader2,
    Paperclip,
    Plus,
    RotateCw,
    Settings2,
    ShieldCheck,
    Sparkles,
    X,
    Zap,
  } from "lucide-svelte";
  import { tick, untrack } from "svelte";
  import type {
    AiAgentApprovalMode,
    AiAgentPermissionRequest,
    AiAgentProjectReference,
    AiAgentPromptAttachmentInput,
  } from "@opentales/sdk";
  import { buildApprovalDoc } from "$lib/ai-approval";
  import {
    extractLineRange,
    projectReferenceSuggestions,
    type AutocompleteItem,
  } from "$lib/ai-mentions";
  import { deleteAiApprovalDoc, setAiApprovalDoc } from "$lib/data/ai-approval-docs";
  import { agent } from "$lib/stores/agent.svelte";
  import { ai } from "$lib/stores/ai.svelte";
  import { manuscript } from "$lib/stores/manuscript.svelte";
  import { cn } from "$lib/utils";
  import AgentApprovalSlip from "./agent/AgentApprovalSlip.svelte";
  import AgentQuestionCard from "./agent/AgentQuestionCard.svelte";
  import AgentTranscript from "./agent/AgentTranscript.svelte";
  import AiSessionMenu from "./AiSessionMenu.svelte";

  const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

  let prompt = $state("");
  let scrollEl: HTMLDivElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let fileInputEl: HTMLInputElement | undefined = $state();
  let attachments = $state<AiAgentPromptAttachmentInput[]>([]);
  let references = $state<Array<AiAgentProjectReference & { key: string }>>([]);
  let pinned = $state(true);
  let autoConfirm = $state(false);
  let modelDraft = $state<string | null>(null);
  let autocompleteOpen = $state(false);
  let autocompleteQuery = $state("");
  let autocompleteStart = $state(0);
  let autocompleteIndex = $state(0);

  const projectId = $derived(manuscript.projectId);
  const aiEnabled = $derived(ai.settings?.enabled ?? false);
  const root = $derived(agent.activeSession);
  const viewed = $derived(agent.viewedSession);
  const inChild = $derived(agent.viewStack.length > 0);
  const running = $derived(viewed?.status === "running" || viewed?.status === "retrying");
  const rootRunning = $derived(root?.status === "running" || root?.status === "retrying");
  const mode = $derived<AiAgentApprovalMode>(root?.approvalMode ?? "manual");
  const caps = $derived(agent.capabilities);
  const primaryAgents = $derived(caps?.agents.filter((a) => a.mode !== "subagent") ?? []);
  const subagents = $derived(caps?.agents.filter((a) => a.mode !== "primary") ?? []);
  const currentAgent = $derived(root?.agent ?? caps?.defaultAgent ?? "writer");
  const currentModel = $derived(root?.model?.model ?? caps?.model ?? ai.settings?.model ?? "");
  const permissions = $derived(root?.permissions ?? []);
  const questions = $derived(root?.questions ?? []);
  const retry = $derived(viewed ? agent.retryFor(viewed.id) : null);
  const totalTokens = $derived(
    root ? root.tokens.input + root.tokens.output + root.tokens.reasoning : 0,
  );
  const autocompleteItems = $derived(
    autocompleteOpen ? projectReferenceSuggestions(autocompleteQuery, projectId) : [],
  );
  const canSend = $derived(Boolean(prompt.trim()) && !agent.sending && !inChild);
  const transcriptRevision = $derived(
    viewed
      ? `${viewed.id}:${viewed.messages.length}:${viewed.messages.at(-1)?.role === "assistant" ? JSON.stringify((viewed.messages.at(-1) as { parts: unknown[] }).parts).length : 0}:${permissions.length}:${questions.length}`
      : "",
  );

  // ── lifecycle ─────────────────────────────────────────────────────────
  $effect(() => {
    ai.setProjectContext(projectId);
  });

  $effect(() => {
    const pid = projectId;
    if (!pid) return;
    void ai.loadSettings(pid);
  });

  $effect(() => {
    const pid = projectId;
    if (!pid || !aiEnabled) return;
    untrack(() => {
      void agent.initialize(pid);
      void ai.loadFileTree(pid);
    });
    return () => agent.stopStream();
  });

  $effect(() => {
    const _ = transcriptRevision;
    if (!pinned) return;
    void tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  // Refresh the manuscript when the agent finishes changing project data.
  let wasRunning = false;
  $effect(() => {
    const now = rootRunning;
    if (wasRunning && !now && projectId && root?.approvalMode) {
      void manuscript.refreshProject(projectId);
      void ai.loadFileTree(projectId);
    }
    wasRunning = now;
  });

  function onScroll() {
    if (!scrollEl) return;
    pinned = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 56;
  }

  function pin() {
    pinned = true;
    void tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  // ── actions ───────────────────────────────────────────────────────────
  async function send(delivery: "steer" | "queue" = rootRunning ? "queue" : "steer") {
    if (!canSend) return;
    const text = prompt.trim();
    const payload = {
      text,
      delivery,
      attachments: attachments.length ? attachments : undefined,
      references: references.length
        ? references.map(({ key: _key, ...ref }) => ref)
        : undefined,
    };
    prompt = "";
    const sentAttachments = attachments;
    const sentReferences = references;
    attachments = [];
    references = [];
    pin();
    const ok = await agent.send(payload);
    if (!ok) {
      prompt = text;
      attachments = sentAttachments;
      references = sentReferences;
    }
  }

  async function newSession() {
    const created = await agent.createSession({ approvalMode: mode });
    if (created) {
      pin();
      await tick();
      textareaEl?.focus();
    }
  }

  async function setMode(next: AiAgentApprovalMode) {
    if (!root || next === mode) return;
    if (next === "auto" && !autoConfirm) {
      autoConfirm = true;
      return;
    }
    autoConfirm = false;
    await agent.updateSession(root.id, { approvalMode: next });
  }

  async function setAgent(id: string) {
    if (!root) {
      await agent.createSession({ agent: id, approvalMode: mode });
      return;
    }
    await agent.updateSession(root.id, { agent: id });
  }

  async function commitModel() {
    const next = modelDraft?.trim();
    modelDraft = null;
    if (!root || !next || next === currentModel) return;
    await agent.updateSession(root.id, { model: next });
  }

  function reviewDiff(request: AiAgentPermissionRequest) {
    const doc = buildApprovalDoc(request);
    const fallback = {
      targetLabel: request.toolName,
      title: `AI: ${request.toolName}`,
      panes: [
        {
          id: "raw",
          title: "Proposed input",
          description: "Tool payload",
          original: "",
          modified: JSON.stringify(request.toolInput, null, 2),
          language: "json",
        },
      ],
    };
    const built = doc ?? fallback;
    setAiApprovalDoc({ id: request.id, sessionId: request.sessionId, request, ...built });
    void manuscript.openTab({
      id: `tab-ai-approval-${request.id}`,
      type: "ai-approval",
      refId: request.id,
      title: built.title,
    });
  }

  async function decide(request: AiAgentPermissionRequest, decision: "once" | "always" | "reject") {
    const ok = await agent.replyPermission(request, decision);
    if (!ok) return;
    deleteAiApprovalDoc(request.id);
    await manuscript.closeTab(`tab-ai-approval-${request.id}`);
  }

  async function approveAll() {
    for (const request of [...permissions]) await decide(request, "once");
  }

  // ── composer: keyboard, mentions, attachments ─────────────────────────
  function handleKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (autocompleteOpen && autocompleteItems.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        autocompleteIndex = Math.min(autocompleteIndex + 1, autocompleteItems.length - 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(autocompleteItems[autocompleteIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeAutocomplete();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(event.altKey ? "queue" : rootRunning ? "queue" : "steer");
    }
    if (event.key === "Escape" && rootRunning) void agent.interrupt();
  }

  function updateAutocomplete() {
    if (!textareaEl) return;
    const cursor = textareaEl.selectionStart ?? prompt.length;
    const before = prompt.slice(0, cursor);
    const at = before.lastIndexOf("@");
    const query = at === -1 ? "" : before.slice(at + 1);
    const boundary = at <= 0 || /\s/.test(prompt[at - 1] ?? "");
    if (at !== -1 && boundary && !/\s/.test(query)) {
      autocompleteOpen = true;
      autocompleteStart = at;
      autocompleteQuery = query;
      autocompleteIndex = 0;
    } else closeAutocomplete();
  }

  function closeAutocomplete() {
    autocompleteOpen = false;
    autocompleteQuery = "";
    autocompleteIndex = 0;
  }

  function insertMention(item: AutocompleteItem) {
    if (!textareaEl) return;
    const range = extractLineRange(autocompleteQuery);
    const cursor = textareaEl.selectionStart ?? prompt.length;
    const mention = `@${item.label}${range.suffix} `;
    prompt = `${prompt.slice(0, autocompleteStart)}${mention}${prompt.slice(cursor)}`;
    const key = `${item.type}:${item.id}:${range.suffix}`;
    if (!references.some((ref) => ref.key === key)) {
      references = [
        ...references,
        {
          key,
          type: item.type,
          id: item.id,
          path: item.path,
          label: `${item.label}${range.suffix}`,
          startLine: range.startLine,
          endLine: range.endLine,
        },
      ];
    }
    const next = autocompleteStart + mention.length;
    closeAutocomplete();
    void tick().then(() => {
      textareaEl?.focus();
      textareaEl?.setSelectionRange(next, next);
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        agent.clearError();
        continue;
      }
      const base64 = await fileToBase64(file);
      attachments = [
        ...attachments,
        { name: file.name, mimeType: file.type || "application/octet-stream", base64 },
      ];
    }
    if (fileInputEl) fileInputEl.value = "";
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function formatTokens(value: number) {
    return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard" }).format(value);
  }

  function statusWord(): string {
    if (!viewed) return "Ready";
    if (viewed.status === "retrying") return retry ? `Retrying · attempt ${retry.attempt}` : "Retrying";
    if (viewed.status === "running") return inChild ? "Subagent working" : "Writing";
    if (viewed.status === "error") return "Stopped with an error";
    return "Ready";
  }

  const hasChapters = $derived(manuscript.chapters.length > 0);
  const hasNotes = $derived(ai.fileTree.docs.length > 0);
  const starters = $derived(
    hasChapters
      ? [
          { icon: BookOpenText, text: "Keep going." },
          { icon: Feather, text: "Draft the next chapter from its brief." },
          { icon: GitBranch, text: "Run a continuity check across the drafted chapters and fix what you find." },
        ]
      : hasNotes
        ? [
            { icon: BookOpenText, text: "Read my notes and begin planning out the story." },
            { icon: Feather, text: "Build the cast and the world from my notes." },
            { icon: GitBranch, text: "Critique my idea honestly, then propose a stronger version." },
          ]
        : [
            { icon: BookOpenText, text: "Help me find the idea for my novel — ask me a few questions first." },
            { icon: Feather, text: "I have an idea: " },
            { icon: GitBranch, text: "Set up a Story Bible for a new novel." },
          ],
  );
</script>

<div class="agent-panel relative flex h-full flex-col overflow-hidden">
  <!-- Header -->
  <header class="relative z-10 flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-sidebar/95 px-2.5 backdrop-blur">
    {#if inChild}
      <button
        type="button"
        onclick={() => agent.closeChild()}
        class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Back to parent session"
      >
        <ArrowLeft class="size-3.5" /> back
      </button>
      <span class="min-w-0 truncate font-mono text-[10px] text-accent">
        <GitBranch class="mb-0.5 mr-1 inline size-3" />{viewed?.agent ?? "subagent"} · {viewed?.title}
      </span>
    {:else}
      <span class="agent-mark" aria-hidden="true"><Feather class="size-3.5" /></span>
      <AiSessionMenu
        title={root?.title ?? "Agent"}
        sessions={agent.rootSessions}
        activeSessionId={agent.activeSessionId}
        loading={agent.loading}
        onCreate={newSession}
        onSelect={(id) => { pin(); return agent.openSession(id); }}
      />
    {/if}
    <span class="flex-1"></span>
    <span
      class={cn(
        "size-1.5 rounded-full",
        agent.streamStatus === "connected" ? "bg-emerald-400" : agent.streamStatus === "disconnected" ? "bg-muted-foreground" : "agent-pulse bg-amber-400",
      )}
      title={`Live connection: ${agent.streamStatus}`}
    ></span>
    <button
      type="button"
      onclick={newSession}
      class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="New session"
      title="New session"
    >
      <Plus class="size-3.5" />
    </button>
    <button
      type="button"
      onclick={() => void manuscript.setActiveView("settings")}
      class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="AI settings"
      title="AI settings"
    >
      <Settings2 class="size-3.5" />
    </button>
  </header>

  {#if !aiEnabled}
    <div class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div class="agent-seal"><Sparkles class="size-5" /></div>
      <div>
        <p class="font-serif text-lg text-foreground">The agent is resting.</p>
        <p class="mt-1 text-[11.5px] text-muted-foreground">Enable AI for this project and choose a model to start writing with an agent.</p>
      </div>
      <button
        type="button"
        onclick={() => void manuscript.setActiveView("settings")}
        class="rounded-md border border-accent/40 px-3 py-1.5 text-[11px] text-accent hover:bg-accent/10"
      >
        Open AI settings
      </button>
    </div>
  {:else}
    <!-- Transcript -->
    <div bind:this={scrollEl} onscroll={onScroll} class="agent-paper relative flex-1 overflow-y-auto">
      {#if viewed && viewed.messages.length}
        <AgentTranscript
          session={viewed}
          {running}
          onOpenChild={(id) => { pin(); void agent.openChild(id); }}
          onLoadEarlier={() => viewed && agent.loadEarlier(viewed.id)}
        />
      {:else if agent.loading}
        <div class="flex h-full items-center justify-center">
          <Loader2 class="size-4 motion-safe:animate-spin text-muted-foreground" />
        </div>
      {:else}
        <div class="flex min-h-full flex-col justify-end gap-5 px-4 pb-6 pt-10">
          <div>
            <p class="font-mono text-[9.5px] uppercase tracking-[0.2em] text-accent">OpenCode · {currentAgent}</p>
            <h2 class="mt-2 font-serif text-[22px] leading-[1.15] text-foreground">
              What shall we<br /><em class="text-accent">write</em> today?
            </h2>
            <p class="mt-2 max-w-[28ch] text-[11.5px] leading-relaxed text-muted-foreground">
              The agent plans and writes inside your project — a Story Bible, characters, places, chapters and scenes — and keeps a Ledger so it can pick up where it left off.
            </p>
          </div>
          <ul class="space-y-1.5">
            {#each starters as starter, i (starter.text)}
              <li style={`animation-delay:${80 + i * 70}ms`} class="agent-rise">
                <button
                  type="button"
                  onclick={() => { prompt = starter.text; void tick().then(() => textareaEl?.focus()); }}
                  class="group flex w-full items-start gap-2.5 rounded-lg border border-border/80 bg-card/40 px-3 py-2 text-left text-[11.5px] leading-snug text-foreground/85 transition-colors hover:border-accent/40 hover:bg-card"
                >
                  <starter.icon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-accent" />
                  {starter.text}
                </button>
              </li>
            {/each}
          </ul>
          {#if caps}
            <p class="font-mono text-[9.5px] text-muted-foreground/70">
              {caps.tools.length} tools · {caps.skills.length} skills · {subagents.length} subagents
            </p>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Interrupts: approvals and questions -->
    {#if !inChild && (permissions.length || questions.length)}
      <div class="agent-interrupts max-h-[45%] shrink-0 space-y-2 overflow-y-auto border-t border-amber-400/20 bg-sidebar/80 p-2.5">
        {#if permissions.length > 1}
          <div class="flex items-center justify-between px-0.5">
            <p class="font-mono text-[9.5px] uppercase tracking-[0.14em] text-amber-300/90">{permissions.length} changes awaiting you</p>
            <button type="button" onclick={approveAll} class="font-mono text-[10px] text-emerald-400 hover:underline">approve all</button>
          </div>
        {/if}
        {#each questions as question (question.id)}
          <AgentQuestionCard
            {question}
            busy={Boolean(agent.pendingActions[question.id])}
            error={agent.actionErrors[question.id]}
            onSubmit={(answers) => void agent.answerQuestion(question, answers)}
            onDismiss={() => void agent.dismissQuestion(question)}
          />
        {/each}
        {#each permissions as request (request.id)}
          <AgentApprovalSlip
            {request}
            busy={agent.pendingActions[request.id]}
            error={agent.actionErrors[request.id]}
            fromSubagent={request.sessionId !== root?.id}
            onReview={() => reviewDiff(request)}
            onApprove={() => void decide(request, "once")}
            onAlways={() => void decide(request, "always")}
            onReject={() => void decide(request, "reject")}
          />
        {/each}
      </div>
    {/if}

    <!-- Status / errors -->
    {#if agent.error || viewed?.error}
      <div role="alert" class="flex shrink-0 items-start gap-2 border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
        <span class="flex-1">{agent.error ?? viewed?.error}</span>
        {#if agent.streamStatus === "disconnected" && projectId}
          <button type="button" onclick={() => agent.retryStream()} class="inline-flex items-center gap-1 rounded border border-destructive/30 px-1.5 py-0.5 text-[10px] hover:bg-destructive/10">
            <RotateCw class="size-3" /> Reconnect
          </button>
        {/if}
        <button type="button" onclick={() => agent.clearError()} aria-label="Dismiss" class="opacity-70 hover:opacity-100"><X class="size-3" /></button>
      </div>
    {/if}

    <!-- Composer -->
    {#if !inChild}
      <div class="relative shrink-0 border-t border-border bg-sidebar/90 p-2">
        <div class="mb-1.5 flex items-center gap-2 px-1 font-mono text-[9.5px] text-muted-foreground">
          <span class={cn("inline-flex items-center gap-1", running && "text-accent")}>
            {#if running}<span class="agent-pulse size-1.5 rounded-full bg-accent"></span>{/if}
            {statusWord()}
          </span>
          <span class="flex-1"></span>
          {#if root && totalTokens > 0}
            <span title="Tokens used in this session">{formatTokens(totalTokens)} tok</span>
            {#if root.cost > 0}<span>· ${root.cost.toFixed(root.cost < 1 ? 3 : 2)}</span>{/if}
          {/if}
        </div>

        {#if autoConfirm}
          <div class="agent-rise mb-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5 text-[11px] text-amber-100">
            <p class="font-medium text-amber-200">Switch this session to Auto?</p>
            <p class="mt-0.5 text-amber-100/80">The agent will change chapters, characters, and docs without asking. Capability and permission checks still apply.</p>
            <div class="mt-2 flex justify-end gap-1.5">
              <button type="button" onclick={() => (autoConfirm = false)} class="rounded px-2 py-0.5 text-amber-100/80 hover:bg-amber-400/10">Cancel</button>
              <button type="button" onclick={() => void setMode("auto")} class="rounded bg-amber-400 px-2 py-0.5 font-medium text-black hover:bg-amber-300">Enable Auto</button>
            </div>
          </div>
        {/if}

        <div class="agent-composer rounded-xl border border-border bg-background/95 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] focus-within:border-accent/60">
          <div class="flex items-center gap-1.5 border-b border-border/60 px-2 py-1">
            {#if primaryAgents.length > 1}
              <select
                value={currentAgent}
                onchange={(e) => void setAgent((e.currentTarget as HTMLSelectElement).value)}
                disabled={rootRunning}
                aria-label="Agent"
                class="agent-select max-w-[8rem] shrink-0"
              >
                {#each primaryAgents as a (a.id)}
                  <option value={a.id}>{a.name}</option>
                {/each}
              </select>
            {/if}

            <input
              value={modelDraft ?? currentModel}
              oninput={(e) => (modelDraft = (e.currentTarget as HTMLInputElement).value)}
              onblur={() => void commitModel()}
              onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
              disabled={rootRunning || !root}
              aria-label="Model"
              title="Model (press Enter to switch)"
              class="agent-select min-w-0 flex-1 truncate border-transparent hover:border-border"
            />

          </div>
          {#if references.length || attachments.length}
            <div class="flex flex-wrap gap-1 border-b border-border/70 px-2 py-1.5">
              {#each references as ref (ref.key)}
                <button type="button" onclick={() => (references = references.filter((r) => r.key !== ref.key))} class="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:bg-accent/20" title="Remove reference">
                  <AtSign class="size-2.5" />{ref.label}<X class="size-2.5 opacity-60" />
                </button>
              {/each}
              {#each attachments as file, i (file.name + i)}
                <button type="button" onclick={() => (attachments = attachments.filter((_, idx) => idx !== i))} class="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 hover:bg-muted/70" title="Remove attachment">
                  <Paperclip class="size-2.5" />{file.name}<X class="size-2.5 opacity-60" />
                </button>
              {/each}
            </div>
          {/if}

          <div class="relative">
            <textarea
              bind:this={textareaEl}
              bind:value={prompt}
              oninput={updateAutocomplete}
              onclick={updateAutocomplete}
              onkeydown={handleKey}
              rows="3"
              placeholder={rootRunning ? "Steer the agent, or ⌥↵ to queue…" : "Ask the agent to plan, draft, or revise…  @ to reference"}
              aria-label="Message the agent"
              class="block max-h-60 min-h-[4.5rem] w-full resize-none bg-transparent px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            ></textarea>

            {#if autocompleteOpen && autocompleteItems.length}
              <ul role="listbox" class="absolute bottom-full left-2 right-2 z-20 mb-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
                {#each autocompleteItems as item, index (item.type + item.id)}
                  <li role="option" aria-selected={index === autocompleteIndex}>
                    <button
                      type="button"
                      onmousedown={(e) => { e.preventDefault(); insertMention(item); }}
                      class={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left", index === autocompleteIndex ? "bg-accent/15 text-foreground" : "text-foreground/80 hover:bg-muted")}
                    >
                      <span class="min-w-0 flex-1 truncate font-mono text-[11px]">{item.label}</span>
                      <span class="shrink-0 text-[9.5px] text-muted-foreground">{item.detail}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <div class="flex items-center gap-1 px-1.5 pb-1.5">
            <input bind:this={fileInputEl} type="file" multiple class="hidden" onchange={(e) => void handleFiles((e.currentTarget as HTMLInputElement).files)} />
            <button type="button" onclick={() => fileInputEl?.click()} class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Attach files" title="Attach files">
              <Paperclip class="size-3.5" />
            </button>

            <span class="flex-1"></span>
            <div class="flex shrink-0 overflow-hidden rounded-md border border-border" role="group" aria-label="Execution mode">
              <button
                type="button"
                onclick={() => void setMode("manual")}
                disabled={!root || rootRunning}
                aria-pressed={mode === "manual"}
                title="Manual: review every change"
                class={cn("inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]", mode === "manual" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <Hand class="size-3" /> Manual
              </button>
              <button
                type="button"
                onclick={() => void setMode("auto")}
                disabled={!root || rootRunning}
                aria-pressed={mode === "auto"}
                title="Auto: apply changes immediately (admins)"
                class={cn("inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]", mode === "auto" ? "bg-amber-400/20 text-amber-300" : "text-muted-foreground hover:text-foreground")}
              >
                {#if mode === "auto"}<Zap class="size-3" />{:else}<ShieldCheck class="size-3" />{/if} Auto
              </button>
            </div>

            {#if rootRunning && !prompt.trim()}
              <button type="button" onclick={() => void agent.interrupt()} class="agent-send bg-destructive/90 text-white hover:bg-destructive" aria-label="Stop the agent" title="Stop (Esc)">
                <CircleStop class="size-3.5" />
              </button>
            {:else}
              <button type="button" onclick={() => void send()} disabled={!canSend} class="agent-send bg-accent text-accent-foreground hover:brightness-110 disabled:opacity-30" aria-label="Send" title={rootRunning ? "Steer (↵) · Queue (⌥↵)" : "Send (↵)"}>
                {#if agent.sending}<Loader2 class="size-3.5 motion-safe:animate-spin" />{:else}<ArrowUp class="size-3.5" />{/if}
              </button>
            {/if}
          </div>
        </div>
      </div>
    {:else if viewed}
      <div class="shrink-0 border-t border-border bg-sidebar/90 px-3 py-2 font-mono text-[10px] text-muted-foreground">
        Read-only view of a subagent session. {#if running}<button type="button" onclick={() => void agent.interrupt(viewed.id)} class="ml-1 text-destructive hover:underline">stop it</button>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .agent-panel {
    background:
      radial-gradient(120% 60% at 100% 0%, color-mix(in oklch, var(--accent) 7%, transparent), transparent 60%),
      var(--background);
  }
  .agent-paper {
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 27px,
      color-mix(in oklch, var(--foreground) 2.2%, transparent) 27px,
      color-mix(in oklch, var(--foreground) 2.2%, transparent) 28px
    );
  }
  .agent-mark {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: var(--accent);
    background: color-mix(in oklch, var(--accent) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 30%, transparent);
  }
  .agent-seal {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 999px;
    color: var(--accent);
    background: radial-gradient(circle at 35% 30%, color-mix(in oklch, var(--accent) 35%, transparent), color-mix(in oklch, var(--accent) 8%, transparent) 70%);
    box-shadow: 0 0 0 1px color-mix(in oklch, var(--accent) 35%, transparent), 0 10px 30px -10px color-mix(in oklch, var(--accent) 60%, transparent);
  }
  .agent-select {
    height: 22px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: transparent;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--muted-foreground);
  }
  .agent-select:focus {
    outline: none;
    border-color: color-mix(in oklch, var(--accent) 60%, transparent);
    color: var(--foreground);
  }
  .agent-send {
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    transition: filter 120ms, transform 120ms;
  }
  .agent-send:not(:disabled):active {
    transform: scale(0.94);
  }
  :global(.agent-prose) {
    font-family: var(--font-serif);
    font-size: 13.5px;
    line-height: 1.62;
    color: color-mix(in oklch, var(--foreground) 92%, transparent);
  }
  :global(.agent-prose code),
  :global(.agent-prose pre) {
    font-family: var(--font-mono);
    font-size: 11px;
  }
  :global(.agent-label) {
    margin-bottom: 2px;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: color-mix(in oklch, var(--muted-foreground) 80%, transparent);
  }
  :global(.agent-code) {
    max-height: 14rem;
    overflow: auto;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: color-mix(in oklch, var(--card) 70%, transparent);
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    color: color-mix(in oklch, var(--foreground) 80%, transparent);
  }
  :global(.agent-rise) {
    animation: agent-rise 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  :global(.agent-pulse) {
    animation: agent-pulse 1.4s ease-in-out infinite;
  }
  :global(.agent-quill) {
    display: inline-flex;
    animation: agent-quill 1.1s ease-in-out infinite;
  }
  :global(.agent-ink-line) {
    height: 1px;
    width: 64px;
    background: linear-gradient(90deg, var(--accent), transparent);
    transform-origin: left;
    animation: agent-ink 1.6s ease-in-out infinite;
  }
  @keyframes agent-rise {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
  }
  @keyframes agent-pulse {
    50% { opacity: 0.35; }
  }
  @keyframes agent-quill {
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    50% { transform: translate(3px, -1px) rotate(-8deg); }
  }
  @keyframes agent-ink {
    0% { transform: scaleX(0.1); opacity: 0.2; }
    60% { transform: scaleX(1); opacity: 1; }
    100% { transform: scaleX(1); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.agent-rise), :global(.agent-pulse), :global(.agent-quill), :global(.agent-ink-line) {
      animation: none;
    }
  }
</style>
