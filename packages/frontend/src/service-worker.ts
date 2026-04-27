/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// SvelteKit auto-registers a service worker when this file exists. We use
// the standard "precache app shell + cache-first for build assets,
// network-first for everything else" pattern.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `opentales-cache-${version}`;
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Don't intercept cross-origin (e.g. backend API on a different host).
  if (url.origin !== sw.location.origin) return;

  // Cache-first for build/static assets.
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Network-first for navigations and everything else (so SPA fallback +
  // fresh data wins when online; cached shell available when offline).
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Final fallback for navigations: serve the SPA shell so the app boots
    // offline and shows whatever local state is available.
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    throw new Error('Offline and no cache match');
  }
}
