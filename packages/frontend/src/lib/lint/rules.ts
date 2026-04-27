import type { Diagnostic, LintRule } from './types';

const EYE_COLORS = [
  'amber', 'blue', 'brown', 'green', 'grey', 'gray',
  'hazel', 'black', 'violet', 'pale', 'silver'
];

function eyeColorMatches(text: string, name: string): { color: string; line: number }[] {
  // Match patterns like "<name> ... <color> eyes" or "her/his <color> eyes" within
  // ~120 characters of a character's name. Greedy enough to catch common phrasing,
  // narrow enough not to flag every adjective in the manuscript.
  const out: { color: string; line: number }[] = [];
  const lines = text.split('\n');
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$1');
  const colorAlt = EYE_COLORS.join('|');
  // Forms:
  //   "<name>'s <color> eyes"
  //   "<name>'s eyes were <color>"
  //   "<name> ... <color> eyes" (within ~80 chars)
  const direct = new RegExp(
    `${escName}[^\\n]{0,80}?\\b(${colorAlt})\\b[^\\n]{0,40}?\\beyes?\\b`,
    'gi'
  );
  const reversed = new RegExp(
    `${escName}[^\\n]{0,80}?\\beyes?\\b[^\\n]{0,40}?\\b(${colorAlt})\\b`,
    'gi'
  );
  for (let i = 0; i < lines.length; i++) {
    direct.lastIndex = 0;
    reversed.lastIndex = 0;
    const line = lines[i];
    let m: RegExpExecArray | null;
    while ((m = direct.exec(line))) {
      out.push({ color: m[1].toLowerCase(), line: i + 1 });
    }
    while ((m = reversed.exec(line))) {
      out.push({ color: m[1].toLowerCase(), line: i + 1 });
    }
  }
  return out;
}

export const eyeColorDriftRule: LintRule = {
  id: 'craft/eye-color-drift',
  label: 'Eye color drift',
  description:
    'Surface places where a character is described with conflicting eye colors across chapters.',
  defaultEnabled: true,
  run({ chapters, characters }) {
    const diagnostics: Diagnostic[] = [];

    for (const character of characters) {
      const observations: {
        chapterId: string;
        chapterTitle: string;
        line: number;
        color: string;
      }[] = [];

      for (const chapter of chapters) {
        const matches = eyeColorMatches(chapter.content, character.name);
        for (const match of matches) {
          observations.push({
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            line: match.line,
            color: match.color
          });
        }
      }

      if (observations.length < 2) continue;

      const byColor = new Map<string, typeof observations>();
      for (const obs of observations) {
        const list = byColor.get(obs.color) ?? [];
        list.push(obs);
        byColor.set(obs.color, list);
      }

      if (byColor.size < 2) continue;

      const colors = Array.from(byColor.keys()).sort();
      // Flag the first occurrence of each conflicting color so users can
      // see both sides of the contradiction in the Problems panel.
      for (const color of colors) {
        const first = byColor.get(color)![0];
        diagnostics.push({
          ruleId: eyeColorDriftRule.id,
          severity: 'warning',
          chapterId: first.chapterId,
          chapterTitle: first.chapterTitle,
          message: `${character.name}'s eyes described as ${color} (conflicts with ${colors
            .filter((c) => c !== color)
            .join(', ')}).`,
          hint: `Saw ${observations.length} eye-color mentions for ${character.name} across ${chapters.length} chapters.`,
          lineStart: first.line,
          lineEnd: first.line
        });
      }
    }

    return diagnostics;
  }
};

const PRESENT_VERBS = new Set([
  'is', 'are', 'am', 'has', 'have', 'do', 'does',
  'walks', 'runs', 'sits', 'stands', 'looks', 'speaks',
  'thinks', 'feels', 'knows', 'sees', 'hears', 'says'
]);

const PAST_VERBS = new Set([
  'was', 'were', 'had', 'did',
  'walked', 'ran', 'sat', 'stood', 'looked', 'spoke',
  'thought', 'felt', 'knew', 'saw', 'heard', 'said'
]);

function classifyTense(text: string): 'past' | 'present' | 'mixed' | 'unknown' {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let past = 0;
  let present = 0;
  for (const tok of tokens) {
    if (PAST_VERBS.has(tok)) past++;
    else if (PRESENT_VERBS.has(tok)) present++;
  }
  const total = past + present;
  if (total < 6) return 'unknown';
  const presentShare = present / total;
  if (presentShare > 0.7) return 'present';
  if (presentShare < 0.3) return 'past';
  return 'mixed';
}

export const tenseDriftRule: LintRule = {
  id: 'craft/tense-drift',
  label: 'Tense drift',
  description:
    'Compare each chapter\'s dominant tense to the manuscript baseline and flag the outliers.',
  defaultEnabled: true,
  run({ chapters }) {
    const diagnostics: Diagnostic[] = [];
    const classifications = chapters.map((c) => ({
      chapter: c,
      tense: classifyTense(c.content)
    }));

    const usable = classifications.filter((x) => x.tense === 'past' || x.tense === 'present');
    if (usable.length < 2) return diagnostics;

    const counts = { past: 0, present: 0 };
    for (const x of usable) counts[x.tense as 'past' | 'present']++;
    const baseline = counts.past >= counts.present ? 'past' : 'present';

    for (const x of classifications) {
      if (x.tense === 'unknown') continue;
      if (x.tense === baseline) continue;
      diagnostics.push({
        ruleId: tenseDriftRule.id,
        severity: x.tense === 'mixed' ? 'info' : 'warning',
        chapterId: x.chapter.id,
        chapterTitle: x.chapter.title,
        message:
          x.tense === 'mixed'
            ? `Chapter mixes past and present tense — manuscript baseline is ${baseline}.`
            : `Chapter is in ${x.tense} tense — manuscript baseline is ${baseline}.`,
        hint: 'Tense drift inside a single scene reads as a typo; across a chapter it reads as authorial uncertainty.'
      });
    }

    return diagnostics;
  }
};

const PROP_VERBS = [
  'pocketed', 'grabbed', 'took', 'picked up', 'drew', 'stuffed', 'slipped',
  'tucked', 'pulled out', 'clutched'
];

export const forgottenPropsRule: LintRule = {
  id: 'craft/forgotten-props',
  label: 'Forgotten props',
  description:
    'Look for props that get explicitly picked up by a character and never reappear in any later chapter.',
  defaultEnabled: true,
  run({ chapters }) {
    const diagnostics: Diagnostic[] = [];
    const sorted = [...chapters].sort((a, b) => a.number - b.number);

    const verbAlt = PROP_VERBS.map((v) => v.replace(/ /g, '\\s+')).join('|');
    // Capture a noun phrase like "the key" or "a worn revolver" right after
    // a pickup verb. We deliberately skip pronouns and proper nouns.
    const re = new RegExp(`\\b(?:${verbAlt})\\s+(the|a|an|his|her|their)\\s+([a-z][a-z\\s-]{1,30}?)\\b`, 'gi');

    for (let i = 0; i < sorted.length; i++) {
      const chapter = sorted[i];
      const seen = new Set<string>();
      const lines = chapter.content.split('\n');
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          const noun = m[2].trim().toLowerCase().split(/\s+/).slice(-1)[0];
          if (!noun || noun.length < 3) continue;
          if (seen.has(noun)) continue;
          seen.add(noun);

          const laterChapters = sorted.slice(i + 1);
          const reused = laterChapters.some((later) =>
            new RegExp(`\\b${noun}s?\\b`, 'i').test(later.content)
          );
          if (!reused && laterChapters.length > 0) {
            diagnostics.push({
              ruleId: forgottenPropsRule.id,
              severity: 'info',
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              message: `Prop "${noun}" picked up here but never referenced in later chapters.`,
              hint: 'Chekhov\'s gun candidate — payoff or cut.',
              lineStart: lineIdx + 1,
              lineEnd: lineIdx + 1
            });
          }
        }
      }
    }

    return diagnostics;
  }
};

function tokenizeSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sentenceWordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export const sentenceLengthVarianceRule: LintRule = {
  id: 'craft/sentence-length-variance',
  label: 'Sentence rhythm',
  description:
    'Surface chapters whose sentences land on a single, monotonous length — variety reads as voice.',
  defaultEnabled: true,
  run({ chapters }) {
    const diagnostics: Diagnostic[] = [];

    for (const chapter of chapters) {
      const sentences = tokenizeSentences(chapter.content);
      if (sentences.length < 8) continue;

      const lengths = sentences.map(sentenceWordCount);
      const mean = lengths.reduce((s, l) => s + l, 0) / lengths.length;
      const variance =
        lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev < 3 && mean > 4) {
        diagnostics.push({
          ruleId: sentenceLengthVarianceRule.id,
          severity: 'info',
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          message: `Sentence lengths cluster tightly around ${mean.toFixed(1)} words (σ = ${stdDev.toFixed(1)}).`,
          hint: 'Vary cadence — short, then long, then medium — to give prose breath.'
        });
      }
    }

    return diagnostics;
  }
};

export const allRules: LintRule[] = [
  eyeColorDriftRule,
  tenseDriftRule,
  forgottenPropsRule,
  sentenceLengthVarianceRule
];
