<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ApiError,
    OpenTalesClient,
    type McpOAuthAuthorizationContext,
    type McpOAuthAuthorizationRequest,
    type ProjectMcpApiKeyPermission
  } from '@opentales/sdk';
  import { ArrowRight, BookOpen, Check, KeyRound, LockKeyhole, ShieldCheck, X } from 'lucide-svelte';
  import Logo from '$lib/components/Logo.svelte';

  const tokenKey = 'opentales.token';
  const api = new OpenTalesClient({ baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000' });
  let request = $state<McpOAuthAuthorizationRequest | null>(null);
  let context = $state<McpOAuthAuthorizationContext | null>(null);
  let selectedProjectId = $state('');
  let access = $state<ProjectMcpApiKeyPermission>('read-only');
  let loading = $state(true);
  let busy = $state(false);
  let needsLogin = $state(false);
  let leakedApiKey = $state(false);
  let error = $state<string | null>(null);
  let emailOrUsername = $state('');
  let password = $state('');

  const selectedProject = $derived(
    context?.projects.find((project) => project.projectId === selectedProjectId) ?? null
  );

  $effect(() => {
    if (selectedProject && (!selectedProject.canWrite || !context?.writeRequested)) access = 'read-only';
  });

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get('client_id') ?? '';
    if (clientId.startsWith('otmcp_')) {
      leakedApiKey = true;
      loading = false;
      window.history.replaceState({}, '', '/authorize/');
      return;
    }
    request = {
      responseType: params.get('response_type') ?? '',
      clientId,
      redirectUri: params.get('redirect_uri') ?? '',
      codeChallenge: params.get('code_challenge') ?? '',
      codeChallengeMethod: params.get('code_challenge_method') ?? '',
      state: params.get('state') ?? undefined,
      resource: params.get('resource') ?? undefined,
      scope: params.get('scope') ?? undefined
    };
    const savedToken = localStorage.getItem(tokenKey) ?? undefined;
    api.setToken(savedToken);
    void loadContext();
  });

  async function loadContext() {
    if (!request) return;
    loading = true;
    error = null;
    try {
      context = await api.getMcpOAuthAuthorizationContext(request);
      needsLogin = false;
      selectedProjectId = context.projects[0]?.projectId ?? '';
      const first = context.projects[0];
      access = first?.canWrite && context.writeRequested ? 'read-write' : 'read-only';
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        localStorage.removeItem(tokenKey);
        api.setToken(undefined);
        needsLogin = true;
      } else {
        error = caught instanceof Error ? caught.message : 'This authorization request is invalid.';
      }
    } finally {
      loading = false;
    }
  }

  async function login(event: Event) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      const session = await api.login({ emailOrUsername, password });
      localStorage.setItem(tokenKey, session.token);
      await loadContext();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Sign in failed.';
    } finally {
      busy = false;
    }
  }

  async function decide(decision: 'approve' | 'deny') {
    if (!request || busy) return;
    if (decision === 'approve' && !selectedProjectId) {
      error = 'Choose a project to connect.';
      return;
    }
    busy = true;
    error = null;
    try {
      const result = await api.authorizeMcpOAuth({
        ...request,
        decision,
        ...(decision === 'approve' ? { projectId: selectedProjectId, access } : {})
      });
      window.location.assign(result.redirectUrl);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Could not complete authorization.';
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Connect Claude — OpenTales</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="relative min-h-screen overflow-hidden bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12">
  <div class="pointer-events-none absolute inset-0 opacity-50" aria-hidden="true">
    <div class="absolute -left-24 top-10 size-80 rounded-full bg-accent/10 blur-3xl"></div>
    <div class="absolute -right-24 bottom-0 size-96 rounded-full bg-sidebar blur-3xl"></div>
  </div>

  <div class="relative mx-auto max-w-3xl">
    <header class="mb-6 flex items-center justify-between">
      <a href="/" class="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Logo size={30} />
        <span>OpenTales</span>
      </a>
      <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Secure connection
      </span>
    </header>

    <section class="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/20">
      <div class="grid md:grid-cols-[0.8fr_1.2fr]">
        <div class="relative border-b border-border bg-sidebar p-6 md:border-b-0 md:border-r md:p-8">
          <div class="absolute inset-y-0 left-0 w-1 bg-accent"></div>
          <div class="flex size-10 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            <BookOpen class="size-5" />
          </div>
          <p class="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Project access</p>
          <h1 class="mt-2 text-2xl font-semibold leading-tight">Let Claude work inside your story.</h1>
          <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
            Choose one manuscript. OpenTales keeps every tool call inside that project and applies your current workspace role.
          </p>
          <ul class="mt-6 space-y-3 text-xs text-muted-foreground">
            <li class="flex gap-2"><ShieldCheck class="mt-0.5 size-4 shrink-0 text-accent" /> Short-lived access with automatic refresh</li>
            <li class="flex gap-2"><LockKeyhole class="mt-0.5 size-4 shrink-0 text-accent" /> No API key is sent to Claude</li>
            <li class="flex gap-2"><KeyRound class="mt-0.5 size-4 shrink-0 text-accent" /> Revoke access by removing the connector</li>
          </ul>
        </div>

        <div class="p-6 sm:p-8">
          {#if loading}
            <div class="flex min-h-72 items-center justify-center" aria-live="polite">
              <p class="text-sm text-muted-foreground">Checking the connection request…</p>
            </div>
          {:else if leakedApiKey}
            <div class="min-h-72">
              <div class="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <X class="size-5" />
              </div>
              <h2 class="mt-5 text-xl font-semibold">That was an API key, not a client ID</h2>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
                Revoke the exposed key in Project Settings, remove this connector from Claude, then add it again using only the MCP server URL. Leave custom client credentials empty so Claude can register securely.
              </p>
              <a href="/projects/" class="mt-6 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90">
                Open Project Settings <ArrowRight class="size-4" />
              </a>
            </div>
          {:else if needsLogin}
            <h2 class="text-xl font-semibold">Sign in to approve</h2>
            <p class="mt-1 text-sm text-muted-foreground">Use the OpenTales account that owns or collaborates on the project.</p>
            <form class="mt-6 space-y-4" onsubmit={login}>
              <label class="block text-xs font-medium">
                Email or username
                <input
                  bind:value={emailOrUsername}
                  autocomplete="username"
                  required
                  class="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </label>
              <label class="block text-xs font-medium">
                Password
                <input
                  type="password"
                  bind:value={password}
                  autocomplete="current-password"
                  required
                  class="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </label>
              {#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
              <button type="submit" disabled={busy} class="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60">
                {busy ? 'Signing in…' : 'Sign in and continue'}
              </button>
            </form>
          {:else if error || !context}
            <div class="min-h-72">
              <div class="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"><X class="size-5" /></div>
              <h2 class="mt-5 text-xl font-semibold">Connection request rejected</h2>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{error ?? 'The OAuth request could not be verified.'}</p>
            </div>
          {:else}
            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{context.clientName} wants access</p>
            <h2 class="mt-2 text-xl font-semibold">Choose a manuscript</h2>
            <label class="mt-5 block text-xs font-medium">
              Project
              <select
                bind:value={selectedProjectId}
                class="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              >
                {#each context.projects as project (project.projectId)}
                  <option value={project.projectId}>{project.title} · {project.orgName}</option>
                {/each}
              </select>
            </label>

            {#if context.projects.length === 0}
              <p class="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">This account has no projects available to connect.</p>
            {:else}
              <fieldset class="mt-5">
                <legend class="text-xs font-medium">Access level</legend>
                <div class="mt-2 grid gap-2 sm:grid-cols-2">
                  <label class={'flex cursor-pointer gap-3 rounded-md border p-3 ' + (access === 'read-only' ? 'border-accent bg-accent/5' : 'border-border')}>
                    <input type="radio" bind:group={access} value="read-only" class="mt-0.5 accent-accent" />
                    <span><span class="block text-xs font-medium">Read only</span><span class="mt-1 block text-[10px] leading-relaxed text-muted-foreground">Research, inspect, search, and review.</span></span>
                  </label>
                  <label class={'flex gap-3 rounded-md border p-3 ' + (selectedProject?.canWrite && context.writeRequested ? 'cursor-pointer ' : 'opacity-50 ') + (access === 'read-write' ? 'border-accent bg-accent/5' : 'border-border')}>
                    <input type="radio" bind:group={access} value="read-write" disabled={!selectedProject?.canWrite || !context.writeRequested} class="mt-0.5 accent-accent" />
                    <span><span class="block text-xs font-medium">Read and write</span><span class="mt-1 block text-[10px] leading-relaxed text-muted-foreground">Create and revise through normal project permissions.</span></span>
                  </label>
                </div>
              </fieldset>
            {/if}

            {#if error}<p class="mt-4 text-xs text-destructive" role="alert">{error}</p>{/if}
            <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onclick={() => decide('deny')} disabled={busy} class="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">Cancel</button>
              <button type="button" onclick={() => decide('approve')} disabled={busy || !selectedProjectId} class="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60">
                <Check class="size-4" /> {busy ? 'Connecting…' : 'Allow connection'}
              </button>
            </div>
          {/if}
        </div>
      </div>
    </section>
    <p class="mt-4 text-center text-[10px] text-muted-foreground">OAuth 2.1 · PKCE S256 · project-scoped access</p>
  </div>
</main>
