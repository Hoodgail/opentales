import { describe, expect, it, vi } from 'vitest';
import { ApiError, OpenTalesClient } from './client.js';
import type { ApplyRenameSymbolInput, PreviewRenameSymbolInput } from './types.js';

function harness(status = 200, payload: unknown = {}) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })) as unknown as typeof fetch;
  return {
    client: new OpenTalesClient({ baseUrl: 'https://api.test', token: 'secret', fetcher }),
    fetcher: fetcher as unknown as ReturnType<typeof vi.fn>
  };
}

describe('symbol-aware rename SDK contracts', () => {
  const previewInput: PreviewRenameSymbolInput = {
    targetType: 'character',
    targetId: 'character-1',
    newName: 'Mara Vale',
    scope: 'all',
    buildRunId: 'build-1',
    caseSensitive: false,
    includeAliases: ['Dr. [Mara]+'],
    limit: 750
  };

  it('posts a bounded preview with auth and preserves explicit rename options', async () => {
    const { client, fetcher } = harness();
    await client.previewRenameSymbol('project / one', previewInput);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.test/projects/project / one/refactor/rename/preview');
    expect(request).toMatchObject({ method: 'POST' });
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer secret');
    expect(JSON.parse(String(request?.body))).toEqual(previewInput);
  });

  it('posts exact preview fencing and confirmation to apply', async () => {
    const { client, fetcher } = harness();
    const input: ApplyRenameSymbolInput = {
      ...previewInput,
      idempotencyKey: 'rename-1',
      confirm: true,
      previewHash: 'preview-hash',
      expectedEntityUpdatedAt: '2026-08-25T12:00:00.000Z',
      expectedHeads: [{ writingId: 'writing-1', branchId: 'branch-1', versionId: 'version-1', bodyHash: 'body-hash' }],
      expectedRevisions: { 'artifact:artifact-1': 'revision' }
    };
    await client.applyRenameSymbol('project-1', input);
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.test/projects/project-1/refactor/rename/apply');
    expect(JSON.parse(String(request?.body))).toEqual(input);
  });

  it('surfaces server conflicts as ApiError without masking details', async () => {
    const { client } = harness(409, { message: 'Rename preview is stale', details: { branchId: 'branch-1' } });
    await expect(client.previewRenameSymbol('project-1', previewInput)).rejects.toMatchObject({
      name: 'ApiError', status: 409, message: 'Rename preview is stale', details: { message: 'Rename preview is stale', details: { branchId: 'branch-1' } }
    } satisfies Partial<ApiError>);
  });
});
