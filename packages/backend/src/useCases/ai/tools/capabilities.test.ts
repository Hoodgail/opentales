import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buildAgentTools, executeAgentMutationTool } from "./index.js";
import {
  filterToolsForRole,
  filterToolsForSkill,
  isReadOnlyRole,
} from "./capabilities.js";
import { taskContractSchema } from "../runtime/taskContract.js";
import { loadBuiltInAiSkills } from "../markdownCatalog.js";

const tool = { execute: async () => "done" };
const tools = {
  readProjectDoc: tool,
  readChapter: tool,
  createProjectDoc: tool,
  updateProjectDoc: tool,
  updateChapter: tool,
  updateScene: tool,
  createCharacter: tool,
  task: tool,
};
const contract = taskContractSchema.parse({
  objective: "Write the opening",
  outputs: [{ type: "chapter-draft", name: "Opening" }],
  acceptanceCriteria: [{ id: "written", description: "Opening saved" }],
  scope: {
    chapterIds: ["chapter-1"],
    sceneIds: ["scene-1"],
    allowSupportingArtifacts: true,
  },
});

function actualTools(mode: "manual" | "auto" = "manual") {
  return buildAgentTools(
    {} as PrismaClient,
    { projectId: "p", userId: "u" },
    { handleApproval: async (_name, _input, execute) => execute() },
    { handleQuestion: async () => ({}) } as any,
    { handleTask: async () => ({}) } as any,
    [],
    {
      role: "orchestrator",
      primary: true,
      taskContract: null,
      approvalMode: mode,
    },
  );
}

describe("document-based agent capabilities", () => {
  it("exposes document and manuscript tools and removes the build surface", () => {
    const names = Object.keys(actualTools());
    expect(names).toEqual(
      expect.arrayContaining([
        "listProjectFiles",
        "readProjectDoc",
        "createProjectDoc",
        "updateProjectDoc",
        "createChapter",
        "updateChapter",
        "task",
      ]),
    );
    expect(
      names.some((name) => /Build|ArtifactBatch|Checkpoint/.test(name)),
    ).toBe(false);
    expect(actualTools().askUser).toBeDefined();
    expect(actualTools("auto").askUser).toBeUndefined();
  });

  it("rejects replaying a removed mutation", async () => {
    await expect(
      executeAgentMutationTool(
        {} as PrismaClient,
        { projectId: "p", userId: "u" },
        "startNovelBuild",
        {},
      ),
    ).rejects.toThrow();
  });

  it("keeps every shipped skill tool callable", () => {
    const available = new Set(Object.keys(actualTools()));
    for (const skill of loadBuiltInAiSkills()) {
      for (const name of skill.manifest.allowedTools)
        expect(available.has(name), skill.name + ": " + name).toBe(true);
    }
  });

  it("keeps exploration and research read-only", () => {
    for (const role of ["explorer", "researcher"] as const) {
      expect(
        Object.keys(
          filterToolsForRole(tools, role, contract, { primary: false }),
        ),
      ).toEqual(["readProjectDoc", "readChapter"]);
      expect(isReadOnlyRole(role)).toBe(true);
    }
    expect(isReadOnlyRole("drafter")).toBe(false);
  });

  it("lets planning and continuity roles maintain docs within their scope", () => {
    for (const role of [
      "creator",
      "librarian",
      "critic",
      "orchestrator",
    ] as const) {
      const scoped = filterToolsForRole(tools, role, contract, {
        primary: false,
      });
      expect(scoped.updateProjectDoc).toBeDefined();
      expect(scoped.updateChapter).toBeUndefined();
    }
    expect(
      filterToolsForRole(tools, "critic", null, { primary: false })
        .updateProjectDoc,
    ).toBeUndefined();
  });

  it("enforces assigned chapter and scene boundaries", async () => {
    const scoped = filterToolsForRole(tools, "drafter", contract, {
      primary: false,
    });
    await expect(
      scoped.updateChapter.execute!({ chapterId: "chapter-1" }),
    ).resolves.toBe("done");
    await expect(
      scoped.updateChapter.execute!({ chapterId: "chapter-2" }),
    ).rejects.toThrow("assigned chapters");
    await expect(
      scoped.updateScene.execute!({ sceneId: "scene-1" }),
    ).resolves.toBe("done");
    await expect(
      scoped.updateScene.execute!({ sceneId: "scene-2" }),
    ).rejects.toThrow("assigned scenes");
    expect(scoped.createCharacter).toBeUndefined();
  });

  it("narrows skill writes while preserving bounded reads", () => {
    const scoped = filterToolsForRole(tools, "drafter", contract, {
      primary: false,
    });
    expect(
      Object.keys(filterToolsForSkill(scoped, ["updateProjectDoc"])),
    ).toEqual(["readProjectDoc", "readChapter", "updateProjectDoc"]);
    expect(
      Object.keys(
        filterToolsForSkill(scoped, ["updateProjectDoc"], {
          preserveRoleReads: false,
        }),
      ),
    ).toEqual(["updateProjectDoc"]);
    expect(filterToolsForSkill(scoped, null)).toBe(scoped);
  });
});
