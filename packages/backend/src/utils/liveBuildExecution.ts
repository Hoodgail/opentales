import { readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Validation-only guard: fail before Prisma can connect to an unintended database. */
export function assertValidationDatabase(databaseUrl: string | undefined, expectedName: string | undefined): void {
  if (!expectedName) return;
  let actualName: string;
  try {
    actualName = decodeURIComponent(new URL(databaseUrl ?? '').pathname.slice(1));
  } catch {
    throw new Error('Validation requires a valid DATABASE_URL');
  }
  if (!expectedName.startsWith('opentales_validation_') || actualName !== expectedName) {
    throw new Error('Refusing to run validation against an unexpected database');
  }
}

export async function atomicValidationWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

export async function resolveValidationRunId(output: string, explicitId: string | undefined, requireExisting: boolean): Promise<string | undefined> {
  let savedId: string | undefined;
  try {
    savedId = (await readFile(`${output}/run-id.txt`, 'utf8')).trim();
    if (!savedId) throw new Error('Saved validation run ID is empty');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (savedId && explicitId && savedId !== explicitId) {
    throw new Error('LIVE_BUILD_ID conflicts with the saved validation run; use its own output directory');
  }
  const id = explicitId ?? savedId;
  if (requireExisting && !id) throw new Error('This validation deployment requires an existing build ID; refusing to start a replacement story');
  return id;
}

/** A supervised paused/failed run stops for review; a crash still exits nonzero. */
export function validationExitCode(completed: boolean, supervised: boolean, status: string | null): number {
  if (completed) return 0;
  return supervised && status !== null && ['FAILED', 'PAUSED', 'CANCELLED'].includes(status) ? 0 : 1;
}
