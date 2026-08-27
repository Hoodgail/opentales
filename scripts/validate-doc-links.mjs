import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
  path.join(root, 'README.md'),
  path.join(root, 'CONTRIBUTING.md'),
  path.join(root, 'docs'),
  path.join(root, 'packages/backend/README.md'),
  path.join(root, 'packages/sdk/README.md')
];

async function markdownFiles(target) {
  const statEntries = await readdir(target, { withFileTypes: true }).catch(() => null);
  if (!statEntries) return target.endsWith('.md') ? [target] : [];
  const nested = await Promise.all(
    statEntries.map((entry) => markdownFiles(path.join(target, entry.name)))
  );
  return nested.flat().filter((file) => file.endsWith('.md'));
}

const missing = [];
for (const file of (await Promise.all(roots.map(markdownFiles))).flat()) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].trim().replace(/^<|>$/g, '');
    if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    const pathname = decodeURIComponent(href.split('#')[0]);
    if (!pathname) continue;
    const target = pathname.startsWith('/')
      ? path.join(root, pathname.slice(1))
      : path.resolve(path.dirname(file), pathname);
    try {
      await access(target);
    } catch {
      missing.push(`${path.relative(root, file)} -> ${href}`);
    }
  }
}

if (missing.length) {
  process.stderr.write(`Broken local documentation links:\n${missing.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Documentation links verified.\n');
}
