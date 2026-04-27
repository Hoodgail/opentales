<script lang="ts">
  import { Code2, Compass, FileText, MapPin, Network, Users } from 'lucide-svelte';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const features: { icon: any; title: string; body: string }[] = [
    {
      icon: Code2,
      title: 'Monaco-powered editor',
      body: 'The same editor that powers VS Code, tuned for prose. Markdown highlighting, multi-cursor, find-and-replace, and a custom theme calibrated for long sessions.'
    },
    {
      icon: Users,
      title: 'Living characters',
      body: 'Every character is a first-class document — portraits, traits, voice samples, and relationships. Mention a name and the inspector wires it to the source.'
    },
    {
      icon: MapPin,
      title: 'Settings with atmosphere',
      body: 'Upload reference imagery for every location. Mood, sensory details, and notable features travel with the place wherever it appears in your manuscript.'
    },
    {
      icon: Network,
      title: 'Plot, voice, and obstacles',
      body: 'Premise, theme, POV, climax, and obstacles live in their own structured panels — and connect back to the chapters where they pay off.'
    },
    {
      icon: FileText,
      title: 'Episodic chapters',
      body: 'Acts, chapters, and scene beats organized like a project tree. Drag to reorder, snapshot revisions, and track word counts per beat.'
    },
    {
      icon: Compass,
      title: 'Outline that holds together',
      body: "From premise to denouement, every story element is interconnected. Jump from a character's arc to the chapter where it breaks, instantly."
    }
  ];
</script>

<section id="features" class="border-b border-border/60">
  <div class="mx-auto w-full max-w-6xl px-6 py-24">
    <div class="mx-auto max-w-2xl text-center">
      <div class="mb-3 font-mono text-[11px] uppercase tracking-wider text-accent">Features</div>
      <h2 class="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        Everything a novel needs, nothing it doesn't.
      </h2>
      <p class="mt-4 text-pretty text-muted-foreground">
        OpenTales treats your novel like a codebase: modular, navigable, and built for
        structure. The interface stays out of the way so the work can stay the focus.
      </p>
    </div>

    <div
      class="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-2 lg:grid-cols-3"
    >
      {#each features as f (f.title)}
        <div
          class="group relative flex flex-col gap-3 bg-background p-6 transition-colors hover:bg-panel/50"
        >
          <div
            class="flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-panel text-accent"
          >
            <f.icon class="h-4 w-4" />
          </div>
          <h3 class="mt-2 text-base font-medium tracking-tight">{f.title}</h3>
          <p class="text-pretty text-sm leading-relaxed text-muted-foreground">{f.body}</p>
        </div>
      {/each}
    </div>
  </div>
</section>
