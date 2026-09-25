<script lang="ts">
  import { manuscript } from "$lib/stores/manuscript.svelte";
</script>

<div class="m-auto max-w-md p-6 text-sm">
  <h1 class="font-semibold">Story notes</h1>
  <p class="mt-2 text-muted-foreground">
    Keep your story bible, canon, plans, and progress in project docs. The
    writing agent can read and update them as your story evolves.
  </p>
  <button
    type="button"
    onclick={() => void manuscript.setActiveView("docs")}
    class="mt-4 rounded border border-border px-3 py-2"
    >Open Docs &amp; Notes</button
  >
</div>
