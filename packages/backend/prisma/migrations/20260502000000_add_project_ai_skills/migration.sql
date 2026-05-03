-- CreateTable
CREATE TABLE "ProjectAiSkill" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAiSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAiSkill_projectId_name_key" ON "ProjectAiSkill"("projectId", "name");

-- CreateIndex
CREATE INDEX "ProjectAiSkill_projectId_enabled_idx" ON "ProjectAiSkill"("projectId", "enabled");

-- AddForeignKey
ALTER TABLE "ProjectAiSkill" ADD CONSTRAINT "ProjectAiSkill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
