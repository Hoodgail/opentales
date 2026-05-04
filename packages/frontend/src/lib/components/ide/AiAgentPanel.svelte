<script lang="ts">
  import {
    Bot,
    Check,
    ChevronDown,
    ChevronRight,
    CircleStop,
    FileText,
    Paperclip,
    Plus,
    Send,
    Sparkles,
    X,
    Zap,
  } from "lucide-svelte";
  import { tick, untrack } from "svelte";
  import type {
    AiAgentAttachmentInput,
    AiAgentMessage,
    AiAgentProjectReferenceType,
    AiAgentToolCall,
    AssetKind,
  } from "@opentales/sdk";
  import {
    deleteAiApprovalDoc,
    setAiApprovalDoc,
  } from "$lib/data/ai-approval-docs";
  import { ai } from "$lib/stores/ai.svelte";
  import { manuscript } from "$lib/stores/manuscript.svelte";
  import AiAgentMessages from "./AiAgentMessages.svelte";
  import AiAgentQuestions from "./AiAgentQuestions.svelte";
  import PanelHeader from "./PanelHeader.svelte";

  let prompt = $state("");
  let scrollEl: HTMLDivElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let fileInputEl: HTMLInputElement | undefined = $state();
  let sessionMenuOpen = $state(false);
  let selectedModel = $state("");
  let attachments = $state<AiAgentAttachmentInput[]>([]);
  let uploadingAttachment = $state(false);
  let autocompleteOpen = $state(false);
  let autocompleteQuery = $state("");
  let autocompleteStart = $state(0);
  let selectedAutocompleteIndex = $state(0);

  const projectId = $derived(manuscript.projectId);
  const session = $derived(ai.session);
  const isRunning = $derived(session?.status === "running");
  const aiEnabled = $derived(ai.settings?.enabled ?? false);
  const modelOptions = $derived(modelChoices(ai.settings?.model));
  const activeModel = $derived(
    selectedModel || ai.settings?.model || modelOptions[0],
  );
  const activeAssistantMessage = $derived(
    session ? latestAssistantMessage(session.messages) : null,
  );
  const showThinking = $derived(isRunning && !activeAssistantMessage?.content);
  const pendingToolCalls = $derived(
    session?.pendingToolCalls?.filter(
      (tc) => tc.status === "pending-approval" && tc.toolName !== "askUser",
    ) ?? [],
  );
  const pendingQuestionCalls = $derived(
    session?.pendingToolCalls?.filter(
      (tc) => tc.status === "pending-approval" && tc.toolName === "askUser",
    ) ?? [],
  );
  const autocompleteItems = $derived(
    autocompleteOpen ? projectReferenceSuggestions(autocompleteQuery) : [],
  );

  // Auto-scroll on new content
  $effect(() => {
    const settingsModel = ai.settings?.model;
    if (settingsModel && !selectedModel) selectedModel = settingsModel;
  });

  $effect(() => {
    const _ = activeAssistantMessage?.content;
    const __ = session?.messages?.length;
    void tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  function latestAssistantMessage(
    messages: AiAgentMessage[],
  ): AiAgentMessage | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant") return messages[index];
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
      void ai.loadFileTree(pid);
      void ai.loadSkills(pid);
    });

    return () => ai.stopStream();
  });

  function send() {
    if (!projectId || !prompt.trim()) return;
    const queuedAttachments = [...attachments];
    void ai.queuePrompt(projectId, prompt.trim(), false, {
      model: activeModel,
      attachments: queuedAttachments,
    });
    prompt = "";
    attachments = [];
  }

  function interrupt() {
    if (!projectId || !prompt.trim()) return;
    const queuedAttachments = [...attachments];
    void ai.queuePrompt(projectId, prompt.trim(), true, {
      model: activeModel,
      attachments: queuedAttachments,
    });
    prompt = "";
    attachments = [];
  }

  function cancel() {
    if (!projectId) return;
    void ai.cancelSession(projectId);
  }

  function approve(toolCallId: string) {
    if (!projectId) return;
    const pid = projectId;
    void ai
      .approveToolCall(pid, toolCallId, true)
      .then(() => manuscript.refreshProject(pid));
  }

  function approveAll() {
    if (!projectId || pendingToolCalls.length === 0) return;
    const pid = projectId;
    const toolCallIds = pendingToolCalls.map((tc) => tc.id);
    void ai
      .approveToolCalls(pid, toolCallIds, true)
      .then(() => manuscript.refreshProject(pid))
      .then(() => {
        for (const toolCallId of toolCallIds) {
          deleteAiApprovalDoc(toolCallId);
          void manuscript.closeTab(`tab-ai-approval-${toolCallId}`);
        }
      });
  }

  function reject(toolCallId: string) {
    if (!projectId) return;
    void ai.approveToolCall(projectId, toolCallId, false);
  }

  function submitQuestion(tc: AiAgentToolCall, answers: string[][]) {
    if (!projectId) return;
    void ai.answerQuestion(projectId, tc.id, answers);
  }

  function handleKey(e: KeyboardEvent) {
    if (autocompleteOpen) {
      if (e.key === "ArrowDown" || (e.ctrlKey && e.key.toLowerCase() === "n")) {
        e.preventDefault();
        selectedAutocompleteIndex = Math.min(
          selectedAutocompleteIndex + 1,
          Math.max(autocompleteItems.length - 1, 0),
        );
        return;
      }
      if (e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "p")) {
        e.preventDefault();
        selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, 0);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const item = autocompleteItems[selectedAutocompleteIndex];
        if (item) {
          e.preventDefault();
          insertAutocompleteItem(item);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeAutocomplete();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function handlePromptInput(event: Event) {
    prompt = (event.currentTarget as HTMLTextAreaElement).value;
    updateAutocomplete();
  }

  function handlePromptClick() {
    updateAutocomplete();
  }

  function updateAutocomplete() {
    if (!textareaEl) return;
    const offset = textareaEl.selectionStart ?? prompt.length;
    const text = prompt.slice(0, offset);
    const idx = text.lastIndexOf("@");
    if (idx === -1) {
      closeAutocomplete();
      return;
    }
    const before = idx === 0 ? undefined : prompt[idx - 1];
    const between = text.slice(idx + 1);
    if ((before === undefined || /\s/.test(before)) && !/\s/.test(between)) {
      autocompleteStart = idx;
      autocompleteQuery = between;
      autocompleteOpen = true;
      selectedAutocompleteIndex = 0;
    } else {
      closeAutocomplete();
    }
  }

  function closeAutocomplete() {
    autocompleteOpen = false;
    autocompleteQuery = "";
    selectedAutocompleteIndex = 0;
  }

  async function handleFiles(files: FileList | null) {
    if (!projectId || !files?.length) return;
    uploadingAttachment = true;
    try {
      for (const file of Array.from(files)) {
        const uploaded = await ai.uploadAttachment(projectId, file, {
          kind: assetKindForFile(file),
          filename: file.name,
        });
        if (!uploaded) continue;
        attachments = [
          ...attachments,
          {
            id: uploaded.id,
            assetId: uploaded.id,
            name: file.name,
            mimeType: uploaded.mimeType,
            kind: uploaded.kind,
            sizeBytes: uploaded.sizeBytes,
            url: uploaded.url,
          },
        ];
      }
    } finally {
      uploadingAttachment = false;
      if (fileInputEl) fileInputEl.value = "";
    }
  }

  function removeAttachment(id: string) {
    attachments = attachments.filter((attachment) => attachment.id !== id);
  }

  type AutocompleteItem = {
    id: string;
    type: AiAgentProjectReferenceType;
    label: string;
    detail: string;
    path?: string;
    searchText: string;
    scoreBoost?: number;
  };

  function insertAutocompleteItem(item: AutocompleteItem) {
    if (!textareaEl) return;
    const lineRange = extractLineRange(autocompleteQuery);
    const cursor = textareaEl.selectionStart ?? prompt.length;
    const mention = `@${item.label}${lineRange.suffix} `;
    prompt = `${prompt.slice(0, autocompleteStart)}${mention}${prompt.slice(cursor)}`;
    const nextCursor = autocompleteStart + mention.length;
    const attachmentId = `reference:${item.type}:${item.id}:${lineRange.suffix}`;
    const existingIndex = attachments.findIndex(
      (attachment) => attachment.id === attachmentId,
    );
    const attachment: AiAgentAttachmentInput = {
      id: attachmentId,
      name: `${item.label}${lineRange.suffix}`,
      mimeType: "text/plain",
      kind: "document",
      sizeBytes: 0,
      reference: {
        type: item.type,
        id: item.id,
        path: item.path,
        startLine: lineRange.startLine,
        endLine: lineRange.endLine,
      },
    };
    attachments =
      existingIndex === -1
        ? [...attachments, attachment]
        : attachments.map((existing, index) =>
            index === existingIndex ? attachment : existing,
          );
    closeAutocomplete();
    void tick().then(() => {
      textareaEl?.focus();
      textareaEl?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function extractLineRange(query: string): {
    suffix: string;
    startLine?: number;
    endLine?: number;
  } {
    const hashIndex = query.lastIndexOf("#");
    if (hashIndex === -1) return { suffix: "" };
    const linePart = query.slice(hashIndex + 1);
    const match = linePart.match(/^(\d+)(?:-(\d*))?$/);
    if (!match) return { suffix: "" };
    const startLine = Number(match[1]);
    const parsedEnd = match[2] ? Number(match[2]) : undefined;
    const endLine = parsedEnd && startLine < parsedEnd ? parsedEnd : undefined;
    return {
      suffix: `#${startLine}${endLine ? `-${endLine}` : ""}`,
      startLine,
      endLine,
    };
  }

  function projectReferenceSuggestions(rawQuery: string): AutocompleteItem[] {
    const { baseQuery } = autocompleteQueryParts(rawQuery);
    const items: AutocompleteItem[] = [
      {
        id: projectId ?? "structure",
        type: "structure",
        label: "story-structure",
        detail: "Story structure",
        searchText: "story structure logline outline climax obstacles plot",
        scoreBoost: 3,
      },
      ...ai.fileTree.folders.map((folder) => ({
        id: folder.id,
        type: "folder" as const,
        label: folder.path,
        detail: "Folder",
        path: folder.path,
        searchText: `${folder.name} ${folder.path}`,
        scoreBoost: 2,
      })),
      ...ai.fileTree.docs.map((doc) => ({
        id: doc.id,
        type: "doc" as const,
        label: doc.path ?? doc.title,
        detail: `Doc · ${doc.kind}`,
        path: doc.path ?? doc.title,
        searchText: `${doc.title} ${doc.path ?? ""} ${doc.kind}`,
        scoreBoost: 4,
      })),
      ...ai.fileTree.assets.map((asset) => ({
        id: asset.id,
        type: "asset" as const,
        label: asset.path,
        detail: `Asset · ${asset.kind}`,
        path: asset.path,
        searchText: `${asset.name} ${asset.path} ${asset.kind} ${asset.mimeType}`,
        scoreBoost: 1,
      })),
      ...manuscript.chapters.map((chapter) => ({
        id: chapter.id,
        type: "chapter" as const,
        label: `chapters/${chapter.number}-${slugify(chapter.title)}`,
        detail: `Chapter ${chapter.number}`,
        searchText: `${chapter.title} chapter ${chapter.number} ${chapter.summary}`,
        scoreBoost: 4,
      })),
      ...manuscript.characters.map((character) => ({
        id: character.id,
        type: "character" as const,
        label: `characters/${slugify(character.name)}`,
        detail: "Character",
        searchText: `${character.name} ${character.role} ${character.traits.join(" ")}`,
        scoreBoost: 3,
      })),
      ...manuscript.locations.map((location) => ({
        id: location.id,
        type: "location" as const,
        label: `locations/${slugify(location.name)}`,
        detail: "Location",
        searchText: `${location.name} ${location.type}`,
        scoreBoost: 3,
      })),
      ...manuscript.acts.map((act) => ({
        id: act.id,
        type: "act" as const,
        label: `acts/${slugify(act.title)}`,
        detail: "Act",
        searchText: `${act.title} act`,
        scoreBoost: 2,
      })),
      ...manuscript.structure.obstacles.map((obstacle) => ({
        id: obstacle.id,
        type: "obstacle" as const,
        label: `obstacles/${slugify(obstacle.title)}`,
        detail: `Obstacle · ${obstacle.type.toLowerCase()}`,
        searchText: `${obstacle.title} ${obstacle.type}`,
        scoreBoost: 2,
      })),
    ];
    return items
      .map((item) => ({ item, score: fuzzyScore(baseQuery, item) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const aDepth = a.item.label.split("/").length;
        const bDepth = b.item.label.split("/").length;
        if (aDepth !== bDepth) return aDepth - bDepth;
        return a.item.label.localeCompare(b.item.label);
      })
      .slice(0, 8)
      .map((entry) => entry.item);
  }

  function autocompleteQueryParts(query: string): { baseQuery: string } {
    const hashIndex = query.lastIndexOf("#");
    if (hashIndex === -1) return { baseQuery: query };
    const linePart = query.slice(hashIndex + 1);
    return /^\d*(?:-\d*)?$/.test(linePart)
      ? { baseQuery: query.slice(0, hashIndex) }
      : { baseQuery: query };
  }

  function fuzzyScore(query: string, item: AutocompleteItem): number {
    const q = query.trim().toLowerCase();
    if (!q) return item.scoreBoost ?? 1;
    const haystack = `${item.label} ${item.searchText}`.toLowerCase();
    if (/[*?]/.test(q)) return globMatches(q, haystack) ? 200 + (item.scoreBoost ?? 0) : 0;
    if (haystack.includes(q)) return 100 + q.length + (item.scoreBoost ?? 0);
    let score = item.scoreBoost ?? 0;
    let cursor = 0;
    for (const char of q) {
      const found = haystack.indexOf(char, cursor);
      if (found === -1) return 0;
      score += found === cursor ? 6 : 2;
      cursor = found + 1;
    }
    return score;
  }

  function globMatches(pattern: string, value: string): boolean {
    const source = pattern
      .split("")
      .map((char) => {
        if (char === "*") return ".*";
        if (char === "?") return ".";
        return char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
      })
      .join("");
    return new RegExp(source).test(value);
  }

  function slugify(value: string): string {
    return (
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "untitled"
    );
  }

  function assetKindForFile(file: File): AssetKind {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("audio/")) return "audio";
    if (file.type.startsWith("video/")) return "video";
    return "document";
  }

  function modelChoices(settingsModel: string | undefined): string[] {
    const defaults = [
      "openai/gpt-5.4",
      "openai/gpt-5-mini",
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4.5",
      "google/gemini-3-pro-preview",
    ];
    return [
      ...new Set(
        [settingsModel, ...defaults].filter((value): value is string =>
          Boolean(value),
        ),
      ),
    ];
  }

  function formatUsage(value: number): string {
    return new Intl.NumberFormat(undefined, {
      notation: value >= 10_000 ? "compact" : "standard",
    }).format(value);
  }

  function createSession() {
    if (!projectId) return;
    void ai.createSession(projectId, "New chat");
    sessionMenuOpen = false;
  }

  function selectSession(sessionId: string) {
    if (!projectId) return;
    void ai.selectSession(projectId, sessionId);
    sessionMenuOpen = false;
  }

  function sessionTime(value: string): string {
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  // Collapsible tool call rows
  let expandedTools = $state<Record<string, boolean>>({});

  function toggleTool(id: string) {
    expandedTools[id] = !expandedTools[id];
  }

  function toolLabel(name: string): string {
    const map: Record<string, string> = {
      listCharacters: "Listed characters",
      readCharacter: "Read character",
      listChapters: "Listed chapters",
      readChapter: "Read chapter",
      grepChapter: "Searched chapter",
      grepChapters: "Searched chapters",
      listLocations: "Listed locations",
      readLocation: "Read location",
      listProjectDocs: "Listed docs",
      readProjectDoc: "Read doc",
      readStoryStructure: "Read story structure",
      updateProject: "Update project",
      updateProjectAiSettings: "Update AI settings",
      askUser: "Ask user",
      createAct: "Create act",
      updateAct: "Update act",
      deleteAct: "Delete act",
      updateCharacter: "Update character",
      createCharacter: "Create character",
      deleteCharacter: "Delete character",
      createCharacterRelationship: "Create relationship",
      deleteCharacterRelationship: "Delete relationship",
      createLocation: "Create location",
      updateLocation: "Update location",
      deleteLocation: "Delete location",
      updateChapter: "Update chapter",
      createChapter: "Create chapter",
      deleteChapter: "Delete chapter",
      restoreTrashChapter: "Restore chapter",
      purgeTrashChapter: "Purge chapter",
      createScene: "Create scene",
      updateScene: "Update scene",
      deleteScene: "Delete scene",
      updateStoryStructure: "Update structure",
      createObstacle: "Create obstacle",
      updateObstacle: "Update obstacle",
      deleteObstacle: "Delete obstacle",
      createProjectDoc: "Create doc",
      updateProjectDoc: "Update doc",
      deleteProjectDoc: "Delete doc",
      createSubmission: "Create submission",
      mergeSubmission: "Merge submission",
      declineSubmission: "Decline submission",
      commentSubmission: "Comment submission",
      uploadAsset: "Upload asset",
      attachAsset: "Attach asset",
      detachAsset: "Detach asset",
      updateMemberRole: "Update member role",
      removeMember: "Remove member",
      createInvite: "Create invite",
      revokeInvite: "Revoke invite",
      acceptInvite: "Accept invite",
      createBetaShareLink: "Create share link",
      updateBetaShareLink: "Update share link",
      revokeBetaShareLink: "Revoke share link",
      postBetaShareComment: "Post share comment",
    };
    return map[name] ?? name;
  }

  function toolForMessage(msg: AiAgentMessage): AiAgentToolCall | undefined {
    if (msg.role !== "tool" || !session?.toolCalls) return undefined;
    return session.toolCalls.find((tc) => toolMessageMatches(msg, tc));
  }

  function toolMessageMatches(
    msg: AiAgentMessage,
    tc: AiAgentToolCall,
  ): boolean {
    if (msg.content.includes(tc.toolName)) return true;
    const createdAt = Date.parse(msg.createdAt);
    const toolCreatedAt = Date.parse(tc.createdAt);
    return (
      !Number.isNaN(createdAt) &&
      !Number.isNaN(toolCreatedAt) &&
      Math.abs(createdAt - toolCreatedAt) < 10_000
    );
  }

  function toolStatusLabel(status: AiAgentToolCall["status"]): string {
    const map: Record<AiAgentToolCall["status"], string> = {
      "pending-approval": "pending",
      approved: "approved",
      rejected: "rejected",
      executed: "executed",
      error: "failed",
    };
    return map[status];
  }

  function toolSummary(tc: AiAgentToolCall): string {
    const input = inputRecord(tc.input);
    if (tc.toolName === "updateChapter") {
      const chapter = manuscript.chapters.find(
        (c) => c.id === textInput(input, "chapterId"),
      );
      return (
        chapter?.title ??
        firstLine(textInput(input, "title"), "Unknown chapter")
      );
    }
    if (tc.toolName === "createChapter")
      return firstLine(textInput(input, "title"), "New chapter");
    if (tc.toolName === "updateCharacter") {
      const character = manuscript.characters.find(
        (c) => c.id === textInput(input, "characterId"),
      );
      return (
        character?.name ??
        firstLine(textInput(input, "name"), "Unknown character")
      );
    }
    if (tc.toolName === "createCharacter")
      return firstLine(textInput(input, "name"), "New character");
    if (tc.toolName === "updateProjectDoc") {
      const doc = ai.docs.find((d) => d.id === textInput(input, "docId"));
      return doc?.title ?? firstLine(textInput(input, "title"), "Unknown doc");
    }
    if (tc.toolName === "createProjectDoc")
      return firstLine(textInput(input, "title"), "New doc");
    if (typeof input.title === "string")
      return firstLine(input.title, "Review proposed tool input");
    if (typeof input.name === "string")
      return firstLine(input.name, "Review proposed tool input");
    if (typeof input.label === "string")
      return firstLine(input.label, "Review proposed tool input");
    for (const key of [
      "chapterId",
      "characterId",
      "locationId",
      "actId",
      "docId",
      "submissionId",
      "shareLinkId",
      "assetId",
    ]) {
      const value = textInput(input, key);
      if (value) return value;
    }
    return "Review proposed tool input";
  }

  type JsonRecord = Record<string, unknown>;

  function inputRecord(input: unknown): JsonRecord {
    return input && typeof input === "object" && !Array.isArray(input)
      ? (input as JsonRecord)
      : {};
  }

  function textInput(input: JsonRecord, key: string): string | undefined {
    const value = input[key];
    return typeof value === "string" ? value : undefined;
  }

  function stringArrayInput(
    input: JsonRecord,
    key: string,
  ): string[] | undefined {
    const value = input[key];
    return Array.isArray(value) &&
      value.every((item) => typeof item === "string")
      ? value
      : undefined;
  }

  function contentEditInput(
    input: JsonRecord,
  ):
    | { oldString: string; newString: string; replaceAll?: boolean }
    | undefined {
    const value = input.contentEdit;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const edit = value as JsonRecord;
    const oldString = textInput(edit, "oldString");
    const newString = textInput(edit, "newString");
    if (oldString === undefined || newString === undefined) return undefined;
    return {
      oldString,
      newString,
      replaceAll:
        typeof edit.replaceAll === "boolean" ? edit.replaceAll : undefined,
    };
  }

  function applyContentEdit(
    content: string,
    edit: ReturnType<typeof contentEditInput>,
  ): string {
    if (!edit?.oldString) return content;
    return edit.replaceAll
      ? content.split(edit.oldString).join(edit.newString)
      : content.replace(edit.oldString, edit.newString);
  }

  function displayValue(value: unknown): string {
    if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
    if (typeof value === "string") return value.trim() || "Empty";
    if (value === null || value === undefined) return "None";
    return String(value);
  }

  function firstLine(value: string | undefined, fallback: string): string {
    return (
      value
        ?.split("\n")
        .find((line) => line.trim())
        ?.trim() ?? fallback
    );
  }

  function chapterMeta(input: {
    title?: string;
    status?: string;
    povCharacterId?: string;
    locationId?: string;
  }) {
    const pov =
      manuscript.characters.find((c) => c.id === input.povCharacterId)?.name ??
      input.povCharacterId;
    const location =
      manuscript.locations.find((l) => l.id === input.locationId)?.name ??
      input.locationId;
    return [
      `Title: ${displayValue(input.title)}`,
      `Status: ${displayValue(input.status)}`,
      `POV: ${displayValue(pov)}`,
      `Location: ${displayValue(location)}`,
    ].join("\n");
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
      `Traits: ${displayValue(input.traits)}`,
    ].join("\n");
  }

  function docMeta(input: { title?: string; kind?: string }) {
    return [
      `Title: ${displayValue(input.title)}`,
      `Kind: ${displayValue(input.kind)}`,
    ].join("\n");
  }

  function buildApprovalDoc(tc: AiAgentToolCall) {
    const input = inputRecord(tc.input);
    const title = toolLabel(tc.toolName);

    if (tc.toolName === "updateChapter") {
      const chapter = manuscript.chapters.find(
        (c) => c.id === textInput(input, "chapterId"),
      );
      if (!chapter) return null;
      const contentEdit = contentEditInput(input);
      const modified = {
        title: textInput(input, "title") ?? chapter.title,
        status: textInput(input, "status") ?? chapter.status,
        povCharacterId:
          textInput(input, "povCharacterId") ?? chapter.povCharacterId,
        locationId: textInput(input, "locationId") ?? chapter.locationId,
        summary: textInput(input, "summary") ?? chapter.summary,
        content: applyContentEdit(chapter.content, contentEdit),
      };
      return {
        targetLabel: chapter.title,
        title: `AI: ${title}`,
        panes: [
          {
            id: "chapter-meta",
            title: "Chapter Details",
            description: "Title, status, POV, and location",
            original: chapterMeta(chapter),
            modified: chapterMeta(modified),
            language: "markdown",
          },
          {
            id: "chapter-summary",
            title: "Summary",
            description: "Synopsis and intent for the chapter",
            original: chapter.summary,
            modified: modified.summary ?? "",
            language: "markdown",
          },
          {
            id: "chapter-content",
            title: "Manuscript",
            description: "Full chapter prose",
            original: chapter.content,
            modified: modified.content ?? "",
            language: "markdown",
          },
        ],
      };
    }

    if (tc.toolName === "createChapter") {
      const modified = {
        title: textInput(input, "title"),
        status: textInput(input, "status"),
        povCharacterId: textInput(input, "povCharacterId"),
        locationId: textInput(input, "locationId"),
        summary: textInput(input, "summary"),
        content: textInput(input, "content"),
      };
      return {
        targetLabel: textInput(input, "title") ?? "New chapter",
        title: `AI: ${title}`,
        panes: [
          {
            id: "chapter-meta",
            title: "Chapter Details",
            description: "Title, status, POV, and location",
            original: "",
            modified: chapterMeta(modified),
            language: "markdown",
          },
          {
            id: "chapter-summary",
            title: "Summary",
            description: "Synopsis and intent for the chapter",
            original: "",
            modified: modified.summary ?? "",
            language: "markdown",
          },
          {
            id: "chapter-content",
            title: "Manuscript",
            description: "Full chapter prose",
            original: "",
            modified: modified.content ?? "",
            language: "markdown",
          },
        ],
      };
    }

    if (tc.toolName === "updateCharacter") {
      const character = manuscript.characters.find(
        (c) => c.id === textInput(input, "characterId"),
      );
      if (!character) return null;
      const modified = {
        name: textInput(input, "name") ?? character.name,
        role: textInput(input, "role") ?? character.role,
        age: textInput(input, "age") ?? character.age,
        occupation: textInput(input, "occupation") ?? character.occupation,
        traits: stringArrayInput(input, "traits") ?? character.traits,
        description: textInput(input, "description") ?? character.description,
        appearance: textInput(input, "appearance") ?? character.appearance,
        motivation: textInput(input, "motivation") ?? character.motivation,
        arc: textInput(input, "arc") ?? character.arc,
      };
      return {
        targetLabel: character.name,
        title: `AI: ${title}`,
        panes: [
          {
            id: "character-basics",
            title: "Basics",
            description: "Name, role, age, occupation, and traits",
            original: characterBasics(character),
            modified: characterBasics(modified),
            language: "markdown",
          },
          {
            id: "character-description",
            title: "Description",
            description: "Core identity and backstory notes",
            original: character.description,
            modified: modified.description ?? "",
            language: "markdown",
          },
          {
            id: "character-appearance",
            title: "Appearance",
            description: "Physical presentation and visual cues",
            original: character.appearance,
            modified: modified.appearance ?? "",
            language: "markdown",
          },
          {
            id: "character-motivation-arc",
            title: "Motivation & Arc",
            description: "Driving wants and transformation",
            original: `## Motivation\n${character.motivation}\n\n## Character Arc\n${character.arc}`,
            modified: `## Motivation\n${modified.motivation ?? ""}\n\n## Character Arc\n${modified.arc ?? ""}`,
            language: "markdown",
          },
        ],
      };
    }

    if (tc.toolName === "createCharacter") {
      const modified = {
        name: textInput(input, "name"),
        role: textInput(input, "role"),
        age: textInput(input, "age"),
        occupation: textInput(input, "occupation"),
        traits: stringArrayInput(input, "traits"),
        description: textInput(input, "description"),
        appearance: textInput(input, "appearance"),
        motivation: textInput(input, "motivation"),
        arc: textInput(input, "arc"),
      };
      return {
        targetLabel: textInput(input, "name") ?? "New character",
        title: `AI: ${title}`,
        panes: [
          {
            id: "character-basics",
            title: "Basics",
            description: "Name, role, age, occupation, and traits",
            original: "",
            modified: characterBasics(modified),
            language: "markdown",
          },
          {
            id: "character-description",
            title: "Description",
            description: "Core identity and backstory notes",
            original: "",
            modified: modified.description ?? "",
            language: "markdown",
          },
          {
            id: "character-appearance",
            title: "Appearance",
            description: "Physical presentation and visual cues",
            original: "",
            modified: modified.appearance ?? "",
            language: "markdown",
          },
          {
            id: "character-motivation-arc",
            title: "Motivation & Arc",
            description: "Driving wants and transformation",
            original: "",
            modified: `## Motivation\n${modified.motivation ?? ""}\n\n## Character Arc\n${modified.arc ?? ""}`,
            language: "markdown",
          },
        ],
      };
    }

    if (tc.toolName === "updateProjectDoc") {
      const doc = ai.docs.find((d) => d.id === textInput(input, "docId"));
      if (!doc) return null;
      const contentEdit = contentEditInput(input);
      const modified = {
        title: textInput(input, "title") ?? doc.title,
        kind: textInput(input, "kind") ?? doc.kind,
        content: applyContentEdit(doc.content, contentEdit),
      };
      return {
        targetLabel: doc.title,
        title: `AI: ${title}`,
        panes: [
          {
            id: "doc-meta",
            title: "Document Details",
            description: "Title and document kind",
            original: docMeta(doc),
            modified: docMeta(modified),
            language: "markdown",
          },
          {
            id: "doc-content",
            title: "Content",
            description: "Document body",
            original: doc.content,
            modified: modified.content ?? "",
            language: "markdown",
          },
        ],
      };
    }

    if (tc.toolName === "createProjectDoc") {
      const modified = {
        title: textInput(input, "title"),
        kind: textInput(input, "kind"),
        content: textInput(input, "content"),
      };
      return {
        targetLabel: textInput(input, "title") ?? "New doc",
        title: `AI: ${title}`,
        panes: [
          {
            id: "doc-meta",
            title: "Document Details",
            description: "Title and document kind",
            original: "",
            modified: docMeta(modified),
            language: "markdown",
          },
          {
            id: "doc-content",
            title: "Content",
            description: "Document body",
            original: "",
            modified: modified.content ?? "",
            language: "markdown",
          },
        ],
      };
    }

    return {
      targetLabel: title,
      title: `AI: ${title}`,
      panes: [
        {
          id: "raw-input",
          title: "Raw Input",
          description: "Unrecognized tool payload",
          original: "",
          modified: JSON.stringify(tc.input, null, 2),
          language: "json",
        },
      ],
    };
  }

  function openApprovalDoc(tc: AiAgentToolCall) {
    const doc = buildApprovalDoc(tc);
    if (!doc) return;
    const id = tc.id;
    setAiApprovalDoc({
      id,
      sessionId: session?.id ?? ai.activeSessionId ?? "",
      toolCall: tc,
      ...doc,
    });
    void manuscript.openTab({
      id: `tab-ai-approval-${id}`,
      type: "ai-approval",
      refId: id,
      title: doc.title,
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
          <span class="truncate">{session?.title ?? "Sessions"}</span>
          <ChevronDown class="size-3" />
        </button>
        {#if sessionMenuOpen}
          <button
            type="button"
            aria-label="Close session menu"
            class="fixed inset-0 z-10 cursor-default bg-transparent"
            onclick={() => (sessionMenuOpen = false)}
          ></button>
          <div
            class="absolute right-0 top-7 z-20 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
          >
            <div
              class="flex items-center justify-between border-b border-border px-2 py-1.5"
            >
              <span
                class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >AI Sessions</span
              >
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
                <div
                  class="px-2 py-3 text-center text-[11px] text-muted-foreground"
                >
                  No sessions yet.
                </div>
              {:else}
                {#each ai.sessions as s (s.id)}
                  <button
                    type="button"
                    onclick={() => selectSession(s.id)}
                    class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <span class="min-w-0">
                      <span class="block truncate text-[11px] text-foreground"
                        >{s.title}</span
                      >
                      <span
                        class="block truncate text-[10px] text-muted-foreground"
                      >
                        {s.messageCount} messages · {sessionTime(s.updatedAt)} ·
                        {s.status}
                      </span>
                    </span>
                    {#if s.id === ai.activeSessionId}
                      <span class="size-1.5 shrink-0 rounded-full bg-accent"
                      ></span>
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
    <div
      class="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center"
    >
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
        onclick={() => void manuscript.setActiveView("settings")}
        class="rounded-md border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-muted"
      >
        Open Settings
      </button>
    </div>
  {:else}
    <!-- Transcript -->
    <div bind:this={scrollEl} class="flex-1 overflow-y-auto">
      <AiAgentMessages
        {session}
        {isRunning}
        {activeAssistantMessage}
        {showThinking}
        {toolLabel}
        {toolStatusLabel}
      />

      <!-- Pending questions (agent is waiting for user input) -->
      <AiAgentQuestions
        questions={pendingQuestionCalls}
        onSubmit={submitQuestion}
        onDismiss={reject}
      />

      <!-- Pending tool calls (need approval) -->
      {#if pendingToolCalls.length > 0}
        <div class="border-t border-border">
          <div class="flex items-center justify-between gap-2 px-3 pt-2 pb-1">
            <div class="flex items-center gap-1.5">
              <span class="size-1 rounded-full bg-accent"></span>
              <p
                class="text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                Pending approval
              </p>
            </div>
            {#if pendingToolCalls.length > 1}
              <button
                type="button"
                onclick={approveAll}
                class="inline-flex items-center gap-1 rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-500 hover:bg-emerald-500/10"
              >
                <Check class="size-3" /> Approve all
              </button>
            {/if}
          </div>
          <ul class="divide-y divide-border/60">
            {#each pendingToolCalls as tc (tc.id)}
              <li class="group px-3 py-2">
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onclick={() => openApprovalDoc(tc)}
                    class="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title="Open diff"
                  >
                    <FileText class="size-3 shrink-0 text-muted-foreground" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-[11px] text-foreground">
                        {toolLabel(tc.toolName)}
                        <span class="text-muted-foreground"
                          >— {toolSummary(tc)}</span
                        >
                      </span>
                    </span>
                  </button>
                  <div class="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onclick={() => toggleTool(tc.id)}
                      title={expandedTools[tc.id] ? "Hide input" : "Show input"}
                      class="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {#if expandedTools[tc.id]}
                        <ChevronDown class="size-3" />
                      {:else}
                        <ChevronRight class="size-3" />
                      {/if}
                    </button>
                    <button
                      type="button"
                      onclick={() => reject(tc.id)}
                      title="Reject"
                      class="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <X class="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onclick={() => approve(tc.id)}
                      title="Approve"
                      class="flex size-6 items-center justify-center rounded text-emerald-500 hover:bg-emerald-500/10"
                    >
                      <Check class="size-3.5" />
                    </button>
                  </div>
                </div>
                {#if expandedTools[tc.id]}
                  <pre
                    class="mt-1.5 ml-5 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[10px] leading-relaxed text-muted-foreground">{JSON.stringify(
                      tc.input,
                      null,
                      2,
                    )}</pre>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Queue -->
      {#if session?.queue && session.queue.filter((q) => q.status === "queued").length > 0}
        <div class="border-t border-border px-3 py-2">
          <div class="mb-1 flex items-center gap-1.5">
            <span class="size-1 rounded-full bg-muted-foreground/60"></span>
            <p
              class="text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              Queued
            </p>
          </div>
          <ul class="space-y-0.5">
            {#each session.queue.filter((q) => q.status === "queued") as q (q.id)}
              <li class="truncate pl-2.5 text-[11px] text-muted-foreground">
                {#if q.model}<span class="text-foreground/70">{q.model}</span> ·
                {/if}{q.prompt}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <!-- Error -->
    {#if ai.sessionError || session?.error}
      <div
        class="border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive"
      >
        <div>{ai.sessionError ?? session?.error}</div>
        {#if session?.contextUsage && session.status === 'error'}
          <div class="mt-1 text-[10px] text-destructive/80">
            Request context: {formatUsage(session.contextUsage.totalTokens)} / {formatUsage(session.contextUsage.maxTokens)} tokens ({session.contextUsage.percentage}%)
          </div>
        {/if}
      </div>
    {/if}

    <!-- Input -->
    <div class="border-border bg-sidebar/70 p-2">
      <div
        class="rounded-xl border border-border bg-background/95 shadow-sm focus-within:border-accent/70"
      >
        {#if attachments.length > 0}
          <div
            class="flex flex-wrap gap-1.5 border-b border-border/70 px-2 py-2"
          >
            {#each attachments as attachment (attachment.id)}
              <button
                type="button"
                onclick={() => removeAttachment(attachment.id)}
                title="Remove attachment"
                class="inline-flex max-w-44 items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground hover:text-destructive"
              >
                <Paperclip class="size-3 shrink-0" />
                <span class="truncate">{attachment.name}</span>
                {#if attachment.reference}
                  <span class="text-[9px] uppercase text-muted-foreground/70"
                    >{attachment.reference.type}</span
                  >
                {/if}
                <X class="size-3 shrink-0" />
              </button>
            {/each}
          </div>
        {/if}
        <div class="relative">
          <textarea
            bind:this={textareaEl}
            value={prompt}
            oninput={handlePromptInput}
            onkeydown={handleKey}
            onclick={handlePromptClick}
            onkeyup={handlePromptClick}
            placeholder="Ask about your manuscript..."
            rows="3"
            class="max-h-36 min-h-20 w-full resize-none bg-transparent px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground outline-none"
          ></textarea>
          {#if autocompleteOpen && autocompleteItems.length > 0}
            <div
              class="absolute bottom-full left-2 right-2 z-30 mb-1 overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
            >
              <div
                class="border-b border-border/70 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                Project context
              </div>
              <div class="max-h-56 overflow-y-auto p-1">
                {#each autocompleteItems as item, index (item.type + item.id)}
                  <button
                    type="button"
                    onmousedown={(event) => {
                      event.preventDefault();
                      insertAutocompleteItem(item);
                    }}
                    class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left {index ===
                    selectedAutocompleteIndex
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'}"
                  >
                    <span class="min-w-0">
                      <span class="block truncate text-[11px]">@{item.label}</span>
                      <span class="block truncate text-[10px] opacity-70"
                        >{item.detail}</span
                      >
                    </span>
                    <span class="shrink-0 text-[9px] uppercase opacity-60"
                      >{item.type}</span
                    >
                  </button>
                {/each}
              </div>
              <div
                class="border-t border-border/70 px-2 py-1 text-[10px] text-muted-foreground"
              >
                Enter/Tab to attach, Esc to close. Add #10-20 for lines.
              </div>
            </div>
          {/if}
        </div>
        <div
          class="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-1.5"
        >
          <div class="flex min-w-0 items-center gap-1.5">
            <input
              bind:this={fileInputEl}
              type="file"
              multiple
              class="hidden"
              onchange={(event) => void handleFiles(event.currentTarget.files)}
            />
            <button
              type="button"
              onclick={() => fileInputEl?.click()}
              disabled={uploadingAttachment}
              class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              title="Attach files"
            >
              <Paperclip class="size-3.5" />
            </button>
            <select
              bind:value={selectedModel}
              class="h-7 max-w-40 rounded-md border border-transparent bg-transparent px-1.5 text-[10px] text-muted-foreground outline-none hover:border-border hover:text-foreground"
              title="Model"
            >
              {#each modelOptions as model}
                <option value={model}>{model}</option>
              {/each}
            </select>
          </div>
          <div class="flex items-center gap-1">
            {#if isRunning}
              <button
                type="button"
                onclick={interrupt}
                disabled={!prompt.trim()}
                title="Interrupt and send"
                class="flex size-7 items-center justify-center rounded-md border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 disabled:opacity-40"
              >
                <Zap class="size-3.5" />
              </button>
            {/if}
            <button
              type="button"
              onclick={send}
              disabled={!prompt.trim() || uploadingAttachment}
              title="Send"
              class="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40"
            >
              <Send class="size-3.5" />
            </button>
          </div>
        </div>
      </div>
      <div
        class="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
      >
        <span class="inline-flex items-center gap-1">
          <span
            class="size-1.5 rounded-full {ai.streaming
              ? 'animate-pulse bg-emerald-400'
              : 'bg-muted-foreground'}"
          ></span>
          {ai.streaming ? "Connected" : "Disconnected"} · {session?.status ??
            "idle"}
        </span>
        {#if session?.contextUsage}
          <span
            class="min-w-24 text-right {session.contextUsage.percentage > 100 ? 'text-destructive' : ''}"
            title={`${session.contextUsage.totalTokens} / ${session.contextUsage.maxTokens} tokens`}
          >
            Context {session.contextUsage.percentage}% · {formatUsage(
              session.contextUsage.totalTokens,
            )} tokens
          </span>
        {:else}
          <span class="text-right">Context --%</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
