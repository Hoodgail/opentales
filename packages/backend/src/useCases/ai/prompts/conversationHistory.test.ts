import { expect, it } from 'vitest';
import { buildRecentTranscript } from './conversationHistory.js';
import { clearTemplateCache, renderUserContext } from './promptEngine.js';
import { serializeUntrustedData } from './untrustedData.js';

it('renders the active request only in Current request, never recent history', () => {
  const activeRequest = 'Draft the bridge confrontation.';
  const transcript = buildRecentTranscript(
    [
      { id: 'm1', role: 'USER', content: 'What is Mara afraid of?' },
      { id: 'm2', role: 'ASSISTANT', content: 'She fears losing her memories.' },
      { id: 'active', role: 'USER', content: activeRequest },
      { id: 'active-assistant', role: 'ASSISTANT', content: '' }
    ],
    ['active', 'active-assistant'],
    (content) => ({ prompt: content, attachmentLabels: [] })
  );
  clearTemplateCache();
  const rendered = renderUserContext({ transcript: serializeUntrustedData('conversation-history', transcript), prompt: activeRequest });
  expect(rendered.match(/Draft the bridge confrontation\./g)).toHaveLength(1);
  expect(rendered).toMatchInlineSnapshot(`
    "## Recent conversation

    <untrusted_data label="conversation-history" encoding="json-unicode-escaped">
    "user: What is Mara afraid of?\\nassistant: She fears losing her memories."
    </untrusted_data>

    ## Current request

    Draft the bridge confrontation."
  `);
});
