import type { AiAgentPermissionRequest } from "@opentales/sdk";
import type { AiApprovalDiffPane } from "$lib/data/ai-approval-docs";
import { manuscript } from "$lib/stores/manuscript.svelte";
import { ai } from "$lib/stores/ai.svelte";

/**
 * Builds the multi-pane Monaco diff preview for an OpenTales mutation the
 * agent is asking permission to run. Works on the raw tool input so it is
 * independent of how the harness transports the request.
 */
export function toolLabel(name: string): string {
  const map: Record<string, string> = {
    listCharacters: "Listed characters",
    readCharacter: "Read character",
    listCharacterRelationships: "Listed relationships",
    listChapters: "Listed chapters",
    readChapter: "Read chapter",
    listScenes: "Listed scenes",
    grepChapter: "Searched chapter",
    grepChapters: "Searched chapters",
    grepProject: "Searched project",
    listLocations: "Listed locations",
    readLocation: "Read location",
    listActs: "Listed acts",
    listObstacles: "Listed obstacles",
    listProjectDocs: "Listed docs",
    readProjectDoc: "Read doc",
    listProjectFiles: "Listed project files",
    listProjectAiSkills: "Listed AI skills",
    readProjectAiSkill: "Read AI skill",
    listAssets: "Listed assets",
    listMembers: "Listed members",
    listSubmissions: "Listed submissions",
    listTrash: "Listed trash",
    listWritingVersions: "Listed writing versions",
    readStoryStructure: "Read story structure",
    getProjectStats: "Read project stats",
    compareVersions: "Compared versions",
    getSceneContext: "Read scene context",
    searchStory: "Searched story",
    findReferences: "Found references",
    runStoryLint: "Checked story",
    reportTaskResult: "Reported task result",
    task: "Delegated task",
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
  return map[name] ?? humanize(name);
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

export function buildApprovalDoc(
  request: Pick<AiAgentPermissionRequest, "toolName" | "toolInput">,
): { targetLabel: string; title: string; panes: AiApprovalDiffPane[] } | null {
  const tc = { toolName: request.toolName, input: request.toolInput };
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


/** `readProjectAiSkill` → "Read project ai skill". */
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
