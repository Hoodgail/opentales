import { randomUUID } from "node:crypto";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOpenTalesMcpServer } from "./OpenTalesMcpServer.js";

const databaseUrl = process.env.REVISION_TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))(
  "MCP chapter persistence over JSON-RPC",
  () => {
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    const suffix = randomUUID();
    let userId: string;
    let orgId: string;
    let projectId: string;
    const handler = createMcpHandler(({ authInfo }) =>
      createOpenTalesMcpServer(prisma, authInfo),
    );
    beforeAll(async () => {
      const user = await prisma.user.create({
        data: {
          username: suffix,
          email: `${suffix}@example.test`,
          passwordHash: "test",
        },
      });
      userId = user.id;
      const org = await prisma.org.create({
        data: {
          slug: suffix,
          name: "MCP persistence",
          memberships: { create: { userId, role: "OWNER" } },
        },
      });
      orgId = org.id;
      const project = await prisma.project.create({
        data: { orgId, slug: suffix, title: "MCP persistence" },
      });
      projectId = project.id;
    });
    afterAll(async () => {
      await handler.close();
      if (orgId) await prisma.org.delete({ where: { id: orgId } });
      if (userId) await prisma.user.delete({ where: { id: userId } });
      await prisma.$disconnect();
    });
    async function call(
      name: string,
      args: Record<string, unknown>,
      access = "read-write",
    ) {
      const authInfo = {
        token: "test",
        clientId: "test",
        scopes: ["opentales:project:read", "opentales:project:write"],
        extra: {
          credentialId: "test",
          credentialType: "api-key",
          projectId,
          projectTitle: "MCP persistence",
          orgId,
          userId,
          role: "OWNER",
          access,
        },
      } as AuthInfo;
      const response = await handler.fetch(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: randomUUID(),
            method: "tools/call",
            params: { name, arguments: args },
          }),
        }),
        { authInfo },
      );
      expect(response.status).toBe(200);
      const raw = await response.text();
      const payload = JSON.parse(
        raw
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6) ?? raw,
      );
      expect(payload.error).toBeUndefined();
      return payload.result;
    }
    it("creates, initializes, edits, and re-reads chapter prose; stale edits leave the saved head intact", async () => {
      const created = await call("createChapter", { title: "The Last Signal" });
      expect(created.isError, JSON.stringify(created)).not.toBe(true);
      const list = await call("listChapters", {});
      const chapterId = list.structuredContent.result.items[0].id;
      const first = (await call("readChapter", { chapterId })).structuredContent
        .result;
      expect(first.content).toBe("");
      const prose =
        "Mara held the broken receiver.\n\nAt dawn, someone finally answered.";
      const update = await call("updateChapter", {
        chapterId,
        expectedHeadVersionId: first.headVersionId,
        content: prose,
      });
      expect(update.isError, JSON.stringify(update)).not.toBe(true);
      const saved = (await call("readChapter", { chapterId })).structuredContent
        .result;
      expect(saved.content).toBe(prose);
      expect(saved.wordCount).toBe(10);
      const stale = await call("updateChapter", {
        chapterId,
        expectedHeadVersionId: first.headVersionId,
        content: "Lost update",
      });
      expect(stale.isError).toBe(true);
      const edited = await call("updateChapter", {
        chapterId,
        expectedHeadVersionId: saved.headVersionId,
        contentEdit: {
          oldString: "broken receiver",
          newString: "silent receiver",
        },
      });
      expect(edited.isError, JSON.stringify(edited)).not.toBe(true);
      const reread = (await call("readChapter", { chapterId }))
        .structuredContent.result;
      expect(reread.content).toBe(prose.replace("broken", "silent"));
      const row = await prisma.chapter.findUniqueOrThrow({
        where: { id: chapterId },
        include: {
          bodyWriting: {
            include: { defaultBranch: { include: { headVersion: true } } },
          },
        },
      });
      expect(row.bodyWriting.defaultBranch?.headVersion?.body).toBe(
        reread.content,
      );
    });
    it("returns usable chapter receipts even when prose exceeds the MCP response cap", async () => {
      const content = "signal ".repeat(20_000);
      const created = await call("createChapter", {
        title: "Long chapter",
        content,
      });
      expect(created.isError, JSON.stringify(created)).not.toBe(true);
      const receipt = created.structuredContent.result;
      expect(receipt.truncated).toBeUndefined();
      expect(receipt.id).toBeTruthy();
      expect(receipt.headVersionId).toBeTruthy();
      expect(receipt.wordCount).toBe(20_000);
      expect(JSON.stringify(receipt).length).toBeLessThan(1000);
      const updated = await call("updateChapter", {
        chapterId: receipt.id,
        expectedHeadVersionId: receipt.headVersionId,
        content: content + "answered",
      });
      expect(updated.isError, JSON.stringify(updated)).not.toBe(true);
      expect(updated.structuredContent.result.headVersionId).not.toBe(
        receipt.headVersionId,
      );
      expect(updated.structuredContent.result.wordCount).toBe(20_001);
      expect(updated.structuredContent.result.truncated).toBeUndefined();
      expect(
        (await call("readChapter", { chapterId: receipt.id })).structuredContent
          .result.totalCharacters,
      ).toBe(content.length + 8);
    });
    it("rejects misspelled prose fields instead of silently creating an empty chapter", async () => {
      const result = await call("createChapter", {
        title: "Must not exist",
        body: "This prose must not be discarded.",
      });
      expect(result.isError).toBe(true);
      expect(
        await prisma.chapter.count({
          where: { projectId, title: "Must not exist" },
        }),
      ).toBe(0);
    });
    it("persists supplied prose at creation without requiring a separate edit", async () => {
      const content = "The station clock stopped before the train did.";
      const result = await call("createChapter", { title: "Arrival", content });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const chapter = await prisma.chapter.findFirstOrThrow({
        where: { projectId, title: "Arrival" },
      });
      expect(
        (await call("readChapter", { chapterId: chapter.id })).structuredContent
          .result.content,
      ).toBe(content);
    });
  },
);
