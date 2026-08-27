export interface PromptHistoryMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  content: string;
}

export interface DecodedHistoryPrompt {
  prompt: string;
  attachmentLabels: string[];
}

/** Build a transcript that explicitly excludes the separately rendered request. */
export function buildRecentTranscript(
  messages: PromptHistoryMessage[],
  excludedMessageIds: string | readonly string[] | null,
  decodeUserPrompt: (content: string) => DecodedHistoryPrompt
): string {
  const excluded = new Set(Array.isArray(excludedMessageIds) ? excludedMessageIds : excludedMessageIds ? [excludedMessageIds] : []);
  return messages
    .filter((message) => !excluded.has(message.id))
    .map((message) => {
      const role = message.role.toLowerCase();
      if (message.role !== 'USER') return `${role}: ${message.content}`;
      const payload = decodeUserPrompt(message.content);
      const suffix = payload.attachmentLabels.length
        ? `\nAttachments: ${payload.attachmentLabels.join(', ')}`
        : '';
      return `${role}: ${payload.prompt}${suffix}`;
    })
    .join('\n');
}
