-- CreateEnum
CREATE TYPE "AiAgentSessionStatus" AS ENUM ('IDLE', 'RUNNING', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "AiAgentMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');

-- CreateEnum
CREATE TYPE "AiAgentPromptStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "AiToolCallStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'ERROR');

-- CreateTable
CREATE TABLE "ProjectAiAgentSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "AiAgentSessionStatus" NOT NULL DEFAULT 'IDLE',
    "activePromptId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAiAgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "AiAgentMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentPrompt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "AiAgentPromptStatus" NOT NULL DEFAULT 'QUEUED',
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgentPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentToolCall" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "promptId" TEXT,
    "toolCallId" TEXT,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" "AiToolCallStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "output" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "AiAgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAiAgentSession_projectId_key" ON "ProjectAiAgentSession"("projectId");

-- CreateIndex
CREATE INDEX "AiAgentMessage_sessionId_createdAt_idx" ON "AiAgentMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAgentPrompt_sessionId_status_order_idx" ON "AiAgentPrompt"("sessionId", "status", "order");

-- CreateIndex
CREATE INDEX "AiAgentToolCall_sessionId_status_createdAt_idx" ON "AiAgentToolCall"("sessionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiAgentToolCall_toolCallId_idx" ON "AiAgentToolCall"("toolCallId");

-- AddForeignKey
ALTER TABLE "ProjectAiAgentSession" ADD CONSTRAINT "ProjectAiAgentSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAgentMessage" ADD CONSTRAINT "AiAgentMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProjectAiAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAgentPrompt" ADD CONSTRAINT "AiAgentPrompt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProjectAiAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAgentToolCall" ADD CONSTRAINT "AiAgentToolCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProjectAiAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
