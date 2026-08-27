import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApplyRenameSymbolResult, RenameSymbolPreview } from '@opentales/sdk';
import RenameSymbolDialog from './RenameSymbolDialog.svelte';

const preview: RenameSymbolPreview = {
  projectId: 'project-1',
  targetType: 'character',
  targetId: 'character-1',
  oldName: 'Mara',
  aliases: ['The Fox'],
  newName: 'Maris',
  scope: 'main',
  buildRunId: null,
  caseSensitive: true,
  selectedNames: ['The Fox', 'Mara'],
  occurrences: [{
    id: 'occurrence-1',
    kind: 'canonical-writing',
    entityType: 'chapter',
    entityId: 'chapter-1',
    title: 'The crossing',
    writingId: 'writing-1',
    branchId: 'branch-1',
    versionId: 'version-1',
    buildRunId: null,
    artifactId: null,
    unitId: null,
    field: 'body',
    start: 4,
    end: 8,
    matchedText: 'Mara',
    beforeSnippet: 'When Mara crossed the bridge',
    afterSnippet: 'When Maris crossed the bridge'
  }],
  totalOccurrences: 1,
  truncated: false,
  expectedHeads: [{ writingId: 'writing-1', branchId: 'branch-1', versionId: 'version-1', bodyHash: 'body-hash' }],
  expectedRevisions: { 'character:character-1': '2026-01-01T00:00:00.000Z' },
  expectedEntityUpdatedAt: '2026-01-01T00:00:00.000Z',
  previewHash: 'preview-hash',
  conflicts: []
};

const applied: ApplyRenameSymbolResult = {
  previewHash: preview.previewHash,
  targetType: 'character',
  targetId: 'character-1',
  oldName: 'Mara',
  newName: 'Maris',
  aliases: ['Mara', 'The Fox'],
  scope: 'main',
  buildRunId: null,
  appliedOccurrences: 1,
  updatedBranches: [{ writingId: 'writing-1', branchId: 'branch-1', previousVersionId: 'version-1', newVersionId: 'version-2' }],
  updatedArtifactIds: [],
  updatedUnitIds: [],
  appliedAt: '2026-01-01T00:01:00.000Z'
};

afterEach(() => cleanup());

describe('RenameSymbolDialog', () => {
  it('shows an exact diff and requires reviewed confirmation before applying CAS inputs', async () => {
    const onPreview = vi.fn().mockResolvedValue(preview);
    const onApply = vi.fn().mockResolvedValue(applied);
    const onApplied = vi.fn();
    const onNavigate = vi.fn();
    render(RenameSymbolDialog, { props: {
      target: { targetType: 'character', targetId: 'character-1', name: 'Mara', aliases: ['The Fox'] },
      builds: [{ id: 'build-1', branchName: 'ai/alternate', status: 'paused' }],
      activeBuildId: 'build-1',
      onPreview,
      onApply,
      onApplied,
      onNavigate,
      onClose: vi.fn()
    } });

    expect(screen.getByRole('dialog', { name: 'Rename Mara' })).toBeTruthy();
    await fireEvent.input(screen.getByRole('textbox', { name: 'New name' }), { target: { value: 'Maris' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));

    await waitFor(() => expect(onPreview).toHaveBeenCalledWith({
      targetType: 'character',
      targetId: 'character-1',
      newName: 'Maris',
      scope: 'main',
      caseSensitive: true,
      includeAliases: ['The Fox']
    }));
    expect(await screen.findByText('When Mara crossed the bridge')).toBeTruthy();
    expect(screen.getByText('When Maris crossed the bridge')).toBeTruthy();
    expect(screen.getByText(/1 occurrence across 1 writing head/)).toBeTruthy();

    const applyButton = screen.getByRole('button', { name: 'Apply rename' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onNavigate).toHaveBeenCalledWith(preview.occurrences[0]);
    await fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this exact preview/ }));
    expect(applyButton.disabled).toBe(false);
    await fireEvent.click(applyButton);

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      confirm: true,
      previewHash: 'preview-hash',
      expectedHeads: preview.expectedHeads,
      expectedRevisions: preview.expectedRevisions,
      expectedEntityUpdatedAt: preview.expectedEntityUpdatedAt,
      idempotencyKey: expect.any(String)
    })));
    expect(onApplied).toHaveBeenCalledWith(applied);
    expect(await screen.findByText('Renamed Mara to Maris')).toBeTruthy();
  });

  it('offers all-build scope without a build id and blocks conflicted previews', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      ...preview,
      scope: 'all',
      buildRunId: null,
      conflicts: ["Another character already uses 'Maris' as a canonical name or alias"]
    });
    const onApply = vi.fn();
    render(RenameSymbolDialog, { props: {
      target: { targetType: 'character', targetId: 'character-1', name: 'Mara', aliases: [] },
      builds: [{ id: 'build-1', branchName: 'ai/alternate', status: 'paused' }],
      activeBuildId: 'build-1',
      onPreview,
      onApply,
      onClose: vi.fn()
    } });

    await fireEvent.input(screen.getByRole('textbox', { name: 'New name' }), { target: { value: 'Maris' } });
    await fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect((screen.getByRole('combobox', { name: /Build branches/ }) as HTMLSelectElement).value).toBe('');
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Resolve conflicts before applying');
    await fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this exact preview/ }));
    expect((screen.getByRole('button', { name: 'Apply rename' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('reuses the exact apply idempotency key after an ambiguous response failure', async () => {
    const keys: string[] = [];
    const onApply = vi.fn()
      .mockImplementationOnce(async (input) => { keys.push(input.idempotencyKey); throw new SyntaxError('truncated response'); })
      .mockImplementationOnce(async (input) => { keys.push(input.idempotencyKey); return applied; });
    render(RenameSymbolDialog, { props: {
      target: { targetType: 'character', targetId: 'character-1', name: 'Mara', aliases: [] },
      onPreview: vi.fn().mockResolvedValue({ ...preview, aliases: [], selectedNames: ['Mara'] }),
      onApply,
      onClose: vi.fn()
    } });

    await fireEvent.input(screen.getByRole('textbox', { name: 'New name' }), { target: { value: 'Maris' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    const reviewed = await screen.findByRole('checkbox', { name: /I reviewed this exact preview/ });
    await fireEvent.click(reviewed);
    await fireEvent.click(screen.getByRole('button', { name: 'Apply rename' }));
    expect((await screen.findByRole('alert')).textContent).toContain('truncated response');

    await fireEvent.click(reviewed);
    await fireEvent.click(screen.getByRole('button', { name: 'Apply rename' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
