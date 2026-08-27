ALTER TYPE "AiToolCallStatus" ADD VALUE 'RUNNING' BEFORE 'EXECUTED';

ALTER TABLE "ProjectAiAgentSession"
  ADD COLUMN "activeBuildRunId" TEXT,
  ADD COLUMN "nextPartSequence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "AiAgentSessionPart" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "promptId" TEXT,
  "messageId" TEXT,
  "toolCallId" TEXT,
  "kind" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiAgentSessionPart_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectAiAgentSession_activeBuildRunId_idx"
  ON "ProjectAiAgentSession"("activeBuildRunId");
CREATE UNIQUE INDEX "AiAgentSessionPart_sessionId_sequence_key"
  ON "AiAgentSessionPart"("sessionId", "sequence");
CREATE UNIQUE INDEX "AiAgentSessionPart_sessionId_kind_toolCallId_key"
  ON "AiAgentSessionPart"("sessionId", "kind", "toolCallId");
CREATE INDEX "AiAgentSessionPart_sessionId_createdAt_idx"
  ON "AiAgentSessionPart"("sessionId", "createdAt");
CREATE INDEX "AiAgentSessionPart_messageId_idx"
  ON "AiAgentSessionPart"("messageId");
CREATE INDEX "AiAgentSessionPart_toolCallId_idx"
  ON "AiAgentSessionPart"("toolCallId");

ALTER TABLE "ProjectAiAgentSession"
  ADD CONSTRAINT "ProjectAiAgentSession_activeBuildRunId_fkey"
  FOREIGN KEY ("activeBuildRunId") REFERENCES "BuildRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiAgentSessionPart"
  ADD CONSTRAINT "AiAgentSessionPart_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ProjectAiAgentSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
