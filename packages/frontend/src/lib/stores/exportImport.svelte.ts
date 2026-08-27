import {
  OpenTalesClient,
  type ApplyProjectImportInput,
  type CreateProjectExportInput,
  type ProjectExport,
  type ProjectImportPreview
} from '@opentales/sdk';

const api = new OpenTalesClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  token: typeof localStorage !== 'undefined' ? localStorage.getItem('opentales.token') ?? undefined : undefined
});

export function syncExportImportToken(token: string | undefined) {
  api.setToken(token);
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function createExportImportStore() {
  let projectId = $state<string | null>(null);
  const exports = $state<ProjectExport[]>([]);
  const imports = $state<ProjectImportPreview[]>([]);
  let preview = $state<ProjectImportPreview | null>(null);
  let busy = $state(false);
  let progress = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function load(nextProjectId: string) {
    projectId = nextProjectId;
    busy = true;
    error = null;
    try {
      const [nextExports, nextImports] = await Promise.all([
        api.listProjectExports(nextProjectId),
        api.listProjectImports(nextProjectId)
      ]);
      if (projectId !== nextProjectId) return;
      exports.splice(0, exports.length, ...nextExports);
      imports.splice(0, imports.length, ...nextImports);
      preview = nextImports.find((item) => item.status === 'previewed') ?? null;
    } catch (caught) { error = message(caught, 'Failed to load publishing history'); }
    finally { busy = false; progress = null; }
  }

  async function createExport(input: CreateProjectExportInput) {
    if (!projectId) return null;
    busy = true;
    error = null;
    progress = input.target.kind === 'build' ? 'Compiling and validating the build branch…' : 'Rendering the main manuscript…';
    try {
      const created = await api.createProjectExport(projectId, input);
      exports.unshift(created);
      return created;
    } catch (caught) { error = message(caught, 'Export failed'); return null; }
    finally { busy = false; progress = null; }
  }

  async function download(item: ProjectExport) {
    if (!projectId) return;
    busy = true;
    error = null;
    progress = `Downloading ${item.filename}…`;
    try {
      const result = await api.downloadProjectExport(projectId, item.id);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (caught) { error = message(caught, 'Download failed'); }
    finally { busy = false; progress = null; }
  }

  async function regenerate(item: ProjectExport) {
    if (!projectId) return;
    busy = true;
    error = null;
    progress = `Regenerating ${item.format.toUpperCase()}…`;
    try {
      const created = await api.regenerateProjectExport(projectId, item.id, { idempotencyKey: crypto.randomUUID() });
      exports.unshift(created);
    } catch (caught) { error = message(caught, 'Regeneration failed'); }
    finally { busy = false; progress = null; }
  }

  async function remove(item: ProjectExport) {
    if (!projectId) return;
    busy = true;
    error = null;
    try {
      const deleted = await api.deleteProjectExport(projectId, item.id);
      const index = exports.findIndex((candidate) => candidate.id === deleted.id);
      if (index >= 0) exports[index] = deleted;
    } catch (caught) { error = message(caught, 'Delete failed'); }
    finally { busy = false; }
  }

  async function previewFile(file: File) {
    if (!projectId) return null;
    busy = true;
    error = null;
    progress = 'Parsing chapter structure without changing the project…';
    try {
      preview = await api.previewProjectImport(projectId, { idempotencyKey: crypto.randomUUID(), file, filename: file.name, mimeType: file.type || undefined });
      imports.unshift(preview);
      return preview;
    } catch (caught) { error = message(caught, 'Import preview failed'); return null; }
    finally { busy = false; progress = null; }
  }

  async function applyPreview(input: Omit<ApplyProjectImportInput, 'idempotencyKey'>) {
    if (!projectId || !preview) return null;
    busy = true;
    error = null;
    progress = 'Applying versioned chapter and scene changes transactionally…';
    try {
      const applied = await api.applyProjectImport(projectId, preview.id, { ...input, idempotencyKey: crypto.randomUUID() });
      preview = applied;
      const index = imports.findIndex((candidate) => candidate.id === applied.id);
      if (index >= 0) imports[index] = applied;
      return applied;
    } catch (caught) { error = message(caught, 'Import apply failed'); return null; }
    finally { busy = false; progress = null; }
  }

  function clearError() { error = null; }
  function reset() { projectId = null; exports.splice(0); imports.splice(0); preview = null; busy = false; progress = null; error = null; }

  return {
    get projectId() { return projectId; }, get exports() { return exports; }, get imports() { return imports; },
    get preview() { return preview; }, get busy() { return busy; }, get progress() { return progress; }, get error() { return error; },
    load, createExport, download, regenerate, remove, previewFile, applyPreview, clearError, reset
  };
}

export const exportImport = createExportImportStore();
