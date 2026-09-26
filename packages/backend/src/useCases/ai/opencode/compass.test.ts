import { describe, expect, it } from 'vitest';
import { extractSections } from './compass.js';

const LEDGER = `# Ledger — The Salt Archive

## Now
Phase 3 (structure). 24 chapters created.

## Next action
Write briefs for Ch 9–16.

### Detail under next action
Use the outline doc.

## Notes to future self
- Aurelio never lies outright.

## Decisions
- D1: 85k words.

## Progress
| Unit | Status |
`;

describe('project compass ledger extraction', () => {
  it('surfaces only the requested sections, including nested detail', () => {
    const sections = extractSections(LEDGER, ['Now', 'Next action', 'Notes to future self']);
    expect(sections.map((section) => section.heading)).toEqual(['Now', 'Next action', 'Notes to future self']);
    expect(sections[1].text).toContain('Write briefs for Ch 9–16.');
    expect(sections[1].text).toContain('Use the outline doc.');
    expect(sections.some((section) => section.text.includes('85k'))).toBe(false);
  });

  it('matches headings by prefix and ignores missing sections', () => {
    const sections = extractSections('## Next action (updated Tue)\nDraft Ch 4.\n', ['Next action', 'Open questions']);
    expect(sections).toEqual([{ heading: 'Next action (updated Tue)', text: 'Draft Ch 4.' }]);
  });

  it('truncates oversized sections so the compass stays bounded', () => {
    const long = `## Now\n${'word '.repeat(2_000)}`;
    const [section] = extractSections(long, ['Now']);
    expect(section.text.length).toBeLessThan(2_100);
    expect(section.text).toContain('truncated');
  });
});
