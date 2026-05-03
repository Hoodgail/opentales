<script lang="ts">
  import { Bot, CheckCircle2, Loader2, Sparkles } from 'lucide-svelte';
  import type { ProjectAiSkill } from '@opentales/sdk';
  import { liveTextField } from '$lib/actions/liveTextField';
  import { ai } from '$lib/stores/ai.svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import MonacoMarkdownEditor from './MonacoMarkdownEditor.svelte';

  interface Props {
    skillId: string;
  }

  let { skillId }: Props = $props();

  let skill = $state<ProjectAiSkill | null>(null);
  let loading = $state(true);
  let localContent = $state('');
  let lastSkillId = $state<string | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const projectId = $derived(manuscript.projectId);

  $effect(() => {
    if (!projectId) return;
    if (skillId === lastSkillId) return;
    lastSkillId = skillId;
    loading = true;
    void loadSkill(projectId, skillId);
  });

  async function loadSkill(pid: string, id: string) {
    if (ai.skills.length === 0) await ai.loadSkills(pid);
    const result = ai.skills.find((candidate) => candidate.id === id) ?? null;
    skill = result;
    localContent = result?.content ?? '';
    loading = false;
  }

  function handleChange(next: string) {
    localContent = next;
    debounceAutosave();
  }

  function debounceAutosave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (projectId && skill) void ai.updateSkill(projectId, skill.id, { content: localContent });
    }, 1200);
  }

  async function updateName(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const name = input.value.trim();
    if (!name || !projectId || !skill) return;
    const updated = await ai.updateSkill(projectId, skill.id, { name });
    if (!updated) return;
    skill = updated;
    const tab = manuscript.tabs.find((candidate) => candidate.id === `tab-ai-skill-${skillId}`);
    if (tab) tab.title = updated.name;
  }

  async function updateDescription(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const description = input.value.trim();
    if (!description || !projectId || !skill) return;
    const updated = await ai.updateSkill(projectId, skill.id, { description });
    if (updated) skill = updated;
  }

  async function toggleEnabled() {
    if (!projectId || !skill) return;
    const updated = await ai.updateSkill(projectId, skill.id, { enabled: !skill.enabled });
    if (updated) skill = updated;
  }
</script>

{#if loading}
  <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
    <Loader2 class="mr-2 size-3.5 animate-spin" />
    Loading…
  </div>
{:else if !skill}
  <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
    AI skill not found
  </div>
{:else}
  <div class="flex h-full flex-col bg-background">
    <div
      class="flex min-h-11 shrink-0 items-center gap-3 overflow-x-auto border-b border-border bg-sidebar/40 px-4 text-xs [scrollbar-width:none]"
    >
      <Sparkles class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="shrink-0 font-mono text-muted-foreground">Agent Skills</span>
      <span class="shrink-0 text-muted-foreground/50">/</span>
      <input
        type="text"
        value={skill.name}
        use:liveTextField={{
          document: { kind: 'ai-skill', entityId: skill.id, field: 'name' },
          getValue: () => skill?.name ?? '',
          onRemoteValue: (value) => {
            if (!skill || !projectId) return;
            skill.name = value;
            void ai.updateSkill(projectId, skill.id, { name: value });
          }
        }}
        onblur={updateName}
        class="min-w-32 flex-1 bg-transparent text-foreground outline-none focus:border-b focus:border-accent"
      />
      <button
        type="button"
        onclick={toggleEnabled}
        class="inline-flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {#if skill.enabled}
          <CheckCircle2 class="size-3 text-emerald-400" /> Enabled
        {:else}
          <Bot class="size-3" /> Disabled
        {/if}
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-border bg-card/40 px-4 py-2">
        <label class="block">
          <span class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Activation Description
          </span>
          <input
            type="text"
            value={skill.description}
            use:liveTextField={{
              document: { kind: 'ai-skill', entityId: skill.id, field: 'description' },
              getValue: () => skill?.description ?? '',
              onRemoteValue: (value) => {
                if (!skill || !projectId) return;
                skill.description = value;
                void ai.updateSkill(projectId, skill.id, { description: value });
              }
            }}
            onblur={updateDescription}
            class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
          />
        </label>
      </div>

      <div class="min-h-0 flex-1">
        <MonacoMarkdownEditor
          value={localContent}
          onChange={handleChange}
          collaboration={{ kind: 'ai-skill', entityId: skill.id, field: 'content' }}
          collaborationLocation={{ tabType: 'ai-skill', refId: skill.id, title: skill.name, field: 'content' }}
        />
      </div>
    </div>
  </div>
{/if}
