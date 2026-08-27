import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiAgentToolCall } from "@opentales/sdk";
import AiAgentQuestions from "./AiAgentQuestions.svelte";

afterEach(() => cleanup());

function questionCall(input: unknown): AiAgentToolCall {
  return {
    id: "question-1",
    toolCallId: "sdk-question-1",
    toolName: "askUser",
    input,
    status: "pending-approval",
    output: null,
    error: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    decidedAt: null,
  };
}

describe("AiAgentQuestions", () => {
  it("keeps malformed questions dismissible", async () => {
    const dismiss = vi.fn();
    render(AiAgentQuestions, {
      questions: [questionCall({ questions: [{ header: "Missing fields" }] })],
      onSubmit: vi.fn(),
      onDismiss: dismiss,
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "Dismiss invalid question" }),
    );
    expect(dismiss).toHaveBeenCalledWith("question-1");
  });

  it("requires every answer and exposes checkbox semantics", async () => {
    const submit = vi.fn();
    render(AiAgentQuestions, {
      questions: [
        questionCall({
          questions: [
            {
              header: "Sources",
              question: "Which sources should be included?",
              multiple: true,
              custom: false,
              options: [{ label: "Outline" }, { label: "Story bible" }],
            },
            {
              header: "Scope",
              question: "Which draft?",
              custom: false,
              options: [{ label: "Current" }, { label: "Main" }],
            },
          ],
        }),
      ],
      onSubmit: submit,
      onDismiss: vi.fn(),
    });

    const submitButton = screen.getByRole("button", { name: "Submit answer" });
    const outline = screen.getByRole("checkbox", { name: "Outline" });
    const current = screen.getByRole("radio", { name: "Current" });
    expect(screen.getByRole("group", { name: "Which sources should be included?" })).toBeTruthy();
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(outline);
    expect(outline.getAttribute("aria-checked")).toBe("true");
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(current);
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(submitButton);

    expect(submit).toHaveBeenCalledWith(expect.anything(), [
      ["Outline"],
      ["Current"],
    ]);
  });

  it("disables repeat actions and surfaces backend failures", () => {
    render(AiAgentQuestions, {
      questions: [
        questionCall({
          questions: [
            {
              header: "Scope",
              question: "Which draft?",
              options: [{ label: "Current" }],
            },
          ],
        }),
      ],
      onSubmit: vi.fn(),
      onDismiss: vi.fn(),
      submitting: true,
      error: "The question could not be answered",
    });

    expect((screen.getByRole("radio", { name: "Current" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "The question could not be answered",
    );
  });
});
