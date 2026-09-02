ALTER TYPE "ActivityType" ADD VALUE 'SUBMISSION_UPDATED';

CREATE TABLE "StoryPatchReceipt" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryPatchReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoryPatchReceipt_projectId_idempotencyKey_key"
ON "StoryPatchReceipt"("projectId", "idempotencyKey");

CREATE INDEX "StoryPatchReceipt_projectId_createdAt_idx"
ON "StoryPatchReceipt"("projectId", "createdAt");

ALTER TABLE "StoryPatchReceipt"
ADD CONSTRAINT "StoryPatchReceipt_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
