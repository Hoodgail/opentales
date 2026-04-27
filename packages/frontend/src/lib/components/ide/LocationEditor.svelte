<script lang="ts">
  import { Eye, Image as ImageIcon, MapPin, Sparkles, Upload } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { Location } from '$lib/data/manuscript-types';

  interface Props {
    location: Location;
  }

  let { location }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();

  function handleUpload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void manuscript.setLocationImage(location.id, file);
    input.value = '';
  }
</script>

<div class="flex h-full flex-col bg-background">
  <div
    class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-sidebar/40 px-4 text-xs text-muted-foreground"
  >
    <MapPin class="size-3.5" />
    <span class="font-mono">Settings</span>
    <span class="text-muted-foreground/50">/</span>
    <span class="text-foreground">{location.name}</span>
  </div>

  <div class="flex-1 overflow-y-auto">
    <div class="mx-auto max-w-4xl p-8">
      <!-- Hero image -->
      <div
        class="group relative mb-6 aspect-[16/7] overflow-hidden rounded-md border border-border bg-muted"
      >
        {#if location.image}
          <img src={location.image} alt={location.name} class="size-full object-cover" />
          <div
            class="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent"
          ></div>
        {:else}
          <div
            class="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"
          >
            <ImageIcon class="size-8" />
            <span class="text-xs">No image uploaded</span>
          </div>
        {/if}

        <div class="absolute bottom-4 left-6 right-6">
          <input
            value={location.name}
            oninput={(e) =>
              void manuscript.updateLocation(location.id, {
                name: (e.currentTarget as HTMLInputElement).value
              })}
            class="w-full bg-transparent font-serif text-3xl font-semibold tracking-tight text-foreground outline-none focus:border-b focus:border-accent"
          />
          <input
            value={location.type}
            oninput={(e) =>
              void manuscript.updateLocation(location.id, {
                type: (e.currentTarget as HTMLInputElement).value
              })}
            class="mt-1 w-full bg-transparent text-xs uppercase tracking-[0.15em] text-muted-foreground outline-none"
          />
        </div>

        <button
          type="button"
          onclick={() => fileInput?.click()}
          class="absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2.5 py-1.5 text-xs text-foreground backdrop-blur-sm transition-colors hover:border-accent/60 hover:bg-card"
        >
          <Upload class="size-3.5" />
          Upload Image
        </button>
        <input
          bind:this={fileInput}
          type="file"
          accept="image/*"
          onchange={handleUpload}
          class="hidden"
        />
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <MapPin class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Description
            </h3>
          </header>
          <div class="p-3">
            <textarea
              value={location.description}
              oninput={(e) =>
                void manuscript.updateLocation(location.id, {
                  description: (e.currentTarget as HTMLTextAreaElement).value
                })}
              rows={6}
              class="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none"
            ></textarea>
          </div>
        </section>

        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Sparkles class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Atmosphere
            </h3>
          </header>
          <div class="p-3">
            <textarea
              value={location.atmosphere}
              oninput={(e) =>
                void manuscript.updateLocation(location.id, {
                  atmosphere: (e.currentTarget as HTMLTextAreaElement).value
                })}
              rows={6}
              class="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none"
            ></textarea>
          </div>
        </section>

        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Eye class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Sensory Details
            </h3>
          </header>
          <div class="p-3">
            <textarea
              value={location.sensoryDetails}
              oninput={(e) =>
                void manuscript.updateLocation(location.id, {
                  sensoryDetails: (e.currentTarget as HTMLTextAreaElement).value
                })}
              rows={5}
              class="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none"
            ></textarea>
          </div>
        </section>

        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Sparkles class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Narrative Significance
            </h3>
          </header>
          <div class="p-3">
            <textarea
              value={location.significance}
              oninput={(e) =>
                void manuscript.updateLocation(location.id, {
                  significance: (e.currentTarget as HTMLTextAreaElement).value
                })}
              rows={5}
              class="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none"
            ></textarea>
          </div>
        </section>
      </div>
    </div>
  </div>
</div>
