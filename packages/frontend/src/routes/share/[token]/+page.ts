import type { PageLoad } from './$types';
import type { BetaShareView } from '@opentales/sdk';
import { error } from '@sveltejs/kit';

// Beta-reader share view — token-gated, no auth.
export const prerender = false;
export const ssr = false;

const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') as string;

export const load: PageLoad = async ({ fetch, params }) => {
  const url = `${API_BASE}/public/share/${encodeURIComponent(params.token)}`;
  const res = await fetch(url);
  if (res.status === 404) throw error(404, 'Share link not found');
  if (res.status === 410) throw error(410, 'This share link has expired');
  if (!res.ok) throw error(res.status, 'Failed to load share');
  const view = (await res.json()) as BetaShareView;
  return { view, token: params.token };
};
