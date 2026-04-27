<script lang="ts">
  import Logo from '$lib/components/Logo.svelte';
</script>

<header
  class="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl"
>
  <nav class="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
    <a href="/" class="flex items-center gap-2">
      <Logo size={22} />
      <span class="text-sm font-medium tracking-tight">OpenTales</span>
      <span
        class="ml-2 hidden rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline-block"
      >
        Beta
      </span>
    </a>

    <div class="hidden items-center gap-8 md:flex">
      <a
        href="#features"
        class="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        Features
      </a>
      <a
        href="#workflow"
        class="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        Workflow
      </a>
      <a
        href="#editor"
        class="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        Editor
      </a>
      <a
        href="https://github.com/Hoodgail/opentales"
        target="_blank"
        rel="noopener noreferrer"
        class="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        GitHub
      </a>
    </div>

    <div class="flex items-center gap-2">
      <a
        href="/projects"
        class="hidden items-center rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
      >
        Sign in
      </a>
      <a
        href="/projects"
        class="inline-flex items-center rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Open app
      </a>
    </div>
  </nav>
</header>
