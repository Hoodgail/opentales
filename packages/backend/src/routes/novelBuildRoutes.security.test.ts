import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://opentales:opentales@127.0.0.1:55432/opentales_test?schema=public';
process.env.JWT_SECRET ??= 'novel-build-route-test-secret';
const { novelBuildRoutes } = await import('./novelBuildRoutes.js');

describe('Novel Build public route boundary', () => {
  const stack = (novelBuildRoutes as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
  }).stack;
  const routes = stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route!.methods).join(',').toUpperCase()} ${layer.route!.path}`);

  it('keeps worker execution mutations off the authenticated project API', () => {
    for (const forbidden of [
      '/:projectId/builds/:buildRunId/recover',
      '/:projectId/builds/:buildRunId/tasks/claim',
      '/:projectId/builds/:buildRunId/tasks/:taskId/heartbeat',
      '/:projectId/builds/:buildRunId/tasks/:taskId/complete',
      '/:projectId/builds/:buildRunId/tasks/:taskId/fail',
      '/:projectId/builds/:buildRunId/chapter-tasks',
      '/:projectId/builds/:buildRunId/writing-branches',
      '/:projectId/builds/:buildRunId/writing-patches',
      '/:projectId/builds/:buildRunId/traces',
      '/:projectId/builds/:buildRunId/evaluations'
    ]) {
      expect(routes.some((route) => route.endsWith(` ${forbidden}`))).toBe(false);
    }
  });

  it('retains author controls, manual state edits, reads and diagnostics', () => {
    expect(routes).toEqual(expect.arrayContaining([
      'POST /:projectId/builds/:buildRunId/authorization',
      'POST /:projectId/builds/:buildRunId/pause',
      'POST /:projectId/builds/:buildRunId/resume',
      'POST /:projectId/builds/:buildRunId/cancel',
      'POST /:projectId/builds/:buildRunId/tasks/:taskId/retry',
      'POST /:projectId/builds/:buildRunId/tasks/:taskId/rerun',
      'POST /:projectId/builds/:buildRunId/replan',
      'POST /:projectId/builds/:buildRunId/branches/from-checkpoint',
      'GET /:projectId/builds/:buildRunId/units',
      'POST /:projectId/builds/:buildRunId/units/reorder',
      'GET /:projectId/builds/:buildRunId/comparison',
      'POST /:projectId/builds/:buildRunId/reviews/:reviewId/approve',
      'POST /:projectId/builds/:buildRunId/reviews/:reviewId/merge',
      'POST /:projectId/builds/:buildRunId/reviews/:reviewId/reject',
      'POST /:projectId/builds/:buildRunId/artifacts/batch',
      'POST /:projectId/builds/:buildRunId/story-state/batch',
      'GET /:projectId/builds/:buildRunId/story-state/delta',
      'GET /:projectId/builds/:buildRunId/story-state/history/:entityKind/:key',
      'GET /:projectId/builds/:buildRunId/observability',
      'POST /:projectId/builds/:buildRunId/search',
      'POST /:projectId/builds/:buildRunId/references',
      'GET /:projectId/builds/:buildRunId/diagnostics'
    ]));
  });
});
