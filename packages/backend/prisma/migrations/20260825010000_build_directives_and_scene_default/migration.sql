-- Complete the populated-table Scene migration. The preceding migration uses a
-- temporary default so existing rows can satisfy NOT NULL; Prisma's @updatedAt
-- steady-state column intentionally has no database default.
ALTER TABLE "Scene" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Persist author re-plan directives and the checkpoint/artifact boundary they pin.
CREATE TABLE "BuildDirective" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "fromTaskId" TEXT NOT NULL,
    "checkpointId" TEXT,
    "createdById" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "directive" TEXT NOT NULL,
    "pinnedArtifactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildDirective_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuildDirective_buildRunId_idempotencyKey_key" ON "BuildDirective"("buildRunId", "idempotencyKey");
CREATE INDEX "BuildDirective_projectId_createdAt_idx" ON "BuildDirective"("projectId", "createdAt");
CREATE INDEX "BuildDirective_buildRunId_createdAt_idx" ON "BuildDirective"("buildRunId", "createdAt");
CREATE INDEX "BuildDirective_fromTaskId_idx" ON "BuildDirective"("fromTaskId");
CREATE INDEX "BuildDirective_checkpointId_idx" ON "BuildDirective"("checkpointId");

ALTER TABLE "BuildDirective" ADD CONSTRAINT "BuildDirective_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuildDirective" ADD CONSTRAINT "BuildDirective_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuildDirective" ADD CONSTRAINT "BuildDirective_fromTaskId_fkey" FOREIGN KEY ("fromTaskId") REFERENCES "BuildTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuildDirective" ADD CONSTRAINT "BuildDirective_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "BuildCheckpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BuildDirective" ADD CONSTRAINT "BuildDirective_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
