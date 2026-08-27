import type { JsonObject, StoryArtifact, StorySourceSpan } from '@opentales/sdk';
import {
  DEFAULT_FILTER_WORDS,
  artifactEvidence,
  chapterEvidence,
  escapeRegex,
  excerpt,
  findEvidence,
  isJsonObject,
  jsonString,
  normalizeText,
  pairs,
  proseUnits,
  reference,
  sceneEvidence,
  sceneReference,
  uniqueBy,
  wordCount,
  wordTokens
} from './internal.js';
import type {
  DiagnosticContext,
  DiagnosticDialogueTurn,
  DiagnosticSceneSnapshot
} from './types.js';

const PAST_VERBS = new Set([
  'was',
  'were',
  'had',
  'did',
  'said',
  'went',
  'came',
  'saw',
  'heard',
  'felt',
  'knew',
  'thought',
  'stood',
  'sat',
  'ran',
  'walked',
  'looked',
  'spoke',
  'asked',
  'answered',
  'turned',
  'reached',
  'opened',
  'closed',
  'moved',
  'wanted',
  'needed'
]);

const PRESENT_VERBS = new Set([
  'am',
  'is',
  'are',
  'has',
  'have',
  'do',
  'does',
  'says',
  'goes',
  'comes',
  'sees',
  'hears',
  'feels',
  'knows',
  'thinks',
  'stands',
  'sits',
  'runs',
  'walks',
  'looks',
  'speaks',
  'asks',
  'answers',
  'turns',
  'reaches',
  'opens',
  'closes',
  'moves',
  'wants',
  'needs'
]);

const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves']);
const SECOND_PERSON = new Set(['you', 'your', 'yours', 'yourself', 'yourselves']);
const THIRD_PERSON = new Set([
  'he',
  'him',
  'his',
  'himself',
  'she',
  'her',
  'hers',
  'herself',
  'they',
  'them',
  'their',
  'theirs',
  'themselves'
]);

const DIALOGUE_TAGS = [
  'said',
  'asked',
  'replied',
  'answered',
  'whispered',
  'shouted',
  'murmured',
  'muttered',
  'cried',
  'called',
  'added'
] as const;

const VOICE_FUNCTION_WORDS = new Set([
  'a',
  'about',
  'all',
  'and',
  'as',
  'at',
  'because',
  'but',
  'can',
  'could',
  'do',
  'for',
  'from',
  'have',
  'i',
  'if',
  'in',
  'is',
  'it',
  'just',
  'like',
  'maybe',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'really',
  'so',
  'that',
  'the',
  'then',
  'to',
  'was',
  'we',
  'what',
  'when',
  'will',
  'with',
  'would',
  'yes',
  'you'
]);

export function runProseRules(context: DiagnosticContext): void {
  runRepetitionRules(context);
  runDialogueRules(context);
  runStyleRules(context);
}

function runRepetitionRules(context: DiagnosticContext): void {
  const rules = context.input.projectRules?.repetition ?? {};
  const minimumPassageWords = Math.max(6, rules.minimumRepeatedPassageWords ?? 10);
  const minimumPhraseWords = Math.max(6, rules.minimumPhraseWords ?? 10);
  const minimumPhraseOccurrences = Math.max(2, rules.minimumPhraseOccurrences ?? 3);
  const maximumDiagnostics = Math.max(1, rules.maximumDiagnostics ?? 20);
  const allowed = new Set((rules.allowedPhrases ?? []).map(normalizeText));
  const units = proseUnits(context);

  const passages = new Map<string, Array<{ unit: (typeof units)[number]; quote: string }>>();
  for (const unit of units) {
    for (const segment of proseSegments(unit.text)) {
      const normalized = normalizeText(segment);
      if (
        wordCount(segment) < minimumPassageWords ||
        allowed.has(normalized) ||
        isBoilerplateSegment(segment)
      ) {
        continue;
      }
      passages.set(normalized, [...(passages.get(normalized) ?? []), { unit, quote: segment.trim() }]);
    }
  }

  const repeatedPassages = [...passages.entries()]
    .filter(([, occurrences]) => uniqueBy(occurrences, (value) => value.unit.key).length >= 2)
    .sort((left, right) => wordCount(right[0]) - wordCount(left[0]) || left[0].localeCompare(right[0]));
  const selectedPassages: string[] = [];
  for (const [normalized, occurrences] of repeatedPassages) {
    if (selectedPassages.length >= maximumDiagnostics) break;
    if (selectedPassages.some((selected) => selected.includes(normalized))) continue;
    selectedPassages.push(normalized);
    const uniqueOccurrences = uniqueBy(occurrences, (value) => value.unit.key);
    context.add({
      code: 'repeated-passage',
      category: 'repetition',
      severity: 'warning',
      message: `The same ${wordCount(normalized)}-word passage appears in ${uniqueOccurrences.length} manuscript locations: “${excerpt(
        occurrences[0].quote,
        120
      )}”`,
      evidence: uniqueOccurrences.map((occurrence) => findEvidence(occurrence.unit, occurrence.quote)),
      relatedRefs: uniqueOccurrences.map((occurrence) =>
        occurrence.unit.scene
          ? sceneReference(occurrence.unit.scene)
          : reference('chapter', occurrence.unit.chapter.id, String(occurrence.unit.chapter.number), occurrence.unit.chapter.title)
      ),
      suggestedResolution: 'Cut, vary, or deliberately mark the repeated passage as a refrain.'
    });
  }

  if (selectedPassages.length >= maximumDiagnostics) return;
  const phrases = new Map<string, Array<{ unit: (typeof units)[number]; quote: string }>>();
  for (const unit of units) {
    const tokens = wordTokens(unit.text);
    for (let index = 0; index <= tokens.length - minimumPhraseWords; index += 1) {
      const phrase = tokens.slice(index, index + minimumPhraseWords).join(' ');
      if (
        allowed.has(phrase) ||
        selectedPassages.some((passage) => passage.includes(phrase)) ||
        !isDistinctivePhrase(tokens.slice(index, index + minimumPhraseWords))
      ) {
        continue;
      }
      phrases.set(phrase, [...(phrases.get(phrase) ?? []), { unit, quote: phrase }]);
    }
  }
  const repeatedPhrases = [...phrases.entries()]
    .filter(([, occurrences]) => {
      return (
        occurrences.length >= minimumPhraseOccurrences &&
        uniqueBy(occurrences, (value) => value.unit.key).length >= 2
      );
    })
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  const selectedPhrases: string[] = [];
  for (const [phrase, occurrences] of repeatedPhrases) {
    if (selectedPassages.length + selectedPhrases.length >= maximumDiagnostics) break;
    if (selectedPhrases.some((selected) => overlapRatio(selected, phrase) > 0.75)) continue;
    selectedPhrases.push(phrase);
    const uniqueOccurrences = uniqueBy(occurrences, (value) => value.unit.key);
    context.add({
      code: 'repeated-phrase',
      category: 'repetition',
      severity: 'info',
      message: `The phrase “${phrase}” appears ${occurrences.length} times across ${uniqueOccurrences.length} scenes/chapters.`,
      evidence: uniqueOccurrences.map((occurrence) => findEvidence(occurrence.unit, occurrence.quote)),
      relatedRefs: uniqueOccurrences.map((occurrence) =>
        occurrence.unit.scene
          ? sceneReference(occurrence.unit.scene)
          : reference('chapter', occurrence.unit.chapter.id, String(occurrence.unit.chapter.number), occurrence.unit.chapter.title)
      ),
      suggestedResolution: 'Vary the phrasing unless the repetition is a deliberate motif.'
    });
  }
}

function runDialogueRules(context: DiagnosticContext): void {
  const rules = context.input.projectRules?.dialogue ?? {};
  const minimumTaggedLines = Math.max(4, rules.minimumTaggedLines ?? 10);
  const dominantTagRatio = clamp(rules.dominantTagRatio ?? 0.85, 0.5, 1);
  const expositionWords = Math.max(30, rules.expositionTurnWords ?? 80);

  for (const scene of context.scenes) {
    const extracted = extractDialogue(scene);
    const tags = extracted.flatMap((turn) => (turn.tag ? [turn.tag] : []));
    if (tags.length >= minimumTaggedLines) {
      const counts = countValues(tags);
      const dominant = [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
      )[0];
      if (dominant && dominant[1] / tags.length >= dominantTagRatio) {
        context.add({
          code: 'overused-dialogue-tag',
          category: 'dialogue',
          severity: 'info',
          message: `“${dominant[0]}” accounts for ${dominant[1]} of ${tags.length} dialogue tags in “${scene.title}.”`,
          evidence: extracted
            .filter((turn) => turn.tag === dominant[0])
            .slice(0, 6)
            .map((turn) => sceneEvidence(scene, { quote: turn.quote, start: turn.start, end: turn.end })),
          relatedRefs: [sceneReference(scene)],
          suggestedResolution: 'Check whether action beats, silence, or untagged exchanges would improve rhythm and clarity.'
        });
      }
    }

    for (const turn of extracted) {
      if (
        wordCount(turn.text) < expositionWords ||
        !/\b(?:as you (?:already )?know|as we (?:both )?know|let me explain|the reason (?:is|that)|here(?:'s| is) how|you need to understand)\b/i.test(
          turn.text
        )
      ) {
        continue;
      }
      context.add({
        code: 'exposition-heavy-dialogue',
        category: 'dialogue',
        severity: 'warning',
        message: `A ${wordCount(turn.text)}-word speech in “${scene.title}” uses an explicit exposition cue.`,
        evidence: [sceneEvidence(scene, { quote: turn.quote, start: turn.start, end: turn.end })],
        relatedRefs: [sceneReference(scene)],
        suggestedResolution: 'Break the information into conflict, implication, action, or only what the listener genuinely needs.'
      });
    }

    for (const turn of scene.dialogueTurns ?? []) {
      if (!turn.speakerId || context.characterById.has(turn.speakerId)) continue;
      context.add({
        code: 'unknown-dialogue-speaker',
        category: 'dialogue',
        severity: 'error',
        message: `A dialogue turn in “${scene.title}” references unknown speaker “${turn.speakerId}”.`,
        evidence: [turnEvidence(scene, turn)],
        relatedRefs: [sceneReference(scene), reference('character', turn.speakerId)],
        suggestedResolution: 'Link the turn to a Story Bible character or correct the speaker ID.'
      });
    }
  }

  if (rules.detectIndistinctVoices) runDialogueVoiceRules(context, rules.indistinctVoiceThreshold ?? 0.96);
}

function runDialogueVoiceRules(context: DiagnosticContext, configuredThreshold: number): void {
  const threshold = clamp(configuredThreshold, 0.75, 1);
  const samples = new Map<string, string[]>();
  const evidence = new Map<string, Array<{ scene: DiagnosticSceneSnapshot; turn: DiagnosticDialogueTurn }>>();
  for (const scene of context.scenes) {
    for (const turn of scene.dialogueTurns ?? []) {
      if (!turn.speakerId || !context.characterById.has(turn.speakerId)) continue;
      samples.set(turn.speakerId, [...(samples.get(turn.speakerId) ?? []), turn.text]);
      evidence.set(turn.speakerId, [...(evidence.get(turn.speakerId) ?? []), { scene, turn }]);
    }
  }
  const usable = [...samples.entries()]
    .filter(([, turns]) => wordCount(turns.join(' ')) >= 50)
    .map(([speakerId, turns]) => ({ speakerId, turns, fingerprint: voiceFingerprint(turns) }));

  for (const [left, right] of pairs(usable)) {
    const similarity = cosineSimilarity(left.fingerprint.vector, right.fingerprint.vector);
    const rhythmDifference = Math.abs(left.fingerprint.wordsPerTurn - right.fingerprint.wordsPerTurn);
    if (similarity < threshold || rhythmDifference > 1.5) continue;
    const leftEvidence = evidence.get(left.speakerId)?.[0];
    const rightEvidence = evidence.get(right.speakerId)?.[0];
    context.add({
      code: 'indistinct-character-dialogue',
      category: 'dialogue',
      severity: 'info',
      message: `${characterName(context, left.speakerId)} and ${characterName(
        context,
        right.speakerId
      )} have highly similar dialogue function-word and rhythm profiles (${Math.round(similarity * 100)}%).`,
      evidence: [
        ...(leftEvidence ? [turnEvidence(leftEvidence.scene, leftEvidence.turn)] : []),
        ...(rightEvidence ? [turnEvidence(rightEvidence.scene, rightEvidence.turn)] : [])
      ],
      relatedRefs: [
        reference('character', left.speakerId, undefined, characterName(context, left.speakerId)),
        reference('character', right.speakerId, undefined, characterName(context, right.speakerId))
      ],
      suggestedResolution: 'Review diction, compression, syntax, evasions, and verbal habits so each speaker has a distinct strategy.'
    });
  }
}

function runStyleRules(context: DiagnosticContext): void {
  const units = proseUnits(context);
  const contract = narrativeContract(context);
  const configuredPov = context.input.projectRules?.pov;
  const expectedTense = configuredPov?.tense ?? contract.tense;
  const expectedPerson = configuredPov?.person ?? contract.person;

  for (const unit of units) {
    if (expectedTense) {
      const tense = tenseCounts(unit.text);
      const total = tense.past + tense.present;
      if (total >= 8) {
        const expected = expectedTense === 'past' ? tense.past : tense.present;
        const opposite = expectedTense === 'past' ? tense.present : tense.past;
        if (opposite / total >= 0.7 && opposite >= 7) {
          context.add({
            code: 'tense-drift',
            category: 'style',
            severity: 'warning',
            message: `${unitLabel(unit)} is predominantly ${expectedTense === 'past' ? 'present' : 'past'} tense, but the narrative contract is ${expectedTense}.`,
            evidence: [unitEvidence(unit)],
            relatedRefs: [unitReference(unit), ...contract.refs],
            suggestedResolution: `Restore ${expectedTense} tense or explicitly revise the narrative contract.`
          });
        }
      }
    }

    if (expectedPerson) {
      const person = personCounts(stripDialogue(unit.text));
      const total = person.first + person.second + person.third;
      if (total >= 15) {
        const expected = person[expectedPerson];
        const strongestOpposite = Math.max(
          ...(['first', 'second', 'third'] as const)
            .filter((value) => value !== expectedPerson)
            .map((value) => person[value])
        );
        if (strongestOpposite / total >= 0.85 && expected / total <= 0.1) {
          context.add({
            code: 'person-drift',
            category: 'pov',
            severity: 'warning',
            message: `${unitLabel(unit)} conflicts with the ${expectedPerson}-person narrative contract.`,
            evidence: [unitEvidence(unit)],
            relatedRefs: [unitReference(unit), ...contract.refs],
            suggestedResolution: `Restore ${expectedPerson}-person narration or explicitly revise the narrative contract.`
          });
        }
      }
    }
  }

  const style = context.input.projectRules?.style ?? {};
  for (const phrase of uniqueBy(style.bannedPhrases ?? [], normalizeText)) {
    if (!phrase.trim()) continue;
    const pattern = new RegExp(escapeRegex(phrase), 'giu');
    for (const unit of units) {
      for (const match of unit.text.matchAll(pattern)) {
        context.add({
          code: 'configured-banned-phrase',
          category: 'style',
          severity: 'warning',
          message: `${unitLabel(unit)} uses configured banned phrase “${phrase}”.`,
          evidence: [unitEvidence(unit, match[0], match.index)],
          relatedRefs: [unitReference(unit)],
          suggestedResolution: 'Remove the phrase or update the project’s explicit style constraints.'
        });
      }
    }
  }

  if (style.maximumFilterWordsPerThousand !== undefined) {
    const filterWords = new Set((style.filterWords ?? [...DEFAULT_FILTER_WORDS]).map(normalizeText));
    for (const unit of units) {
      const tokens = wordTokens(unit.text);
      if (tokens.length < 150) continue;
      const hits = tokens.filter((token) => filterWords.has(token));
      const rate = (hits.length / tokens.length) * 1_000;
      if (rate <= style.maximumFilterWordsPerThousand) continue;
      context.add({
        code: 'excessive-filtering',
        category: 'style',
        severity: 'info',
        message: `${unitLabel(unit)} uses ${rate.toFixed(1)} configured filter words per thousand (limit ${style.maximumFilterWordsPerThousand}).`,
        evidence: [unitEvidence(unit)],
        relatedRefs: [unitReference(unit)],
        suggestedResolution: 'Where useful, render perception or thought directly instead of filtering it through “saw,” “felt,” or “realized.”'
      });
    }
  }

  if (style.checkSentenceRhythm) {
    const minimumSentences = Math.max(6, style.minimumSentencesForRhythm ?? 10);
    const maximumStdDev = Math.max(0, style.maximumSentenceLengthStdDev ?? 2.5);
    for (const unit of units) {
      const sentences = sentenceSegments(unit.text);
      if (sentences.length < minimumSentences) continue;
      const lengths = sentences.map(wordCount);
      const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
      const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
      const standardDeviation = Math.sqrt(variance);
      if (mean <= 4 || standardDeviation > maximumStdDev) continue;
      context.add({
        code: 'monotonous-sentence-rhythm',
        category: 'style',
        severity: 'info',
        message: `${unitLabel(unit)} has tightly clustered sentence lengths (mean ${mean.toFixed(1)}, σ ${standardDeviation.toFixed(1)}).`,
        evidence: [unitEvidence(unit)],
        relatedRefs: [unitReference(unit)],
        suggestedResolution: 'Vary sentence length and structure where the scene’s emotional rhythm calls for it.'
      });
    }
  }
}

function proseSegments(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return paragraphs.flatMap((paragraph) => {
    if (wordCount(paragraph) <= 80) return [paragraph];
    return sentenceSegments(paragraph);
  });
}

function sentenceSegments(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[“"'A-Z0-9])/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function isBoilerplateSegment(value: string): boolean {
  return /^(?:chapter|scene|act)\s+[\divxlcdm]+\b/i.test(value.trim()) || /^#{1,6}\s/.test(value.trim());
}

function isDistinctivePhrase(tokens: string[]): boolean {
  const content = tokens.filter(
    (token) => token.length >= 4 && !VOICE_FUNCTION_WORDS.has(token)
  );
  return new Set(content).size >= 3;
}

function overlapRatio(left: string, right: string): number {
  const leftTokens = new Set(wordTokens(left));
  const rightTokens = new Set(wordTokens(right));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

interface ExtractedDialogueTurn {
  text: string;
  quote: string;
  start: number;
  end: number;
  tag?: string;
}

function extractDialogue(scene: DiagnosticSceneSnapshot): ExtractedDialogueTurn[] {
  const result: ExtractedDialogueTurn[] = [];
  const quotePattern = /[“"]([^”"\n]{1,3000})[”"]/gu;
  for (const match of scene.content.matchAll(quotePattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const tail = scene.content.slice(end, end + 100);
    const tag = tail.match(
      new RegExp(`^\\s*[,—-]?\\s*(?:[\\p{L}][\\p{L}'’-]*|he|she|they)\\s+(${DIALOGUE_TAGS.join('|')})\\b`, 'iu')
    )?.[1];
    result.push({
      text: match[1],
      quote: match[0],
      start,
      end,
      ...(tag ? { tag: tag.toLocaleLowerCase('en-US') } : {})
    });
  }
  return result;
}

function turnEvidence(scene: DiagnosticSceneSnapshot, turn: DiagnosticDialogueTurn): StorySourceSpan {
  return sceneEvidence(scene, {
    quote: turn.quote || turn.text,
    start: turn.start,
    end: turn.end
  });
}

function voiceFingerprint(turns: string[]): { vector: Map<string, number>; wordsPerTurn: number } {
  const vector = new Map<string, number>();
  let totalWords = 0;
  for (const turn of turns) {
    const tokens = wordTokens(turn);
    totalWords += tokens.length;
    for (const token of tokens) {
      if (!VOICE_FUNCTION_WORDS.has(token)) continue;
      vector.set(token, (vector.get(token) ?? 0) + 1);
    }
  }
  const denominator = Math.max(1, [...vector.values()].reduce((sum, value) => sum + value, 0));
  for (const [key, value] of vector) vector.set(key, value / denominator);
  return { vector, wordsPerTurn: totalWords / Math.max(1, turns.length) };
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  const keys = new Set([...left.keys(), ...right.keys()]);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const key of keys) {
    const leftValue = left.get(key) ?? 0;
    const rightValue = right.get(key) ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue ** 2;
    rightMagnitude += rightValue ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function countValues(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function tenseCounts(text: string): { past: number; present: number } {
  let past = 0;
  let present = 0;
  for (const token of wordTokens(stripDialogue(text))) {
    if (PAST_VERBS.has(token) || /(?:ed)$/.test(token) && token.length > 4) past += 1;
    else if (PRESENT_VERBS.has(token)) present += 1;
  }
  return { past, present };
}

function personCounts(text: string): { first: number; second: number; third: number } {
  const result = { first: 0, second: 0, third: 0 };
  for (const token of wordTokens(text)) {
    if (FIRST_PERSON.has(token)) result.first += 1;
    else if (SECOND_PERSON.has(token)) result.second += 1;
    else if (THIRD_PERSON.has(token)) result.third += 1;
  }
  return result;
}

function stripDialogue(text: string): string {
  return text.replace(/[“"][^”"\n]*[”"]/gu, ' ');
}

function narrativeContract(context: DiagnosticContext): {
  tense?: 'past' | 'present';
  person?: 'first' | 'second' | 'third';
  refs: ReturnType<typeof reference>[];
} {
  const artifact = context.activeArtifacts.find(
    (value) => value.type === 'narrative-contract' && isJsonObject(value.content)
  );
  if (!artifact) return { refs: [] };
  const content = artifact.content as JsonObject;
  const tenseValue = normalizeText(jsonString(content.tense) ?? '');
  const povValue = normalizeText(jsonString(content.pov) ?? '');
  return {
    tense: tenseValue.includes('present') ? 'present' : tenseValue.includes('past') ? 'past' : undefined,
    person: povValue.includes('first')
      ? 'first'
      : povValue.includes('second')
        ? 'second'
        : povValue.includes('third')
          ? 'third'
          : undefined,
    refs: [reference('artifact', artifact.id, artifact.key, artifact.title)]
  };
}

function unitEvidence(
  unit: ReturnType<typeof proseUnits>[number],
  quote?: string,
  start?: number
): StorySourceSpan {
  const details = {
    ...(quote ? { quote } : {}),
    ...(start !== undefined ? { start, end: start + (quote?.length ?? 0) } : {})
  };
  return unit.scene ? sceneEvidence(unit.scene, details) : chapterEvidence(unit.chapter, details);
}

function unitReference(unit: ReturnType<typeof proseUnits>[number]): ReturnType<typeof reference> {
  return unit.scene
    ? sceneReference(unit.scene)
    : reference('chapter', unit.chapter.id, String(unit.chapter.number), unit.chapter.title);
}

function unitLabel(unit: ReturnType<typeof proseUnits>[number]): string {
  return unit.scene
    ? `Scene “${unit.scene.title}”`
    : `Chapter ${unit.chapter.number}, “${unit.chapter.title},”`;
}

function characterName(context: DiagnosticContext, characterId: string): string {
  return context.characterById.get(characterId)?.name ?? `character “${characterId}”`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

