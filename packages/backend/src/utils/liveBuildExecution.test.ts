import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertValidationDatabase, atomicValidationWrite, resolveValidationRunId, validationExitCode } from './liveBuildExecution.js';

const directories: string[] = [];
async function outputDirectory() {
  const dir = await mkdtemp(join(tmpdir(), 'opentales-validation-'));
  directories.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('durable live validation controls', () => {
  it('resumes the saved run after process environment and container are replaced', async () => {
    const dir = await outputDirectory();
    await atomicValidationWrite(`${dir}/run-id.txt`, 'existing-build');
    expect(await resolveValidationRunId(dir, undefined, true)).toBe('existing-build');
    await atomicValidationWrite(`${dir}/heartbeat.json`, '{"status":"DRAFTING"}');
    expect(JSON.parse(await readFile(`${dir}/heartbeat.json`, 'utf8')).status).toBe('DRAFTING');
  });

  it('refuses missing, corrupted and conflicting run checkpoints instead of creating another novel', async () => {
    const dir = await outputDirectory();
    await expect(resolveValidationRunId(dir, undefined, true)).rejects.toThrow('refusing to start a replacement story');
    expect(await resolveValidationRunId(dir, 'restored-build', true)).toBe('restored-build');
    await writeFile(`${dir}/run-id.txt`, '');
    await expect(resolveValidationRunId(dir, undefined, true)).rejects.toThrow('empty');
    await atomicValidationWrite(`${dir}/run-id.txt`, 'first');
    await expect(resolveValidationRunId(dir, 'second', true)).rejects.toThrow('conflicts');
  });

  it('rejects a production database URL without including its credentials in the error', () => {
    expect(() => assertValidationDatabase('postgresql://user:private-password@host/opentales_validation_gemini', 'opentales_validation_gemini')).not.toThrow();
    for (const [url, expected] of [
      ['postgresql://user:private-password@host/production', 'opentales_validation_gemini'],
      ['postgresql://user:private-password@host/production', 'production'],
      ['private-password', 'opentales_validation_luna']
    ]) {
      expect(() => assertValidationDatabase(url, expected)).toThrow(/Validation|Refusing/);
      try { assertValidationDatabase(url, expected); } catch (error) { expect(String(error)).not.toContain('private-password'); }
    }
  });

  it('does not turn paused or rejected builds into a paid automatic restart loop', () => {
    for (const status of ['FAILED', 'PAUSED', 'CANCELLED']) {
      expect(validationExitCode(false, true, status)).toBe(0);
      expect(validationExitCode(false, false, status)).toBe(1);
    }
    expect(validationExitCode(false, true, 'DRAFTING')).toBe(1);
    expect(validationExitCode(false, true, 'COMPLETED')).toBe(1); // Export verification must actually pass.
    expect(validationExitCode(true, true, 'COMPLETED')).toBe(0);
  });
});
