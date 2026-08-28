-- CreateEnum
CREATE TYPE "ProjectMcpApiKeyPermission" AS ENUM ('READ_ONLY', 'READ_WRITE');

-- CreateTable
CREATE TABLE "ProjectMcpApiKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permission" "ProjectMcpApiKeyPermission" NOT NULL DEFAULT 'READ_WRITE',
    "secretHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMcpApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMcpApiKey_secretHash_key" ON "ProjectMcpApiKey"("secretHash");

-- CreateIndex
CREATE INDEX "ProjectMcpApiKey_projectId_createdAt_idx" ON "ProjectMcpApiKey"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectMcpApiKey_createdById_idx" ON "ProjectMcpApiKey"("createdById");

-- CreateIndex
CREATE INDEX "ProjectMcpApiKey_projectId_revokedAt_expiresAt_idx" ON "ProjectMcpApiKey"("projectId", "revokedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "ProjectMcpApiKey" ADD CONSTRAINT "ProjectMcpApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMcpApiKey" ADD CONSTRAINT "ProjectMcpApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
