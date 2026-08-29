import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/mcp': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      '/token': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      '/register': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      '/revoke': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      '/.well-known': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  },
  // Vendor monaco — it ships its own workers and large CSS files.
  optimizeDeps: {
    include: ['monaco-editor/esm/vs/editor/editor.api']
  }
});
