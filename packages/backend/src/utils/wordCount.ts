const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

/**
 * Count natural-language words without treating punctuation such as an em dash
 * as part of a token. Intl.Segmenter also avoids the ASCII-only assumptions of
 * whitespace splitting for contractions and non-Latin scripts.
 */
export function countWords(value: string): number {
  const normalized = value.replace(/(?<=\p{L})[-‐‑](?=\p{L})/gu, "'");
  let count = 0;
  for (const segment of wordSegmenter.segment(normalized)) {
    if (segment.isWordLike) count += 1;
  }
  return count;
}
