import { describe, expect, it } from 'vitest';
import {
  lineFromOffset,
  normalizeRenameInput,
  occurrenceCounts,
  renameInputError,
  type RenameSymbolOccurrence
} from './rename-symbol-ui';

describe('rename symbol UI model', () => {
  it('normalizes names and aliases without changing the explicit scope', () => {
    expect(normalizeRenameInput({
      targetType: 'character',
      targetId: 'character-1',
      newName: '  Eleanor  ',
      scope: 'all',
      buildRunId: undefined,
      caseSensitive: true,
      includeAliases: [' Lena ', 'Lena', '', 'Captain Vale']
    })).toEqual({
      targetType: 'character',
      targetId: 'character-1',
      newName: 'Eleanor',
      scope: 'all',
      caseSensitive: true,
      includeAliases: ['Lena', 'Captain Vale']
    });
  });

  it('requires a branch only for build-only scope', () => {
    const base = {
      targetType: 'location' as const,
      targetId: 'location-1',
      newName: 'North Terminal',
      caseSensitive: false,
      includeAliases: []
    };
    expect(renameInputError({ ...base, scope: 'build' }, 'North Station')).toBe('Choose the build branch to rename.');
    expect(renameInputError({ ...base, scope: 'all' }, 'North Station')).toBeNull();
    expect(renameInputError({ ...base, scope: 'main', newName: 'North Station' }, 'North Station')).toContain('different');
  });

  it('counts proof rows by persisted source and converts absolute offsets to editor lines', () => {
    const occurrence = (id: string, kind: RenameSymbolOccurrence['kind']): RenameSymbolOccurrence => ({
      id,
      kind,
      entityType: 'chapter',
      entityId: 'chapter-1',
      title: 'Chapter one',
      writingId: 'writing-1',
      branchId: 'branch-1',
      versionId: 'version-1',
      buildRunId: null,
      artifactId: null,
      unitId: null,
      field: 'body',
      start: 6,
      end: 10,
      matchedText: 'Mara',
      beforeSnippet: 'Hello Mara',
      afterSnippet: 'Hello Maris'
    });
    expect(occurrenceCounts([
      occurrence('1', 'canonical-writing'),
      occurrence('2', 'build-writing'),
      occurrence('3', 'canonical-writing')
    ])).toEqual([
      { kind: 'canonical-writing', count: 2 },
      { kind: 'build-writing', count: 1 }
    ]);
    expect(lineFromOffset('one\ntwo\nthree', 8)).toBe(3);
  });
});
