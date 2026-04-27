<script lang="ts">
  import { Camera, Heart, Plus, ShieldAlert, Sparkles, Target, User, X } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import type { Character } from '$lib/data/manuscript-types';

  interface Props {
    character: Character;
  }

  let { character }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();

  let newRelToId = $state('');
  let newRelType = $state('');
  let newRelNote = $state('');

  const availableTargets = $derived(
    manuscript.characters.filter(
      (c) =>
        c.id !== character.id &&
        !character.relationships.some((r) => r.characterId === c.id && r.type === newRelType)
    )
  );

  function handleAvatar(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void manuscript.setCharacterAvatar(character.id, file);
    input.value = '';
  }

  async function addRelationship() {
    if (!newRelToId || !newRelType.trim()) return;
    await manuscript.addCharacterRelationship(character.id, {
      toCharacterId: newRelToId,
      type: newRelType.trim(),
      note: newRelNote.trim() || undefined
    });
    newRelToId = '';
    newRelType = '';
    newRelNote = '';
  }
</script>

<div class="flex h-full flex-col bg-background">
  <!-- Breadcrumb -->
  <div
    class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-sidebar/40 px-4 text-xs text-muted-foreground"
  >
    <User class="size-3.5" />
    <span class="font-mono">Characters</span>
    <span class="text-muted-foreground/50">/</span>
    <span class="text-foreground">{character.name}</span>
  </div>

  <div class="flex-1 overflow-y-auto">
    <div class="mx-auto max-w-4xl p-8">
      <!-- Header -->
      <div class="mb-8 flex items-start gap-6">
        <div class="relative shrink-0">
          <div
            class="size-32 overflow-hidden rounded-md border border-border bg-muted"
          >
            {#if character.avatar}
              <img src={character.avatar} alt={character.name} class="size-full object-cover" />
            {:else}
              <div
                class="flex size-full items-center justify-center text-3xl font-semibold text-muted-foreground"
              >
                {character.name.charAt(0)}
              </div>
            {/if}
          </div>
          <button
            type="button"
            onclick={() => fileInput?.click()}
            class="absolute -bottom-2 -right-2 flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-accent/60 hover:text-foreground"
            title="Upload portrait"
          >
            <Camera class="size-4" />
          </button>
          <input
            bind:this={fileInput}
            type="file"
            accept="image/*"
            onchange={handleAvatar}
            class="hidden"
          />
        </div>

        <div class="flex-1">
          <input
            value={character.name}
            oninput={(e) =>
              void manuscript.updateCharacter(character.id, {
                name: (e.currentTarget as HTMLInputElement).value
              })}
            class="w-full bg-transparent font-serif text-3xl font-semibold tracking-tight text-foreground outline-none focus:border-b focus:border-accent"
          />
          <div class="mt-2 grid grid-cols-3 gap-3 text-xs">
            <div class="rounded border border-border bg-card px-2 py-1.5">
              <div
                class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Role
              </div>
              <div class="mt-0.5">
                <input
                  value={character.role}
                  oninput={(e) =>
                    void manuscript.updateCharacter(character.id, {
                      role: (e.currentTarget as HTMLInputElement).value
                    })}
                  class="w-full bg-transparent text-foreground outline-none"
                />
              </div>
            </div>
            <div class="rounded border border-border bg-card px-2 py-1.5">
              <div
                class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Age
              </div>
              <div class="mt-0.5">
                <input
                  value={character.age}
                  oninput={(e) =>
                    void manuscript.updateCharacter(character.id, {
                      age: (e.currentTarget as HTMLInputElement).value
                    })}
                  class="w-full bg-transparent text-foreground outline-none"
                />
              </div>
            </div>
            <div class="rounded border border-border bg-card px-2 py-1.5">
              <div
                class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Occupation
              </div>
              <div class="mt-0.5">
                <input
                  value={character.occupation}
                  oninput={(e) =>
                    void manuscript.updateCharacter(character.id, {
                      occupation: (e.currentTarget as HTMLInputElement).value
                    })}
                  class="w-full bg-transparent text-foreground outline-none"
                />
              </div>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            {#each character.traits as t (t)}
              <span
                class="rounded border border-border bg-card px-2 py-0.5 text-[11px] text-foreground/80"
              >
                {t}
              </span>
            {/each}
          </div>
        </div>
      </div>

      <!-- Sections -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <User class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Description
            </h3>
          </header>
          <div class="p-3">
            <textarea
              value={character.description}
              oninput={(e) =>
                void manuscript.updateCharacter(character.id, {
                  description: (e.currentTarget as HTMLTextAreaElement).value
                })}
              rows={5}
              class="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none placeholder:text-muted-foreground"
            ></textarea>
          </div>
        </section>

        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Sparkles class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Appearance
            </h3>
          </header>
          <div class="p-3">
            <textarea
              value={character.appearance}
              oninput={(e) =>
                void manuscript.updateCharacter(character.id, {
                  appearance: (e.currentTarget as HTMLTextAreaElement).value
                })}
              rows={5}
              class="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none placeholder:text-muted-foreground"
            ></textarea>
          </div>
        </section>

        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Target class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Motivation
            </h3>
          </header>
          <div class="p-3">
            <textarea
              value={character.motivation}
              oninput={(e) =>
                void manuscript.updateCharacter(character.id, {
                  motivation: (e.currentTarget as HTMLTextAreaElement).value
                })}
              rows={4}
              class="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none placeholder:text-muted-foreground"
            ></textarea>
          </div>
        </section>

        <section class="rounded-md border border-border bg-card">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <ShieldAlert class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Character Arc
            </h3>
          </header>
          <div class="p-3">
            <textarea
              value={character.arc}
              oninput={(e) =>
                void manuscript.updateCharacter(character.id, {
                  arc: (e.currentTarget as HTMLTextAreaElement).value
                })}
              rows={4}
              class="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground/90 outline-none placeholder:text-muted-foreground"
            ></textarea>
          </div>
        </section>

        <section class="rounded-md border border-border bg-card lg:col-span-2">
          <header class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Heart class="size-3.5 text-accent/80" />
            <h3
              class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Relationships
            </h3>
          </header>
          <div class="p-3">
            {#if character.relationships.length === 0}
              <p class="mb-3 text-center text-xs italic text-muted-foreground">
                No relationships yet. Add one below.
              </p>
            {/if}
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
              {#each character.relationships as r (r.id)}
                {@const other = manuscript.characters.find((c) => c.id === r.characterId)}
                {#if other}
                  <div
                    class="group relative flex items-center gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:border-accent/40 hover:bg-muted/40"
                  >
                    <button
                      type="button"
                      onclick={() =>
                        void manuscript.openTab({
                          id: `tab-${other.id}`,
                          type: 'character',
                          refId: other.id,
                          title: other.name
                        })}
                      class="flex flex-1 items-center gap-3 text-left"
                    >
                      <div
                        class="size-10 shrink-0 overflow-hidden rounded-full border border-border bg-muted"
                      >
                        {#if other.avatar}
                          <img src={other.avatar} alt="" class="size-full object-cover" />
                        {/if}
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="truncate text-sm font-medium text-foreground">
                            {other.name}
                          </span>
                          <span
                            class="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                          >
                            {r.type}
                          </span>
                        </div>
                        <div class="truncate text-xs text-muted-foreground">{r.note}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onclick={() =>
                        void manuscript.removeCharacterRelationship(character.id, r.id)}
                      title="Remove relationship"
                      aria-label="Remove relationship"
                      class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive-foreground"
                    >
                      <X class="size-3.5" />
                    </button>
                  </div>
                {/if}
              {/each}
            </div>
            <div class="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <div class="min-w-[10rem] flex-1">
                <label
                  for="new-rel-target-{character.id}"
                  class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Character
                </label>
                <select
                  id="new-rel-target-{character.id}"
                  bind:value={newRelToId}
                  class="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent/60"
                >
                  <option value="">— Select —</option>
                  {#each availableTargets as candidate (candidate.id)}
                    <option value={candidate.id}>{candidate.name}</option>
                  {/each}
                </select>
              </div>
              <div class="min-w-[8rem] flex-1">
                <label
                  for="new-rel-type-{character.id}"
                  class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Type
                </label>
                <input
                  id="new-rel-type-{character.id}"
                  bind:value={newRelType}
                  placeholder="Mentor, Rival…"
                  class="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent/60"
                />
              </div>
              <div class="min-w-[12rem] flex-[2]">
                <label
                  for="new-rel-note-{character.id}"
                  class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Note
                </label>
                <input
                  id="new-rel-note-{character.id}"
                  bind:value={newRelNote}
                  placeholder="Optional"
                  class="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent/60"
                />
              </div>
              <button
                type="button"
                onclick={addRelationship}
                disabled={!newRelToId || !newRelType.trim()}
                class="inline-flex items-center gap-1 rounded border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-accent/60 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus class="size-3" />
                Add
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</div>
