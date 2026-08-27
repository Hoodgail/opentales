<script lang="ts">
  import Logo from '$lib/components/Logo.svelte';

  interface Props {
    page?: 'home' | 'guide';
  }

  let { page = 'home' }: Props = $props();
  const year = new Date().getFullYear();
</script>

<footer class="bg-background">
  <div class="mx-auto w-full max-w-6xl px-6 py-12">
    <div
      class="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center"
    >
      <div class="flex items-center gap-2">
        <Logo size={22} />
        <span class="text-sm font-medium">OpenTales</span>
        <span class="ml-2 font-mono text-[11px] text-muted-foreground">v1.0.0-beta</span>
      </div>

      <nav
        class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
      >
        {#if page === 'guide'}
          <a href="/" class="hover:text-foreground">Home</a>
          <a href="#start" class="hover:text-foreground">Start</a>
          <a href="#workspace" class="hover:text-foreground">Workspace</a>
        {:else}
          <a href="#features" class="hover:text-foreground">Features</a>
          <a href="#workflow" class="hover:text-foreground">Workflow</a>
          <a href="#editor" class="hover:text-foreground">Editor</a>
        {/if}
        <a href="/guide" class="hover:text-foreground">Guide</a>
        <a href="/projects" class="hover:text-foreground">Open app</a>
        <a
          href="https://github.com/Hoodgail/opentales/blob/main/CONTRIBUTING.md"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-foreground">Contributing</a
        >
        <a
          href="https://github.com/Hoodgail/opentales"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-foreground">GitHub</a
        >
      </nav>
    </div>

    <div
      class="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground md:flex-row md:items-center"
    >
      <span>© {year} OpenTales. Built for writers, by writers.</span>
      <span class="font-mono">crafted in monospace</span>
    </div>
  </div>
</footer>
