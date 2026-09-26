import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const runtime = fileURLToPath(new URL('../dist/', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(runtime, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@opentales/sdk');
const directory = await mkdtemp(path.join(tmpdir(), 'opentales-sdk-runtime-'));
try {
  await mkdir(path.join(directory, 'node_modules', '@opentales'), { recursive: true });
  await symlink(runtime, path.join(directory, 'node_modules', '@opentales', 'sdk'), 'junction');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { OpenTalesClient, aiModelChoices } from '@opentales/sdk';
    assert.equal(typeof OpenTalesClient, 'function');
    assert.equal(typeof aiModelChoices, 'function');
    assert.ok(import.meta.resolve('@opentales/sdk').endsWith('/index.js'));
    console.log('Compiled SDK imports successfully in plain Node');
  `], { cwd: directory, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  process.stdout.write(result.stdout);
} finally {
  await rm(directory, { recursive: true, force: true });
}
