import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Cache compiled Handlebars templates by name. */
const templateCache = new Map<string, HandlebarsTemplateDelegate>();

function loadTemplate(name: string): HandlebarsTemplateDelegate {
  const cached = templateCache.get(name);
  if (cached) return cached;

  // Try the co-located .hbs file (works in dev with tsx and in production
  // if a build step copies the templates next to the compiled JS).
  const filePath = resolve(__dirname, `${name}.hbs`);
  const source = readFileSync(filePath, 'utf-8');
  const compiled = Handlebars.compile(source, { noEscape: true });
  templateCache.set(name, compiled);
  return compiled;
}

/** Context needed to render the system prompt template. */
export interface SystemPromptContext {
  project: {
    title: string;
    genre: string;
    tone: string;
    voice: string;
    perspective: string;
    pov: string;
  };
  themes: string;
  instructionDocs: Array<{ title: string; content: string }>;
}

/** Context needed to render the per-prompt user context template. */
export interface UserContextData {
  transcript: string;
  prompt: string;
}

/**
 * Render the system prompt from the Handlebars template.
 * Returns a fully-rendered string ready to pass as the `system` parameter.
 */
export function renderSystemPrompt(context: SystemPromptContext): string {
  const template = loadTemplate('systemPrompt');
  return template(context).trim();
}

/**
 * Render the per-prompt user context from the Handlebars template.
 * Returns a fully-rendered string ready to pass as the `prompt` parameter.
 */
export function renderUserContext(data: UserContextData): string {
  const template = loadTemplate('userContext');
  return template(data).trim();
}

/**
 * Clear cached templates — useful for tests or hot-reload scenarios.
 */
export function clearTemplateCache(): void {
  templateCache.clear();
}
