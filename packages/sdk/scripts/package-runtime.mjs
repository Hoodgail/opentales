import { readFile, writeFile } from 'node:fs/promises';

const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
// The workspace manifest serves TypeScript to Vite/tsx. A deployed package
// must resolve only compiled JavaScript, without depending on either loader.
const runtime = {
  name: source.name,
  version: source.version,
  private: source.private,
  type: 'module',
  main: './index.js',
  types: './index.d.ts',
  exports: { '.': { types: './index.d.ts', default: './index.js' } },
  ...(source.dependencies ? { dependencies: source.dependencies } : {})
};
await writeFile(new URL('../dist/package.json', import.meta.url), `${JSON.stringify(runtime, null, 2)}\n`);
