import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiAgentSessionSummary } from "@opentales/sdk";
import AiSessionMenu from "./AiSessionMenu.svelte";

afterEach(() => cleanup());

function session(id: string): AiAgentSessionSummary {
  return {
    id,
    projectId: "project-1",
    title: id === "session-1" ? "First session" : "Active session",
    approvalMode: id === "session-2" ? "auto" : "manual",
    status: "idle",
    messageCount: 2,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
  };
}

describe("AiSessionMenu", () => {
  it("focuses the selected option, supports arrow keys, and restores focus on Escape", async () => {
    render(AiSessionMenu, {
      title: "Active session",
      sessions: [session("session-1"), session("session-2")],
      activeSessionId: "session-2",
      loading: false,
      onCreate: vi.fn(),
      onSelect: vi.fn(),
    });
    const trigger = screen.getByRole("button", { name: "Switch AI session" });
    await fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const active = screen.getByRole("option", { name: /Active session/ });
    await waitFor(() => expect(document.activeElement).toBe(active));
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.textContent).toContain("Auto");

    await fireEvent.keyDown(active, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New" }));
    await fireEvent.keyDown(document.activeElement ?? active, { key: "End" });
    expect(document.activeElement).toBe(active);
    await fireEvent.keyDown(active, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("selects sessions once and closes the dialog", async () => {
    const select = vi.fn();
    render(AiSessionMenu, {
      title: "First session",
      sessions: [session("session-1"), session("session-2")],
      activeSessionId: "session-1",
      loading: false,
      onCreate: vi.fn(),
      onSelect: select,
    });
    await fireEvent.click(screen.getByRole("button", { name: "Switch AI session" }));
    await fireEvent.click(screen.getByRole("option", { name: /Active session/ }));

    expect(select).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith("session-2");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
