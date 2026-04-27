<script lang="ts">
  import { ArrowRight, BookOpen } from 'lucide-svelte';
</script>

<section class="relative overflow-hidden border-b border-border/60">
  <!-- subtle grid backdrop -->
  <div
    aria-hidden="true"
    class="pointer-events-none absolute inset-0 opacity-[0.04]"
    style="background-image: linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px); background-size: 56px 56px;"
  ></div>
  <!-- soft accent glow -->
  <div
    aria-hidden="true"
    class="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[680px] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
  ></div>

  <div class="relative mx-auto w-full max-w-6xl px-6 pb-20 pt-24 sm:pt-28">
    <div class="mx-auto max-w-3xl text-center">
      <div
        class="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-panel/60 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
      >
        <BookOpen class="h-3 w-3 text-accent" />
        <span>v1.0 — open beta</span>
      </div>

      <h1 class="text-balance text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
        The IDE for
        <span class="font-serif italic text-accent">novelists</span>.
      </h1>

      <p
        class="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
      >
        Write chapters, build characters, map plot structure — all in one
        distraction-free workspace. Powered by Monaco, designed for long-form fiction.
      </p>

      <div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href="/projects"
          class="group inline-flex h-11 items-center gap-1 rounded-md bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Open the editor
          <ArrowRight
            class="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5"
          />
        </a>
        <a
          href="#features"
          class="inline-flex h-11 items-center rounded-md px-6 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Explore features
        </a>
      </div>

      <div
        class="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80"
      >
        <span class="flex items-center gap-1.5">
          <span class="h-1 w-1 rounded-full bg-accent"></span>
          Monaco editor
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-1 w-1 rounded-full bg-accent"></span>
          Markdown native
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-1 w-1 rounded-full bg-accent"></span>
          Local-first
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-1 w-1 rounded-full bg-accent"></span>
          Keyboard driven
        </span>
      </div>
    </div>
  </div>
</section>
