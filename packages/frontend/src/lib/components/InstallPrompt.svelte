<script lang="ts">
  import { Download, X } from 'lucide-svelte';
  import { onDestroy, onMount } from 'svelte';

  // Type for the chrome-only beforeinstallprompt event.
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  const STORAGE_KEY = 'opentales.install-dismissed-at';
  const DISMISS_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

  let deferred = $state<BeforeInstallPromptEvent | null>(null);
  let visible = $state(false);
  let installing = $state(false);

  function shouldShow(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia('(display-mode: standalone)').matches) return false;
    const dismissed = Number(window.localStorage?.getItem(STORAGE_KEY) ?? 0);
    if (dismissed && Date.now() - dismissed < DISMISS_TTL) return false;
    return true;
  }

  function onBeforeInstallPrompt(e: Event) {
    e.preventDefault();
    if (!shouldShow()) return;
    deferred = e as BeforeInstallPromptEvent;
    visible = true;
  }

  function onInstalled() {
    visible = false;
    deferred = null;
  }

  onMount(() => {
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
  });

  onDestroy(() => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.removeEventListener('appinstalled', onInstalled);
  });

  async function install() {
    if (!deferred) return;
    installing = true;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      installing = false;
      visible = false;
      deferred = null;
    }
  }

  function dismiss() {
    visible = false;
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(STORAGE_KEY, String(Date.now()));
    }
  }
</script>

{#if visible}
  <div
    class="fixed inset-x-4 z-50 flex items-center gap-3 rounded-xl border border-border bg-card/95 px-3 py-3 text-sm shadow-lg backdrop-blur sm:left-auto sm:right-3 sm:max-w-sm sm:rounded-md"
    style="bottom: calc(env(safe-area-inset-bottom) + 12px);"
    role="dialog"
    aria-label="Install OpenTales"
  >
    <Download class="size-4 shrink-0 text-accent" />
    <div class="min-w-0 flex-1">
      <p class="font-medium text-foreground">Install OpenTales</p>
      <p class="truncate text-xs text-muted-foreground">Use it like a native app, even offline.</p>
    </div>
    <button
      type="button"
      onclick={install}
      disabled={installing}
      class="tap-target shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-foreground disabled:opacity-60"
    >
      {installing ? 'Installing…' : 'Install'}
    </button>
    <button
      type="button"
      onclick={dismiss}
      aria-label="Dismiss"
      class="tap-target shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
    >
      <X class="size-3.5" />
    </button>
  </div>
{/if}
