-- CreateEnum
CREATE TYPE "BuildManuscriptUnitKind" AS ENUM ('CHAPTER', 'SCENE');

-- CreateEnum
CREATE TYPE "BuildManuscriptUnitStatus" AS ENUM ('PLANNED', 'DRAFTING', 'REVIEW', 'ACCEPTED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "StoryArtifactBindingKind" AS ENUM ('BUILD_UNIT', 'ENTITY', 'LEDGER');

-- CreateEnum
CREATE TYPE "BuildReviewStatus" AS ENUM ('OPEN', 'APPROVED', 'MERGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BuildReviewUnitAction" AS ENUM ('CREATE', 'UPDATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StoryArtifactType" ADD VALUE 'FINALE_PLAN';
ALTER TYPE "StoryArtifactType" ADD VALUE 'EXPORT_MANIFEST';

-- DropIndex
DROP INDEX "CanonFact_buildRunId_key_key";

-- DropIndex
DROP INDEX "EntityState_buildRunId_key_key";

-- DropIndex
DROP INDEX "TimelineEvent_buildRunId_key_key";

-- DropIndex
DROP INDEX "OpenLoop_buildRunId_key_key";

-- DropIndex
DROP INDEX "SetupPayoffLink_buildRunId_key_key";

-- DropIndex
DROP INDEX "PlotThread_buildRunId_key_key";

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tension" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "BuildRun" ADD COLUMN     "costMicrosReserved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "executionGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requestHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tokensReserved" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BuildTask" ADD COLUMN     "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "leaseToken" TEXT,
ADD COLUMN     "reservedCostMicros" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reservedTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "runGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scopeUnitIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Character" ALTER COLUMN "aliases" SET NOT NULL;
ALTER TABLE "BuildTask" ALTER COLUMN "scopeUnitIds" SET NOT NULL;

-- AlterTable
ALTER TABLE "BuildTaskTransition" ADD COLUMN     "requestHash" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CanonFact" ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceTaskId" TEXT,
ADD COLUMN     "sourceUnitId" TEXT,
ADD COLUMN     "supersedesFactId" TEXT,
ADD COLUMN     "validFromOrder" INTEGER,
ADD COLUMN     "validToOrder" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "EntityState" ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceTaskId" TEXT,
ADD COLUMN     "sourceUnitId" TEXT,
ADD COLUMN     "supersedesStateId" TEXT,
ADD COLUMN     "validFromOrder" INTEGER,
ADD COLUMN     "validToOrder" INTEGER,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "TimelineEvent" ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceTaskId" TEXT,
ADD COLUMN     "sourceUnitId" TEXT,
ADD COLUMN     "supersedesEventId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "OpenLoop" ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceTaskId" TEXT,
ADD COLUMN     "sourceUnitId" TEXT,
ADD COLUMN     "supersedesLoopId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SetupPayoffLink" ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceTaskId" TEXT,
ADD COLUMN     "sourceUnitId" TEXT,
ADD COLUMN     "supersedesLinkId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PlotThread" ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceTaskId" TEXT,
ADD COLUMN     "sourceUnitId" TEXT,
ADD COLUMN     "supersedesThreadId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "BuildCheckpoint" ADD COLUMN     "requestHash" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "BuildTrace" ADD COLUMN     "finishRequestHash" TEXT,
ADD COLUMN     "requestHash" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "BuildEvaluationResult" ADD COLUMN     "requestHash" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "BuildManuscriptUnit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "planArtifactId" TEXT,
    "parentUnitId" TEXT,
    "sourceChapterId" TEXT,
    "sourceSceneId" TEXT,
    "writingId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "kind" "BuildManuscriptUnitKind" NOT NULL,
    "status" "BuildManuscriptUnitStatus" NOT NULL DEFAULT 'PLANNED',
    "key" TEXT NOT NULL,
    "containerKey" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "chapterNumber" INTEGER,
    "title" TEXT NOT NULL,
    "povCharacterId" TEXT,
    "locationId" TEXT,
    "storyDate" TEXT,
    "storyTime" TEXT,
    "tension" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildManuscriptUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryArtifactBinding" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "taskId" TEXT,
    "unitId" TEXT,
    "bindingKind" "StoryArtifactBindingKind" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryArtifactBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildCompilation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "checkpointId" TEXT,
    "exportManifestArtifactId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "totalWordCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildCompilation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildCompilationUnit" (
    "id" TEXT NOT NULL,
    "compilationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "writingVersionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "BuildCompilationUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "compilationId" TEXT NOT NULL,
    "checkpointId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "mergedById" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" "BuildReviewStatus" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "mergedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildReviewUnit" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "action" "BuildReviewUnitAction" NOT NULL,
    "targetChapterId" TEXT,
    "targetSceneId" TEXT,
    "expectedMainHeadVersionId" TEXT,
    "sourceBuildVersionId" TEXT NOT NULL,
    "resultMainVersionId" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "BuildReviewUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuildManuscriptUnit_writingId_key" ON "BuildManuscriptUnit"("writingId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildManuscriptUnit_branchId_key" ON "BuildManuscriptUnit"("branchId");

-- CreateIndex
CREATE INDEX "BuildManuscriptUnit_projectId_kind_order_idx" ON "BuildManuscriptUnit"("projectId", "kind", "order");

-- CreateIndex
CREATE INDEX "BuildManuscriptUnit_buildRunId_parentUnitId_order_idx" ON "BuildManuscriptUnit"("buildRunId", "parentUnitId", "order");

-- CreateIndex
CREATE INDEX "BuildManuscriptUnit_sourceTaskId_idx" ON "BuildManuscriptUnit"("sourceTaskId");

-- CreateIndex
CREATE INDEX "BuildManuscriptUnit_planArtifactId_idx" ON "BuildManuscriptUnit"("planArtifactId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildManuscriptUnit_buildRunId_kind_key_key" ON "BuildManuscriptUnit"("buildRunId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BuildManuscriptUnit_buildRunId_kind_containerKey_order_key" ON "BuildManuscriptUnit"("buildRunId", "kind", "containerKey", "order");

-- CreateIndex
CREATE INDEX "StoryArtifactBinding_projectId_entityType_entityId_idx" ON "StoryArtifactBinding"("projectId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "StoryArtifactBinding_buildRunId_bindingKind_idx" ON "StoryArtifactBinding"("buildRunId", "bindingKind");

-- CreateIndex
CREATE INDEX "StoryArtifactBinding_unitId_idx" ON "StoryArtifactBinding"("unitId");

-- CreateIndex
CREATE INDEX "StoryArtifactBinding_taskId_idx" ON "StoryArtifactBinding"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryArtifactBinding_artifactId_bindingKind_role_unitId_ent_key" ON "StoryArtifactBinding"("artifactId", "bindingKind", "role", "unitId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "BuildCompilation_projectId_createdAt_idx" ON "BuildCompilation"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BuildCompilation_buildRunId_createdAt_idx" ON "BuildCompilation"("buildRunId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuildCompilation_buildRunId_idempotencyKey_key" ON "BuildCompilation"("buildRunId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BuildCompilationUnit_unitId_idx" ON "BuildCompilationUnit"("unitId");

-- CreateIndex
CREATE INDEX "BuildCompilationUnit_writingVersionId_idx" ON "BuildCompilationUnit"("writingVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildCompilationUnit_compilationId_unitId_key" ON "BuildCompilationUnit"("compilationId", "unitId");

-- CreateIndex
CREATE INDEX "BuildReview_projectId_status_createdAt_idx" ON "BuildReview"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BuildReview_buildRunId_status_idx" ON "BuildReview"("buildRunId", "status");

-- CreateIndex
CREATE INDEX "BuildReviewUnit_targetChapterId_idx" ON "BuildReviewUnit"("targetChapterId");

-- CreateIndex
CREATE INDEX "BuildReviewUnit_targetSceneId_idx" ON "BuildReviewUnit"("targetSceneId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildReviewUnit_reviewId_unitId_key" ON "BuildReviewUnit"("reviewId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_id_revision_key" ON "Scene"("id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "CanonFact_buildRunId_key_version_key" ON "CanonFact"("buildRunId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EntityState_buildRunId_key_version_key" ON "EntityState"("buildRunId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineEvent_buildRunId_key_version_key" ON "TimelineEvent"("buildRunId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OpenLoop_buildRunId_key_version_key" ON "OpenLoop"("buildRunId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SetupPayoffLink_buildRunId_key_version_key" ON "SetupPayoffLink"("buildRunId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PlotThread_buildRunId_key_version_key" ON "PlotThread"("buildRunId", "key", "version");

-- AddForeignKey
ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_sourceUnitId_fkey" FOREIGN KEY ("sourceUnitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_supersedesFactId_fkey" FOREIGN KEY ("supersedesFactId") REFERENCES "CanonFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityState" ADD CONSTRAINT "EntityState_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityState" ADD CONSTRAINT "EntityState_sourceUnitId_fkey" FOREIGN KEY ("sourceUnitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityState" ADD CONSTRAINT "EntityState_supersedesStateId_fkey" FOREIGN KEY ("supersedesStateId") REFERENCES "EntityState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_sourceUnitId_fkey" FOREIGN KEY ("sourceUnitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_supersedesEventId_fkey" FOREIGN KEY ("supersedesEventId") REFERENCES "TimelineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLoop" ADD CONSTRAINT "OpenLoop_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLoop" ADD CONSTRAINT "OpenLoop_sourceUnitId_fkey" FOREIGN KEY ("sourceUnitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLoop" ADD CONSTRAINT "OpenLoop_supersedesLoopId_fkey" FOREIGN KEY ("supersedesLoopId") REFERENCES "OpenLoop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupPayoffLink" ADD CONSTRAINT "SetupPayoffLink_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupPayoffLink" ADD CONSTRAINT "SetupPayoffLink_sourceUnitId_fkey" FOREIGN KEY ("sourceUnitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupPayoffLink" ADD CONSTRAINT "SetupPayoffLink_supersedesLinkId_fkey" FOREIGN KEY ("supersedesLinkId") REFERENCES "SetupPayoffLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotThread" ADD CONSTRAINT "PlotThread_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotThread" ADD CONSTRAINT "PlotThread_sourceUnitId_fkey" FOREIGN KEY ("sourceUnitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotThread" ADD CONSTRAINT "PlotThread_supersedesThreadId_fkey" FOREIGN KEY ("supersedesThreadId") REFERENCES "PlotThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_planArtifactId_fkey" FOREIGN KEY ("planArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_parentUnitId_fkey" FOREIGN KEY ("parentUnitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_sourceChapterId_fkey" FOREIGN KEY ("sourceChapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_sourceSceneId_fkey" FOREIGN KEY ("sourceSceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_writingId_fkey" FOREIGN KEY ("writingId") REFERENCES "Writing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WritingBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_povCharacterId_fkey" FOREIGN KEY ("povCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifactBinding" ADD CONSTRAINT "StoryArtifactBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifactBinding" ADD CONSTRAINT "StoryArtifactBinding_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifactBinding" ADD CONSTRAINT "StoryArtifactBinding_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "StoryArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifactBinding" ADD CONSTRAINT "StoryArtifactBinding_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifactBinding" ADD CONSTRAINT "StoryArtifactBinding_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCompilation" ADD CONSTRAINT "BuildCompilation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCompilation" ADD CONSTRAINT "BuildCompilation_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCompilation" ADD CONSTRAINT "BuildCompilation_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "BuildCheckpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCompilation" ADD CONSTRAINT "BuildCompilation_exportManifestArtifactId_fkey" FOREIGN KEY ("exportManifestArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCompilationUnit" ADD CONSTRAINT "BuildCompilationUnit_compilationId_fkey" FOREIGN KEY ("compilationId") REFERENCES "BuildCompilation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCompilationUnit" ADD CONSTRAINT "BuildCompilationUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCompilationUnit" ADD CONSTRAINT "BuildCompilationUnit_writingVersionId_fkey" FOREIGN KEY ("writingVersionId") REFERENCES "WritingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReview" ADD CONSTRAINT "BuildReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReview" ADD CONSTRAINT "BuildReview_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReview" ADD CONSTRAINT "BuildReview_compilationId_fkey" FOREIGN KEY ("compilationId") REFERENCES "BuildCompilation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReview" ADD CONSTRAINT "BuildReview_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "BuildCheckpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReview" ADD CONSTRAINT "BuildReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReview" ADD CONSTRAINT "BuildReview_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReview" ADD CONSTRAINT "BuildReview_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReviewUnit" ADD CONSTRAINT "BuildReviewUnit_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "BuildReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReviewUnit" ADD CONSTRAINT "BuildReviewUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BuildManuscriptUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReviewUnit" ADD CONSTRAINT "BuildReviewUnit_targetChapterId_fkey" FOREIGN KEY ("targetChapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReviewUnit" ADD CONSTRAINT "BuildReviewUnit_targetSceneId_fkey" FOREIGN KEY ("targetSceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReviewUnit" ADD CONSTRAINT "BuildReviewUnit_expectedMainHeadVersionId_fkey" FOREIGN KEY ("expectedMainHeadVersionId") REFERENCES "WritingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReviewUnit" ADD CONSTRAINT "BuildReviewUnit_sourceBuildVersionId_fkey" FOREIGN KEY ("sourceBuildVersionId") REFERENCES "WritingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildReviewUnit" ADD CONSTRAINT "BuildReviewUnit_resultMainVersionId_fkey" FOREIGN KEY ("resultMainVersionId") REFERENCES "WritingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Durable workflow and structured-history invariants that Prisma cannot express.
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_tension_range_check"
  CHECK ("tension" IS NULL OR ("tension" >= 0 AND "tension" <= 1));
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_tension_range_check"
  CHECK ("tension" IS NULL OR ("tension" >= 0 AND "tension" <= 1));
ALTER TABLE "BuildManuscriptUnit" ADD CONSTRAINT "BuildManuscriptUnit_shape_check"
  CHECK ((kind = 'CHAPTER' AND "parentUnitId" IS NULL AND "chapterNumber" IS NOT NULL)
      OR (kind = 'SCENE' AND "parentUnitId" IS NOT NULL));
ALTER TABLE "BuildRun" ADD CONSTRAINT "BuildRun_reservations_nonnegative_check"
  CHECK ("tokensReserved" >= 0 AND "costMicrosReserved" >= 0);
ALTER TABLE "BuildTask" ADD CONSTRAINT "BuildTask_reservations_nonnegative_check"
  CHECK ("reservedTokens" >= 0 AND "reservedCostMicros" >= 0 AND "leaseGeneration" >= 0 AND "runGeneration" >= 0);
ALTER TABLE "StoryArtifactBinding" ADD CONSTRAINT "StoryArtifactBinding_target_check"
  CHECK (("bindingKind" = 'BUILD_UNIT' AND "unitId" IS NOT NULL)
      OR ("bindingKind" IN ('ENTITY', 'LEDGER') AND "entityType" IS NOT NULL AND "entityId" IS NOT NULL));
ALTER TABLE "BuildReviewUnit" ADD CONSTRAINT "BuildReviewUnit_target_check"
  CHECK ((action = 'CREATE' AND "targetChapterId" IS NULL AND "targetSceneId" IS NULL)
      OR (action = 'UPDATE' AND num_nonnulls("targetChapterId", "targetSceneId") = 1));

-- At most one live value exists per typed ledger key; prior versions remain queryable.
CREATE UNIQUE INDEX "CanonFact_current_key_idx" ON "CanonFact" ("buildRunId", "key") WHERE "isCurrent" = true;
CREATE UNIQUE INDEX "EntityState_current_key_idx" ON "EntityState" ("buildRunId", "key") WHERE "isCurrent" = true;
CREATE UNIQUE INDEX "TimelineEvent_current_key_idx" ON "TimelineEvent" ("buildRunId", "key") WHERE "isCurrent" = true;
CREATE UNIQUE INDEX "OpenLoop_current_key_idx" ON "OpenLoop" ("buildRunId", "key") WHERE "isCurrent" = true;
CREATE UNIQUE INDEX "SetupPayoffLink_current_key_idx" ON "SetupPayoffLink" ("buildRunId", "key") WHERE "isCurrent" = true;
CREATE UNIQUE INDEX "PlotThread_current_key_idx" ON "PlotThread" ("buildRunId", "key") WHERE "isCurrent" = true;

-- Project-wide search indexes, including sandbox prose metadata and character aliases.
-- PostgreSQL's array_to_string is STABLE, not IMMUTABLE, so aliases use the native
-- array GIN operator class while the existing immutable character FTS index remains.
CREATE INDEX "Character_aliases_gin_idx" ON "Character" USING GIN ("aliases");
CREATE INDEX "BuildManuscriptUnit_content_fts_idx" ON "BuildManuscriptUnit" USING GIN
  (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("key", '') || ' ' || "metadata"::text));
