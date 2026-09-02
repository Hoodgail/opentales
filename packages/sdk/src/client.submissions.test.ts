import { describe, expect, it, vi } from 'vitest';
import { OpenTalesClient } from './client.js';

describe('OpenTalesClient submission editing', () => {
  it('sends stale-safe open-submission updates through the project-scoped route', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'submission-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch;
    const client = new OpenTalesClient({ baseUrl: 'https://api.example.test/', token: 'secret', fetcher });

    await client.updateSubmission('project-1', 'submission-1', {
      expectedHeadVersionId: 'version-1',
      title: 'Continuity repair',
      body: 'Corrected proposal body.'
    });

    const mock = fetcher as unknown as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls[0][0]).toBe('https://api.example.test/projects/project-1/submissions/submission-1');
    expect(mock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'PATCH' }));
    expect(JSON.parse(String(mock.mock.calls[0][1]?.body))).toEqual({
      expectedHeadVersionId: 'version-1',
      title: 'Continuity repair',
      body: 'Corrected proposal body.'
    });
  });
});
