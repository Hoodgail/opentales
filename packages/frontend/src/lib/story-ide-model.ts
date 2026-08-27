/**
 * Pure view-model helpers for the story compiler surfaces.
 *
 * The backend owns canonical story state. These helpers only project that state
 * into deterministic layouts and searchable records for the human-facing IDE.
 * Keeping the projection logic pure lets every outline view stay synchronized
 * and makes the build graph testable without a browser.
 */
import type { BuildManuscriptUnit } from '@opentales/sdk';

export type StorySearchMode = 'search' | 'references';

export interface ParsedStoryQuery {
  text: string[];
  exact: string[];
  filters: Record<string, string[]>;
  regex: RegExp | null;
  invalidRegex: string | null;
}

const FILTER_KEYS = new Set([
  'type',
  'kind',
  'pov',
  'status',
  'thread',
  'location',
  'after',
  'before',
  'chapter',
  'scene',
  'entity',
  'knows',
  'setup',
  'severity',
  'category',
  'pass',
  'scene.goal',
  'character'
]);

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/** Parse the small, explicit query language shown in the Search panel. */
export function parseStoryQuery(input: string): ParsedStoryQuery {
  const query: ParsedStoryQuery = {
    text: [],
    exact: [],
    filters: {},
    regex: null,
    invalidRegex: null
  };

  // Pull regex out before tokenization so patterns may contain spaces.
  const regexToken = input.match(/regex:\/((?:\\.|[^/])*)\/([dgimsuvy]*)/);
  let tokenInput = input;
  if (regexToken) {
    try {
      query.regex = new RegExp(regexToken[1], regexToken[2]);
    } catch (error) {
      query.invalidRegex = error instanceof Error ? error.message : 'Invalid regular expression.';
    }
    tokenInput = `${input.slice(0, regexToken.index)} ${input.slice((regexToken.index ?? 0) + regexToken[0].length)}`;
  } else if (input.includes('regex:')) {
    query.invalidRegex = 'Regular expressions use regex:/pattern/flags.';
  }

  // Quoted strings stay intact, including when used as filter values.
  const tokens = tokenInput.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  for (const token of tokens) {
    const colon = token.indexOf(':');
    if (colon > 0) {
      const rawKey = token.slice(0, colon).toLowerCase();
      const key = rawKey.startsWith('@') ? rawKey.slice(1) : rawKey;
      if (FILTER_KEYS.has(key)) {
        const value = unquote(token.slice(colon + 1)).trim();
        if (value) (query.filters[key === 'character' ? 'entity' : key] ??= []).push(value);
        continue;
      }
    }

    if (token.startsWith('"') && token.endsWith('"')) query.exact.push(unquote(token));
    else query.text.push(token);
  }

  return query;
}

export interface SearchableStoryRecord {
  id: string;
  kind: string;
  title: string;
  text: string;
  fields?: Record<string, string | number | boolean | null | undefined | string[]>;
}

function valuesFor(record: SearchableStoryRecord, key: string): string[] {
  if (key === 'type' || key === 'kind') return [record.kind];
  const raw = record.fields?.[key];
  if (Array.isArray(raw)) return raw.map(String);
  if (raw === null || raw === undefined) return [];
  return [String(raw)];
}

/** Deterministic local matcher used while typing and as an offline fallback. */
export function matchesStoryQuery(record: SearchableStoryRecord, parsed: ParsedStoryQuery): boolean {
  const haystack = `${record.title}\n${record.text}`;
  const lower = haystack.toLocaleLowerCase();
  if (parsed.text.some((term) => !lower.includes(term.toLocaleLowerCase()))) return false;
  if (parsed.exact.some((term) => !haystack.includes(term))) return false;
  if (parsed.regex) {
    parsed.regex.lastIndex = 0;
    if (!parsed.regex.test(haystack)) return false;
  }

  for (const [key, accepted] of Object.entries(parsed.filters)) {
    const actual = valuesFor(record, key).map((value) => value.toLocaleLowerCase());
    const exact = ['type', 'kind', 'status', 'severity', 'category', 'pass'].includes(key);
    if (!accepted.some((wanted) => actual.some((value) => exact ? value === wanted.toLocaleLowerCase() : value.includes(wanted.toLocaleLowerCase())))) return false;
  }
  return true;
}

export interface GraphTaskLike {
  id: string;
  dependencies?: string[];
  dependencyIds?: string[];
}

export interface GraphNodeLayout {
  id: string;
  layer: number;
  row: number;
  x: number;
  y: number;
}

export interface GraphEdgeLayout {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BuildGraphLayout {
  nodes: GraphNodeLayout[];
  edges: GraphEdgeLayout[];
  width: number;
  height: number;
  hasCycle: boolean;
}

export const BUILD_GRAPH_NODE_WIDTH = 184;
export const BUILD_GRAPH_NODE_HEIGHT = 68;
const BUILD_GRAPH_COLUMN_GAP = 72;
const BUILD_GRAPH_ROW_GAP = 28;
const BUILD_GRAPH_PADDING = 28;

function dependenciesOf(task: GraphTaskLike): string[] {
  return task.dependencies ?? task.dependencyIds ?? [];
}

/**
 * Assign a stable topological layer and row to every task. Invalid dependency
 * ids are ignored; cycles are surfaced while still receiving a usable layout.
 */
export function layoutBuildGraph(tasks: GraphTaskLike[]): BuildGraphLayout {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    for (const dependency of dependenciesOf(task)) {
      if (!byId.has(dependency)) continue;
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
      const next = dependents.get(dependency) ?? [];
      next.push(task.id);
      dependents.set(dependency, next);
    }
  }

  const layers = new Map<string, number>();
  const queue = tasks
    .filter((task) => indegree.get(task.id) === 0)
    .map((task) => task.id)
    .sort();
  for (const id of queue) layers.set(id, 0);

  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    const layer = layers.get(id) ?? 0;
    for (const dependent of (dependents.get(id) ?? []).sort()) {
      layers.set(dependent, Math.max(layers.get(dependent) ?? 0, layer + 1));
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
    queue.sort();
  }

  const hasCycle = visited !== tasks.length;
  if (hasCycle) {
    const fallbackLayer = Math.max(0, ...layers.values()) + 1;
    for (const task of tasks) if (!layers.has(task.id)) layers.set(task.id, fallbackLayer);
  }

  const grouped = new Map<number, string[]>();
  for (const task of tasks) {
    const layer = layers.get(task.id) ?? 0;
    const values = grouped.get(layer) ?? [];
    values.push(task.id);
    grouped.set(layer, values);
  }
  for (const values of grouped.values()) values.sort();

  const nodes = tasks.map((task) => {
    const layer = layers.get(task.id) ?? 0;
    const row = grouped.get(layer)?.indexOf(task.id) ?? 0;
    return {
      id: task.id,
      layer,
      row,
      x: BUILD_GRAPH_PADDING + layer * (BUILD_GRAPH_NODE_WIDTH + BUILD_GRAPH_COLUMN_GAP),
      y: BUILD_GRAPH_PADDING + row * (BUILD_GRAPH_NODE_HEIGHT + BUILD_GRAPH_ROW_GAP)
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdgeLayout[] = [];
  for (const task of tasks) {
    const to = nodeById.get(task.id);
    if (!to) continue;
    for (const dependency of dependenciesOf(task)) {
      const from = nodeById.get(dependency);
      if (!from) continue;
      edges.push({
        from: dependency,
        to: task.id,
        x1: from.x + BUILD_GRAPH_NODE_WIDTH,
        y1: from.y + BUILD_GRAPH_NODE_HEIGHT / 2,
        x2: to.x,
        y2: to.y + BUILD_GRAPH_NODE_HEIGHT / 2
      });
    }
  }

  const maxLayer = Math.max(0, ...nodes.map((node) => node.layer));
  const maxRows = Math.max(1, ...Array.from(grouped.values(), (values) => values.length));
  return {
    nodes,
    edges,
    width:
      BUILD_GRAPH_PADDING * 2 +
      (maxLayer + 1) * BUILD_GRAPH_NODE_WIDTH +
      maxLayer * BUILD_GRAPH_COLUMN_GAP,
    height:
      BUILD_GRAPH_PADDING * 2 +
      maxRows * BUILD_GRAPH_NODE_HEIGHT +
      (maxRows - 1) * BUILD_GRAPH_ROW_GAP,
    hasCycle
  };
}

export interface UnknownStoryRecord {
  id: string;
  key?: string;
  type?: string;
  kind?: string;
  title?: string;
  name?: string;
  status?: string;
  data?: unknown;
  payload?: unknown;
  content?: unknown;
  bindings?: Array<{ unitId?: string | null }>;
}

export function storyRecordData(record: UnknownStoryRecord): Record<string, unknown> {
  for (const candidate of [record.data, record.payload, record.content]) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
    if (typeof candidate === 'string') {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Human-authored markdown is valid artifact content; it simply has no
        // structured scene projection.
      }
    }
  }
  return {};
}

export function stringField(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function stringListField(data: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    if (typeof value === 'string' && value.trim()) {
      return value.split(',').map((part) => part.trim()).filter(Boolean);
    }
  }
  return [];
}

export function numberField(data: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function referenceField(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ref = value as Record<string, unknown>;
      for (const refKey of ['id', 'key', 'label']) {
        if (typeof ref[refKey] === 'string' && ref[refKey].trim()) return ref[refKey].trim();
      }
    }
  }
  return '';
}

export function referenceListField(data: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const ref = item as Record<string, unknown>;
        return String(ref.id ?? ref.key ?? ref.label ?? '');
      })
      .filter(Boolean);
  }
  return [];
}

export interface OutlineSceneProjection {
  id: string;
  artifactId: string | null;
  sceneEntityId: string | null;
  title: string;
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  ordinal: number;
  pov: string;
  location: string;
  storyTime: string;
  summary: string;
  goal: string;
  obstacle: string;
  turn: string;
  outcome: string;
  emotionalShift: string;
  threads: string[];
  characters: string[];
  tension: number | null;
  estimatedWords: number | null;
  actualWords: number | null;
  status: string;
  raw: UnknownStoryRecord;
}

export interface ChapterProjectionInput {
  id: string;
  number: number;
  title: string;
  summary?: string;
  wordCount?: number;
  povCharacterId?: string;
  locationId?: string;
  scenes?: Array<{
    id: string;
    chapterId: string;
    order: number;
    title: string;
    status: string;
    povCharacterId: string | null;
    locationId: string | null;
    storyDate: string | null;
    storyTime: string | null;
    estimatedWordCount: number | null;
    actualWordCount: number;
    sceneFunction: string;
    goal: string;
    obstacle: string;
    stakes: string;
    conflict: string;
    turn: string;
    revelation: string;
    outcome: string;
    emotionalValueShift: string;
    tension?: number | null;
    characterPresentIds: string[];
    plotThreadIds: string[];
    summary: string;
  }>;
}

function looksLikeScene(record: UnknownStoryRecord): boolean {
  const kind = String(record.type ?? record.kind ?? '').toLocaleLowerCase();
  return kind === 'sceneplan' || kind === 'scene-plan' || kind === 'scene_plan' || kind === 'scene';
}

/** Normalize ScenePlan artifacts once, then drive every outline projection from it. */
export function deriveOutlineScenes(
  artifacts: UnknownStoryRecord[],
  chapters: ChapterProjectionInput[],
  units: BuildManuscriptUnit[] = []
): OutlineSceneProjection[] {
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const artifactScenes: OutlineSceneProjection[] = artifacts.filter((artifact) => looksLikeScene(artifact) && !['superseded', 'invalidated'].includes(String(artifact.status ?? '').toLowerCase())).map((artifact, index) => {
    const data = storyRecordData(artifact);
    const typedArtifact = artifact as UnknownStoryRecord & { bindings?: Array<{ unitId?: string | null }> };
    const boundUnitId = typedArtifact.bindings?.find((binding) => binding.unitId)?.unitId;
    const unit = units.find((candidate) => candidate.id === boundUnitId)
      ?? units.find((candidate) => candidate.key === stringField(data, 'sceneKey', 'sceneId'));
    const parentUnit = unit?.parentUnitId ? units.find((candidate) => candidate.id === unit.parentUnitId) : undefined;
    const sourceSceneId = unit?.sourceSceneId ?? (stringField(data, 'sceneId') || null);
    const chapterId = referenceField(data, 'chapterId', 'chapter', 'chapterKey');
    const chapterPlan = artifacts.find((candidate) => {
      if (!['chapterbrief', 'chapter-brief', 'chapter_brief', 'chapter'].includes(String(candidate.type ?? candidate.kind ?? '').toLowerCase())) return false;
      const chapterData = storyRecordData(candidate);
      return candidate.key === chapterId || stringField(chapterData, 'chapterKey', 'chapterId') === chapterId;
    });
    const chapterPlanData = chapterPlan ? storyRecordData(chapterPlan) : {};
    const sourceChapterId = unit?.sourceChapterId ?? parentUnit?.sourceChapterId;
    const chapter = chapterById.get(sourceChapterId ?? chapterId)
      ?? chapters.find((candidate) => candidate.scenes?.some((scene) => scene.id === sourceSceneId))
      ?? chapters.find((candidate) => {
      const normalized = candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return candidate.number === (unit?.chapterNumber ?? parentUnit?.chapterNumber) || chapterId === `chapter-${candidate.number}` || chapterId === `chapter-${candidate.number.toString().padStart(2, '0')}` || normalized === chapterId;
    });
    return {
      id: unit?.id ?? (stringField(data, 'sceneId', 'sceneKey', 'id') || artifact.id),
      artifactId: artifact.id,
      sceneEntityId: sourceSceneId,
      title: unit?.title ?? (stringField(data, 'title', 'name') || artifact.title || artifact.name || `Scene ${index + 1}`),
      chapterId: chapter?.id ?? sourceChapterId ?? chapterId,
      chapterTitle: chapter?.title || parentUnit?.title || chapterPlan?.title || stringField(chapterPlanData, 'title') || stringField(data, 'chapterTitle') || unit?.containerKey || 'Unassigned',
      chapterNumber: chapter?.number ?? parentUnit?.chapterNumber ?? unit?.chapterNumber ?? numberField(chapterPlanData, 'number', 'chapterNumber') ?? numberField(data, 'chapterNumber') ?? Number.MAX_SAFE_INTEGER,
      ordinal: unit?.order ?? numberField(data, 'ordinal', 'order', 'position') ?? index,
      pov: unit?.povCharacterId ?? referenceField(data, 'povRef', 'pov', 'povCharacter', 'povCharacterId'),
      location: unit?.locationId ?? referenceField(data, 'locationRef', 'location', 'locationName', 'locationId'),
      storyTime: unit?.storyTime ?? (referenceField(data, 'storyTime', 'dateTime', 'time') || (data.storyTime ? JSON.stringify(data.storyTime) : '')),
      summary: stringField(data, 'summary', 'purpose', 'sceneFunction', 'function'),
      goal: stringField(data, 'goal', 'immediateGoal'),
      obstacle: stringField(data, 'obstacle', 'conflict'),
      turn: stringField(data, 'turn', 'revelation'),
      outcome: stringField(data, 'outcome', 'exitState'),
      emotionalShift: stringField(data, 'emotionalShift', 'emotionalValueShift', 'valueShift'),
      threads: [...new Set(referenceListField(data, 'plotThreadRefs').concat(stringListField(data, 'threads', 'plotThreads', 'threadIds')))],
      characters: [...new Set(referenceListField(data, 'characterRefs').concat(stringListField(data, 'characterPresentIds', 'characters', 'charactersPresent', 'characterIds')))],
      tension: unit?.tension ?? numberField(data, 'tension', 'tensionLevel'),
      estimatedWords: numberField(data, 'estimatedWordCount', 'estimatedWords', 'targetWords'),
      actualWords: unit?.wordCount ?? numberField(data, 'actualWords', 'wordCount'),
      status: String(unit?.status ?? artifact.status ?? data.status ?? 'planned'),
      raw: artifact
    } satisfies OutlineSceneProjection;
  });

  const representedSceneIds = new Set(artifactScenes.map((scene) => scene.sceneEntityId).filter(Boolean));
  const entityScenes: OutlineSceneProjection[] = [];
  for (const chapter of chapters) {
    for (const scene of chapter.scenes ?? []) {
      if (representedSceneIds.has(scene.id)) continue;
      entityScenes.push({
        id: scene.id,
        artifactId: null,
        sceneEntityId: scene.id,
        title: scene.title || `Scene ${scene.order + 1}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterNumber: chapter.number,
        ordinal: scene.order,
        pov: scene.povCharacterId ?? '',
        location: scene.locationId ?? '',
        storyTime: scene.storyTime ?? scene.storyDate ?? '',
        summary: scene.sceneFunction || scene.summary,
        goal: scene.goal,
        obstacle: scene.obstacle || scene.conflict,
        turn: scene.turn || scene.revelation,
        outcome: scene.outcome,
        emotionalShift: scene.emotionalValueShift,
        threads: scene.plotThreadIds,
        characters: scene.characterPresentIds,
        tension: scene.tension ?? null,
        estimatedWords: scene.estimatedWordCount,
        actualWords: scene.actualWordCount,
        status: scene.status,
        raw: {
          id: scene.id,
          type: 'scene',
          title: scene.title,
          status: scene.status,
          content: scene
        }
      });
    }
  }

  const scenes = artifactScenes.concat(entityScenes);

  return scenes.sort(
    (a, b) =>
      a.chapterNumber - b.chapterNumber ||
      a.ordinal - b.ordinal ||
      a.title.localeCompare(b.title)
  );
}

export function buildProgress(tasks: Array<{ status: string }>): number {
  if (tasks.length === 0) return 0;
  const weights: Record<string, number> = {
    done: 1,
    completed: 1,
    review: 0.9,
    running: 0.5,
    ready: 0.1,
    blocked: 0,
    failed: 0,
    cancelled: 0
  };
  const completed = tasks.reduce((sum, task) => sum + (weights[task.status] ?? 0), 0);
  return Math.round((completed / tasks.length) * 100);
}

export function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
