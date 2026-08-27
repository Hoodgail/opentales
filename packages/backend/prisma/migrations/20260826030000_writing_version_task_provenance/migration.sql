ALTER TABLE "WritingVersion" ADD COLUMN "sourceTaskId" TEXT;
CREATE INDEX "WritingVersion_sourceTaskId_idx" ON "WritingVersion"("sourceTaskId");
ALTER TABLE "WritingVersion" ADD CONSTRAINT "WritingVersion_sourceTaskId_fkey"
  FOREIGN KEY ("sourceTaskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
