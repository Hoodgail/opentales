import type { BuildRun, BuildTask } from '@opentales/sdk';

export type BuildExecutionStatus =
  | { kind: 'provider-wait'; task: BuildTask; retryAt: string }
  | { kind: 'queued' }
  | null;

/** A phase is not proof that a worker is currently making progress. */
export function buildExecutionStatus(run: BuildRun | null, now: number): BuildExecutionStatus {
  if (!run?.authorizedAt || !['planning', 'drafting', 'revising'].includes(run.status)) return null;
  if (run.tasks.some(task => task.status === 'running')) return null;
  const ready = run.tasks.filter(task => task.status === 'ready');
  if (!ready.length) return null;
  const deadlines = ready.map(task => ({ task, at: Date.parse(task.retryAfterAt ?? '') }));
  if (deadlines.some(({ at }) => !Number.isFinite(at) || at <= now)) return { kind: 'queued' };
  deadlines.sort((a, b) => a.at - b.at);
  return { kind: 'provider-wait', task: deadlines[0]!.task, retryAt: new Date(deadlines[0]!.at).toISOString() };
}
