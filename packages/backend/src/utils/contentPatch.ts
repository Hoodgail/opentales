import { HttpError } from '../http/HttpError.js';

export interface ExactContentEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export type ContentPatch =
  | { mode: 'replace'; content: string }
  | { mode: 'edit'; edits: ExactContentEdit[] };

export function applyContentEdit(content: string, input: ExactContentEdit): string {
  if (!input.oldString) throw new HttpError(400, 'oldString is required');
  if (input.oldString === input.newString) throw new HttpError(400, 'oldString and newString must differ');
  const occurrences = content.split(input.oldString).length - 1;
  if (occurrences === 0) {
    throw new HttpError(409, 'oldString was not found in the current content; re-read the target and retry with exact current text, or use mode="replace" for an intentional full-body replacement');
  }
  if (occurrences > 1 && !input.replaceAll) {
    throw new HttpError(409, `oldString matched ${occurrences} places; provide more surrounding text for one unique match or set replaceAll=true to change all matches`);
  }
  return input.replaceAll
    ? content.split(input.oldString).join(input.newString)
    : content.replace(input.oldString, input.newString);
}

export function applyContentPatch(content: string, patch: ContentPatch): string {
  if (patch.mode === 'replace') return patch.content;
  return patch.edits.reduce((current, edit) => applyContentEdit(current, edit), content);
}
