import { cp, mkdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'src/useCases/ai/prompts');
const target = resolve(root, 'dist/src/useCases/ai/prompts');
const agentsSource = resolve(root, 'src/useCases/ai/agents');
const agentsTarget = resolve(root, 'dist/src/useCases/ai/agents');
const skillsSource = resolve(root, 'src/useCases/ai/skills');
const skillsTarget = resolve(root, 'dist/src/useCases/ai/skills');

await mkdir(target, { recursive: true });
await cp(source, target, {
  recursive: true,
  filter: (path) => path.endsWith('.hbs') || path === source
});

await mkdir(agentsTarget, { recursive: true });
await cp(agentsSource, agentsTarget, {
  recursive: true,
  filter: (path) => path.endsWith('.md') || path === agentsSource
});

await mkdir(skillsTarget, { recursive: true });
await cp(skillsSource, skillsTarget, {
  recursive: true,
  filter: (path) => path === skillsSource || path.endsWith('.md') || !extname(path)
});
