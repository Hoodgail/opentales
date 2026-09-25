import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.EXPORT_IMPORT_TEST_DATABASE_URL;
const integration = describe.runIf(Boolean(databaseUrl));
const assetRoot = await mkdtemp(
  path.join(os.tmpdir(), "opentales-export-import-"),
);
process.env.ASSETS_DIR = assetRoot;
process.env.DATABASE_URL ??=
  databaseUrl ??
  "postgresql://opentales:opentales@127.0.0.1:55432/opentales_test";
process.env.JWT_SECRET ??= "export-import-integration-secret";

const [
  { ProjectExportUseCase },
  { ProjectImportUseCase },
  { CreateChapterUseCase },
  { StreamAssetUseCase },
  { stableHash, ARTIFACT_TYPES },
] = await Promise.all([
  import("./ProjectExportUseCase.js"),
  import("./ProjectImportUseCase.js"),
  import("../projects/CreateChapterUseCase.js"),
  import("../assets/StreamAssetUseCase.js"),
  import("../storyState/schemas.js"),
]);

integration("export/import PostgreSQL integration", () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const suffix = randomUUID().slice(0, 8);
  let userId = "";
  let outsiderId = "";
  let orgId = "";
  let projectId = "";

  beforeAll(async () => {
    const users = await Promise.all([
      prisma.user.create({
        data: {
          username: `export-${suffix}`,
          email: `export-${suffix}@test.local`,
          passwordHash: "x",
        },
      }),
      prisma.user.create({
        data: {
          username: `outside-${suffix}`,
          email: `outside-${suffix}@test.local`,
          passwordHash: "x",
        },
      }),
    ]);
    userId = users[0].id;
    outsiderId = users[1].id;
    const org = await prisma.org.create({
      data: {
        slug: `export-${suffix}`,
        name: "Vale",
        memberships: { create: { userId, role: "OWNER" } },
      },
    });
    orgId = org.id;
    const project = await prisma.project.create({
      data: {
        orgId,
        slug: "novel",
        title: "The Memory Map",
        description: "A test novel.",
        genre: "Fantasy",
      },
    });
    projectId = project.id;
    await new CreateChapterUseCase(prisma).execute(userId, projectId, {
      title: "The Door",
      content: "Mara drew the vanished street. The map took her oldest memory.",
    });
  });

  afterAll(async () => {
    await prisma.org.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, outsiderId] } },
    });
    await prisma.$disconnect();
    await rm(assetRoot, { recursive: true, force: true });
  });

  it("generates all formats as private checksummed assets and supports secure list/download/delete", async () => {
    const exports = new ProjectExportUseCase(prisma);
    const formats = [
      "docx",
      "pdf",
      "epub",
      "markdown",
      "text",
      "html",
      "project-archive",
    ] as const;
    const results = [];
    for (const format of formats) {
      results.push(
        await exports.create(userId, projectId, {
          idempotencyKey: `main:${format}`,
          format,
          preset:
            format === "project-archive"
              ? "archive"
              : format === "docx" || format === "pdf"
                ? "standard-manuscript"
                : "reading-copy",
          target: { kind: "main" },
          options: { includeAssets: false, includeTitlePage: true },
        }),
      );
    }
    expect(
      results.every(
        (item) =>
          item.status === "ready" &&
          item.checksum?.length === 64 &&
          (item.sizeBytes ?? 0) > 0,
      ),
    ).toBe(true);
    const assets = await prisma.asset.findMany({
      where: { id: { in: results.map((item) => item.assetId!) } },
    });
    expect(
      assets.every(
        (asset) => asset.isPublic === false && asset.checksum?.length === 64,
      ),
    ).toBe(true);
    await expect(
      new StreamAssetUseCase(prisma).execute(results[0].assetId!, {} as never),
    ).rejects.toMatchObject({ status: 404 });
    const download = await exports.download(userId, projectId, results[0].id);
    const chunks: Buffer[] = [];
    for await (const chunk of download.stream)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    expect(Buffer.concat(chunks).length).toBe(results[0].sizeBytes);
    await expect(exports.list(outsiderId, projectId)).rejects.toMatchObject({
      status: 404,
    });
    const deleted = await exports.delete(userId, projectId, results[5].id);
    expect(deleted.status).toBe("deleted");
    expect(
      await prisma.asset.findUnique({ where: { id: results[5].assetId! } }),
    ).toBeNull();
  }, 30_000);

  it("previews imports, blocks unconfirmed overwrite, applies versioned changes, and imports manuscript archives", async () => {
    const imports = new ProjectImportUseCase(prisma);
    const target = await prisma.project.create({
      data: { orgId, slug: "import-target", title: "Import Target" },
    });
    const preview = await imports.preview(userId, target.id, {
      idempotencyKey: "markdown:preview",
      filename: "draft.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Chapter 1: Arrival\n\nFirst imported body."),
    });
    expect(preview.chapters).toHaveLength(1);
    expect(
      await prisma.chapter.count({ where: { projectId: target.id } }),
    ).toBe(0);
    const applied = await imports.apply(userId, target.id, preview.id, {
      idempotencyKey: "markdown:apply",
      confirmConflicts: false,
    });
    expect(applied.status).toBe("applied");
    const chapter = await prisma.chapter.findFirstOrThrow({
      where: { projectId: target.id, title: "Arrival" },
      include: {
        bodyWriting: {
          include: { defaultBranch: { include: { headVersion: true } } },
        },
      },
    });
    const firstVersion = chapter.bodyWriting.defaultBranch!.headVersionId;
    const conflict = await imports.preview(userId, target.id, {
      idempotencyKey: "markdown:conflict",
      filename: "draft.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Chapter 1: Arrival\n\nConfirmed replacement body.",
      ),
    });
    expect(conflict.conflicts.length).toBeGreaterThan(0);
    await expect(
      imports.apply(userId, target.id, conflict.id, {
        idempotencyKey: "conflict:no",
        confirmConflicts: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const confirmed = await imports.apply(userId, target.id, conflict.id, {
      idempotencyKey: "conflict:yes",
      confirmConflicts: true,
    });
    expect(confirmed.status).toBe("applied");
    const replaced = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapter.id },
      include: {
        bodyWriting: {
          include: { defaultBranch: { include: { headVersion: true } } },
        },
      },
    });
    expect(replaced.bodyWriting.defaultBranch!.headVersion?.body).toBe(
      "Confirmed replacement body.",
    );
    expect(replaced.bodyWriting.defaultBranch!.headVersionId).not.toBe(
      firstVersion,
    );

    const sourceArchive = await prisma.projectExport.findFirstOrThrow({
      where: {
        projectId,
        buildRunId: null,
        format: "PROJECT_ARCHIVE",
        status: "READY",
      },
      include: { asset: true },
    });
    const archiveBytes = await readFile(
      path.join(assetRoot, sourceArchive.asset!.s3Key),
    );
    const archiveTarget = await prisma.project.create({
      data: { orgId, slug: "archive-target", title: "Archive Target" },
    });
    const archivePreview = await imports.preview(userId, archiveTarget.id, {
      idempotencyKey: "archive:preview",
      filename: "project.opentales.zip",
      mimeType: sourceArchive.mimeType!,
      buffer: archiveBytes,
    });
    const archiveApplied = await imports.apply(
      userId,
      archiveTarget.id,
      archivePreview.id,
      {
        idempotencyKey: "archive:apply",
        confirmConflicts: false,
        restoreStructuredState: false,
      },
    );
    expect(archiveApplied.status).toBe("applied");
    expect(
      await prisma.chapter.count({ where: { projectId: archiveTarget.id } }),
    ).toBeGreaterThan(0);
  }, 30_000);
});
