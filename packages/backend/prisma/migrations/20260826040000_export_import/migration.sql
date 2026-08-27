CREATE TYPE "ProjectExportFormat" AS ENUM ('DOCX', 'PDF', 'EPUB', 'MARKDOWN', 'TEXT', 'HTML', 'PROJECT_ARCHIVE');
CREATE TYPE "ProjectExportPreset" AS ENUM ('STANDARD_MANUSCRIPT', 'READING_COPY', 'EBOOK', 'WEB', 'ARCHIVE');
CREATE TYPE "ProjectExportTarget" AS ENUM ('MAIN', 'BUILD');
CREATE TYPE "ProjectExportStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED', 'DELETED');
CREATE TYPE "ProjectImportFormat" AS ENUM ('DOCX', 'MARKDOWN', 'TEXT', 'HTML', 'PROJECT_ARCHIVE');
CREATE TYPE "ProjectImportStatus" AS ENUM ('PREVIEWED', 'APPLYING', 'APPLIED', 'FAILED');

ALTER TABLE "Asset" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ProjectExport" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "buildRunId" TEXT,
  "compilationId" TEXT,
  "assetId" TEXT,
  "requestedById" TEXT,
  "regeneratedFromId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "target" "ProjectExportTarget" NOT NULL,
  "format" "ProjectExportFormat" NOT NULL,
  "preset" "ProjectExportPreset" NOT NULL,
  "status" "ProjectExportStatus" NOT NULL DEFAULT 'PENDING',
  "filename" TEXT NOT NULL,
  "mimeType" TEXT,
  "checksum" TEXT,
  "sizeBytes" BIGINT,
  "options" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  "branchHeads" JSONB NOT NULL,
  "error" TEXT,
  "generatedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectExport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectImport" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "assetId" TEXT,
  "createdById" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "applyIdempotencyKey" TEXT,
  "requestHash" TEXT NOT NULL,
  "format" "ProjectImportFormat" NOT NULL,
  "status" "ProjectImportStatus" NOT NULL DEFAULT 'PREVIEWED',
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "preview" JSONB NOT NULL,
  "conflicts" JSONB NOT NULL,
  "sourceMetadata" JSONB NOT NULL,
  "applyResult" JSONB,
  "error" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectExport_assetId_key" ON "ProjectExport"("assetId");
CREATE UNIQUE INDEX "ProjectExport_projectId_idempotencyKey_key" ON "ProjectExport"("projectId", "idempotencyKey");
CREATE INDEX "ProjectExport_projectId_status_createdAt_idx" ON "ProjectExport"("projectId", "status", "createdAt");
CREATE INDEX "ProjectExport_buildRunId_compilationId_idx" ON "ProjectExport"("buildRunId", "compilationId");
CREATE INDEX "ProjectExport_requestedById_idx" ON "ProjectExport"("requestedById");
CREATE INDEX "ProjectExport_regeneratedFromId_idx" ON "ProjectExport"("regeneratedFromId");

CREATE UNIQUE INDEX "ProjectImport_assetId_key" ON "ProjectImport"("assetId");
CREATE UNIQUE INDEX "ProjectImport_projectId_idempotencyKey_key" ON "ProjectImport"("projectId", "idempotencyKey");
CREATE INDEX "ProjectImport_projectId_status_createdAt_idx" ON "ProjectImport"("projectId", "status", "createdAt");
CREATE INDEX "ProjectImport_createdById_idx" ON "ProjectImport"("createdById");
CREATE INDEX "ProjectImport_expiresAt_idx" ON "ProjectImport"("expiresAt");

ALTER TABLE "ProjectExport" ADD CONSTRAINT "ProjectExport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectExport" ADD CONSTRAINT "ProjectExport_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectExport" ADD CONSTRAINT "ProjectExport_compilationId_fkey" FOREIGN KEY ("compilationId") REFERENCES "BuildCompilation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectExport" ADD CONSTRAINT "ProjectExport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectExport" ADD CONSTRAINT "ProjectExport_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectExport" ADD CONSTRAINT "ProjectExport_regeneratedFromId_fkey" FOREIGN KEY ("regeneratedFromId") REFERENCES "ProjectExport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectImport" ADD CONSTRAINT "ProjectImport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectImport" ADD CONSTRAINT "ProjectImport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectImport" ADD CONSTRAINT "ProjectImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
