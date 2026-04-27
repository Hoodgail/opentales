import type { PageLoad } from './$types';
import type { PublicProject } from '@opentales/sdk';
import { error } from '@sveltejs/kit';

// Dynamic public read pages — cannot be prerendered (params are user-supplied).
export const prerender = false;
export const ssr = false;

const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') as string;

export const load: PageLoad = async ({ fetch, params }) => {
  const url = `${API_BASE}/public/projects/${encodeURIComponent(params.orgSlug)}/${encodeURIComponent(params.projectSlug)}`;
  const res = await fetch(url);
  if (res.status === 404) throw error(404, 'Project not found');
  if (!res.ok) throw error(res.status, 'Failed to load project');
  const project = (await res.json()) as PublicProject;
  return { project };
};
