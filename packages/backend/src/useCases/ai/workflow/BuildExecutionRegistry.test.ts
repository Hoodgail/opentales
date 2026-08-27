import { describe, expect, it } from 'vitest';
import {
  abortBuildRunExecutions,
  activeBuildExecutions,
  registerBuildExecution
} from './BuildExecutionRegistry.js';

describe('build execution abort registry', () => {
  it('aborts and quiesces every in-process task for a paused run', async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });
    const unregister = registerBuildExecution(
      { buildRunId: 'build-1', taskId: 'task-1', workerId: 'worker-1', leaseToken: 'lease-1', leaseGeneration: 3 },
      controller,
      settled
    );
    controller.signal.addEventListener('abort', finish, { once: true });
    expect(activeBuildExecutions('build-1')).toHaveLength(1);
    const result = await abortBuildRunExecutions('build-1', 'paused', 1_000);
    expect(result).toEqual({ matched: 1, quiesced: true });
    expect(controller.signal.aborted).toBe(true);
    unregister();
    expect(activeBuildExecutions('build-1')).toHaveLength(0);
  });
});
