import { describe, expect, it } from 'vitest';
import { mergeDiagnostics, revisionPassForCategory } from './merge';
import type { Diagnostic } from './types';

function diagnostic(source: Diagnostic['source']): Diagnostic {
  return {
    ruleId: source === 'semantic' ? 'semantic/duplicate' : 'local/duplicate',
    severity: source === 'semantic' ? 'error' : 'warning', category: 'continuity', pass: 'continuity', chapterId: 'chapter-1', chapterTitle: 'One',
    message: source === 'semantic' ? 'Mara uses a secret before learning it.' : 'Mara knows the secret too early.', source,
    evidence: [{ chapterId: 'chapter-1', lineStart: 4, lineEnd: 4 }]
  };
}

describe('diagnostic projections', () => {
  it('maps every specialized category to the intended revision pass', () => {
    expect(revisionPassForCategory('character')).toBe('character');
    expect(revisionPassForCategory('pacing')).toBe('pacing');
    expect(revisionPassForCategory('publishing')).toBe('proof');
    expect(revisionPassForCategory('style')).toBe('line');
    expect(revisionPassForCategory('knowledge')).toBe('continuity');
  });

  it('deduplicates local and semantic copies while preferring semantic provenance', () => {
    const merged = mergeDiagnostics([diagnostic('local')], [diagnostic('semantic')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('semantic');
  });
});
