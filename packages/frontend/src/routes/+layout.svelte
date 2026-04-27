<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import InstallPrompt from '$lib/components/InstallPrompt.svelte';

  let { children } = $props();

  onMount(() => {
    // Service worker registration (SvelteKit auto-registers in production
    // builds, but we add an explicit guard so it's clear and safe to
    // remove later if needed).
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('./service-worker.js', { type: 'module' }).catch(() => {
        // Non-fatal — app continues to work without offline support.
      });
    }
  });
</script>

{@render children?.()}
<InstallPrompt />
