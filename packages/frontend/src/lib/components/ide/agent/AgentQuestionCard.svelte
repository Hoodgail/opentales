<script lang="ts">
  import { Check, Loader2, MessageCircleQuestion, X } from "lucide-svelte";
  import type { AiAgentQuestion, AnswerAiQuestionInput } from "@opentales/sdk";
  import { cn } from "$lib/utils";

  interface Props {
    question: AiAgentQuestion;
    busy?: boolean;
    error?: string;
    onSubmit: (answers: AnswerAiQuestionInput["answers"]) => void;
    onDismiss: () => void;
  }

  let { question, busy = false, error, onSubmit, onDismiss }: Props = $props();

  let selected = $state<Record<string, string[]>>({});
  let custom = $state<Record<string, string>>({});

  const complete = $derived(
    question.fields.every(
      (field) => (selected[field.key]?.length ?? 0) > 0 || (custom[field.key] ?? "").trim(),
    ),
  );

  function toggle(key: string, value: string, multi: boolean) {
    const current = selected[key] ?? [];
    selected[key] = multi
      ? current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      : current[0] === value
        ? []
        : [value];
    if (!multi) custom[key] = "";
  }

  function submit() {
    if (!complete || busy) return;
    const answers: AnswerAiQuestionInput["answers"] = {};
    for (const field of question.fields) {
      const typed = (custom[field.key] ?? "").trim();
      const picks = selected[field.key] ?? [];
      if (field.type === "multiselect") answers[field.key] = typed ? [...picks, typed] : picks;
      else if (field.type === "boolean") answers[field.key] = (typed || picks[0]) === "true";
      else if (field.type === "number" || field.type === "integer") answers[field.key] = Number(typed || picks[0]);
      else answers[field.key] = typed || picks[0] || "";
    }
    onSubmit(answers);
  }
</script>

<section
  class="agent-slip agent-rise relative overflow-hidden rounded-lg border border-accent/30 bg-card/90 p-3"
  aria-label="Question from the agent"
>
  <header class="mb-2 flex items-center gap-2">
    <MessageCircleQuestion class="size-3.5 text-accent" />
    <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">The agent asks</h3>
  </header>

  <div class="space-y-3">
    {#each question.fields as field (field.key)}
      {@const multi = field.type === "multiselect"}
      <fieldset>
        <legend class="font-serif text-[13px] leading-snug text-foreground">
          {field.description ?? field.title}
        </legend>
        {#if field.description && field.title !== field.description}
          <p class="mt-0.5 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">{field.title}</p>
        {/if}
        {#if field.options.length}
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each field.options as option (option.value)}
              {@const on = (selected[field.key] ?? []).includes(option.value)}
              <button
                type="button"
                aria-pressed={on}
                onclick={() => toggle(field.key, option.value, multi)}
                title={option.description}
                class={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  on
                    ? "border-accent bg-accent text-accent-foreground shadow-[0_0_0_3px_color-mix(in_oklch,var(--accent)_15%,transparent)]"
                    : "border-border bg-background/60 text-foreground/85 hover:border-accent/50",
                )}
              >
                {#if on}<Check class="size-3" />{/if}
                {option.label}
              </button>
            {/each}
          </div>
        {/if}
        {#if field.custom || !field.options.length}
          <input
            type="text"
            bind:value={custom[field.key]}
            oninput={() => { if (!multi && custom[field.key]) selected[field.key] = []; }}
            onkeydown={(e) => e.key === "Enter" && submit()}
            placeholder={field.options.length ? "Or write your own…" : "Your answer…"}
            class="mt-2 w-full rounded-md border border-border bg-background/70 px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:border-accent/60 focus:outline-none"
          />
        {/if}
      </fieldset>
    {/each}
  </div>

  {#if error}
    <p role="alert" class="mt-2 text-[11px] text-destructive">{error}</p>
  {/if}

  <footer class="mt-3 flex items-center justify-end gap-1.5">
    <button
      type="button"
      onclick={onDismiss}
      disabled={busy}
      class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <X class="size-3" /> Skip
    </button>
    <button
      type="button"
      onclick={submit}
      disabled={!complete || busy}
      class="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {#if busy}<Loader2 class="size-3 motion-safe:animate-spin" />{:else}<Check class="size-3" />{/if}
      Answer
    </button>
  </footer>
</section>
