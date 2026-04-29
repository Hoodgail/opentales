<script lang="ts">
  import { BookOpen, FileText } from 'lucide-svelte';
  import { manuscript } from '$lib/stores/manuscript.svelte';
  import AiApprovalEditor from './AiApprovalEditor.svelte';
  import ChapterEditor from './ChapterEditor.svelte';
  import CharacterEditor from './CharacterEditor.svelte';
  import DocEditor from './DocEditor.svelte';
  import EditorTabs from './EditorTabs.svelte';
  import LocationEditor from './LocationEditor.svelte';
  import OutlineEditor from './OutlineEditor.svelte';
  import StructureEditor from './StructureEditor.svelte';
  import SubmissionEditor from './SubmissionEditor.svelte';

  const activeTab = $derived(
    manuscript.tabs.find((t) => t.id === manuscript.activeTabId) ?? null
  );

  const activeChapter = $derived(
    activeTab?.type === 'chapter'
      ? manuscript.chapters.find((c) => c.id === activeTab.refId) ?? null
      : null
  );
  const activeCharacter = $derived(
    activeTab?.type === 'character'
      ? manuscript.characters.find((c) => c.id === activeTab.refId) ?? null
      : null
  );
  const activeLocation = $derived(
    activeTab?.type === 'location'
      ? manuscript.locations.find((l) => l.id === activeTab.refId) ?? null
      : null
  );
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <EditorTabs />
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    {#if !activeTab}
      <div class="flex h-full items-center justify-center bg-background">
        <div class="max-w-md text-center">
          <div
            class="mx-auto mb-4 flex size-12 items-center justify-center rounded-md border border-border bg-card"
          >
            <FileText class="size-5 text-muted-foreground" />
          </div>
          <h2 class="font-serif text-2xl font-semibold text-foreground">
            {manuscript.structure.title}
          </h2>
          <p class="mt-2 text-sm text-muted-foreground">
            Select a chapter, character, or setting to begin.
          </p>
          <button
            type="button"
            onclick={() =>
              void manuscript.openTab({
                id: 'tab-outline',
                type: 'outline',
                refId: 'outline',
                title: 'Outline'
              })}
            class="mt-6 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground transition-colors hover:border-accent/60"
          >
            <BookOpen class="size-3.5" />
            Open Master Outline
          </button>
        </div>
      </div>
    {:else if activeTab.type === 'chapter' && activeChapter}
      <ChapterEditor chapter={activeChapter} />
    {:else if activeTab.type === 'character' && activeCharacter}
      <CharacterEditor character={activeCharacter} />
    {:else if activeTab.type === 'location' && activeLocation}
      <LocationEditor location={activeLocation} />
    {:else if activeTab.type === 'structure'}
      <StructureEditor />
    {:else if activeTab.type === 'outline'}
      <OutlineEditor />
    {:else if activeTab.type === 'submission'}
      <SubmissionEditor submissionId={activeTab.refId} />
    {:else if activeTab.type === 'doc'}
      <DocEditor docId={activeTab.refId} />
    {:else if activeTab.type === 'ai-approval'}
      <AiApprovalEditor approvalId={activeTab.refId} />
    {/if}
  </div>
</div>
