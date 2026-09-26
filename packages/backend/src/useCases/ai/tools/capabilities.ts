import { HttpError } from "../../../http/HttpError.js";
import type { RuntimeRole, TaskContract } from "../runtime/taskContract.js";

type RawTool = {
  // Tool implementations have provider-specific execution option types.
  // Treat it as unknown until the runtime function check below.
  execute?: unknown;
  [key: string]: unknown;
};

type ExecutableTool = Omit<RawTool, "execute"> & {
  execute?: (input: unknown, options?: unknown) => unknown;
};

export type AgentToolMap = Record<string, ExecutableTool>;

const STORY_READ_TOOLS = new Set([
  "readProject",
  "listProjectFiles",
  "readFolder",
  "listCharacters",
  "readCharacter",
  "listCharacterRelationships",
  "listChapters",
  "grepChapter",
  "grepChapters",
  "readChapter",
  "listActs",
  "readAct",
  "listScenes",
  "readScene",
  "listLocations",
  "readLocation",
  "listObstacles",
  "readObstacle",
  "listProjectDocs",
  "readProjectDoc",
  "readStoryStructure",
  "listSubmissions",
  "readSubmission",
  "listTrash",
  "readTrashedChapter",
  "listAssets",
  "readAssetMetadata",
  "readAssetContent",
  "getProjectStats",
  "runStoryLint",
  "listMembers",
  "listBetaShareLinks",
  "readBetaShareLink",
  "readPublicProject",
  "readProjectAiSettings",
  "listProjectAiSkills",
  "readProjectAiSkill",
  "listWritingVersions",
  "readWritingVersion",
  "grepProject",
]);

function allowedTools(
  role: RuntimeRole,
  isPrimary: boolean,
  contract: TaskContract | null,
): Set<string> | null {
  if (isPrimary && role === "orchestrator") return null;
  const reads = new Set(STORY_READ_TOOLS);
  if (role === "explorer" || role === "researcher") return reads;
  const docs = contract?.scope.allowSupportingArtifacts
    ? new Set(["createProjectDoc", "updateProjectDoc"])
    : new Set<string>();
  if (role === "critic" || role === "librarian") return union(reads, docs);
  if (role === "creator")
    return union(
      reads,
      docs,
      contract?.scope.allowSupportingArtifacts
        ? new Set([
            "createCharacter",
            "updateCharacter",
            "createCharacterRelationship",
            "createLocation",
            "updateLocation",
            "createAct",
            "updateAct",
            "createObstacle",
            "updateObstacle",
            "updateStoryStructure",
          ])
        : new Set<string>(),
    );
  if (role === "drafter" || role === "reviser")
    return union(reads, docs, new Set(["updateChapter", "updateScene"]));
  return union(reads, docs, new Set(["task"]));
}

export function filterToolsForRole(
  tools: Record<string, unknown>,
  role: RuntimeRole,
  contract: TaskContract | null,
  options: { primary: boolean },
): AgentToolMap {
  const allowed = allowedTools(role, options.primary, contract);
  const entries = Object.entries(tools)
    .filter(([name]) => allowed === null || allowed.has(name))
    .map(
      ([name, value]) =>
        [name, scopedTool(name, value as RawTool, role, contract)] as const,
    );
  return Object.fromEntries(entries);
}

export function filterToolsForSkill(
  tools: AgentToolMap,
  allowedTools: readonly string[] | null | undefined,
  options: { preserveRoleReads?: boolean } = {},
): AgentToolMap {
  if (!allowedTools?.length) return tools;
  const allowed = new Set(allowedTools);
  // Skill manifests may narrow writes/delegation, but the runtime role owns its
  // safe read surface. Omitting a read from one procedural manifest must not
  // blind a worker to canon/evidence it is otherwise authorized to inspect.
  const preserveRoleReads = options.preserveRoleReads !== false;
  return Object.fromEntries(
    Object.entries(tools).filter(
      ([name]) =>
        allowed.has(name) || (preserveRoleReads && STORY_READ_TOOLS.has(name)),
    ),
  );
}

function scopedTool(
  name: string,
  original: RawTool,
  role: RuntimeRole,
  contract: TaskContract | null,
): ExecutableTool {
  if (typeof original.execute !== "function")
    return { ...original, execute: undefined };
  const execute = original.execute as (
    input: unknown,
    options?: unknown,
  ) => unknown;
  return {
    ...original,
    execute: async (input: unknown, options?: unknown) => {
      assertToolScope(name, input, role, contract);
      return execute(input, options);
    },
  };
}

export function assertToolScope(
  toolName: string,
  input: unknown,
  role: RuntimeRole,
  contract: TaskContract | null,
): void {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  if (
    (role === "drafter" || role === "reviser") &&
    toolName === "updateChapter" &&
    contract?.scope.chapterIds.length
  ) {
    const id = stringField(record, "chapterId");
    if (!id || !contract.scope.chapterIds.includes(id))
      throw new HttpError(403, "Only assigned chapters may be edited");
  }
  if (
    (role === "drafter" || role === "reviser") &&
    toolName === "updateScene" &&
    contract?.scope.sceneIds.length
  ) {
    const id = stringField(record, "sceneId");
    if (!id || !contract.scope.sceneIds.includes(id))
      throw new HttpError(403, "Only assigned scenes may be edited");
  }
}

function union(...sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((set) => [...set]));
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isReadOnlyRole(role: RuntimeRole): boolean {
  return role === "explorer" || role === "researcher";
}
