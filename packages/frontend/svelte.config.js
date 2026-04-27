import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      // Use a distinct fallback file so the prerendered landing
      // (build/index.html) isn't overwritten by the SPA shell.
      fallback: 'app.html',
      precompress: false,
      strict: true
    }),
    paths: {
      // Use relative asset paths so Electron can load via file:// from any directory.
      relative: true
    }
  }
};

export default config;
