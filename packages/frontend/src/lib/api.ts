import { OpenTalesClient } from '@opentales/sdk';

const TOKEN_KEY = 'opentales.token';

function browserLocalStorage(): Storage {
  if (typeof localStorage !== 'undefined') return localStorage;
  return {
    length: 0,
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    removeItem: () => undefined,
    setItem: () => undefined
  };
}

const initialToken = browserLocalStorage().getItem(TOKEN_KEY) ?? undefined;

/**
 * Singleton OpenTales SDK client. Token state is synced with localStorage so
 * non-SDK helpers (e.g. the SSE stream that needs the bearer token in the
 * Authorization header) stay in sync with whatever the manuscript store does.
 */
export const api = new OpenTalesClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  token: initialToken
});

export function getApiToken(): string | undefined {
  return browserLocalStorage().getItem(TOKEN_KEY) ?? undefined;
}

export function setApiToken(token: string | undefined) {
  api.setToken(token);
  if (token) browserLocalStorage().setItem(TOKEN_KEY, token);
  else browserLocalStorage().removeItem(TOKEN_KEY);
}

export const apiBaseUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  ''
);
