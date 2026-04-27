-- Add soft-delete columns to Project and Chapter so that destructive
-- actions can be reversed within a 30-day window before purge.
ALTER TABLE "Project" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Chapter" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Index for fast trash lookups scoped to a project.
CREATE INDEX "Chapter_projectId_deletedAt_idx" ON "Chapter"("projectId", "deletedAt");
