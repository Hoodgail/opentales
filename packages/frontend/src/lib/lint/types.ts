import type { Chapter, Character } from '@opentales/sdk';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface Diagnostic {
  ruleId: string;
  severity: DiagnosticSeverity;
  chapterId: string;
  chapterTitle: string;
  message: string;
  hint?: string;
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
