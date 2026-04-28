-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('GATEWAY', 'OPENAI_COMPATIBLE');

-- CreateTable
CREATE TABLE "ProjectAiSettings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "providerKind" "AiProviderKind" NOT NULL DEFAULT 'GATEWAY',
    "model" TEXT NOT NULL DEFAULT 'openai/gpt-5.4',
    "baseUrl" TEXT,
    "apiKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAiSettings_projectId_key" ON "ProjectAiSettings"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectAiSettings" ADD CONSTRAINT "ProjectAiSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
