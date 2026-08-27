-- CreateEnum
CREATE TYPE "SceneStatus" AS ENUM ('PLANNED', 'DRAFT', 'IN_PROGRESS', 'REVIEW', 'REVISED', 'FINAL');

-- CreateEnum
CREATE TYPE "BuildAutonomyMode" AS ENUM ('ASSIST', 'PLAN_REVIEW', 'AUTONOMOUS_DRAFT');

-- CreateEnum
CREATE TYPE "BuildRunStatus" AS ENUM ('PLANNING', 'DRAFTING', 'REVISING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BuildTaskStatus" AS ENUM ('BLOCKED', 'READY', 'RUNNING', 'REVIEW', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StoryArtifactType" AS ENUM ('STORY_BRIEF', 'NARRATIVE_CONTRACT', 'CHARACTER_BIBLE', 'RELATIONSHIP_GRAPH', 'WORLD_BIBLE', 'PLOT_THREAD', 'ACT_ARCHITECTURE', 'CHAPTER_BRIEF', 'SCENE_PLAN', 'TIMELINE', 'SETUP_PAYOFF_MAP', 'RESEARCH_QUESTIONS', 'OPEN_QUESTIONS', 'BEAT', 'CHAPTER_DRAFT', 'REVISION_ISSUE');

-- CreateEnum
CREATE TYPE "StoryArtifactStatus" AS ENUM ('DRAFT', 'VALIDATED', 'ACCEPTED', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "CanonFactStatus" AS ENUM ('PROPOSED', 'CANONICAL', 'DISPUTED', 'RETRACTED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "EntityStateStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "OpenLoopKind" AS ENUM ('PROMISE', 'QUESTION', 'CLUE', 'SETUP', 'MYSTERY', 'FORESHADOWING', 'OTHER');

-- CreateEnum
CREATE TYPE "OpenLoopStatus" AS ENUM ('OPEN', 'REINFORCED', 'RESOLVED', 'ABANDONED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "SetupPayoffStatus" AS ENUM ('PLANNED', 'SETUP', 'REINFORCED', 'PAID_OFF', 'ABANDONED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "PlotThreadKind" AS ENUM ('MAIN', 'SUBPLOT', 'CHARACTER_ARC', 'MYSTERY', 'ROMANCE', 'THEMATIC', 'OTHER');

-- CreateEnum
CREATE TYPE "PlotThreadStatus" AS ENUM ('PLANNED', 'ACTIVE', 'RESOLVED', 'ABANDONED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "BuildTraceStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BuildEvaluationKind" AS ENUM ('DETERMINISTIC', 'MODEL', 'HUMAN');

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "actualWordCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiNotes" TEXT,
ADD COLUMN     "characterPresentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "characterReferencedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "conflict" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "emotionalValueShift" TEXT,
ADD COLUMN     "entryState" JSONB,
ADD COLUMN     "estimatedWordCount" INTEGER,
ADD COLUMN     "exitState" JSONB,
ADD COLUMN     "goal" TEXT,
ADD COLUMN     "injuryStateChanges" JSONB,
ADD COLUMN     "knowledgeDeltas" JSONB,
ADD COLUMN     "objectTransfers" JSONB,
ADD COLUMN     "obstacle" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "plotThreadIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revelation" TEXT,
ADD COLUMN     "sceneFunction" TEXT,
ADD COLUMN     "setupPayoffIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stakes" TEXT,
ADD COLUMN     "status" "SceneStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "storyDate" TEXT,
ADD COLUMN     "storyTime" TEXT,
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "turn" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "worldRuleRefs" JSONB,
ADD COLUMN     "writerNotes" TEXT;

-- Backfill derived scene word counts for existing projects.
UPDATE "Scene" s
SET "actualWordCount" = COALESCE(v."wordCount", 0)
FROM "Writing" w
LEFT JOIN "WritingBranch" b ON b.id = w."defaultBranchId"
LEFT JOIN "WritingVersion" v ON v.id = b."headVersionId"
WHERE w.id = s."bodyWritingId";

-- AlterTable
ALTER TABLE "WritingBranch" ADD COLUMN     "buildRunId" TEXT;

-- CreateTable
CREATE TABLE "BuildRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,
    "authorizedById" TEXT,
    "objective" TEXT NOT NULL,
    "brainstorm" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "autonomyMode" "BuildAutonomyMode" NOT NULL DEFAULT 'ASSIST',
    "status" "BuildRunStatus" NOT NULL DEFAULT 'PLANNING',
    "currentPhase" TEXT NOT NULL DEFAULT 'planning',
    "workflowVersion" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "authorizationScope" JSONB NOT NULL,
    "maxTokens" INTEGER,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "maxCostMicros" INTEGER,
    "costMicrosUsed" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildTask" (
    "id" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "status" "BuildTaskStatus" NOT NULL DEFAULT 'BLOCKED',
    "dependencyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inputArtifactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputArtifactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedAgent" TEXT NOT NULL,
    "skillVersions" JSONB NOT NULL,
    "acceptanceCriteria" JSONB NOT NULL,
    "executionPolicy" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "revisionIteration" INTEGER NOT NULL DEFAULT 0,
    "maxRevisionIterations" INTEGER NOT NULL DEFAULT 1,
    "qualityThreshold" DOUBLE PRECISION,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildTaskTransition" (
    "id" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "BuildTaskStatus" NOT NULL,
    "toStatus" "BuildTaskStatus" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildTaskTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryArtifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "taskId" TEXT,
    "type" "StoryArtifactType" NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "schemaVersion" TEXT NOT NULL,
    "status" "StoryArtifactStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "replacesArtifactId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryArtifactLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "fromArtifactId" TEXT NOT NULL,
    "toArtifactId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryArtifactLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonFact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "sourceArtifactId" TEXT,
    "key" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "object" JSONB NOT NULL,
    "status" "CanonFactStatus" NOT NULL DEFAULT 'PROPOSED',
    "validFromSceneId" TEXT,
    "validToSceneId" TEXT,
    "sourceChapterId" TEXT,
    "sourceSceneId" TEXT,
    "sourceSpan" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "sourceArtifactId" TEXT,
    "sourceFactId" TEXT,
    "key" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "stateKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "status" "EntityStateStatus" NOT NULL DEFAULT 'PROPOSED',
    "validFromSceneId" TEXT,
    "validToSceneId" TEXT,
    "storyOrder" INTEGER,
    "sourceSpan" JSONB,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "sourceArtifactId" TEXT,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "chronology" JSONB NOT NULL,
    "sortOrder" DOUBLE PRECISION,
    "chapterId" TEXT,
    "sceneId" TEXT,
    "dependencyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "participantRefs" JSONB NOT NULL,
    "sourceSpan" JSONB,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenLoop" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "OpenLoopKind" NOT NULL,
    "status" "OpenLoopStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "introducedSceneId" TEXT,
    "resolvedSceneId" TEXT,
    "introducedArtifactId" TEXT,
    "resolvedArtifactId" TEXT,
    "targetPayoff" TEXT,
    "metadata" JSONB,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenLoop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupPayoffLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "plotThreadId" TEXT,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "SetupPayoffStatus" NOT NULL DEFAULT 'PLANNED',
    "setupSceneId" TEXT,
    "payoffSceneId" TEXT,
    "reinforcementSceneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "setupArtifactId" TEXT,
    "payoffArtifactId" TEXT,
    "metadata" JSONB,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetupPayoffLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlotThread" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "sourceArtifactId" TEXT,
    "parentThreadId" TEXT,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "PlotThreadKind" NOT NULL,
    "status" "PlotThreadStatus" NOT NULL DEFAULT 'PLANNED',
    "summary" TEXT NOT NULL,
    "stakes" TEXT,
    "sceneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "introducedSceneId" TEXT,
    "resolvedSceneId" TEXT,
    "metadata" JSONB,
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlotThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildCheckpoint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "taskId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "stateSnapshot" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildTrace" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "taskId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "BuildTraceStatus" NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "modelParameters" JSONB,
    "workflowVersion" TEXT NOT NULL,
    "systemPromptVersion" TEXT,
    "skillVersions" JSONB NOT NULL,
    "toolSchemaVersions" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "retrievedArtifactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contextTokenCount" INTEGER,
    "toolCalls" JSONB NOT NULL,
    "toolResults" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "validatorResults" JSONB NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costMicros" INTEGER,
    "latencyMs" INTEGER,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "completionState" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BuildTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildEvaluationResult" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "taskId" TEXT,
    "artifactId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "kind" "BuildEvaluationKind" NOT NULL,
    "rubric" TEXT NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "checks" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "threshold" DOUBLE PRECISION,
    "feedback" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildEvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildOperationReceipt" (
    "id" TEXT NOT NULL,
    "buildRunId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildOperationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuildRun_projectId_status_updatedAt_idx" ON "BuildRun"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuildRun_projectId_branchName_key" ON "BuildRun"("projectId", "branchName");

-- CreateIndex
CREATE UNIQUE INDEX "BuildRun_projectId_idempotencyKey_key" ON "BuildRun"("projectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BuildTask_buildRunId_status_priority_createdAt_idx" ON "BuildTask"("buildRunId", "status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "BuildTask_leaseExpiresAt_idx" ON "BuildTask"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuildTask_buildRunId_key_key" ON "BuildTask"("buildRunId", "key");

-- CreateIndex
CREATE INDEX "BuildTaskTransition_buildRunId_createdAt_idx" ON "BuildTaskTransition"("buildRunId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuildTaskTransition_taskId_idempotencyKey_key" ON "BuildTaskTransition"("taskId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StoryArtifact_projectId_type_status_idx" ON "StoryArtifact"("projectId", "type", "status");

-- CreateIndex
CREATE INDEX "StoryArtifact_buildRunId_type_status_idx" ON "StoryArtifact"("buildRunId", "type", "status");

-- CreateIndex
CREATE INDEX "StoryArtifact_taskId_idx" ON "StoryArtifact"("taskId");

-- CreateIndex
CREATE INDEX "StoryArtifact_replacesArtifactId_idx" ON "StoryArtifact"("replacesArtifactId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryArtifact_buildRunId_type_key_version_key" ON "StoryArtifact"("buildRunId", "type", "key", "version");

-- CreateIndex
CREATE INDEX "StoryArtifactLink_projectId_relationType_idx" ON "StoryArtifactLink"("projectId", "relationType");

-- CreateIndex
CREATE INDEX "StoryArtifactLink_buildRunId_idx" ON "StoryArtifactLink"("buildRunId");

-- CreateIndex
CREATE INDEX "StoryArtifactLink_toArtifactId_idx" ON "StoryArtifactLink"("toArtifactId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryArtifactLink_fromArtifactId_toArtifactId_relationType_key" ON "StoryArtifactLink"("fromArtifactId", "toArtifactId", "relationType");

-- CreateIndex
CREATE INDEX "CanonFact_projectId_subjectType_subjectId_predicate_idx" ON "CanonFact"("projectId", "subjectType", "subjectId", "predicate");

-- CreateIndex
CREATE INDEX "CanonFact_buildRunId_status_idx" ON "CanonFact"("buildRunId", "status");

-- CreateIndex
CREATE INDEX "CanonFact_sourceSceneId_idx" ON "CanonFact"("sourceSceneId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonFact_buildRunId_key_key" ON "CanonFact"("buildRunId", "key");

-- CreateIndex
CREATE INDEX "EntityState_projectId_entityType_entityId_stateKey_storyOrd_idx" ON "EntityState"("projectId", "entityType", "entityId", "stateKey", "storyOrder");

-- CreateIndex
CREATE INDEX "EntityState_buildRunId_status_idx" ON "EntityState"("buildRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EntityState_buildRunId_key_key" ON "EntityState"("buildRunId", "key");

-- CreateIndex
CREATE INDEX "TimelineEvent_projectId_sortOrder_idx" ON "TimelineEvent"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "TimelineEvent_buildRunId_sceneId_idx" ON "TimelineEvent"("buildRunId", "sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineEvent_buildRunId_key_key" ON "TimelineEvent"("buildRunId", "key");

-- CreateIndex
CREATE INDEX "OpenLoop_projectId_kind_status_idx" ON "OpenLoop"("projectId", "kind", "status");

-- CreateIndex
CREATE INDEX "OpenLoop_buildRunId_status_idx" ON "OpenLoop"("buildRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpenLoop_buildRunId_key_key" ON "OpenLoop"("buildRunId", "key");

-- CreateIndex
CREATE INDEX "SetupPayoffLink_projectId_status_idx" ON "SetupPayoffLink"("projectId", "status");

-- CreateIndex
CREATE INDEX "SetupPayoffLink_buildRunId_plotThreadId_idx" ON "SetupPayoffLink"("buildRunId", "plotThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "SetupPayoffLink_buildRunId_key_key" ON "SetupPayoffLink"("buildRunId", "key");

-- CreateIndex
CREATE INDEX "PlotThread_projectId_kind_status_idx" ON "PlotThread"("projectId", "kind", "status");

-- CreateIndex
CREATE INDEX "PlotThread_buildRunId_parentThreadId_idx" ON "PlotThread"("buildRunId", "parentThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "PlotThread_buildRunId_key_key" ON "PlotThread"("buildRunId", "key");

-- CreateIndex
CREATE INDEX "BuildCheckpoint_projectId_createdAt_idx" ON "BuildCheckpoint"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BuildCheckpoint_taskId_idx" ON "BuildCheckpoint"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildCheckpoint_buildRunId_sequence_key" ON "BuildCheckpoint"("buildRunId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "BuildCheckpoint_buildRunId_idempotencyKey_key" ON "BuildCheckpoint"("buildRunId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BuildTrace_projectId_startedAt_idx" ON "BuildTrace"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "BuildTrace_buildRunId_taskId_attempt_idx" ON "BuildTrace"("buildRunId", "taskId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "BuildTrace_buildRunId_idempotencyKey_key" ON "BuildTrace"("buildRunId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BuildEvaluationResult_projectId_createdAt_idx" ON "BuildEvaluationResult"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BuildEvaluationResult_buildRunId_taskId_idx" ON "BuildEvaluationResult"("buildRunId", "taskId");

-- CreateIndex
CREATE INDEX "BuildEvaluationResult_artifactId_idx" ON "BuildEvaluationResult"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildEvaluationResult_buildRunId_idempotencyKey_key" ON "BuildEvaluationResult"("buildRunId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BuildOperationReceipt_buildRunId_operation_createdAt_idx" ON "BuildOperationReceipt"("buildRunId", "operation", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuildOperationReceipt_buildRunId_idempotencyKey_key" ON "BuildOperationReceipt"("buildRunId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WritingBranch_buildRunId_idx" ON "WritingBranch"("buildRunId");

-- AddForeignKey
ALTER TABLE "WritingBranch" ADD CONSTRAINT "WritingBranch_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildRun" ADD CONSTRAINT "BuildRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildRun" ADD CONSTRAINT "BuildRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildRun" ADD CONSTRAINT "BuildRun_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildTask" ADD CONSTRAINT "BuildTask_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildTaskTransition" ADD CONSTRAINT "BuildTaskTransition_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildTaskTransition" ADD CONSTRAINT "BuildTaskTransition_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BuildTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifact" ADD CONSTRAINT "StoryArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifact" ADD CONSTRAINT "StoryArtifact_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifact" ADD CONSTRAINT "StoryArtifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifact" ADD CONSTRAINT "StoryArtifact_replacesArtifactId_fkey" FOREIGN KEY ("replacesArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifactLink" ADD CONSTRAINT "StoryArtifactLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifactLink" ADD CONSTRAINT "StoryArtifactLink_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifactLink" ADD CONSTRAINT "StoryArtifactLink_fromArtifactId_fkey" FOREIGN KEY ("fromArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryArtifactLink" ADD CONSTRAINT "StoryArtifactLink_toArtifactId_fkey" FOREIGN KEY ("toArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityState" ADD CONSTRAINT "EntityState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityState" ADD CONSTRAINT "EntityState_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityState" ADD CONSTRAINT "EntityState_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityState" ADD CONSTRAINT "EntityState_sourceFactId_fkey" FOREIGN KEY ("sourceFactId") REFERENCES "CanonFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLoop" ADD CONSTRAINT "OpenLoop_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLoop" ADD CONSTRAINT "OpenLoop_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLoop" ADD CONSTRAINT "OpenLoop_introducedArtifactId_fkey" FOREIGN KEY ("introducedArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenLoop" ADD CONSTRAINT "OpenLoop_resolvedArtifactId_fkey" FOREIGN KEY ("resolvedArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupPayoffLink" ADD CONSTRAINT "SetupPayoffLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupPayoffLink" ADD CONSTRAINT "SetupPayoffLink_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupPayoffLink" ADD CONSTRAINT "SetupPayoffLink_plotThreadId_fkey" FOREIGN KEY ("plotThreadId") REFERENCES "PlotThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupPayoffLink" ADD CONSTRAINT "SetupPayoffLink_setupArtifactId_fkey" FOREIGN KEY ("setupArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupPayoffLink" ADD CONSTRAINT "SetupPayoffLink_payoffArtifactId_fkey" FOREIGN KEY ("payoffArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotThread" ADD CONSTRAINT "PlotThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotThread" ADD CONSTRAINT "PlotThread_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotThread" ADD CONSTRAINT "PlotThread_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotThread" ADD CONSTRAINT "PlotThread_parentThreadId_fkey" FOREIGN KEY ("parentThreadId") REFERENCES "PlotThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCheckpoint" ADD CONSTRAINT "BuildCheckpoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCheckpoint" ADD CONSTRAINT "BuildCheckpoint_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCheckpoint" ADD CONSTRAINT "BuildCheckpoint_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildCheckpoint" ADD CONSTRAINT "BuildCheckpoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildTrace" ADD CONSTRAINT "BuildTrace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildTrace" ADD CONSTRAINT "BuildTrace_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildTrace" ADD CONSTRAINT "BuildTrace_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildEvaluationResult" ADD CONSTRAINT "BuildEvaluationResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildEvaluationResult" ADD CONSTRAINT "BuildEvaluationResult_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildEvaluationResult" ADD CONSTRAINT "BuildEvaluationResult_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BuildTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildEvaluationResult" ADD CONSTRAINT "BuildEvaluationResult_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "StoryArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildOperationReceipt" ADD CONSTRAINT "BuildOperationReceipt_buildRunId_fkey" FOREIGN KEY ("buildRunId") REFERENCES "BuildRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Production full-text and reference indexes. These expression indexes are safe for
-- existing rows and support the project-wide search corpus without duplicating prose.
CREATE INDEX "WritingVersion_body_fts_idx" ON "WritingVersion" USING GIN (to_tsvector('english', COALESCE("body", '')));
CREATE INDEX "Chapter_metadata_fts_idx" ON "Chapter" USING GIN (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("summary", '')));
CREATE INDEX "Scene_metadata_fts_idx" ON "Scene" USING GIN (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("summary", '') || ' ' || COALESCE("sceneFunction", '') || ' ' || COALESCE("goal", '') || ' ' || COALESCE("obstacle", '') || ' ' || COALESCE("stakes", '') || ' ' || COALESCE("conflict", '') || ' ' || COALESCE("turn", '') || ' ' || COALESCE("revelation", '') || ' ' || COALESCE("outcome", '') || ' ' || COALESCE("emotionalValueShift", '') || ' ' || COALESCE("writerNotes", '') || ' ' || COALESCE("aiNotes", '')));
CREATE INDEX "ProjectDoc_title_fts_idx" ON "ProjectDoc" USING GIN (to_tsvector('english', COALESCE("title", '')));
CREATE INDEX "Character_metadata_fts_idx" ON "Character" USING GIN (to_tsvector('english', COALESCE("name", '') || ' ' || COALESCE("role", '') || ' ' || COALESCE("age", '') || ' ' || COALESCE("occupation", '')));
CREATE INDEX "Location_metadata_fts_idx" ON "Location" USING GIN (to_tsvector('english', COALESCE("name", '') || ' ' || COALESCE("type", '')));
CREATE INDEX "Obstacle_title_fts_idx" ON "Obstacle" USING GIN (to_tsvector('english', COALESCE("title", '')));
CREATE INDEX "StoryArtifact_content_fts_idx" ON "StoryArtifact" USING GIN (to_tsvector('english', COALESCE("title", '') || ' ' || "content"::text));
CREATE INDEX "CanonFact_content_fts_idx" ON "CanonFact" USING GIN (to_tsvector('english', "subjectType" || ' ' || "subjectId" || ' ' || "predicate" || ' ' || "object"::text));
CREATE INDEX "EntityState_content_fts_idx" ON "EntityState" USING GIN (to_tsvector('english', "entityType" || ' ' || "entityId" || ' ' || "stateKey" || ' ' || "value"::text));
CREATE INDEX "TimelineEvent_content_fts_idx" ON "TimelineEvent" USING GIN (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("description", '') || ' ' || "chronology"::text || ' ' || "participantRefs"::text));
CREATE INDEX "OpenLoop_content_fts_idx" ON "OpenLoop" USING GIN (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("description", '') || ' ' || COALESCE("targetPayoff", '') || ' ' || COALESCE("metadata"::text, '')));
CREATE INDEX "SetupPayoffLink_content_fts_idx" ON "SetupPayoffLink" USING GIN (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("description", '') || ' ' || COALESCE("metadata"::text, '')));
CREATE INDEX "PlotThread_content_fts_idx" ON "PlotThread" USING GIN (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("summary", '') || ' ' || COALESCE("stakes", '') || ' ' || COALESCE("metadata"::text, '')));
CREATE INDEX "Scene_characterPresentIds_gin_idx" ON "Scene" USING GIN ("characterPresentIds");
CREATE INDEX "Scene_characterReferencedIds_gin_idx" ON "Scene" USING GIN ("characterReferencedIds");
CREATE INDEX "Scene_plotThreadIds_gin_idx" ON "Scene" USING GIN ("plotThreadIds");
CREATE INDEX "Scene_setupPayoffIds_gin_idx" ON "Scene" USING GIN ("setupPayoffIds");
