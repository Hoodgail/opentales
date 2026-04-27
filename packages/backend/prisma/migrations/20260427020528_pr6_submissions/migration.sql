-- CreateEnum
CREATE TYPE "SubmissionKind" AS ENUM ('CHAPTER_EDIT', 'NEW_CHAPTER');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('OPEN', 'MERGED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('SUBMISSION_OPENED', 'SUBMISSION_MERGED', 'SUBMISSION_DECLINED', 'COMMENT_ADDED', 'AI_REVIEW_POSTED');

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "SubmissionKind" NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "message" TEXT,
    "chapterId" TEXT,
    "branchId" TEXT NOT NULL,
    "baseVersionId" TEXT,
    "proposedTitle" TEXT,
    "proposedNumber" INTEGER,
    "proposedActId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "content" JSONB,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Submission_branchId_key" ON "Submission"("branchId");

-- CreateIndex
CREATE INDEX "Submission_projectId_status_idx" ON "Submission"("projectId", "status");

-- CreateIndex
CREATE INDEX "Submission_authorId_idx" ON "Submission"("authorId");

-- CreateIndex
CREATE INDEX "Activity_submissionId_createdAt_idx" ON "Activity"("submissionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "WritingBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "WritingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
