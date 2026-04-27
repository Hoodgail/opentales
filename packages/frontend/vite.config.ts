import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    strictPort: true
  },
  // Vendor monaco — it ships its own workers and large CSS files.
  optimizeDeps: {
    include: ['monaco-editor/esm/vs/editor/editor.api']
  }
});
