// Run in two fresh containers against one volume to catch missing native
// dependencies, runtime incompatibilities, and lost session persistence.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { OpencodeRuntime } from '../dist/src/useCases/ai/opencode/host.js';
import { opencodeRoot } from '../dist/src/useCases/ai/opencode/paths.js';

const mode = process.argv[2];
assert.ok(mode === 'write' || mode === 'read', 'Expected write or read');
const timeout = setTimeout(() => {
  console.error('OpenCode smoke test timed out');
  process.exit(1);
}, 60_000);
const prisma = new PrismaClient();
const runtime = new OpencodeRuntime(prisma);
try {
  const host = await runtime.host();
  const marker = path.join(opencodeRoot, 'smoke-session-id');
  if (mode === 'write') {
    const directory = path.join(opencodeRoot, 'projects', 'smoke');
    await mkdir(directory, { recursive: true });
    const session = await host.sessions.create({
      location: { directory },
      title: 'Deployment persistence smoke test',
    });
    await writeFile(marker, session.id);
  } else {
    const sessionID = await readFile(marker, 'utf8');
    const session = await host.sessions.get({ sessionID });
    assert.equal(session.title, 'Deployment persistence smoke test');
  }
  console.log(`OpenCode ${mode} smoke test passed`);
} finally {
  await runtime.close();
  await prisma.$disconnect();
  clearTimeout(timeout);
}
