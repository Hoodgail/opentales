<script lang="ts">
  const steps = [
    {
      n: '01',
      title: 'Sketch the world',
      body: 'Drop in your characters, locations, and core conflicts. Add reference images so the world stays vivid as you write.'
    },
    {
      n: '02',
      title: 'Structure the story',
      body: 'Pin down POV, voice, theme, and climax. Lay out acts and chapter beats — OpenTales keeps every thread connected.'
    },
    {
      n: '03',
      title: 'Write the draft',
      body: 'Open a chapter and disappear into the editor. Inspector keeps relevant characters, places, and beats one glance away.'
    },
    {
      n: '04',
      title: 'Revise with context',
      body: 'Track changes per chapter, surface continuity issues, and jump from a setup to its payoff with a single keystroke.'
    }
  ];
</script>

<section id="workflow" class="border-b border-border/60 bg-panel/30">
  <div class="mx-auto w-full max-w-6xl px-6 py-24">
    <div class="grid gap-12 lg:grid-cols-[1fr_2fr] lg:gap-16">
      <div class="lg:sticky lg:top-24 lg:self-start">
        <div class="mb-3 font-mono text-[11px] uppercase tracking-wider text-accent">
          Workflow
        </div>
        <h2 class="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          From blank page to bound book.
        </h2>
        <p class="mt-4 text-pretty text-muted-foreground">
          A workflow shaped by working novelists. Plan as much or as little as you need —
          OpenTales adapts whether you outline obsessively or write into the dark.
        </p>
      </div>

      <ol class="relative flex flex-col">
        <span aria-hidden="true" class="absolute bottom-2 left-[15px] top-2 w-px bg-border/80"></span>
        {#each steps as s (s.n)}
          <li class="relative flex gap-6 pb-10 last:pb-0">
            <div
              class="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-background font-mono text-[10px] text-accent"
            >
              {s.n}
            </div>
            <div class="flex-1 pt-1">
              <h3 class="text-lg font-medium tracking-tight">{s.title}</h3>
              <p class="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </div>
          </li>
        {/each}
      </ol>
    </div>
  </div>
</section>
