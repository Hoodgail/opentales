import { describe, expect, it } from 'vitest';
import { countWords } from './wordCount.js';

describe('countWords', () => {
  it.each([
    ['', 0],
    ['one two three', 3],
    ['wait—then run', 3],
    ["don't stop", 2],
    ['well-being matters', 2],
    ['“Quoted words,” she said.', 4]
  ])('counts %j as %i words', (text, expected) => {
    expect(countWords(text)).toBe(expected);
  });
});
