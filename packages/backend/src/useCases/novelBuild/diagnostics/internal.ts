import { createHash } from 'node:crypto';
import type {
  JsonObject,
  JsonValue,
  StoryDiagnostic,
  StoryReference,
  StorySourceSpan
} from '@opentales/sdk';
import type {
  DiagnosticChapterSnapshot,
  DiagnosticContext,
  DiagnosticDraft,
  DiagnosticSceneSnapshot,
  StoryDiagnosticsInput
} from './types.js';
import { countWords as countNaturalLanguageWords } from '../../../utils/wordCount.js';

export const DEFAULT_FILTER_WORDS = [
  'felt',
  'feel',
  'feels',
  'heard',
  'hear',
  'hears',
  'knew',
  'know',
  'knows',
  'looked',
  'look',
  'looks',
  'noticed',
  'notice',
  'notices',
  'realized',
  'realize',
  'realizes',
  'saw',
  'see',
  'sees',
  'seemed',
  'seem',
  'seems',
  'thought',
  'think',
  'thinks',
  'watched',
  'watch',
  'watches',
  'wondered',
  'wonder',
  'wonders'
] as const;

export const severityRank: Record<StoryDiagnostic['severity'], number> = {
  error: 3,
  warning: 2,
  info: 1
};

export function buildDiagnosticContext(input: StoryDiagnosticsInput): DiagnosticContext {
  const chapters = [...input.chapters].sort(
    (left, right) => left.number - right.number || left.id.localeCompare(right.id)
  );
  const scenes = chapters.flatMap((chapter) =>
    [...chapter.scenes]
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
      .map((scene) => ({ ...scene, chapterId: chapter.id }))
  );
  const diagnostics: DiagnosticDraft[] = [];
  const enabledCategories = new Set(
    input.metadata?.enabledCategories ?? input.projectRules?.enabledCategories ?? []
  );
  const disabledCodes = new Set([
    ...(input.projectRules?.disabledRuleCodes ?? []),
    ...(input.metadata?.disabledRuleCodes ?? [])
  ]);

  return {
    input,
    chapters,
    scenes,
    chapterById: new Map(chapters.map((chapter) => [chapter.id, chapter])),
    sceneById: new Map(scenes.map((scene) => [scene.id, scene])),
    sceneOrder: new Map(scenes.map((scene, index) => [scene.id, index])),
    characterById: new Map(input.characters.map((character) => [character.id, character])),
    locationById: new Map(input.locations.map((location) => [location.id, location])),
    activeArtifacts: input.artifacts.filter(
      (artifact) => artifact.status !== 'invalidated' && artifact.status !== 'superseded'
    ),
    artifactsById: new Map(input.artifacts.map((artifact) => [artifact.id, artifact])),
    diagnostics,
    add(draft) {
      if (disabledCodes.has(draft.code)) return;
      if (enabledCategories.size > 0 && !enabledCategories.has(draft.category)) return;
      diagnostics.push(normalizeDraft(draft));
    }
  };
}

export function finalizeDiagnostics(drafts: DiagnosticDraft[]): StoryDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics = drafts
    .map((draft) => {
      const normalized = normalizeDraft(draft);
      const identity = stableStringify({
        code: normalized.code,
        category: normalized.category,
        evidence: normalized.evidence,
        relatedRefs: normalized.relatedRefs,
        message: normalized.message
      });
      const id = createHash('sha256').update(identity).digest('hex').slice(0, 24);
      const diagnostic: StoryDiagnostic = { id, ...normalized };
      return diagnostic;
    })
    .filter((diagnostic) => {
      if (seen.has(diagnostic.id)) return false;
      seen.add(diagnostic.id);
      return true;
    });

  return diagnostics.sort(
    (left, right) =>
      severityRank[right.severity] - severityRank[left.severity] ||
      left.category.localeCompare(right.category) ||
      left.code.localeCompare(right.code) ||
      left.id.localeCompare(right.id)
  );
}

function normalizeDraft(draft: DiagnosticDraft): DiagnosticDraft {
  return {
    ...draft,
    code: draft.code.trim(),
    message: draft.message.trim(),
    evidence: uniqueBy(
      draft.evidence.filter(hasSourceSpan),
      (span) => stableStringify(span)
    ).sort(compareSourceSpans),
    relatedRefs: uniqueBy(
      draft.relatedRefs.filter((ref) => Boolean(ref.type && ref.id)),
      (ref) => `${ref.type}:${ref.id}`
    ).sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`)),
    suggestedResolution: draft.suggestedResolution?.trim() || null
  };
}

function hasSourceSpan(span: StorySourceSpan): boolean {
  return Boolean(
    span.chapterId ||
      span.sceneId ||
      span.artifactId ||
      span.quote ||
      span.start !== undefined ||
      span.end !== undefined
  );
}

function compareSourceSpans(left: StorySourceSpan, right: StorySourceSpan): number {
  return stableStringify(left).localeCompare(stableStringify(right));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

export function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function jsonString(value: JsonValue | null | undefined): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isJsonObject(value)) {
    for (const key of ['id', 'key', 'value', 'name', 'status', 'locationId']) {
      if (typeof value[key] === 'string') return value[key] as string;
    }
  }
  return null;
}

export function stringArray(value: JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = jsonString(item);
    return parsed ? [parsed] : [];
  });
}

export function reference(type: string, id: string, key?: string, label?: string): StoryReference {
  return {
    type,
    id,
    ...(key ? { key } : {}),
    ...(label ? { label } : {})
  };
}

export function sceneReference(scene: DiagnosticSceneSnapshot): StoryReference {
  return reference('scene', scene.id, undefined, scene.title);
}

export function chapterReference(chapter: DiagnosticChapterSnapshot): StoryReference {
  return reference('chapter', chapter.id, String(chapter.number), chapter.title);
}

export function sceneEvidence(
  scene: DiagnosticSceneSnapshot,
  details: { quote?: string; start?: number; end?: number } = {}
): StorySourceSpan {
  return {
    chapterId: scene.chapterId,
    sceneId: scene.id,
    ...(scene.sourceArtifactId ? { artifactId: scene.sourceArtifactId } : {}),
    ...(details.start !== undefined ? { start: details.start } : {}),
    ...(details.end !== undefined ? { end: details.end } : {}),
    ...(details.quote ? { quote: excerpt(details.quote) } : {})
  };
}

export function chapterEvidence(
  chapter: DiagnosticChapterSnapshot,
  details: { quote?: string; start?: number; end?: number } = {}
): StorySourceSpan {
  return {
    chapterId: chapter.id,
    ...(chapter.sourceArtifactId ? { artifactId: chapter.sourceArtifactId } : {}),
    ...(details.start !== undefined ? { start: details.start } : {}),
    ...(details.end !== undefined ? { end: details.end } : {}),
    ...(details.quote ? { quote: excerpt(details.quote) } : {})
  };
}

export function sourceEvidence(value: {
  sourceSpan?: StorySourceSpan | null;
  sourceChapterId?: string | null;
  sourceSceneId?: string | null;
  sourceArtifactId?: string | null;
  chapterId?: string | null;
  sceneId?: string | null;
}): StorySourceSpan | null {
  if (value.sourceSpan && hasSourceSpan(value.sourceSpan)) return value.sourceSpan;
  const span: StorySourceSpan = {
    ...(value.sourceChapterId || value.chapterId
      ? { chapterId: value.sourceChapterId ?? value.chapterId ?? undefined }
      : {}),
    ...(value.sourceSceneId || value.sceneId
      ? { sceneId: value.sourceSceneId ?? value.sceneId ?? undefined }
      : {}),
    ...(value.sourceArtifactId ? { artifactId: value.sourceArtifactId } : {})
  };
  return hasSourceSpan(span) ? span : null;
}

export function artifactEvidence(artifactId: string): StorySourceSpan {
  return { artifactId };
}

export function excerpt(value: string, maximum = 280): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maximum) return clean;
  return `${clean.slice(0, maximum - 1).trimEnd()}…`;
}

export function wordTokens(value: string): string[] {
  return value
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

export function wordCount(value: string): number {
  return countNaturalLanguageWords(value);
}

export function normalizeText(value: string): string {
  return wordTokens(value).join(' ');
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findEvidence(
  unit: TextUnit,
  quote: string,
  caseSensitive = false
): StorySourceSpan {
  const haystack = caseSensitive ? unit.text : unit.text.toLocaleLowerCase('en-US');
  const needle = caseSensitive ? quote : quote.toLocaleLowerCase('en-US');
  const start = haystack.indexOf(needle);
  const details = {
    quote,
    ...(start >= 0 ? { start, end: start + quote.length } : {})
  };
  return unit.scene ? sceneEvidence(unit.scene, details) : chapterEvidence(unit.chapter, details);
}

export interface TextUnit {
  key: string;
  chapter: DiagnosticChapterSnapshot;
  scene?: DiagnosticSceneSnapshot;
  text: string;
}

export function proseUnits(context: DiagnosticContext): TextUnit[] {
  const units: TextUnit[] = [];
  for (const chapter of context.chapters) {
    const sceneUnits = chapter.scenes
      .filter((scene) => scene.content.trim().length > 0)
      .map((scene) => ({
        key: `scene:${scene.id}`,
        chapter,
        scene,
        text: scene.content
      }));
    if (sceneUnits.length > 0) units.push(...sceneUnits);
    else if (chapter.content.trim()) {
      units.push({ key: `chapter:${chapter.id}`, chapter, text: chapter.content });
    }
  }
  return units;
}

export function parseSceneTimestamp(scene: DiagnosticSceneSnapshot): number | null {
  if (!scene.storyDate) return null;
  const date = scene.storyDate.trim();
  const time = scene.storyTime?.trim() || '00:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) {
    return null;
  }
  const timestamp = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function parseChronology(value: JsonValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim()) return numeric;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (!isJsonObject(value)) return null;
  for (const key of ['timestamp', 'dateTime', 'datetime', 'date', 'ordinal', 'order']) {
    const candidate = value[key];
    if (candidate !== undefined) {
      const parsed = parseChronology(candidate);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

export function isMetadataEnforced(input: StoryDiagnosticsInput): boolean {
  if (input.metadata?.planningMode === 'pantser') {
    return input.metadata.enforceOptionalSceneMetadata === true;
  }
  return Boolean(
    input.metadata?.enforceOptionalSceneMetadata ||
      Object.values(input.projectRules?.metadata ?? {}).some(Boolean)
  );
}

export function isManuscriptComplete(input: StoryDiagnosticsInput): boolean {
  return Boolean(
    input.metadata?.manuscriptComplete ||
      input.metadata?.phase === 'completed' ||
      input.metadata?.phase === 'finalizing' ||
      input.metadata?.phase === 'publishing'
  );
}

export function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]);
  return grouped;
}

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function flattenJson(
  value: JsonValue | null | undefined,
  prefix = '',
  output = new Map<string, string>()
): Map<string, string> {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenJson(item, `${prefix}[${index}]`, output));
    return output;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flattenJson(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  output.set(prefix, stableStringify(value));
  return output;
}

export function pairs<T>(values: T[]): Array<[T, T]> {
  const result: Array<[T, T]> = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      result.push([values[left], values[right]]);
    }
  }
  return result;
}

export function hasCycle(nodes: Array<{ id: string; dependencyIds: string[] }>): string[] | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      return [...path.slice(start), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    for (const dependencyId of byId.get(id)?.dependencyIds ?? []) {
      if (!byId.has(dependencyId)) continue;
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle) return cycle;
  }
  return null;
}
