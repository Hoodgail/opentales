import type {
  ApplyRenameSymbolInput,
  ApplyRenameSymbolResult,
  PreviewRenameSymbolInput,
  RenameSymbolOccurrence,
  RenameSymbolPreview,
  RenameSymbolScope,
  RenameSymbolTargetType
} from '@opentales/sdk';

export type {
  ApplyRenameSymbolInput,
  ApplyRenameSymbolResult,
  RenameSymbolOccurrence,
  RenameSymbolPreview,
  RenameSymbolScope,
  RenameSymbolTargetType
};

export type RenameSymbolInput = PreviewRenameSymbolInput;

export interface RenameSymbolTarget {
  targetType: RenameSymbolTargetType;
  targetId: string;
  name: string;
  aliases: string[];
}

export function normalizeRenameInput(input: RenameSymbolInput): RenameSymbolInput {
  const buildRunId = input.buildRunId?.trim();
  const normalized: RenameSymbolInput = {
    ...input,
    newName: input.newName.trim(),
    includeAliases: [...new Set(input.includeAliases.map((alias) => alias.trim()).filter(Boolean))]
  };
  if (buildRunId) normalized.buildRunId = buildRunId;
  else delete normalized.buildRunId;
  return normalized;
}

export function renameInputError(input: RenameSymbolInput, oldName: string): string | null {
  if (!input.newName.trim()) return 'Enter the new name.';
  if (input.newName.trim() === oldName.trim()) return 'The new name must be different from the current name.';
  if (input.scope === 'build' && !input.buildRunId) return 'Choose the build branch to rename.';
  return null;
}

export function occurrenceCounts(occurrences: RenameSymbolOccurrence[]): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>();
  for (const occurrence of occurrences) counts.set(occurrence.kind, (counts.get(occurrence.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

export function lineFromOffset(content: string, offset: number): number {
  return content.slice(0, Math.max(0, offset)).split('\n').length;
}

export function isRenameableSymbol(kind: string): kind is RenameSymbolTargetType {
  return kind === 'character' || kind === 'location';
}
