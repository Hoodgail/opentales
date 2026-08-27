-- Old test fixtures and pre-FK timeline rows may reference prompts that were
-- already removed. Preserve the timeline part while clearing only the orphan.
UPDATE "AiAgentSessionPart" AS part
SET "promptId" = NULL
WHERE "promptId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "AiAgentPrompt" AS prompt WHERE prompt.id = part."promptId");

UPDATE "AiAgentSessionPart" AS part
SET "messageId" = NULL
WHERE "messageId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "AiAgentMessage" AS message WHERE message.id = part."messageId");

UPDATE "AiAgentSessionPart" AS part
SET "toolCallId" = NULL
WHERE "toolCallId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "AiAgentToolCall" AS tool_call WHERE tool_call.id = part."toolCallId");

CREATE UNIQUE INDEX "AiAgentToolCall_sessionId_toolCallId_key"
  ON "AiAgentToolCall"("sessionId", "toolCallId");

ALTER TABLE "AiAgentSessionPart"
  ADD CONSTRAINT "AiAgentSessionPart_kind_check"
  CHECK (kind IN ('message', 'text', 'tool-call', 'tool-result', 'task'));

ALTER TABLE "AiAgentSessionPart"
  ADD CONSTRAINT "AiAgentSessionPart_promptId_fkey"
  FOREIGN KEY ("promptId") REFERENCES "AiAgentPrompt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiAgentSessionPart"
  ADD CONSTRAINT "AiAgentSessionPart_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "AiAgentMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiAgentSessionPart"
  ADD CONSTRAINT "AiAgentSessionPart_toolCallId_fkey"
  FOREIGN KEY ("toolCallId") REFERENCES "AiAgentToolCall"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
