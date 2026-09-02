import { HttpError } from '../../../http/HttpError.js';
import type { RuntimeRole, TaskContract } from '../runtime/taskContract.js';

type RawTool = {
  // Tool implementations have provider-specific execution option types.
  // Treat it as unknown until the runtime function check below.
  execute?: unknown;
  [key: string]: unknown;
};

type ExecutableTool = Omit<RawTool, 'execute'> & { execute?: (input: unknown, options?: unknown) => unknown };

export type AgentToolMap = Record<string, ExecutableTool>;

const STORY_READ_TOOLS = new Set([
  'readProject',
  'listProjectFiles',
  'readFolder',
  'listCharacters',
  'readCharacter',
  'listCharacterRelationships',
  'listChapters',
  'grepChapter',
  'grepChapters',
  'readChapter',
  'listActs',
  'readAct',
  'listScenes',
  'readScene',
  'listLocations',
  'readLocation',
  'listObstacles',
  'readObstacle',
  'listProjectDocs',
  'readProjectDoc',
  'readStoryStructure',
  'listSubmissions',
  'readSubmission',
  'listTrash',
  'readTrashedChapter',
  'listAssets',
  'readAssetMetadata',
  'readAssetContent',
  'getProjectStats',
  'listMembers',
  'listBetaShareLinks',
  'readBetaShareLink',
  'readPublicProject',
  'readProjectAiSettings',
  'listProjectAiSkills',
  'readProjectAiSkill',
  'listWritingVersions',
  'readWritingVersion',
  'grepProject',
  'searchStory',
  'findReferences',
  'getSceneContext',
  'queryCanon',
  'queryTimeline',
  'queryEntityState',
  'queryOpenLoops',
  'getArcState',
  'compareVersions',
  'listBuildRuns',
  'getBuildState',
  'listBuildUnits',
  'readBuildUnit',
  'listBuildArtifacts',
  'readBuildArtifact',
  'readBuildCompilation',
  'compareBuildManuscript',
  'listBuildReviews',
  'readBuildReview'
]);

const DIAGNOSTIC_TOOLS = new Set(['runStoryLint', 'reportTaskResult']);
const ARTIFACT_WRITE_TOOLS = new Set(['applyArtifactBatch', 'createCheckpoint', 'reportTaskResult']);
const DRAFT_WRITE_TOOLS = new Set(['applyArtifactBatch', 'applyBuildUnitPatch', 'updateChapter', 'updateScene', 'reportTaskResult', 'createCheckpoint']);
const CANON_WRITE_TOOLS = new Set(['applyArtifactBatch', 'commitCanonDelta', 'linkSetupPayoff', 'reportTaskResult']);
const BUILD_BOUND_READ_TOOLS = new Set(['getBuildState', 'listBuildUnits', 'readBuildUnit', 'searchStory', 'findReferences', 'queryCanon', 'queryTimeline', 'queryEntityState', 'queryOpenLoops', 'runStoryLint', 'getArcState']);

function allowedTools(role: RuntimeRole, isPrimary: boolean, contract: TaskContract | null): Set<string> | null {
  if (isPrimary && role === 'orchestrator') return null;
  const reads = new Set(STORY_READ_TOOLS);
  if (role === 'explorer') return reads;
  if (role === 'researcher') return union(reads, new Set(['applyArtifactBatch', 'reportTaskResult']));
  if (role === 'critic') return union(reads, DIAGNOSTIC_TOOLS, !contract?.scope.buildRunId && contract?.scope.allowSupportingArtifacts ? new Set(['createProjectDoc', 'updateProjectDoc']) : new Set());
  if (role === 'creator') return union(
    reads,
    ARTIFACT_WRITE_TOOLS,
    !contract?.scope.buildRunId && contract?.scope.allowSupportingArtifacts
      ? new Set(['createProjectDoc', 'updateProjectDoc', 'createCharacter', 'updateCharacter', 'createLocation', 'updateLocation', 'createAct', 'updateAct', 'createObstacle', 'updateObstacle', 'updateStoryStructure'])
      : new Set()
  );
  if (role === 'drafter' || role === 'reviser') return union(reads, DRAFT_WRITE_TOOLS, DIAGNOSTIC_TOOLS);
  if (role === 'librarian') return union(reads, CANON_WRITE_TOOLS, DIAGNOSTIC_TOOLS);
  // A delegated orchestrator schedules work and updates build state, but does
  // not receive general manuscript CRUD.
  return union(reads, ARTIFACT_WRITE_TOOLS, new Set(['task', 'compileBuildManuscript']));
}

export function filterToolsForRole(
  tools: Record<string, RawTool>,
  role: RuntimeRole,
  contract: TaskContract | null,
  options: { primary: boolean }
): AgentToolMap {
  const allowed = allowedTools(role, options.primary, contract);
  const entries = Object.entries(tools)
    .filter(([name]) => (allowed === null || allowed.has(name)) && !(contract?.scope.buildRunId && (name === 'updateChapter' || name === 'updateScene' || name === 'applyChapterPatch' || name === 'createCheckpoint')))
    .map(([name, value]) => [name, scopedTool(name, value, role, contract)] as const);
  return Object.fromEntries(entries);
}

export function filterToolsForSkill(
  tools: AgentToolMap,
  allowedTools: readonly string[] | null | undefined,
  options: { preserveRoleReads?: boolean } = {}
): AgentToolMap {
  if (!allowedTools?.length) return tools;
  const allowed = new Set(allowedTools);
  // Skill manifests may narrow writes/delegation, but the runtime role owns its
  // safe read surface. Omitting a read from one procedural manifest must not
  // blind a worker to canon/evidence it is otherwise authorized to inspect.
  const preserveRoleReads = options.preserveRoleReads !== false;
  return Object.fromEntries(Object.entries(tools).filter(([name]) =>
    allowed.has(name) || (preserveRoleReads && STORY_READ_TOOLS.has(name))
  ));
}

function scopedTool(
  name: string,
  original: RawTool,
  role: RuntimeRole,
  contract: TaskContract | null
): ExecutableTool {
  if (typeof original.execute !== 'function') return { ...original, execute: undefined };
  const execute = original.execute as (input: unknown, options?: unknown) => unknown;
  return {
    ...original,
    execute: async (input: unknown, options?: unknown) => {
      assertToolScope(name, input, role, contract);
      return execute(input, options);
    }
  };
}

export function assertToolScope(
  toolName: string,
  input: unknown,
  role: RuntimeRole,
  contract: TaskContract | null
): void {
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};

  if (contract?.scope.buildRunId && BUILD_BOUND_READ_TOOLS.has(toolName) && stringField(record, 'buildRunId') !== contract.scope.buildRunId) {
    throw new HttpError(403, `${toolName} must read the assigned build run`);
  }
  if (contract?.scope.buildRunId && toolName === 'getSceneContext') {
    const targetId = stringField(record, 'sceneId');
    const allowed = [...contract.scope.sceneIds, ...contract.scope.manuscriptUnitIds];
    if (!targetId || (allowed.length > 0 && !allowed.includes(targetId))) throw new HttpError(403, 'Scene context must target the assigned scene or build unit');
  }

  if ((role === 'drafter' || role === 'reviser') && (toolName === 'updateChapter' || toolName === 'applyChapterPatch')) {
    const chapterId = stringField(record, 'chapterId');
    if (contract?.scope.buildRunId && (!chapterId || !contract.scope.chapterIds.includes(chapterId))) {
      throw new HttpError(403, `${role} may only mutate an explicitly assigned chapter`);
    }
  }

  if ((role === 'drafter' || role === 'reviser') && toolName === 'applyBuildUnitPatch') {
    const unitId = stringField(record, 'unitId');
    if (!unitId || !contract?.scope.manuscriptUnitIds.includes(unitId)) throw new HttpError(403, `${role} may only patch an explicitly assigned build unit`);
    if (record.status === 'accepted' || record.status === 'invalidated') throw new HttpError(403, 'Only deterministic workflow gates may accept or invalidate a build unit');
  }

  if (role === 'librarian' && toolName === 'commitCanonDelta' && contract?.scope.manuscriptUnitIds.length) {
    const sourceUnitId = stringField(record, 'sourceUnitId');
    if (!sourceUnitId || !contract.scope.manuscriptUnitIds.includes(sourceUnitId)) throw new HttpError(403, 'Scene canon delta must cite the assigned build unit');
  }

  if ((role === 'drafter' || role === 'reviser') && toolName === 'updateScene') {
    const sceneId = stringField(record, 'sceneId');
    if (contract?.scope.buildRunId && (!sceneId || !contract.scope.sceneIds.includes(sceneId))) {
      throw new HttpError(403, `${role} may only mutate explicitly assigned scene metadata`);
    }
  }

  if (toolName === 'reportTaskResult' && contract?.scope.buildTaskId) {
    const taskId = stringField(record, 'taskId') ?? stringField(record, 'buildTaskId');
    if (taskId !== contract.scope.buildTaskId) {
      throw new HttpError(403, 'Task results may only be reported for the assigned build task');
    }
  }

  if (contract?.scope.buildTaskId && ['applyArtifactBatch', 'applyChapterPatch', 'applyBuildUnitPatch', 'compileBuildManuscript', 'commitCanonDelta', 'linkSetupPayoff', 'createCheckpoint'].includes(toolName)) {
    const taskId = stringField(record, 'taskId');
    if (taskId !== contract.scope.buildTaskId) throw new HttpError(403, `${toolName} must be bound to the assigned build task`);
  }

  if (toolName === 'applyArtifactBatch' && role !== 'orchestrator') {
    const buildRunId = stringField(record, 'buildRunId');
    if (!contract?.scope.buildRunId || buildRunId !== contract.scope.buildRunId) {
      throw new HttpError(403, 'Artifact writes must target the assigned build run');
    }
    if (contract.scope.manuscriptUnitIds.length) {
      const operations = Array.isArray(record.operations) ? record.operations : [];
      for (const operation of operations) {
        if (!operation || typeof operation !== 'object' || Array.isArray(operation) || (operation as Record<string, unknown>).action !== 'upsert') continue;
        const bindings = Array.isArray((operation as Record<string, unknown>).bindings) ? (operation as Record<string, unknown>).bindings as unknown[] : [];
        const hasAssignedUnit = bindings.some((binding) => {
          if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return false;
          const value = binding as Record<string, unknown>;
          return value.bindingKind === 'build-unit' && typeof value.unitId === 'string' && contract.scope.manuscriptUnitIds.includes(value.unitId);
        });
        if (!hasAssignedUnit) throw new HttpError(403, 'Scoped artifact output must bind to an assigned build manuscript unit');
      }
    }
  }
}

function union(...sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((set) => [...set]));
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function isReadOnlyRole(role: RuntimeRole): boolean {
  return role === 'explorer' || role === 'researcher';
}
