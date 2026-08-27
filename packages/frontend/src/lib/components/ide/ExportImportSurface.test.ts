import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createExport: vi.fn(async () => null),
  previewFile: vi.fn(async () => null),
  applyPreview: vi.fn(async () => null),
  load: vi.fn(async () => undefined),
  loadRuns: vi.fn(async () => undefined),
  refreshProject: vi.fn(async () => undefined)
}));

vi.mock('$lib/stores/exportImport.svelte', () => ({
  exportImport: {
    exports: [], imports: [], busy: false, progress: null, error: null,
    preview: {
      id: 'import-1', projectId: 'project-1', assetId: 'asset-1', format: 'markdown', status: 'previewed', filename: 'novel.md',
      mimeType: 'text/markdown', checksum: 'a'.repeat(64), sizeBytes: 100,
      chapters: [{ number: 1, title: 'Arrival', body: 'Imported body.', scenes: [] }],
      conflicts: [{ kind: 'chapter-number', sourceKey: '1', existingId: 'chapter-1', message: 'Chapter number 1 already exists.' }],
      sourceMetadata: {}, expiresAt: '2030-01-01T00:00:00.000Z', appliedAt: null, applyResult: null, error: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    },
    load: mocks.load, createExport: mocks.createExport, previewFile: mocks.previewFile, applyPreview: mocks.applyPreview,
    download: vi.fn(), regenerate: vi.fn(), remove: vi.fn(), clearError: vi.fn()
  }
}));
vi.mock('$lib/stores/manuscript.svelte', () => ({ manuscript: { projectId: 'project-1', currentUserRole: 'OWNER', refreshProject: mocks.refreshProject } }));
vi.mock('$lib/stores/storyIde.svelte', () => ({ storyIde: { runs: [{ id: 'build-1', objective: 'Build a novel', status: 'completed' }], selectedRunId: 'build-1', loadRuns: mocks.loadRuns } }));

const { default: ExportImportSurface } = await import('./ExportImportSurface.svelte');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ExportImportSurface', () => {
  it('submits explicit format, preset and source selection', async () => {
    render(ExportImportSurface);
    await fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'pdf' } });
    await fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'build' } });
    await fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'build-1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate & validate' }));
    expect(mocks.createExport).toHaveBeenCalledWith(expect.objectContaining({
      format: 'pdf', preset: 'standard-manuscript', target: { kind: 'build', buildRunId: 'build-1' }
    }));
  });

  it('requires explicit conflict confirmation before applying a preview', async () => {
    render(ExportImportSurface);
    const apply = screen.getByRole('button', { name: 'Apply versioned import' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await fireEvent.click(screen.getByLabelText('Confirm versioned overwrite of matched chapters'));
    expect(apply.disabled).toBe(false);
    await fireEvent.click(apply);
    expect(mocks.applyPreview).toHaveBeenCalledWith(expect.objectContaining({ confirmConflicts: true, restoreStructuredState: false }));
  });
});
