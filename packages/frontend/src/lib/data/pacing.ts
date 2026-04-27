import type { Chapter } from '@opentales/sdk';

export const DEFAULT_WPM = 250;

export interface PacingDatum {
  chapterId: string;
  number: number;
  title: string;
  wordCount: number;
  /** Estimated reading time in minutes at the configured wpm. */
  readingMinutes: number;
}

/**
 * Convert a list of chapters into a normalized pacing series. Sorted by
 * chapter number so the resulting array can be plotted directly as a
 * left-to-right pacing bar / line chart.
 */
export function pacingSeries(chapters: Chapter[], wpm: number = DEFAULT_WPM): PacingDatum[] {
  return [...chapters]
    .sort((a, b) => a.number - b.number)
    .map((c) => ({
      chapterId: c.id,
      number: c.number,
      title: c.title,
      wordCount: c.wordCount,
      readingMinutes: wpm > 0 ? c.wordCount / wpm : 0
    }));
}

export function readingTime(words: number, wpm: number = DEFAULT_WPM): { minutes: number; label: string } {
  if (wpm <= 0) return { minutes: 0, label: '0 min' };
  const minutes = words / wpm;
  if (minutes < 1) return { minutes, label: '< 1 min' };
  if (minutes < 60) return { minutes, label: `${Math.round(minutes)} min` };
  const hours = Math.floor(minutes / 60);
  const rem = Math.round(minutes - hours * 60);
  return { minutes, label: rem > 0 ? `${hours}h ${rem}m` : `${hours}h` };
}
