import { allRules } from './rules';
import type { Diagnostic, LintContext, LintRule } from './types';

export interface LintRunOptions {
  rules?: LintRule[];
  enabled?: Set<string>;
}

export function runLint(context: LintContext, options: LintRunOptions = {}): Diagnostic[] {
  const rules = options.rules ?? allRules;
  const enabled = options.enabled;
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    if (enabled && !enabled.has(rule.id)) continue;
    try {
      diagnostics.push(...rule.run(context));
    } catch (error) {
      // A misbehaving rule must not blow up the whole linter; surface as
      // an info-level diagnostic so users notice it.
      diagnostics.push({
        ruleId: rule.id,
        severity: 'info',
        chapterId: '',
        chapterTitle: '',
        message: `Rule ${rule.id} failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      });
    }
  }

  return diagnostics;
}

export { allRules };
export type { Diagnostic, LintContext, LintRule } from './types';
