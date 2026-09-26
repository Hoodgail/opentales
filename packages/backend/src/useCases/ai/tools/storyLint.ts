import type { PrismaClient } from '@prisma/client';
import type { StoryDiagnostic } from '@opentales/sdk';
import { z } from 'zod';
import { getProjectInclude, toManuscriptProject } from '../../projects/projectMapper.js';
import { createStoryDiagnosticsResult, STORY_DIAGNOSTIC_CATEGORIES } from '../../storyState/diagnostics/index.js';
import type { DiagnosticChapterSnapshot, StoryDiagnosticsCategory } from '../../storyState/diagnostics/index.js';
import { tool, type ToolContext } from './shared.js';

const MAX_ISSUES = 60;

const inputSchema = z.object({
  chapterIds: z.array(z.string().trim().min(1)).max(100).optional()
    .describe('Limit prose checks to these chapters. Omit to check the whole manuscript.'),
  categories: z.array(z.enum(STORY_DIAGNOSTIC_CATEGORIES as unknown as [StoryDiagnosticsCategory, ...StoryDiagnosticsCategory[]])).max(20).optional()
    .describe('Only report these categories (e.g. "pov", "continuity", "style", "pacing", "setup-payoff").'),
  phase: z.enum(['planning', 'drafting', 'revising', 'completed']).optional()
    .describe('Current workflow phase. "completed" also checks unresolved threads and length targets. Defaults to drafting.'),
  targetWordCountMin: z.number().int().min(1).optional().describe('Lower bound of the agreed manuscript length.'),
  targetWordCountMax: z.number().int().min(1).optional().describe('Upper bound of the agreed manuscript length.'),
  bannedPhrases: z.array(z.string().trim().min(1)).max(100).optional()
    .describe('Phrases the style guide forbids (clichés, tics, anachronisms).'),
  minimumSeverity: z.enum(['info', 'warning', 'error']).optional().describe('Hide findings below this severity. Defaults to info.')
});

const severityOrder = { info: 0, warning: 1, error: 2 } as const;

/**
 * Deterministic manuscript diagnostics: POV and tense drift, head-hopping,
 * repetition, filter words, sentence rhythm, dialogue tags, chronology,
 * travel time, unknown characters/locations, scene metadata gaps, length
 * targets, and more. No model call; safe to run after every scene.
 */
export function runStoryLintTool(prisma: PrismaClient, context: ToolContext) {
  return tool({
    description:
      'Run deterministic story diagnostics over the current manuscript (no model call): POV/tense/person drift, head-hopping, repeated passages and phrases, filter words, monotonous rhythm, dialogue-tag overuse, chronology and travel-time contradictions, unknown characters or locations in scenes, missing scene metadata, word-count targets, and structural gaps. Returns counted issues with chapter/scene evidence and suggested fixes. Run it after drafting or revising a scene or chapter and before declaring a pass clean.',
    inputSchema,
    execute: async (input) => {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: context.projectId }, include: getProjectInclude() });
      const manuscript = toManuscriptProject(project);
      const scope = input.chapterIds?.length ? new Set(input.chapterIds) : null;
      const chapters = manuscript.chapters.filter((chapter) => !scope || scope.has(chapter.id)) as unknown as DiagnosticChapterSnapshot[];
      const minimum = severityOrder[input.minimumSeverity ?? 'info'];
      const phase = input.phase ?? 'drafting';
      const result = createStoryDiagnosticsResult({
        projectId: context.projectId,
        buildRunId: 'live-manuscript',
        chapters,
        characters: manuscript.characters.map((character) => ({ ...character, aliases: character.aliases ?? [] })),
        locations: manuscript.locations.map((location) => ({ ...location, aliases: location.aliases ?? [] })),
        artifacts: [],
        canonFacts: [],
        entityStates: [],
        timelineEvents: [],
        openLoops: [],
        setupPayoffs: [],
        plotThreads: [],
        projectRules: {
          publishing: {
            enabled: phase === 'completed',
            targetWordCountMin: input.targetWordCountMin,
            targetWordCountMax: input.targetWordCountMax
          },
          style: input.bannedPhrases?.length ? { bannedPhrases: input.bannedPhrases } : undefined,
          disabledRuleCodes: [
            // Legacy build-pipeline artifacts no longer exist in document-based projects.
            'missing-chapter-brief',
            'missing-publication-artifact',
            'duplicate-artifact-key',
            'duplicate-character-bible',
            'missing-story-state-scene'
          ]
        },
        metadata: {
          planningMode: 'hybrid',
          phase,
          manuscriptComplete: phase === 'completed',
          enabledCategories: input.categories
        }
      } as Parameters<typeof createStoryDiagnosticsResult>[0]);
      const issues = result.diagnostics.filter((diagnostic) => severityOrder[diagnostic.severity as keyof typeof severityOrder] >= minimum);
      return {
        checkedChapters: chapters.length,
        checkedScenes: chapters.reduce((sum, chapter) => sum + (chapter.scenes?.length ?? 0), 0),
        counts: {
          error: issues.filter((issue) => issue.severity === 'error').length,
          warning: issues.filter((issue) => issue.severity === 'warning').length,
          info: issues.filter((issue) => issue.severity === 'info').length
        },
        truncated: grouped(issues).length > MAX_ISSUES,
        issues: grouped(issues).slice(0, MAX_ISSUES)
      };
    }
  });
}

/** Collapse repeated findings (same code, message, and refs) into one entry with a count. */
function grouped(issues: StoryDiagnostic[]) {
  const byKey = new Map<string, ReturnType<typeof compactIssue> & { occurrences: number }>();
  for (const issue of issues) {
    const key = `${issue.code}|${issue.message}|${issue.relatedRefs.map((ref) => ref.id).join(',')}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (existing.evidence.length < 3) existing.evidence.push(...compactIssue(issue).evidence.slice(0, 3 - existing.evidence.length));
    } else byKey.set(key, { ...compactIssue(issue), occurrences: 1 });
  }
  return [...byKey.values()].sort((a, b) => severityOrder[b.severity as keyof typeof severityOrder] - severityOrder[a.severity as keyof typeof severityOrder]);
}

function compactIssue(issue: StoryDiagnostic) {
  return {
    code: issue.code,
    category: issue.category,
    severity: issue.severity,
    message: issue.message,
    fix: issue.suggestedResolution,
    refs: issue.relatedRefs.slice(0, 5).map((ref) => `${ref.type}:${ref.id}`),
    evidence: issue.evidence.slice(0, 3).map((span) => ({
      chapterId: span.chapterId ?? undefined,
      sceneId: span.sceneId ?? undefined,
      quote: span.quote ? span.quote.slice(0, 200) : undefined
    }))
  };
}
