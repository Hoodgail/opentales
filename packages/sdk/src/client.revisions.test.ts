import { describe, expect, it, vi } from 'vitest';
import { OpenTalesClient } from './client.js';
function harness() { const fetcher = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch; return { client: new OpenTalesClient({ baseUrl: 'https://api.test', token: 'token', fetcher }), fetcher: fetcher as unknown as ReturnType<typeof vi.fn> }; }
describe('revision SDK contracts', () => {
  it('serializes snapshot lifecycle routes and CAS bodies', async () => {
    const { client, fetcher } = harness();
    await client.listNamedSnapshots('p', { scope: 'chapter' });
    await client.createNamedSnapshot('p', { idempotencyKey: 'create', label: 'Before edit', scope: 'chapter', chapterId: 'c' });
    await client.getNamedSnapshot('p', 's'); await client.compareNamedSnapshots('p', { leftSnapshotId: 's' });
    await client.restoreNamedSnapshot('p', 's', { idempotencyKey: 'restore', confirm: true, expectedHeads: { w: 'v2' } });
    await client.branchFromNamedSnapshot('p', 's', { idempotencyKey: 'branch', name: 'alternate' }); await client.deleteNamedSnapshot('p', 's');
    expect(fetcher.mock.calls.map((call) => String(call[0]).replace(/\?.*$/, ''))).toEqual([
      'https://api.test/projects/p/snapshots','https://api.test/projects/p/snapshots','https://api.test/projects/p/snapshots/s',
      'https://api.test/projects/p/snapshots/compare','https://api.test/projects/p/snapshots/s/restore','https://api.test/projects/p/snapshots/s/branch','https://api.test/projects/p/snapshots/s'
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[4][1]?.body))).toMatchObject({ confirm: true, expectedHeads: { w: 'v2' } });
  });
  it('serializes annotation and suggestion thread routes', async () => {
    const { client, fetcher } = harness();
    await client.listWritingAnnotations('p', { sceneId: 'scene', status: 'open' });
    await client.createWritingAnnotation('p', { idempotencyKey: 'a', writingId: 'w', branchId: 'b', versionId: 'v', kind: 'suggestion', start: 0, end: 3, quote: 'old', body: 'Change it', suggestedReplacement: 'new' });
    await client.getWritingAnnotation('p', 't'); await client.replyToWritingAnnotation('p', 't', { idempotencyKey: 'r', body: 'Reply' });
    await client.resolveWritingAnnotation('p', 't', { expectedRevision: 0 }); await client.reopenWritingAnnotation('p', 't', { expectedRevision: 1 });
    await client.acceptWritingSuggestion('p', 't', { idempotencyKey: 'accept', confirm: true, expectedRevision: 2, expectedHeadVersionId: 'v' });
    await client.rejectWritingSuggestion('p', 't2', { expectedRevision: 0 });
    expect(fetcher.mock.calls.map((call) => String(call[0]).replace(/\?.*$/, '')).slice(1)).toEqual([
      'https://api.test/projects/p/annotations','https://api.test/projects/p/annotations/t','https://api.test/projects/p/annotations/t/replies',
      'https://api.test/projects/p/annotations/t/resolve','https://api.test/projects/p/annotations/t/reopen','https://api.test/projects/p/annotations/t/accept','https://api.test/projects/p/annotations/t2/reject'
    ]);
  });
});
