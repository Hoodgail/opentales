import type { AiAgentPermissionRequest } from '@opentales/sdk';

export interface AiApprovalDoc {
  /** Permission request id; also the tab ref id. */
  id: string;
  sessionId: string;
  title: string;
  request: AiAgentPermissionRequest;
  targetLabel: string;
  panes: AiApprovalDiffPane[];
}

export interface AiApprovalDiffPane {
  id: string;
  title: string;
  description: string;
  original: string;
  modified: string;
  language: string;
}

const docs = new Map<string, AiApprovalDoc>();

export function setAiApprovalDoc(doc: AiApprovalDoc) {
  docs.set(doc.id, doc);
}

export function getAiApprovalDoc(id: string): AiApprovalDoc | null {
  return docs.get(id) ?? null;
}

export function deleteAiApprovalDoc(id: string) {
  docs.delete(id);
}
