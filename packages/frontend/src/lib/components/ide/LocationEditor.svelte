<script lang="ts">
  import { Eye, Image as ImageIcon, MapPin, Sparkles, Upload } from 'lucide-svelte';
  import { liveTextField } from '$lib/actions/liveTextField';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { Location } from '$lib/data/manuscript-types';
  import ExpandableMarkdownEditor from './ExpandableMarkdownEditor.svelte';

  type LocationMarkdownField = 'description' | 'atmosphere' | 'sensoryDetails' | 'significance';

  interface MarkdownFieldConfig {
    key: LocationMarkdownField;
    label: string;
    icon: typeof MapPin;
    height: string;
  }

  interface Props {
    location: Location;
  }

  let { location }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();

  const markdownFields: MarkdownFieldConfig[] = [
    { key: 'description', label: 'Description', icon: MapPin, height: 'h-40' },
    { key: 'atmosphere', label: 'Atmosphere', icon: Sparkles, height: 'h-40' },
    { key: 'sensoryDetails', label: 'Sensory Details', icon: Eye, height: 'h-36' },
    { key: 'significance', label: 'Narrative Significance', icon: Sparkles, height: 'h-36' }
  ];

  function handleUpload(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void manuscript.setLocationImage(location.id, file);
    input.value = '';
  }

  function updateMarkdownField(locationId: string, field: LocationMarkdownField, value: string) {
    if (field === 'description') {
      void manuscript.updateLocation(locationId, { description: value });
    } else if (field === 'atmosphere') {
      void manuscript.updateLocation(locationId, { atmosphere: value });
    } else if (field === 'sensoryDetails') {
      void manuscript.updateLocation(locationId, { sensoryDetails: value });
    } else {
      void manuscript.updateLocation(locationId, { significance: value });
    }
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
            use:liveTextField={{
              document: { kind: 'location', entityId: location.id, field: 'name' },
              getValue: () => location.name,
              onRemoteValue: (value) => manuscript.updateLocation(location.id, { name: value })
            }}
            oninput={(e) =>
              void manuscript.updateLocation(location.id, {
                name: (e.currentTarget as HTMLInputElement).value
              })}
            class="w-full bg-transparent font-serif text-3xl font-semibold tracking-tight text-foreground outline-none focus:border-b focus:border-accent"
          />
          <input
            value={location.type}
            use:liveTextField={{
              document: { kind: 'location', entityId: location.id, field: 'type' },
              getValue: () => location.type,
              onRemoteValue: (value) => manuscript.updateLocation(location.id, { type: value })
            }}
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
        {#each markdownFields as field (field.key)}
          <ExpandableMarkdownEditor
            value={location[field.key]}
            onChange={(next) => updateMarkdownField(location.id, field.key, next)}
            label={field.label}
            icon={field.icon}
            contextLabel={location.name}
            height={field.height}
            collaboration={{ kind: 'location', entityId: location.id, field: field.key }}
          />
        {/each}
      </div>
    </div>
  </div>
</div>
