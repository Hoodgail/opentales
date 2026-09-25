import { describe, expect, it, vi } from "vitest";
import { OpenTalesClient } from "./client.js";

function createHarness(responseBody: unknown = {}) {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
  const client = new OpenTalesClient({
    baseUrl: "https://api.example.test/",
    token: "secret-token",
    fetcher,
  });
  return { client, fetcher: fetcher as unknown as ReturnType<typeof vi.fn> };
}

describe("OpenTalesClient scene contracts", () => {
  it("uses first-class scene CRUD routes", async () => {
    const { client, fetcher } = createHarness({});
    await client.listScenes("p", "c");
    await client.createScene("p", "c", {
      title: "Threshold",
      sceneFunction: "inciting incident",
      content: "The door opened.",
    });
    await client.updateScene("p", "c", "s", {
      status: "review",
      expectedRevision: 2,
    });
    await client.deleteScene("p", "c", "s");
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.test/projects/p/chapters/c/scenes",
      "https://api.example.test/projects/p/chapters/c/scenes",
      "https://api.example.test/projects/p/chapters/c/scenes/s",
      "https://api.example.test/projects/p/chapters/c/scenes/s",
    ]);
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual([
      "GET",
      "POST",
      "PATCH",
      "DELETE",
    ]);
  });
});
