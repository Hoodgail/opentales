<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import {
    Archive,
    ArrowRight,
    BookOpen,
    Check,
    ChevronRight,
    CircleHelp,
    Clock3,
    Code2,
    Command,
    ExternalLink,
    FileText,
    GitBranch,
    Map,
    PanelLeft,
    PenLine,
    Search,
    ShieldCheck,
    Sparkles,
    Terminal,
    Users,
    Workflow
  } from 'lucide-svelte';
  import Footer from '$lib/components/landing/Footer.svelte';
  import Nav from '$lib/components/landing/Nav.svelte';
  import GuideMedia from '$lib/components/guide/GuideMedia.svelte';

  const title = 'OpenTales Guide — From first chapter to finished manuscript';
  const description =
    'A concise, writer-first guide to drafting, planning, revising, using optional AI, and publishing with OpenTales.';
  const SITE_URL = 'https://tale.yasui.io';

  const guideSections = [
    { id: 'start', label: 'Start writing', meta: '2 minutes' },
    { id: 'workspace', label: 'Know the workspace', meta: 'the layout' },
    { id: 'shape', label: 'Shape the story', meta: 'people & places' },
    { id: 'draft', label: 'Draft & revise', meta: 'stay in flow' },
    { id: 'ai-builds', label: 'AI & Novel Builds', meta: 'optional' },
    { id: 'finish', label: 'Finish & share', meta: 'publish safely' },
    { id: 'help', label: 'Quick answers', meta: 'when stuck' },
    { id: 'self-host', label: 'Self-host & contribute', meta: 'technical' }
  ];

  const route = [
    { n: '1', label: 'Start', href: '#start' },
    { n: '2', label: 'Shape', href: '#shape' },
    { n: '3', label: 'Draft', href: '#draft' },
    { n: '4', label: 'Review', href: '#ai-builds' },
    { n: '5', label: 'Share', href: '#finish' }
  ];

  let activeSection = $state('start');
  const origin = $derived(
    $page.url.origin && !$page.url.origin.includes('sveltekit-prerender')
      ? $page.url.origin
      : SITE_URL
  );
  const canonical = $derived(`${origin}/guide/`);

  onMount(() => {
    const sections = guideSections
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => Boolean(section));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) activeSection = visible.target.id;
      },
      { rootMargin: '-18% 0px -62% 0px', threshold: [0, 0.15, 0.35] }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  });
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonical} />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="OpenTales" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content={`${origin}/og-banner.png`} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
</svelte:head>

<div class="h-full overflow-y-auto bg-background text-foreground scroll-smooth">
  <a
    href="#guide-content"
    class="sr-only z-[100] rounded bg-accent px-3 py-2 text-sm font-medium text-accent-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
  >
    Skip to the guide
  </a>

  <Nav page="guide" />

  <main id="guide-content">
    <section class="guide-grid relative overflow-hidden border-b border-border/60">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute -top-32 left-[62%] size-[34rem] rounded-full bg-accent/8 blur-3xl"
      ></div>

      <div class="relative mx-auto w-full max-w-6xl px-6 pb-16 pt-20 sm:pb-20 sm:pt-24">
        <div class="guide-hero-layout grid items-end gap-12">
          <div class="max-w-3xl">
            <div
              class="mb-6 inline-flex items-center gap-2 rounded-full border border-border/70 bg-panel/70 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
            >
              <BookOpen class="size-3 text-accent" />
              <span>Writer's guide</span>
              <span class="text-border">/</span>
              <Clock3 class="size-3" />
              <span>7 min</span>
            </div>

            <h1 class="max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
              Write the story.
              <span class="block font-serif italic text-accent">Keep the rest connected.</span>
            </h1>

            <p class="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              You do not need to learn the whole IDE. Follow the shortest useful path from a
              blank project to a manuscript you can revise, share, and publish.
            </p>

            <div class="mt-9 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <a
                href="#start"
                class="group inline-flex h-11 items-center gap-2 rounded-md bg-foreground px-5 text-sm font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
              >
                Start with one chapter
                <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <a
                href="/projects"
                class="inline-flex h-11 items-center gap-2 rounded-md border border-border/70 px-5 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent"
              >
                Open OpenTales
                <ExternalLink class="size-3.5" />
              </a>
            </div>
          </div>

          <aside class="rounded-lg border border-border/70 bg-panel/70 p-5 shadow-xl shadow-black/15">
            <div class="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
              If you only do three things
            </div>
            <ol class="mt-4 space-y-4">
              <li class="flex gap-3">
                <span class="flex size-6 shrink-0 items-center justify-center rounded border border-border bg-background font-mono text-[10px] text-accent">1</span>
                <p class="text-sm leading-relaxed text-muted-foreground">
                  Make an act and a chapter, then begin before the project feels “ready.”
                </p>
              </li>
              <li class="flex gap-3">
                <span class="flex size-6 shrink-0 items-center justify-center rounded border border-border bg-background font-mono text-[10px] text-accent">2</span>
                <p class="text-sm leading-relaxed text-muted-foreground">
                  Add a character or location when the draft needs one—not as homework.
                </p>
              </li>
              <li class="flex gap-3">
                <span class="flex size-6 shrink-0 items-center justify-center rounded border border-border bg-background font-mono text-[10px] text-accent">3</span>
                <p class="text-sm leading-relaxed text-muted-foreground">
                  Watch for <strong class="font-medium text-foreground">Synced</strong> in the status bar before you leave.
                </p>
              </li>
            </ol>
          </aside>
        </div>

        <nav class="mt-16 overflow-x-auto" aria-label="The writer's route">
          <div class="relative flex min-w-[38rem] items-start justify-between px-2">
            <div class="absolute left-8 right-8 top-3 h-px bg-border" aria-hidden="true"></div>
            {#each route as stop (stop.n)}
              <a
                href={stop.href}
                class="group relative flex min-w-20 flex-col items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span
                  class="z-10 flex size-6 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] text-muted-foreground transition-colors group-hover:border-accent group-hover:text-accent"
                >
                  {stop.n}
                </span>
                <span class="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground group-hover:text-foreground">
                  {stop.label}
                </span>
              </a>
            {/each}
          </div>
        </nav>
      </div>
    </section>

    <div class="guide-layout mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 lg:gap-14 lg:py-20">
      <aside class="hidden self-start lg:sticky lg:top-20 lg:block">
        <div class="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          In this guide
        </div>
        <nav class="border-l border-border/80" aria-label="Guide sections">
          {#each guideSections as section (section.id)}
            <a
              href={`#${section.id}`}
              aria-current={activeSection === section.id ? 'location' : undefined}
              class={`-ml-px block border-l px-4 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                activeSection === section.id
                  ? 'border-accent bg-accent/5 text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              <span class="block text-sm">{section.label}</span>
              <span class="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.12em] opacity-60">
                {section.meta}
              </span>
            </a>
          {/each}
        </nav>

        <div class="mt-6 rounded-md border border-border/70 bg-panel/50 p-3">
          <div class="flex items-center gap-2 text-xs font-medium">
            <Command class="size-3.5 text-accent" />
            Go anywhere
          </div>
          <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Press <kbd class="rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px]">⌘ / Ctrl K</kbd>
            to find a chapter, person, place, or action.
          </p>
        </div>
      </aside>

      <article class="min-w-0 space-y-24">
        <section id="start" class="scroll-mt-24">
          <header class="max-w-2xl">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">01 / Start writing</div>
            <h2 class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Your first chapter in three moves.
            </h2>
            <p class="mt-4 text-pretty leading-relaxed text-muted-foreground">
              OpenTales becomes useful as soon as prose exists. Build the smallest container your
              story needs, then let structure grow around the draft.
            </p>
          </header>

          <ol class="mt-8 grid gap-3 md:grid-cols-3">
            <li class="rounded-lg border border-border/70 bg-panel/40 p-5">
              <div class="flex items-center justify-between">
                <FileText class="size-4 text-accent" />
                <span class="font-mono text-[10px] text-muted-foreground">01</span>
              </div>
              <h3 class="mt-5 text-sm font-medium">Create or open a project</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
                Give it a title. Genre, voice, and themes can stay rough.
              </p>
            </li>
            <li class="rounded-lg border border-border/70 bg-panel/40 p-5">
              <div class="flex items-center justify-between">
                <PanelLeft class="size-4 text-accent" />
                <span class="font-mono text-[10px] text-muted-foreground">02</span>
              </div>
              <h3 class="mt-5 text-sm font-medium">Add an act, then a chapter</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
                Use the <strong class="font-medium text-foreground">+</strong> controls at the top of Manuscript.
              </p>
            </li>
            <li class="rounded-lg border border-border/70 bg-panel/40 p-5">
              <div class="flex items-center justify-between">
                <PenLine class="size-4 text-accent" />
                <span class="font-mono text-[10px] text-muted-foreground">03</span>
              </div>
              <h3 class="mt-5 text-sm font-medium">Click the chapter and write</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
                The editor accepts Markdown and updates word count as you go.
              </p>
            </li>
          </ol>

          <div class="mt-6 flex gap-3 rounded-lg border border-accent/25 bg-accent/5 p-4">
            <ShieldCheck class="mt-0.5 size-4 shrink-0 text-accent" />
            <p class="text-sm leading-relaxed text-muted-foreground">
              <strong class="font-medium text-foreground">Saving is automatic.</strong> The amber status bar shows the active branch, issue count, words, and sync state. Wait for <strong class="font-medium text-foreground">Synced</strong> before closing the tab.
            </p>
          </div>

          <div class="mt-8">
            <GuideMedia
              src="/guide/open-and-preview.mp4"
              poster="/guide/workspace.png"
              alt="A short OpenTales screen recording that opens a second chapter and switches from source to rendered preview"
              label="Open a chapter · preview Markdown · 8 sec"
              caption="Choose a chapter in the Manuscript tree. Preview gives you a clean reading pass without leaving the editor."
              video
            />
          </div>
        </section>

        <section id="workspace" class="scroll-mt-24">
          <header class="max-w-2xl">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">02 / Know the workspace</div>
            <h2 class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Five regions. One manuscript.
            </h2>
            <p class="mt-4 text-pretty leading-relaxed text-muted-foreground">
              The layout stays stable while the content changes. Once you know these regions, every
              tool has a predictable home.
            </p>
          </header>

          <div class="mt-8">
            <GuideMedia
              src="/guide/workspace.png"
              alt="The OpenTales writing workspace with activity bar, manuscript tree, chapter editor, inspector, and status bar"
              label="The writing workspace"
              caption="The Cartographer of Low Water is a local guide fixture captured from the running app. Open the image for the full-size labels."
            />
          </div>

          <dl class="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            <div class="border-t border-border/70 pt-4">
              <dt class="flex items-center gap-2 text-sm font-medium"><span class="font-mono text-[10px] text-accent">A</span> Activity bar</dt>
              <dd class="mt-2 text-sm leading-relaxed text-muted-foreground">Switch between Manuscript, Characters, Plot, Search, Problems, Builds, Publish, and the rest of the project.</dd>
            </div>
            <div class="border-t border-border/70 pt-4">
              <dt class="flex items-center gap-2 text-sm font-medium"><span class="font-mono text-[10px] text-accent">B</span> Side panel</dt>
              <dd class="mt-2 text-sm leading-relaxed text-muted-foreground">Browse or create items for the active area. In Manuscript, this is your act and chapter tree.</dd>
            </div>
            <div class="border-t border-border/70 pt-4">
              <dt class="flex items-center gap-2 text-sm font-medium"><span class="font-mono text-[10px] text-accent">C</span> Editor</dt>
              <dd class="mt-2 text-sm leading-relaxed text-muted-foreground">Your focused work surface. Tabs let you keep prose and reference material open together.</dd>
            </div>
            <div class="border-t border-border/70 pt-4">
              <dt class="flex items-center gap-2 text-sm font-medium"><span class="font-mono text-[10px] text-accent">D</span> Inspector</dt>
              <dd class="mt-2 text-sm leading-relaxed text-muted-foreground">Edit the active item's status, POV, setting, summary, links, and publishing state.</dd>
            </div>
            <div class="border-t border-border/70 pt-4 sm:col-span-2">
              <dt class="flex items-center gap-2 text-sm font-medium"><span class="font-mono text-[10px] text-accent">E</span> Status bar</dt>
              <dd class="mt-2 text-sm leading-relaxed text-muted-foreground">A quick truth check: current branch, open problems, project and chapter word counts, and whether the latest edit reached the server.</dd>
            </div>
          </dl>
        </section>

        <section id="shape" class="scroll-mt-24">
          <header class="max-w-2xl">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">03 / Shape the story</div>
            <h2 class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Give the draft context, not paperwork.
            </h2>
            <p class="mt-4 text-pretty leading-relaxed text-muted-foreground">
              Add information when it helps you make the next scene more specific. Empty fields are
              not unfinished work.
            </p>
          </header>

          <div class="mt-8 grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/70 sm:grid-cols-2">
            <div class="bg-background p-5">
              <Users class="size-4 text-accent" />
              <h3 class="mt-4 text-sm font-medium">Characters</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Track role, traits, aliases, motivation, arc, relationships, and reference images. Link a POV character from the chapter Inspector.</p>
            </div>
            <div class="bg-background p-5">
              <Map class="size-4 text-accent" />
              <h3 class="mt-4 text-sm font-medium">Locations</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Keep atmosphere, significance, and sensory details close to the scenes that use them.</p>
            </div>
            <div class="bg-background p-5">
              <Workflow class="size-4 text-accent" />
              <h3 class="mt-4 text-sm font-medium">Plot & Outline</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Set the premise, POV, voice, theme, climax, acts, chapters, and scene metadata. Start broad; deepen only what guides the draft.</p>
            </div>
            <div class="bg-background p-5">
              <BookOpen class="size-4 text-accent" />
              <h3 class="mt-4 text-sm font-medium">Docs & Notes</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Store research, loose threads, references, and project instructions in folders beside the manuscript.</p>
            </div>
          </div>

          <div class="mt-8">
            <GuideMedia
              src="/guide/characters.png"
              alt="OpenTales character editor for Mara Venn with profile fields, traits, aliases, reference assets, prose sections, and chapter appearances"
              label="A character as a living story document"
              caption="The Inspector shows where Mara appears while the main surface keeps the details that shape how she behaves on the page."
            />
          </div>
        </section>

        <section id="draft" class="scroll-mt-24">
          <header class="max-w-2xl">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">04 / Draft & revise</div>
            <h2 class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Stay in the sentence. Zoom out when needed.
            </h2>
          </header>

          <div class="mt-8 grid gap-6 md:grid-cols-2">
            <div class="rounded-lg border border-border/70 p-5">
              <div class="flex items-center gap-2 text-sm font-medium"><PenLine class="size-4 text-accent" /> While drafting</div>
              <ul class="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                <li class="flex gap-2"><Check class="mt-1 size-3 shrink-0 text-accent" /><span><strong class="font-medium text-foreground">Focus</strong> and <strong class="font-medium text-foreground">Typewriter</strong> reduce visual drift.</span></li>
                <li class="flex gap-2"><Check class="mt-1 size-3 shrink-0 text-accent" /><span><strong class="font-medium text-foreground">Preview</strong> renders the current Markdown chapter.</span></li>
                <li class="flex gap-2"><Check class="mt-1 size-3 shrink-0 text-accent" /><span><strong class="font-medium text-foreground">Continuous manuscript</strong> reads or edits every chapter in order.</span></li>
              </ul>
            </div>
            <div class="rounded-lg border border-border/70 p-5">
              <div class="flex items-center gap-2 text-sm font-medium"><Search class="size-4 text-accent" /> While revising</div>
              <ul class="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
                <li class="flex gap-2"><Check class="mt-1 size-3 shrink-0 text-accent" /><span><strong class="font-medium text-foreground">Search</strong> finds exact text, fields, structure, and references across main and build prose.</span></li>
                <li class="flex gap-2"><Check class="mt-1 size-3 shrink-0 text-accent" /><span><strong class="font-medium text-foreground">Problems</strong> keeps local checks and evidence-backed story diagnostics in one place.</span></li>
                <li class="flex gap-2"><Check class="mt-1 size-3 shrink-0 text-accent" /><span><strong class="font-medium text-foreground">Revisions</strong> creates named snapshots and compares changes without deleting history.</span></li>
              </ul>
            </div>
          </div>

          <div class="mt-8">
            <GuideMedia
              src="/guide/command-palette.mp4"
              poster="/guide/characters.png"
              alt="A short OpenTales screen recording that opens the command palette, searches for Mara Venn, and jumps to her character document"
              label="Command palette · jump to a character · 9 sec"
              caption="Press ⌘K on macOS or Ctrl K elsewhere. Search the thing you recognize; OpenTales handles where it lives."
              video
            />
          </div>
        </section>

        <section id="ai-builds" class="scroll-mt-24">
          <header class="max-w-2xl">
            <div class="flex flex-wrap items-center gap-3">
              <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">05 / AI & Novel Builds</div>
              <span class="rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">Optional · off by default</span>
            </div>
            <h2 class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Let AI propose. You keep authorship.
            </h2>
            <p class="mt-4 text-pretty leading-relaxed text-muted-foreground">
              Enable a provider in Project Settings only when you want it. Interactive AI defaults
              to Manual mode, so project-changing tools wait for your review.
            </p>
          </header>

          <div class="mt-8 grid gap-3 md:grid-cols-3">
            <div class="rounded-lg border border-border/70 bg-panel/40 p-5">
              <Sparkles class="size-4 text-accent" />
              <h3 class="mt-4 text-sm font-medium">Assist</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Chat, inspect the manuscript, and approve proposed changes one at a time.</p>
            </div>
            <div class="rounded-lg border border-accent/40 bg-accent/5 p-5">
              <ShieldCheck class="size-4 text-accent" />
              <h3 class="mt-4 text-sm font-medium">Plan & Review <span class="text-xs font-normal text-accent">recommended</span></h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Build a complete plan, review the manifest, then authorize prose on an isolated manuscript branch.</p>
            </div>
            <div class="rounded-lg border border-border/70 bg-panel/40 p-5">
              <Workflow class="size-4 text-accent" />
              <h3 class="mt-4 text-sm font-medium">Autonomous Draft</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Requires explicit scope plus finite token and cost limits. Final merge still belongs to the owner.</p>
            </div>
          </div>

          <ol class="mt-8 grid gap-3 sm:grid-cols-2">
            <li class="flex gap-3 rounded-md border border-border/70 p-4"><span class="font-mono text-[10px] text-accent">01</span><p class="text-sm leading-relaxed text-muted-foreground"><strong class="font-medium text-foreground">Brief it.</strong> Add the brainstorm, target, tone, constraints, and autonomy mode.</p></li>
            <li class="flex gap-3 rounded-md border border-border/70 p-4"><span class="font-mono text-[10px] text-accent">02</span><p class="text-sm leading-relaxed text-muted-foreground"><strong class="font-medium text-foreground">Review the manifest.</strong> Check phases, scope, chapter target, and budget before work begins.</p></li>
            <li class="flex gap-3 rounded-md border border-border/70 p-4"><span class="font-mono text-[10px] text-accent">03</span><p class="text-sm leading-relaxed text-muted-foreground"><strong class="font-medium text-foreground">Authorize deliberately.</strong> Pause, resume, retry, or re-plan from the durable task graph.</p></li>
            <li class="flex gap-3 rounded-md border border-border/70 p-4"><span class="font-mono text-[10px] text-accent">04</span><p class="text-sm leading-relaxed text-muted-foreground"><strong class="font-medium text-foreground">Compare before merge.</strong> Build prose never changes main until an owner approves the frozen review.</p></li>
          </ol>

          <div class="mt-8">
            <GuideMedia
              src="/guide/novel-build.png"
              alt="The OpenTales Novel Build execution workspace showing an unauthorized Plan and Review manifest, progress, task dependency graph, and task inspector"
              label="A Plan & Review build before authorization"
              caption="The task graph is durable and restart-safe. This build has planned 29 tasks, spent nothing, and waits for the writer to authorize its scope."
            />
          </div>
        </section>

        <section id="finish" class="scroll-mt-24">
          <header class="max-w-2xl">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">06 / Finish & share</div>
            <h2 class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Export a manuscript, not a mystery file.
            </h2>
            <p class="mt-4 text-pretty leading-relaxed text-muted-foreground">
              Open Publishing from the activity bar. Choose main or a compiled Novel Build, a
              format, and a preset. OpenTales validates the result before it appears in history.
            </p>
          </header>

          <div class="mt-7 flex flex-wrap gap-2">
            {#each ['DOCX', 'PDF', 'EPUB 3', 'Markdown', 'Text', 'HTML', 'Project archive'] as format}
              <span class="rounded border border-border/70 bg-panel/50 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{format}</span>
            {/each}
          </div>

          <div class="mt-8 grid gap-4 md:grid-cols-2">
            <div class="rounded-lg border border-border/70 p-5">
              <Archive class="size-4 text-accent" />
              <h3 class="mt-4 text-sm font-medium">Bring an existing draft</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">DOCX, Markdown, text, HTML, and OpenTales archives open as a read-only preview first. Review chapter mapping and conflicts before applying.</p>
            </div>
            <div class="rounded-lg border border-border/70 p-5">
              <Users class="size-4 text-accent" />
              <h3 class="mt-4 text-sm font-medium">Share with intention</h3>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Invite collaborators for project work. For public reading, make the project public in Settings, then publish only the chapters readers should see.</p>
            </div>
          </div>

          <div class="mt-6 flex gap-3 rounded-lg border border-border/70 bg-panel/40 p-4">
            <ShieldCheck class="mt-0.5 size-4 shrink-0 text-accent" />
            <p class="text-sm leading-relaxed text-muted-foreground">
              Imports do not silently overwrite prose. Applying a confirmed preview creates new writing versions, so the prior text remains part of project history.
            </p>
          </div>

          <div class="mt-8">
            <GuideMedia
              src="/guide/publishing.png"
              alt="The OpenTales publishing pipeline with export format and preset controls, import preview, and a ready PDF in export history"
              label="Publishing pipeline · verified PDF ready"
              caption="Generated files are private by default. The history records source, format, size, status, and actions for each deliverable."
            />
          </div>
        </section>

        <section id="help" class="scroll-mt-24">
          <header class="max-w-2xl">
            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">07 / Quick answers</div>
            <h2 class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              The questions worth answering now.
            </h2>
          </header>

          <div class="mt-8 divide-y divide-border/70 border-y border-border/70">
            <details class="group py-4">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent">
                Can I use OpenTales without AI?
                <ChevronRight class="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Yes. AI is disabled per project until you enable a provider. Drafting, story structure, search, local Problems checks, revisions, collaboration, and publishing remain useful without it.</p>
            </details>
            <details class="group py-4">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent">
                Is the manuscript available offline?
                <ChevronRight class="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">The PWA can cache the application shell, but the server and PostgreSQL database remain authoritative for project data. Treat Synced—not the presence of the window—as confirmation that an edit is stored.</p>
            </details>
            <details class="group py-4">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent">
                Can AI overwrite my main chapters?
                <ChevronRight class="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Interactive changes wait for approval in Manual mode. Novel Build prose stays on isolated build branches until an owner reviews and merges a frozen compilation.</p>
            </details>
            <details class="group py-4">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent">
                What should I use when I feel lost?
                <ChevronRight class="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Press ⌘K or Ctrl K and type the chapter, character, location, panel, or action you want. Press <kbd class="rounded border border-border bg-panel px-1 py-0.5 font-mono text-[10px]">?</kbd> outside an input to open the shortcut guide.</p>
            </details>
          </div>
        </section>

        <section id="self-host" class="scroll-mt-24">
          <header class="max-w-2xl">
            <div class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent"><Terminal class="size-3.5" /> Technical appendix</div>
            <h2 class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Self-host or help build it.
            </h2>
            <p class="mt-4 text-pretty leading-relaxed text-muted-foreground">Stop here if you only came to write. Everything below is for people running or changing OpenTales.</p>
          </header>

          <div class="mt-8 space-y-3">
            <details class="group rounded-lg border border-border/70 bg-panel/30">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg p-5 outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <span class="flex items-center gap-3 text-sm font-medium"><Terminal class="size-4 text-accent" /> Run a local instance</span>
                <ChevronRight class="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div class="border-t border-border/70 p-5">
                <p class="text-sm leading-relaxed text-muted-foreground">You need Node.js 20+, pnpm 10+, and Docker or PostgreSQL 15+. Copy the environment file and replace <code class="font-mono text-xs text-foreground">JWT_SECRET</code> with a long random value.</p>
                <pre class="mt-4 overflow-x-auto rounded-md border border-border bg-sidebar p-4 font-mono text-[11px] leading-6 text-foreground"><code>git clone https://github.com/Hoodgail/opentales.git
cd opentales
pnpm install
pnpm dev:deps
cp packages/backend/.env.example packages/backend/.env
pnpm --dir packages/backend prisma:generate
pnpm --dir packages/backend prisma:migrate
pnpm --dir packages/backend prisma:seed</code></pre>
                <p class="mt-4 text-sm leading-relaxed text-muted-foreground">Run <code class="font-mono text-xs text-foreground">pnpm dev:backend</code> and <code class="font-mono text-xs text-foreground">pnpm dev:web</code> in separate terminals, then open <a href="http://localhost:5173" class="text-foreground underline decoration-border underline-offset-4 hover:decoration-accent">localhost:5173</a>. The seed login is <code class="font-mono text-xs text-foreground">demo@opentales.local</code> / <code class="font-mono text-xs text-foreground">password123</code>.</p>
                <div class="mt-4 flex gap-3 rounded-md border border-accent/25 bg-accent/5 p-4"><ShieldCheck class="mt-0.5 size-4 shrink-0 text-accent" /><p class="text-sm leading-relaxed text-muted-foreground">Before exposing an instance publicly, configure HTTPS and CORS, persistent database and asset storage, strong secrets, backups, and a reverse proxy. The checked-in production compose file expects the project's proxy network; adapt it to your host.</p></div>
              </div>
            </details>

            <details class="group rounded-lg border border-border/70 bg-panel/30">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg p-5 outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <span class="flex items-center gap-3 text-sm font-medium"><GitBranch class="size-4 text-accent" /> Contribute a change</span>
                <ChevronRight class="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div class="border-t border-border/70 p-5">
                <p class="text-sm leading-relaxed text-muted-foreground">Create a focused branch, keep the frontend on Svelte 5 runes, follow controller → use case → repository boundaries in the backend, and include a Prisma migration for schema changes.</p>
                <pre class="mt-4 overflow-x-auto rounded-md border border-border bg-sidebar p-4 font-mono text-[11px] leading-6 text-foreground"><code>pnpm lint
pnpm test
pnpm eval
pnpm build</code></pre>
                <div class="mt-5 flex flex-wrap gap-3 text-sm">
                  <a href="https://github.com/Hoodgail/opentales/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-foreground underline decoration-border underline-offset-4 hover:decoration-accent">Contributing guide <ExternalLink class="size-3" /></a>
                  <a href="https://github.com/Hoodgail/opentales/blob/main/docs/architecture.md" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-foreground underline decoration-border underline-offset-4 hover:decoration-accent">Architecture <ExternalLink class="size-3" /></a>
                  <a href="https://github.com/Hoodgail/opentales/blob/main/docs/novel-build.md" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-foreground underline decoration-border underline-offset-4 hover:decoration-accent">Novel Builds <ExternalLink class="size-3" /></a>
                </div>
              </div>
            </details>
          </div>

          <div class="mt-8 flex flex-col items-start justify-between gap-5 rounded-xl border border-border/70 bg-panel/50 p-6 sm:flex-row sm:items-center">
            <div>
              <div class="flex items-center gap-2 text-sm font-medium"><CircleHelp class="size-4 text-accent" /> Found a gap?</div>
              <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">Report the confusing moment, not just the missing feature. That is how this guide stays short and useful.</p>
            </div>
            <a href="https://github.com/Hoodgail/opentales/issues" target="_blank" rel="noopener noreferrer" class="inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm outline-none hover:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent"><Code2 class="size-4" /> Open an issue</a>
          </div>
        </section>
      </article>
    </div>

    <section class="border-t border-border/60 bg-panel/30">
      <div class="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-6 px-6 py-14 sm:flex-row sm:items-center">
        <div>
          <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Ready when the sentence is</div>
          <h2 class="mt-2 text-2xl font-semibold tracking-tight">Open a chapter. The rest can wait.</h2>
        </div>
        <a href="/projects" class="group inline-flex h-11 items-center gap-2 rounded-md bg-foreground px-5 text-sm font-medium text-background outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent">Open OpenTales <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" /></a>
      </div>
    </section>
  </main>

  <Footer page="guide" />
</div>

<style>
  .guide-grid {
    background-image:
      linear-gradient(to right, color-mix(in oklab, var(--foreground) 3%, transparent) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 3%, transparent) 1px, transparent 1px);
    background-size: 56px 56px;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  @media (min-width: 64rem) {
    .guide-hero-layout {
      grid-template-columns: minmax(0, 1fr) 21rem;
    }

    .guide-layout {
      grid-template-columns: 13.5rem minmax(0, 1fr);
    }
  }
</style>
