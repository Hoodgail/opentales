CREATE TYPE "AiAgentApprovalMode" AS ENUM ('MANUAL', 'AUTO');

ALTER TABLE "ProjectAiAgentSession"
  ADD COLUMN "approvalMode" "AiAgentApprovalMode" NOT NULL DEFAULT 'MANUAL';
