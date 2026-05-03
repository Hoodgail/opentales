<script lang="ts">
  import { Check } from "lucide-svelte";
  import type {
    AiAgentToolCall,
    AiQuestionPrompt,
    AskUserToolInput,
  } from "@opentales/sdk";

  interface Props {
    questions: AiAgentToolCall[];
    onSubmit: (toolCall: AiAgentToolCall, answers: string[][]) => void;
    onDismiss: (toolCallId: string) => void;
  }

  let { questions, onSubmit, onDismiss }: Props = $props();

  let answers = $state<Record<string, string[][]>>({});
  let customAnswers = $state<Record<string, Record<number, string>>>({});

  type JsonRecord = Record<string, unknown>;

  function submit(toolCall: AiAgentToolCall) {
    const input = askUserInput(toolCall);
    const nextAnswers = input.questions.map((question, index) => {
      const selected = answers[toolCall.id]?.[index] ?? [];
      const custom = customAnswers[toolCall.id]?.[index]?.trim();
      if (!custom || question.custom === false) return selected;
      if (question.multiple) return selected.includes(custom) ? selected : [...selected, custom];
      return [custom];
    });
    onSubmit(toolCall, nextAnswers);
  }

  function toggleAnswer(
    toolCallId: string,
    questionIndex: number,
    label: string,
    multiple: boolean,
  ) {
    const current = answers[toolCallId]?.[questionIndex] ?? [];
    const next = multiple
      ? current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label]
      : [label];
    const toolAnswers = [...(answers[toolCallId] ?? [])];
    toolAnswers[questionIndex] = next;
    answers = { ...answers, [toolCallId]: toolAnswers };
    if (!multiple) setCustomAnswer(toolCallId, questionIndex, "");
  }

  function setCustomAnswer(
    toolCallId: string,
    questionIndex: number,
    value: string,
  ) {
    customAnswers = {
      ...customAnswers,
      [toolCallId]: {
        ...(customAnswers[toolCallId] ?? {}),
        [questionIndex]: value,
      },
    };
  }

  function picked(toolCallId: string, questionIndex: number, label: string): boolean {
    return answers[toolCallId]?.[questionIndex]?.includes(label) ?? false;
  }

  function askUserInput(toolCall: AiAgentToolCall): AskUserToolInput {
    const input = inputRecord(toolCall.input);
    const parsedQuestions = Array.isArray(input.questions)
      ? input.questions.filter(isQuestionPrompt)
      : [];
    return { questions: parsedQuestions };
  }

  function inputRecord(input: unknown): JsonRecord {
    return input && typeof input === "object" && !Array.isArray(input)
      ? (input as JsonRecord)
      : {};
  }

  function isQuestionPrompt(value: unknown): value is AiQuestionPrompt {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as JsonRecord;
    return (
      typeof record.question === "string" &&
      typeof record.header === "string" &&
      Array.isArray(record.options) &&
      record.options.every(
        (option) =>
          option &&
          typeof option === "object" &&
          !Array.isArray(option) &&
          typeof (option as JsonRecord).label === "string",
      )
    );
  }
</script>

{#if questions.length > 0}
  <div class="border-t border-border">
    <div class="flex items-center gap-1.5 px-3 pt-2 pb-1">
      <span class="size-1 rounded-full bg-amber-400"></span>
      <p class="text-[10px] uppercase tracking-wider text-muted-foreground">
        Agent question
      </p>
    </div>
    <ul class="space-y-2 px-3 pb-3">
      {#each questions as toolCall (toolCall.id)}
        {@const input = askUserInput(toolCall)}
        <li class="rounded-lg border border-border bg-muted/20 p-2">
          {#if input.questions.length === 0}
            <div class="text-[11px] text-muted-foreground">
              The agent asked a question, but the payload was invalid.
            </div>
          {:else}
            <div class="space-y-3">
              {#each input.questions as question, questionIndex}
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-[10px] font-semibold uppercase tracking-wider text-accent">
                      {question.header}
                    </p>
                    <span class="text-[10px] text-muted-foreground">
                      {question.multiple ? "Choose one or more" : "Choose one"}
                    </span>
                  </div>
                  <p class="text-[12px] leading-relaxed text-foreground">
                    {question.question}
                  </p>
                  <div class="space-y-1">
                    {#each question.options as option}
                      <button
                        type="button"
                        onclick={() =>
                          toggleAnswer(
                            toolCall.id,
                            questionIndex,
                            option.label,
                            question.multiple === true,
                          )}
                        class="flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition {picked(
                          toolCall.id,
                          questionIndex,
                          option.label,
                        )
                          ? 'border-accent bg-accent/10 text-foreground'
                          : 'border-border bg-background/70 text-muted-foreground hover:border-accent/50 hover:text-foreground'}"
                      >
                        <span
                          class="mt-0.5 flex size-3 shrink-0 items-center justify-center border {question.multiple
                            ? 'rounded-sm'
                            : 'rounded-full'} {picked(
                            toolCall.id,
                            questionIndex,
                            option.label,
                          )
                            ? 'border-accent bg-accent text-accent-foreground'
                            : 'border-muted-foreground/40'}"
                        >
                          {#if picked(toolCall.id, questionIndex, option.label)}
                            <Check class="size-2.5" />
                          {/if}
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="flex items-center gap-1.5">
                            <span class="font-medium text-foreground">{option.label}</span>
                            {#if option.recommended}
                              <span
                                class="rounded bg-emerald-500/10 px-1 text-[9px] uppercase tracking-wider text-emerald-500"
                              >
                                Recommended
                              </span>
                            {/if}
                          </span>
                          {#if option.description}
                            <span class="mt-0.5 block leading-relaxed">
                              {option.description}
                            </span>
                          {/if}
                        </span>
                      </button>
                    {/each}
                    {#if question.custom !== false}
                      <textarea
                        value={customAnswers[toolCall.id]?.[questionIndex] ?? ""}
                        oninput={(event) =>
                          setCustomAnswer(
                            toolCall.id,
                            questionIndex,
                            event.currentTarget.value,
                          )}
                        placeholder="Type your own answer..."
                        rows="2"
                        class="w-full resize-none rounded-md border border-border bg-background/70 px-2 py-1.5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-accent/70"
                      ></textarea>
                    {/if}
                  </div>
                </div>
              {/each}
              <div class="flex items-center justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  onclick={() => onDismiss(toolCall.id)}
                  class="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onclick={() => submit(toolCall)}
                  class="rounded bg-accent px-2 py-1 text-[10px] text-accent-foreground hover:bg-accent/90"
                >
                  Submit answer
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
