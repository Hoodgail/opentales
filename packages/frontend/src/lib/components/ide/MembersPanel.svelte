<script lang="ts">
  import { Check, Copy, MailPlus, Trash2, X } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { Role } from '@opentales/sdk';
  import { cn } from '$lib/utils';
  import BetaShareLinksSection from './BetaShareLinksSection.svelte';
  import PanelHeader from './PanelHeader.svelte';

  const ROLES: Role[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];

  let inviteOpen = $state(false);
  let inviteUsername = $state('');
  let inviteRole = $state<Role>('EDITOR');
  let copiedToken = $state<string | null>(null);

  onMount(() => {
    void manuscript.loadMembers();
  });

  function canManage(): boolean {
    const role = manuscript.currentUserRole;
    return role === 'OWNER' || role === 'ADMIN';
  }

  function inviteLink(token: string): string {
    if (typeof window === 'undefined') return token;
    return `${window.location.origin}/invite?token=${encodeURIComponent(token)}`;
  }

  async function copyInviteLink(token: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(inviteLink(token));
    copiedToken = token;
    setTimeout(() => {
      if (copiedToken === token) copiedToken = null;
    }, 1500);
  }

  async function submitInvite(e: Event) {
    e.preventDefault();
    const username = inviteUsername.trim();
    if (!username) return;
    await manuscript.createInvite({ username, role: inviteRole });
    inviteUsername = '';
    inviteRole = 'EDITOR';
    inviteOpen = false;
  }

  async function changeRole(userId: string, role: Role) {
    await manuscript.changeMemberRole(userId, role);
  }

  async function remove(userId: string, label: string) {
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${label} from this workspace?`))
      return;
    await manuscript.removeMember(userId);
  }

  async function revoke(inviteId: string) {
    await manuscript.revokeInvite(inviteId);
  }
</script>

<div class="flex h-full flex-col">
  <PanelHeader title="Members" />
  <div class="flex-1 overflow-y-auto">
    {#if !manuscript.membersLoaded && manuscript.membersLoading}
      <div class="p-4 text-xs text-muted-foreground">Loading members…</div>
    {:else}
      <div class="border-b border-border p-3">
        {#if canManage()}
          {#if !inviteOpen}
            <button
              type="button"
              onclick={() => (inviteOpen = true)}
              class="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:border-accent/60 hover:text-foreground"
            >
              <MailPlus class="size-3.5" />
              Invite member
            </button>
          {:else}
            <form onsubmit={submitInvite} class="space-y-2 text-xs">
              <label class="block">
                <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
                  Username
                </span>
                <input
                  type="text"
                  bind:value={inviteUsername}
                  placeholder="alice"
                  class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
                  Role
                </span>
                <select
                  bind:value={inviteRole}
                  class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-accent"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="EDITOR">Editor</option>
                  <option value="VIEWER">Viewer</option>
                </select>
              </label>
              <div class="flex gap-1.5">
                <button
                  type="submit"
                  class="flex-1 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/90"
                >
                  Send invite
                </button>
                <button
                  type="button"
                  onclick={() => (inviteOpen = false)}
                  class="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </form>
          {/if}
        {/if}
      </div>

      {#if manuscript.invites.length > 0}
        <div class="border-b border-border p-3">
          <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Pending invites
          </h3>
          <ul class="space-y-1.5">
            {#each manuscript.invites as invite (invite.id)}
              <li class="rounded-md border border-border bg-background px-2 py-2 text-xs">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium text-foreground">
                      {invite.username ?? invite.email ?? 'Unspecified'}
                    </div>
                    <div class="text-[10px] text-muted-foreground">
                      {invite.role} · invited by {invite.invitedByUsername}
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      onclick={() => copyInviteLink(invite.token)}
                      title="Copy invite link"
                      class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {#if copiedToken === invite.token}
                        <Check class="size-3.5" />
                      {:else}
                        <Copy class="size-3.5" />
                      {/if}
                    </button>
                    {#if canManage()}
                      <button
                        type="button"
                        onclick={() => revoke(invite.id)}
                        title="Revoke invite"
                        class="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X class="size-3.5" />
                      </button>
                    {/if}
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="p-3">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Members ({manuscript.members.length})
        </h3>
        <ul class="space-y-1">
          {#each manuscript.members as member (member.userId)}
            <li
              class={cn(
                'rounded-md px-2 py-2 text-xs transition-colors',
                'hover:bg-muted/50'
              )}
            >
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="truncate font-medium text-foreground">
                    {member.name ?? member.username}
                  </div>
                  <div class="truncate text-[10px] text-muted-foreground">
                    @{member.username}
                  </div>
                </div>
                {#if canManage()}
                  <select
                    value={member.role}
                    onchange={(e) =>
                      changeRole(member.userId, (e.currentTarget as HTMLSelectElement).value as Role)}
                    class="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground"
                  >
                    {#each ROLES as r (r)}
                      <option value={r}>{r}</option>
                    {/each}
                  </select>
                  <button
                    type="button"
                    onclick={() => remove(member.userId, member.username)}
                    title="Remove member"
                    class="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 class="size-3.5" />
                  </button>
                {:else}
                  <span class="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {member.role}
                  </span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </div>
      <BetaShareLinksSection />
    {/if}
  </div>
</div>
