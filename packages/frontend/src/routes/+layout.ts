// Static, single-page-ish app: prerender the shell and disable SSR so Monaco
// (which depends on browser globals) can mount cleanly.
export const prerender = true;
export const ssr = false;
export const trailingSlash = 'always';
