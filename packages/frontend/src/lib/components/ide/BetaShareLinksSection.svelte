<script lang="ts">
  import { Copy, Link2, MessageSquare, Plus, Trash2 } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import type { BetaShareLink } from '@opentales/sdk';
  import { manuscript } from '$lib/stores/manuscript.svelte';

  let links = $state<BetaShareLink[]>([]);
  let loading = $state(false);
  let creating = $state(false);
  let formOpen = $state(false);
  let label = $state('');
  let allowComments = $state(true);
  let chapterIds = $state<string[]>([]);
  let expiresInDays = $state(14);
  let copied = $state<string | null>(null);

  onMount(() => {
    void load();
  });

  $effect(() => {
    // Reload whenever the active project changes.
    if (manuscript.projectId) void load();
  });

  function canManage(): boolean {
    const role = manuscript.currentUserRole;
    return role === 'OWNER' || role === 'ADMIN';
  }

  async function load() {
    if (!manuscript.projectId) {
      links = [];
      return;
    }
    loading = true;
    try {
      links = await manuscript.listBetaShareLinks();
    } catch {
      links = [];
    } finally {
      loading = false;
    }
  }

  function shareUrl(token: string): string {
    if (typeof window === 'undefined') return token;
    return `${window.location.origin}/share/${token}`;
  }

  async function copy(token: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(shareUrl(token));
    copied = token;
    setTimeout(() => {
      if (copied === token) copied = null;
    }, 1500);
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!manuscript.projectId || creating) return;
    creating = true;
    try {
      const expiresAt =
        expiresInDays > 0
          ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
          : null;
      const link = await manuscript.createBetaShareLink({
        label: label.trim() || undefined,
        allowComments,
        chapterIds,
        expiresAt
      });
      if (link) links = [link, ...links];
      label = '';
      chapterIds = [];
      formOpen = false;
    } finally {
      creating = false;
    }
  }

  async function revoke(link: BetaShareLink) {
    if (!manuscript.projectId) return;
    if (typeof window !== 'undefined' && !window.confirm('Revoke this share link?')) return;
    const next = await manuscript.revokeBetaShareLink(link.id);
    if (next) links = links.map((l) => (l.id === next.id ? next : l));
  }

  function isLive(link: BetaShareLink): boolean {
    if (link.revokedAt) return false;
    if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) return false;
    return true;
  }

  function status(link: BetaShareLink): string {
    if (link.revokedAt) return 'Revoked';
    if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) return 'Expired';
    if (link.expiresAt) return `Expires ${new Date(link.expiresAt).toLocaleDateString()}`;
    return 'Active';
  }
</script>

<div class="border-t border-border p-3">
  <div class="mb-2 flex items-center justify-between">
    <h3 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      Beta-reader share links
    </h3>
    {#if canManage()}
      <button
        type="button"
        onclick={() => (formOpen = !formOpen)}
        class="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus class="size-3" /> New
      </button>
    {/if}
  </div>

  {#if formOpen && canManage()}
    <form onsubmit={submit} class="mb-3 space-y-2 rounded-md border border-border p-2 text-xs">
      <label class="block">
        <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
          Label (private)
        </span>
        <input
          type="text"
          bind:value={label}
          placeholder="e.g. Sarah (agent)"
          class="w-full rounded-md border border-border bg-background px-2 py-1 text-foreground outline-none focus:border-accent"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
          Expires in (days, 0 = never)
        </span>
        <input
          type="number"
          min="0"
          step="1"
          bind:value={expiresInDays}
          class="w-full rounded-md border border-border bg-background px-2 py-1 text-foreground outline-none focus:border-accent"
        />
      </label>
      <label class="flex items-center gap-2">
        <input type="checkbox" bind:checked={allowComments} class="accent-accent" />
        <span>Allow visitors to leave comments</span>
      </label>
      <div>
        <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
          Chapters (none selected = entire manuscript)
        </span>
        <div class="max-h-32 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
          {#each manuscript.chapters as chapter (chapter.id)}
            <label class="flex items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                value={chapter.id}
                checked={chapterIds.includes(chapter.id)}
                onchange={(e) => {
                  const checked = (e.currentTarget as HTMLInputElement).checked;
                  if (checked) chapterIds = [...chapterIds, chapter.id];
                  else chapterIds = chapterIds.filter((id) => id !== chapter.id);
                }}
                class="accent-accent"
              />
              <span class="truncate">{chapter.title}</span>
            </label>
          {/each}
        </div>
      </div>
      <div class="flex gap-1.5">
        <button
          type="submit"
          disabled={creating}
          class="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {creating ? 'Creating…' : 'Create link'}
        </button>
        <button
          type="button"
          onclick={() => (formOpen = false)}
          class="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  {/if}

  {#if loading && links.length === 0}
    <p class="text-[11px] text-muted-foreground">Loading…</p>
  {:else if links.length === 0}
    <p class="text-[11px] text-muted-foreground">
      No share links yet. Beta-reader links let people read your manuscript without signing up.
    </p>
  {:else}
    <ul class="space-y-1.5">
      {#each links as link (link.id)}
        <li
          class="rounded-md border px-2 py-1.5 text-xs"
          class:border-border={isLive(link)}
          class:bg-card={isLive(link)}
          class:border-muted={!isLive(link)}
          class:opacity-60={!isLive(link)}
        >
          <div class="flex items-center gap-2">
            <Link2 class="size-3 text-muted-foreground" />
            <span class="truncate font-medium text-foreground">
              {link.label ?? 'Untitled link'}
            </span>
            <span class="ml-auto text-[10px] text-muted-foreground">{status(link)}</span>
          </div>
          <div class="mt-1 flex items-center gap-1.5">
            <code
              class="flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground"
            >
              {shareUrl(link.token)}
            </code>
            <button
              type="button"
              onclick={() => copy(link.token)}
              class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Copy link"
            >
              <Copy class="size-3" />
            </button>
            {#if canManage() && isLive(link)}
              <button
                type="button"
                onclick={() => revoke(link)}
                class="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Revoke link"
              >
                <Trash2 class="size-3" />
              </button>
            {/if}
          </div>
          <div class="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span class="inline-flex items-center gap-1">
              <MessageSquare class="size-3" />
              {link.allowComments ? 'Comments on' : 'Read-only'}
            </span>
            <span>·</span>
            <span>
              {link.chapterIds.length === 0
                ? 'Full manuscript'
                : `${link.chapterIds.length} chapter${link.chapterIds.length === 1 ? '' : 's'}`}
            </span>
            {#if copied === link.token}
              <span class="ml-auto text-emerald-500">Copied</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
