import { describe, expect, it } from 'vitest';
import { menuPosition } from './floatingMenu';

describe('IDE menu placement', () => {
  it('keeps the session menu inside a narrow viewport at the left edge', () => {
    const position = menuPosition({ left: 50, top: 10, bottom: 35 }, 300, 280, { width: 320, height: 600 }, 'below');
    expect(position.left).toBe(12);
    expect(position.top).toBe(41);
    expect(position.left + 300).toBeLessThanOrEqual(312);
  });
  it('flips a composer menu above the trigger and limits height near viewport edges', () => {
    const position = menuPosition({ left: 900, top: 650, bottom: 675 }, 360, 400, { width: 1024, height: 700 }, 'below');
    expect(position).toMatchObject({ left: 656, top: 244 });
    const compact = menuPosition({ left: 0, top: 130, bottom: 154 }, 220, 400, { width: 320, height: 260 }, 'above');
    expect(compact.top).toBe(8);
    expect(compact.maxHeight).toBe(116);
  });
});
