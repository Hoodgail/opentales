<script lang="ts">
  import { ArrowRight } from 'lucide-svelte';
</script>

<section id="get-started" class="border-b border-border/60">
  <div class="mx-auto w-full max-w-6xl px-6 py-24">
    <div class="relative overflow-hidden rounded-xl border border-border/60 bg-panel/60 p-10 sm:p-16">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 opacity-[0.05]"
        style="background-image: linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px); background-size: 40px 40px;"
      ></div>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-accent/10 blur-3xl"
      ></div>

      <div class="relative mx-auto max-w-2xl text-center">
        <div class="mb-3 font-mono text-[11px] uppercase tracking-wider text-accent">
          Free &amp; open-source
        </div>
        <h2 class="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Your next novel deserves a better workspace.
        </h2>
        <p class="mt-4 text-pretty text-muted-foreground">
          OpenTales is open-source and free to use. Bring a draft, an outline, or a half-formed
          idea — the editor is ready when you are.
        </p>

        <div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
            href="https://github.com/Hoodgail/opentales"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-11 items-center rounded-md border border-border/60 bg-background/40 px-6 text-sm transition-colors hover:bg-muted"
          >
            Star on GitHub
          </a>
        </div>
      </div>
    </div>
  </div>
</section>
