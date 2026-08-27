import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://opentales:opentales@127.0.0.1:55432/opentales_test?schema=public';
process.env.JWT_SECRET ??= 'rename-route-test-secret';
const { refactorRoutes } = await import('./refactorRoutes.js');

describe('rename refactor route boundary', () => {
  const stack = (refactorRoutes as unknown as {
    stack: Array<{ name?: string; route?: { path: string; methods: Record<string, boolean> } }>;
  }).stack;
  const routes = stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route!.methods).join(',').toUpperCase()} ${layer.route!.path}`);

  it('exposes only authenticated preview and explicit apply mutations', () => {
    expect(stack.some((layer) => layer.name === 'requireAuth')).toBe(true);
    expect(routes).toEqual([
      'POST /:projectId/refactor/rename/preview',
      'POST /:projectId/refactor/rename/apply'
    ]);
  });
});
