export interface BuildExecutionIdentity {
  buildRunId: string;
  taskId: string;
  workerId: string;
  leaseToken?: string;
  leaseGeneration?: number;
}

interface RegisteredExecution extends BuildExecutionIdentity {
  controller: AbortController;
  settled: Promise<void>;
}

export interface AbortBuildExecutionsResult {
  matched: number;
  quiesced: boolean;
}

const executions = new Map<string, RegisteredExecution>();

export function executionRegistryKey(buildRunId: string, taskId: string): string {
  return `${buildRunId}:${taskId}`;
}

export function registerBuildExecution(
  identity: BuildExecutionIdentity,
  controller: AbortController,
  settled: Promise<void>
): () => void {
  const key = executionRegistryKey(identity.buildRunId, identity.taskId);
  if (executions.has(key)) throw new Error(`Build task ${identity.taskId} already has a local execution`);
  executions.set(key, { ...identity, controller, settled });
  return () => {
    const current = executions.get(key);
    if (current?.controller === controller) executions.delete(key);
  };
}

export async function abortBuildRunExecutions(
  buildRunId: string,
  reason = 'Build paused or cancelled',
  waitMs = 15_000
): Promise<AbortBuildExecutionsResult> {
  return abortMatching((execution) => execution.buildRunId === buildRunId, reason, waitMs);
}

export async function abortBuildTaskExecution(
  buildRunId: string,
  taskId: string,
  reason = 'Build task interrupted',
  waitMs = 15_000
): Promise<AbortBuildExecutionsResult> {
  return abortMatching(
    (execution) => execution.buildRunId === buildRunId && execution.taskId === taskId,
    reason,
    waitMs
  );
}

export function activeBuildExecutions(buildRunId?: string): BuildExecutionIdentity[] {
  return [...executions.values()]
    .filter((execution) => !buildRunId || execution.buildRunId === buildRunId)
    .map(({ controller: _controller, settled: _settled, ...identity }) => identity);
}

async function abortMatching(
  predicate: (execution: RegisteredExecution) => boolean,
  reason: string,
  waitMs: number
): Promise<AbortBuildExecutionsResult> {
  const matches = [...executions.values()].filter(predicate);
  for (const execution of matches) execution.controller.abort(new Error(reason));
  if (!matches.length) return { matched: 0, quiesced: true };
  const settled = Promise.allSettled(matches.map((execution) => execution.settled)).then(() => true);
  const timedOut = new Promise<false>((resolve) => {
    const timeout = setTimeout(() => resolve(false), Math.max(0, waitMs));
    timeout.unref?.();
  });
  return { matched: matches.length, quiesced: await Promise.race([settled, timedOut]) };
}
