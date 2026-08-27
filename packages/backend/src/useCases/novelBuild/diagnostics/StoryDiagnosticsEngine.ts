import type { StoryDiagnostic, StoryDiagnosticsResult } from '@opentales/sdk';
import { buildDiagnosticContext, finalizeDiagnostics } from './internal.js';
import { runProseRules } from './proseRules.js';
import { runStructuralRules } from './structuralRules.js';
import type { StoryDiagnosticsEngineOptions, StoryDiagnosticsInput } from './types.js';

/**
 * Deterministic diagnostics over one transactionally consistent Novel Build
 * snapshot. The engine has no database or model dependency, making it suitable
 * for API requests, workflow quality gates, CI fixtures, and offline analysis.
 */
export class StoryDiagnosticsEngine {
  private readonly now: () => Date;

  constructor(options: StoryDiagnosticsEngineOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  diagnose(input: StoryDiagnosticsInput): StoryDiagnostic[] {
    assertInput(input);
    const context = buildDiagnosticContext(input);
    runStructuralRules(context);
    runProseRules(context);
    return finalizeDiagnostics(context.diagnostics);
  }

  run(input: StoryDiagnosticsInput): StoryDiagnosticsResult {
    const diagnostics = this.diagnose(input);
    return {
      projectId: input.projectId,
      buildRunId: input.buildRunId,
      generatedAt: input.metadata?.generatedAt ?? this.now().toISOString(),
      diagnostics
    };
  }
}

export function runStoryDiagnostics(input: StoryDiagnosticsInput): StoryDiagnostic[] {
  return new StoryDiagnosticsEngine().diagnose(input);
}

export function createStoryDiagnosticsResult(
  input: StoryDiagnosticsInput,
  options: StoryDiagnosticsEngineOptions = {}
): StoryDiagnosticsResult {
  return new StoryDiagnosticsEngine(options).run(input);
}

function assertInput(input: StoryDiagnosticsInput): void {
  if (!input || typeof input !== 'object') throw new TypeError('Story diagnostics input is required');
  if (!input.projectId?.trim()) throw new TypeError('Story diagnostics projectId is required');
  if (!input.buildRunId?.trim()) throw new TypeError('Story diagnostics buildRunId is required');
  for (const key of [
    'chapters',
    'characters',
    'locations',
    'artifacts',
    'canonFacts',
    'entityStates',
    'timelineEvents',
    'openLoops',
    'setupPayoffs',
    'plotThreads'
  ] as const) {
    if (!Array.isArray(input[key])) throw new TypeError(`Story diagnostics ${key} must be an array`);
  }
  for (const chapter of input.chapters) {
    if (!chapter.id?.trim()) throw new TypeError('Every diagnostic chapter requires an id');
    if (!Number.isFinite(chapter.number)) throw new TypeError(`Chapter ${chapter.id} requires a finite number`);
    if (!Array.isArray(chapter.scenes)) throw new TypeError(`Chapter ${chapter.id} scenes must be an array`);
    for (const scene of chapter.scenes) {
      if (!scene.id?.trim()) throw new TypeError(`Every scene in chapter ${chapter.id} requires an id`);
      if (!Number.isFinite(scene.order)) throw new TypeError(`Scene ${scene.id} requires a finite order`);
      if (typeof scene.content !== 'string') throw new TypeError(`Scene ${scene.id} content must be a string`);
    }
  }
}

