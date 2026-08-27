ALTER TABLE "Location" ADD COLUMN "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "Location_aliases_gin_idx" ON "Location" USING GIN ("aliases");

CREATE TABLE "RenameRefactorReceipt" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RenameRefactorReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RenameRefactorReceipt_projectId_idempotencyKey_key" ON "RenameRefactorReceipt"("projectId", "idempotencyKey");
CREATE INDEX "RenameRefactorReceipt_projectId_targetType_targetId_idx" ON "RenameRefactorReceipt"("projectId", "targetType", "targetId");
ALTER TABLE "RenameRefactorReceipt" ADD CONSTRAINT "RenameRefactorReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
