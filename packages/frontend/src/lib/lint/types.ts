import type { Chapter, Character } from '@opentales/sdk';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export type DiagnosticCategory =
  | 'continuity'
  | 'chronology'
  | 'knowledge'
  | 'location'
  | 'world-rule'
  | 'character'
  | 'pov'
  | 'setup-payoff'
  | 'plot'
  | 'pacing'
  | 'repetition'
  | 'dialogue'
  | 'style'
  | 'metadata'
  | 'publishing'
  | 'workflow'
  | 'schema'
  | 'cross-link';

export type RevisionPass =
  | 'story'
  | 'character'
  | 'continuity'
  | 'pacing'
  | 'scene'
  | 'line'
  | 'copy'
  | 'proof'
  | 'final';

export interface DiagnosticEvidence {
  id?: string;
  unitId?: string;
  chapterId?: string;
  sceneId?: string;
  artifactId?: string;
  refType?: string;
  refId?: string;
  title?: string;
  excerpt?: string;
  lineStart?: number;
  lineEnd?: number;
  sourceSpan?: {
    unitId?: string;
    chapterId?: string;
    sceneId?: string;
    start?: number;
    end?: number;
    quote?: string;
  };
}

export interface Diagnostic {
  ruleId: string;
  severity: DiagnosticSeverity;
  chapterId: string;
  chapterTitle: string;
  message: string;
  hint?: string;
  category?: DiagnosticCategory;
  pass?: RevisionPass;
  evidence?: DiagnosticEvidence[];
  source?: 'local' | 'semantic';
  // Inclusive line range within the chapter body (1-indexed). Optional.
  lineStart?: number;
  lineEnd?: number;
}

export interface LintContext {
  chapters: Chapter[];
  characters: Character[];
}

export interface LintRule {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  run(context: LintContext): Diagnostic[];
}
