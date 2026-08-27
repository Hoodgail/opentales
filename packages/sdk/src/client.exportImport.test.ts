import { describe, expect, it, vi } from 'vitest';
import { OpenTalesClient } from './client.js';

describe('export/import SDK contracts', () => {
  it('uses authenticated export lifecycle endpoints and binary download metadata', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/download')) return new Response('bytes', { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': "attachment; filename*=UTF-8''Novel.pdf" } });
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = new OpenTalesClient({ baseUrl: 'https://api.example.test', token: 'secret', fetcher });
    await client.listProjectExports('p');
    await client.createProjectExport('p', { idempotencyKey: 'e1', format: 'docx', preset: 'standard-manuscript', target: { kind: 'main' } });
    await client.regenerateProjectExport('p', 'e', { idempotencyKey: 'e2' });
    await client.deleteProjectExport('p', 'e');
    const download = await client.downloadProjectExport('p', 'e');
    expect(download.filename).toBe('Novel.pdf');
    expect(download.mimeType).toBe('application/pdf');
    expect(await download.blob.text()).toBe('bytes');
    expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`)).toEqual([
      'GET https://api.example.test/projects/p/exports',
      'POST https://api.example.test/projects/p/exports',
      'POST https://api.example.test/projects/p/exports/e/regenerate',
      'DELETE https://api.example.test/projects/p/exports/e',
      'GET https://api.example.test/projects/p/exports/e/download'
    ]);
    expect(new Headers(calls[4].init?.headers).get('authorization')).toBe('Bearer secret');
  });

  it('uploads import previews as multipart and applies only through the explicit endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const payload = { id: 'i', chapters: [], conflicts: [] };
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = new OpenTalesClient({ baseUrl: 'https://api.example.test', token: 'secret', fetcher });
    await client.listProjectImports('p');
    await client.previewProjectImport('p', { idempotencyKey: 'preview', file: new Blob(['# Chapter 1\nBody'], { type: 'text/markdown' }), filename: 'novel.md', mimeType: 'text/markdown' });
    await client.applyProjectImport('p', 'i', { idempotencyKey: 'apply', confirmConflicts: true });
    expect(calls[1].init?.body).toBeInstanceOf(FormData);
    const form = calls[1].init?.body as FormData;
    expect(form.get('idempotencyKey')).toBe('preview');
    expect((form.get('file') as File).name).toBe('novel.md');
    expect(new Headers(calls[1].init?.headers).has('content-type')).toBe(false);
    expect(calls[2]).toMatchObject({ url: 'https://api.example.test/projects/p/imports/i/apply', init: { method: 'POST' } });
  });
});
