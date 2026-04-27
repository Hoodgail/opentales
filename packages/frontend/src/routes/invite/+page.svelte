<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { AcceptInviteResult } from '@opentales/sdk';

  let token = $state<string | null>(null);
  let status = $state<'idle' | 'pending' | 'accepted' | 'error'>('idle');
  let result = $state<AcceptInviteResult | null>(null);
  let message = $state<string | null>(null);

  onMount(() => {
    token = $page.url.searchParams.get('token');
    if (!token) {
      status = 'error';
      message = 'No invitation token in the link.';
      return;
    }
    void accept();
  });

  async function accept() {
    if (!token) return;
    if (!manuscript.authenticated) {
      status = 'error';
      message = 'Please sign in first, then re-open the invite link.';
      return;
    }
    status = 'pending';
    try {
      result = await manuscript.acceptInvite(token);
      if (result) {
        status = 'accepted';
      } else {
        status = 'error';
        message = manuscript.error ?? 'Could not accept this invitation.';
      }
    } catch (caught) {
      status = 'error';
      message = caught instanceof Error ? caught.message : 'Could not accept this invitation.';
    }
  }
</script>

<div class="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-10">
  <h1 class="text-2xl font-semibold">Accept invitation</h1>

  {#if status === 'pending' || status === 'idle'}
    <p class="text-sm text-muted-foreground">Joining workspace…</p>
  {:else if status === 'accepted' && result}
    <p class="text-sm text-foreground">
      Welcome to <strong>{result.orgName}</strong>{result.projectTitle
        ? ` — opening "${result.projectTitle}"`
        : ''} as <strong>{result.role}</strong>.
    </p>
    <button
      type="button"
      onclick={() => goto('/')}
      class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
    >
      Open workspace
    </button>
  {:else}
    <p class="text-sm text-destructive">{message}</p>
    <button
      type="button"
      onclick={() => goto('/')}
      class="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
    >
      Back to app
    </button>
  {/if}
</div>
