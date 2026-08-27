-- CreateEnum
CREATE TYPE "NamedSnapshotScope" AS ENUM ('PROJECT', 'CHAPTER', 'SCENE', 'PROJECT_DOC', 'WRITING', 'BUILD_CHECKPOINT', 'BUILD_COMPILATION');

-- CreateEnum
CREATE TYPE "WritingAnnotationKind" AS ENUM ('COMMENT', 'NOTE', 'SUGGESTION');

-- CreateEnum
CREATE TYPE "WritingAnnotationStatus" AS ENUM ('OPEN', 'RESOLVED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "NamedSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "message" TEXT,
    "scope" "NamedSnapshotScope" NOT NULL,
    "chapterId" TEXT,
    "sceneId" TEXT,
    "projectDocId" TEXT,
    "writingId" TEXT,
    "buildRunId" TEXT,
    "checkpointId" TEXT,
    "compilationId" TEXT,
    "heads" JSONB NOT NULL,
    "structuredState" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NamedSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WritingAnnotationThread" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "writingId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "anchorVersionId" TEXT NOT NULL,
    "authorId" TEXT,
    "resolvedById" TEXT,
    "acceptedVersionId" TEXT,
    "chapterId" TEXT,
    "sceneId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "kind" "WritingAnnotationKind" NOT NULL,
    "status" "WritingAnnotationStatus" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "anchorHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "suggestedReplacement" TEXT,
    "decisionIdempotencyKey" TEXT,
    "decisionRequestHash" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritingAnnotationThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WritingAnnotationReply" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WritingAnnotationReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapshotOperationReceipt" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotOperationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NamedSnapshot_projectId_scope_createdAt_idx" ON "NamedSnapshot"("projectId", "scope", "createdAt");

-- CreateIndex
CREATE INDEX "NamedSnapshot_buildRunId_checkpointId_idx" ON "NamedSnapshot"("buildRunId", "checkpointId");

-- CreateIndex
CREATE INDEX "NamedSnapshot_chapterId_idx" ON "NamedSnapshot"("chapterId");

-- CreateIndex
CREATE INDEX "NamedSnapshot_sceneId_idx" ON "NamedSnapshot"("sceneId");

-- CreateIndex
CREATE INDEX "NamedSnapshot_writingId_idx" ON "NamedSnapshot"("writingId");

-- CreateIndex
CREATE UNIQUE INDEX "NamedSnapshot_projectId_idempotencyKey_key" ON "NamedSnapshot"("projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WritingAnnotationThread_projectId_status_updatedAt_idx" ON "WritingAnnotationThread"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "WritingAnnotationThread_writingId_status_startOffset_idx" ON "WritingAnnotationThread"("writingId", "status", "startOffset");

-- CreateIndex
CREATE INDEX "WritingAnnotationThread_chapterId_status_idx" ON "WritingAnnotationThread"("chapterId", "status");

-- CreateIndex
CREATE INDEX "WritingAnnotationThread_sceneId_status_idx" ON "WritingAnnotationThread"("sceneId", "status");

-- CreateIndex
CREATE INDEX "WritingAnnotationThread_branchId_anchorVersionId_idx" ON "WritingAnnotationThread"("branchId", "anchorVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "WritingAnnotationThread_projectId_idempotencyKey_key" ON "WritingAnnotationThread"("projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WritingAnnotationReply_threadId_createdAt_idx" ON "WritingAnnotationReply"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WritingAnnotationReply_threadId_idempotencyKey_key" ON "WritingAnnotationReply"("threadId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotOperationReceipt_snapshotId_idempotencyKey_key" ON "SnapshotOperationReceipt"("snapshotId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "NamedSnapshot" ADD CONSTRAINT "NamedSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NamedSnapshot" ADD CONSTRAINT "NamedSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingAnnotationThread" ADD CONSTRAINT "WritingAnnotationThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingAnnotationThread" ADD CONSTRAINT "WritingAnnotationThread_writingId_fkey" FOREIGN KEY ("writingId") REFERENCES "Writing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingAnnotationThread" ADD CONSTRAINT "WritingAnnotationThread_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WritingBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingAnnotationThread" ADD CONSTRAINT "WritingAnnotationThread_anchorVersionId_fkey" FOREIGN KEY ("anchorVersionId") REFERENCES "WritingVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingAnnotationThread" ADD CONSTRAINT "WritingAnnotationThread_acceptedVersionId_fkey" FOREIGN KEY ("acceptedVersionId") REFERENCES "WritingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingAnnotationThread" ADD CONSTRAINT "WritingAnnotationThread_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingAnnotationThread" ADD CONSTRAINT "WritingAnnotationThread_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingAnnotationReply" ADD CONSTRAINT "WritingAnnotationReply_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WritingAnnotationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingAnnotationReply" ADD CONSTRAINT "WritingAnnotationReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotOperationReceipt" ADD CONSTRAINT "SnapshotOperationReceipt_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "NamedSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WritingAnnotationThread" ADD CONSTRAINT "WritingAnnotationThread_anchor_range_check" CHECK ("startOffset" >= 0 AND "endOffset" >= "startOffset");
ALTER TABLE "WritingAnnotationThread" ADD CONSTRAINT "WritingAnnotationThread_suggestion_check" CHECK (kind <> 'SUGGESTION' OR "suggestedReplacement" IS NOT NULL);
ALTER TABLE "NamedSnapshot" ADD CONSTRAINT "NamedSnapshot_scope_target_check" CHECK (
  (scope='PROJECT' AND num_nonnulls("chapterId","sceneId","projectDocId","writingId","checkpointId","compilationId")=0)
  OR (scope='CHAPTER' AND "chapterId" IS NOT NULL)
  OR (scope='SCENE' AND "sceneId" IS NOT NULL)
  OR (scope='PROJECT_DOC' AND "projectDocId" IS NOT NULL)
  OR (scope='WRITING' AND "writingId" IS NOT NULL)
  OR (scope='BUILD_CHECKPOINT' AND "buildRunId" IS NOT NULL AND "checkpointId" IS NOT NULL)
  OR (scope='BUILD_COMPILATION' AND "buildRunId" IS NOT NULL AND "compilationId" IS NOT NULL)
);
