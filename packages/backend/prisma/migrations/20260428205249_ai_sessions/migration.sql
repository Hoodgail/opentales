-- DropIndex
DROP INDEX "ProjectAiAgentSession_projectId_key";

-- AlterTable
ALTER TABLE "ProjectAiAgentSession" ADD COLUMN     "title" TEXT;

-- CreateIndex
CREATE INDEX "ProjectAiAgentSession_projectId_updatedAt_idx" ON "ProjectAiAgentSession"("projectId", "updatedAt");
