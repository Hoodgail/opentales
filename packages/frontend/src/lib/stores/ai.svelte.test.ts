import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenTalesClient, type AiModelCatalog } from "@opentales/sdk";
import { createAiStore, reconnectDelayMs } from "./ai.svelte";

const now = "2026-08-25T00:00:00.000Z";

describe("AI settings store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("runs Codex device auth and applies the connected project settings", async () => {
    vi.spyOn(OpenTalesClient.prototype, "startCodexAuth").mockResolvedValue({
      deviceAuthId: "device-1",
      userCode: "ABCD",
      verificationUri: "https://auth.openai.com/codex/device",
      expiresIn: 900,
      interval: 5,
    });
    vi.spyOn(OpenTalesClient.prototype, "pollCodexAuth").mockResolvedValue({
      status: "authorized",
      settings: {
        projectId: "project-1",
        enabled: true,
        providerKind: "codex",
        model: "codex/gpt-5.4",
        baseUrl: null,
        hasApiKey: true,
        updatedAt: now,
      },
    });
    const store = createAiStore();

    await expect(store.startCodexAuth("project-1")).resolves.toMatchObject({ userCode: "ABCD" });
    await expect(store.pollCodexAuth("project-1", "device-1", "ABCD")).resolves.toMatchObject({ status: "authorized" });
    expect(store.settings).toMatchObject({ providerKind: "codex", model: "codex/gpt-5.4", hasApiKey: true });
  });

  it('ignores superseded catalog requests and clears models on discovery failure', async () => {
    let resolveOld!: (catalog: AiModelCatalog) => void;
    const newer: AiModelCatalog = { providers: [], updatedAt: 'new', source: 'provider' };
    const list = vi.spyOn(OpenTalesClient.prototype, 'listAiModels')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(newer);
    const store = createAiStore();
    const old = store.loadModelCatalog('project-1');
    await store.loadModelCatalog('project-1');
    resolveOld({ providers: [], updatedAt: 'old', source: 'models.dev' });
    await old;
    expect(store.modelCatalog).toEqual(newer);
    list.mockRejectedValueOnce(new Error('Invalid key'));
    await store.loadModelCatalog('project-1');
    expect(store.modelCatalog).toBeNull();
    expect(store.modelCatalogError).toBe('Invalid key');
  });

});

describe("reconnectDelayMs", () => {
  it("uses bounded jittered exponential backoff", () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(375);
    expect(reconnectDelayMs(1, () => 0.5)).toBe(1_000);
    expect(reconnectDelayMs(20, () => 1)).toBeLessThanOrEqual(8_000);
  });
});
