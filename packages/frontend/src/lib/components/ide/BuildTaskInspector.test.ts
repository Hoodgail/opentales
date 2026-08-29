import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildTask } from '@opentales/sdk';
import BuildTaskInspector from './BuildTaskInspector.svelte';

afterEach(() => cleanup());

const task = {
  id: 'task-1', buildRunId: 'build-1', key: 'story-brief', type: 'create-story-brief', phase: 'planning', status: 'ready',
  dependencyIds: [], inputArtifactIds: [], outputArtifactIds: [], scopeUnitIds: [], assignedAgent: 'creator', skillVersions: {},
  acceptanceCriteria: {}, executionPolicy: {}, attempts: 0, maxAttempts: 3, revisionIteration: 0, maxRevisionIterations: 1,
  qualityThreshold: 0.8, priority: 10, progress: 0, revision: 0, leaseOwner: null, leaseGeneration: 0, runGeneration: 0,
  reservedTokens: 0, reservedCostMicros: 0, leaseExpiresAt: null, heartbeatAt: null, startedAt: null, completedAt: null,
  failedAt: null, cancelledAt: null, invalidatedAt: null, lastError: null, createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', transitions: []
} satisfies BuildTask;

describe('BuildTaskInspector tabs', () => {
  it('uses a roving tab stop, linked tabpanels, and arrow-key navigation', async () => {
    render(BuildTaskInspector, { task, tasks: [task], traces: [], evaluations: [] });
    const contract = screen.getByRole('tab', { name: 'Contract' });
    const trace = screen.getByRole('tab', { name: 'Trace 0' });
    expect(contract.getAttribute('aria-controls')).toBe('build-task-panel-task-1-task');
    expect(contract.getAttribute('tabindex')).toBe('0');

    contract.focus();
    await fireEvent.keyDown(contract, { key: 'ArrowRight' });

    expect(trace.getAttribute('aria-selected')).toBe('true');
    expect(trace.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(trace);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('build-task-tab-task-1-trace');
  });

  it('replaces exhausted retry with the explicit failed-boundary rerun action', async () => {
    const exhausted = {
      ...task,
      status: 'failed',
      attempts: task.maxAttempts,
      lastError: 'Provider failed after exhausting retries.'
    } satisfies BuildTask;
    const onRetry = vi.fn();
    const onRerun = vi.fn();
    render(BuildTaskInspector, { task: exhausted, tasks: [exhausted], traces: [], evaluations: [], onRetry, onRerun });

    expect(screen.queryByRole('button', { name: 'Retry task' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Rerun failed boundary' }));
    expect(onRetry).not.toHaveBeenCalled();
    expect(onRerun).toHaveBeenCalledWith(exhausted, expect.any(MouseEvent));
  });
});
