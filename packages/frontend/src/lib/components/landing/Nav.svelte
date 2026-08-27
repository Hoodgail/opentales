<script lang="ts">
  import Logo from '$lib/components/Logo.svelte';

  interface Props {
    page?: 'home' | 'guide';
  }

  interface NavLink {
    href: string;
    label: string;
    external?: boolean;
  }

  let { page = 'home' }: Props = $props();

  const links: NavLink[] = $derived(
    page === 'guide'
      ? [
          { href: '#start', label: 'Start' },
          { href: '#workspace', label: 'Workspace' },
          { href: '#ai-builds', label: 'AI & builds' },
          { href: '#finish', label: 'Finish' },
          { href: '#self-host', label: 'Self-host' }
        ]
      : [
          { href: '/#features', label: 'Features' },
          { href: '/#workflow', label: 'Workflow' },
          { href: '/#editor', label: 'Editor' },
          { href: '/guide', label: 'Guide' },
          { href: 'https://github.com/Hoodgail/opentales', label: 'GitHub', external: true }
        ]
  );
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

    <div class="hidden items-center gap-7 md:flex">
      {#each links as link (link.href)}
        <a
          href={link.href}
          target={link.external ? '_blank' : undefined}
          rel={link.external ? 'noopener noreferrer' : undefined}
          class="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {link.label}
        </a>
      {/each}
    </div>

    <div class="flex items-center gap-2">
      <a
        href={page === 'guide' ? '/' : '/guide'}
        class="inline-flex items-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
      >
        {page === 'guide' ? 'Home' : 'Guide'}
      </a>
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
