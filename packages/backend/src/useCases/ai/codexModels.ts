export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_ISSUER = 'https://auth.openai.com';
export const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
export const CODEX_DEVICE_VERIFICATION_URL = `${CODEX_ISSUER}/codex/device`;
export const CODEX_MODEL_PREFIX = 'codex/';
export const DEFAULT_CODEX_MODEL = `${CODEX_MODEL_PREFIX}gpt-5.4`;

const ALLOWED_MODELS = new Set([
  'gpt-5.5',
  'gpt-5.3-codex-spark',
  'gpt-5.4',
  'gpt-5.4-mini'
]);
const DISALLOWED_MODELS = new Set(['gpt-5.5-pro']);

export function bareCodexModelId(modelId: string): string {
  const trimmed = modelId.trim();
  return trimmed.startsWith(CODEX_MODEL_PREFIX)
    ? trimmed.slice(CODEX_MODEL_PREFIX.length)
    : trimmed;
}

export function canonicalCodexModelId(modelId: string): string {
  return `${CODEX_MODEL_PREFIX}${bareCodexModelId(modelId)}`;
}

/** Mirrors the subscription model gate documented in CODEX.md. */
export function isCodexModelAllowed(modelId: string): boolean {
  const id = bareCodexModelId(modelId);
  if (/(?:^|-)pro(?:$|-)/i.test(id)) return false;
  if (ALLOWED_MODELS.has(id)) return true;
  if (DISALLOWED_MODELS.has(id)) return false;
  if (id === 'gpt-5.6') return false;
  const match = id.match(/^gpt-(\d+\.\d+)/);
  return match ? Number.parseFloat(match[1]) > 5.4 : false;
}

export function usesCodexExtendedLimits(modelId: string): boolean {
  const id = bareCodexModelId(modelId);
  return id.includes('gpt-5.5') || id.includes('gpt-5.6');
}
