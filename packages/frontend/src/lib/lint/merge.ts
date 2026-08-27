import type { Diagnostic, RevisionPass } from './types';

export function revisionPassForCategory(category: string): RevisionPass {
  if (['continuity', 'chronology', 'knowledge', 'location', 'world-rule'].includes(category)) return 'continuity';
  if (['setup-payoff', 'plot', 'cross-link'].includes(category)) return 'story';
  if (category === 'character') return 'character';
  if (category === 'pacing') return 'pacing';
  if (category === 'repetition' || category === 'style') return 'line';
  if (category === 'dialogue' || category === 'pov' || category === 'metadata') return 'scene';
  if (category === 'publishing') return 'proof';
  if (category === 'schema' || category === 'workflow') return 'final';
  return 'scene';
}

function evidenceKey(diagnostic: Diagnostic): string {
  const item = (diagnostic.evidence ?? []).find((candidate) => candidate.unitId || candidate.chapterId || candidate.sceneId || candidate.artifactId);
  return item ? [item.unitId, item.chapterId, item.sceneId, item.artifactId, item.lineStart, item.lineEnd].join(':') : diagnostic.chapterId;
}

export function diagnosticFingerprint(diagnostic: Diagnostic): string {
  const canonicalRule = diagnostic.ruleId.trim().toLocaleLowerCase().split(/[/:]/u).at(-1) ?? diagnostic.ruleId;
  return [
    canonicalRule,
    diagnostic.category ?? '',
    diagnostic.chapterId,
    diagnostic.lineStart ?? '',
    diagnostic.lineEnd ?? '',
    evidenceKey(diagnostic)
  ].join('\0');
}

/** Prefer semantic diagnostics when local and persisted engines report the same issue. */
export function mergeDiagnostics(...groups: Diagnostic[][]): Diagnostic[] {
  const merged = new Map<string, Diagnostic>();
  for (const diagnostic of groups.flat()) {
    const fingerprint = diagnosticFingerprint(diagnostic);
    const existing = merged.get(fingerprint);
    if (!existing || diagnostic.source === 'semantic') merged.set(fingerprint, diagnostic);
  }
  return [...merged.values()];
}
