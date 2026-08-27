import type {
  CanonFact,
  Chapter,
  Character,
  EntityState,
  JsonObject,
  JsonValue,
  Location,
  OpenLoop,
  PlotThread,
  Scene,
  SetupPayoffLink,
  StoryArtifact,
  StoryDiagnostic,
  StoryDiagnosticCategory,
  StoryDiagnosticsResult,
  StoryReference,
  StorySourceSpan,
  TimelineEvent
} from '@opentales/sdk';

/**
 * The complete set requested by the Novel Build research document. This is
 * deliberately kept next to the engine so rules cannot silently drift out of
 * sync with the Problems surface.
 */
export const STORY_DIAGNOSTIC_CATEGORIES = [
  'schema',
  'cross-link',
  'continuity',
  'chronology',
  'knowledge',
  'location',
  'world-rule',
  'character',
  'pov',
  'setup-payoff',
  'plot',
  'pacing',
  'repetition',
  'dialogue',
  'style',
  'metadata',
  'publishing',
  'workflow'
] as const satisfies readonly StoryDiagnosticCategory[];

export type StoryDiagnosticsCategory = (typeof STORY_DIAGNOSTIC_CATEGORIES)[number];

export type PlanningMode = 'pantser' | 'hybrid' | 'planner';
export type DiagnosticsPhase =
  | 'planning'
  | 'drafting'
  | 'revising'
  | 'finalizing'
  | 'publishing'
  | 'completed';

export interface StoryDiagnosticsMetadata {
  /** Human-selected workflow style; pantsers are not forced to fill planning metadata. */
  planningMode?: PlanningMode;
  /** Explicitly turns metadata completeness checks back on for a pantser project. */
  enforceOptionalSceneMetadata?: boolean;
  /** Enables end-of-manuscript checks such as unresolved main threads. */
  manuscriptComplete?: boolean;
  phase?: DiagnosticsPhase;
  /** Build branch whose prose is represented by this snapshot. */
  branchId?: string;
  branchName?: string;
  disabledRuleCodes?: string[];
  enabledCategories?: StoryDiagnosticsCategory[];
  /** ISO timestamp supplied by the caller for reproducible result envelopes. */
  generatedAt?: string;
}

export interface DiagnosticKnowledgeClaim {
  characterId: string;
  knowledgeKey: string;
  quote?: string;
  start?: number;
  end?: number;
}

export interface DiagnosticKnowledgeDelta {
  characterId: string;
  knowledgeKey: string;
  operation: 'gain' | 'lose';
}

export interface DiagnosticCharacterSignal {
  characterId: string;
  kind: 'goal' | 'voice' | 'behavior';
  value: string;
  /** Keys/traits from the Character Bible that an extractor found contradicted. */
  contradicts: string[];
  quote?: string;
  start?: number;
  end?: number;
}

export interface DiagnosticWorldRuleViolation {
  ruleKey: string;
  explanation: string;
  quote?: string;
  start?: number;
  end?: number;
}

export interface DiagnosticDialogueTurn {
  speakerId?: string | null;
  text: string;
  quote?: string;
  start?: number;
  end?: number;
}

export interface DiagnosticSceneSnapshot extends Omit<Scene, 'writingId' | 'branchId' | 'headVersionId'> {
  writingId?: string;
  branchId?: string | null;
  headVersionId?: string | null;
  /** Scene-plan dependency keys or scene IDs, when materialized on the scene. */
  dependencyIds?: string[];
  /** Allows an intentional flashback/flash-forward to bypass linear-order warnings. */
  chronologyMode?: 'linear' | 'flashback' | 'flashforward';
  knowledgeClaims?: DiagnosticKnowledgeClaim[];
  normalizedKnowledgeDeltas?: DiagnosticKnowledgeDelta[];
  interiorityCharacterIds?: string[];
  characterSignals?: DiagnosticCharacterSignal[];
  worldRuleViolations?: DiagnosticWorldRuleViolation[];
  dialogueTurns?: DiagnosticDialogueTurn[];
  sourceArtifactId?: string | null;
  metadata?: JsonObject;
}

export interface DiagnosticChapterSnapshot extends Omit<Chapter, 'scenes' | 'writingId' | 'branchId' | 'headVersionId'> {
  writingId?: string;
  headVersionId?: string | null;
  scenes: DiagnosticSceneSnapshot[];
  /** Optional provenance for chapter prose generated on a Novel Build branch. */
  sourceArtifactId?: string | null;
  branchId?: string | null;
}

export interface DiagnosticCharacterSnapshot extends Character {
  key?: string;
  aliases: string[];
}

export interface DiagnosticLocationSnapshot extends Location {
  key?: string;
  aliases: string[];
}

export interface TravelTimeRule {
  fromLocationId: string;
  toLocationId: string;
  minimumMinutes: number;
  bidirectional?: boolean;
}

export interface MetadataDiagnosticRules {
  requirePov?: boolean;
  requireLocation?: boolean;
  requireStoryDate?: boolean;
  requireStoryTime?: boolean;
  requireSceneFunction?: boolean;
  requireGoal?: boolean;
  requireConflict?: boolean;
  requireOutcome?: boolean;
  requireEmotionalValueShift?: boolean;
}

export interface PovDiagnosticRules {
  mode?: 'single' | 'multiple' | 'omniscient';
  allowedCharacterIds?: string[];
  requiredCharacterId?: string;
  person?: 'first' | 'second' | 'third';
  tense?: 'past' | 'present';
  narrativeDistance?: 'close' | 'medium' | 'distant' | string;
  singlePovPerChapter?: boolean;
}

export interface PacingDiagnosticRules {
  lowConflictRunLength?: number;
  revelationClusterLength?: number;
  minimumChaptersForSizeComparison?: number;
  chapterWordCountLowRatio?: number;
  chapterWordCountHighRatio?: number;
  sceneTargetToleranceRatio?: number;
}

export interface RepetitionDiagnosticRules {
  minimumRepeatedPassageWords?: number;
  minimumPhraseWords?: number;
  minimumPhraseOccurrences?: number;
  allowedPhrases?: string[];
  maximumDiagnostics?: number;
}

export interface DialogueDiagnosticRules {
  minimumTaggedLines?: number;
  dominantTagRatio?: number;
  expositionTurnWords?: number;
  detectIndistinctVoices?: boolean;
  indistinctVoiceThreshold?: number;
}

export interface StyleDiagnosticRules {
  bannedPhrases?: string[];
  maximumFilterWordsPerThousand?: number;
  filterWords?: string[];
  checkSentenceRhythm?: boolean;
  minimumSentencesForRhythm?: number;
  maximumSentenceLengthStdDev?: number;
}

export interface PlotDiagnosticRules {
  requireSceneDependencies?: boolean;
  dormantThreadSceneCount?: number;
}

export interface PublishingDiagnosticRules {
  enabled?: boolean;
  requireSequentialChapterNumbers?: boolean;
  requireUniqueChapterTitles?: boolean;
  requireFinalChapterStatus?: boolean;
  requiredArtifactTypes?: StoryArtifact['type'][];
  targetWordCountMin?: number;
  targetWordCountMax?: number;
}

export interface StoryDiagnosticProjectRules {
  metadata?: MetadataDiagnosticRules;
  pov?: PovDiagnosticRules;
  travelTimes?: TravelTimeRule[];
  allowNonlinearChronology?: boolean;
  allowResurrection?: boolean;
  requireKnowledgeProvenance?: boolean;
  pacing?: PacingDiagnosticRules;
  repetition?: RepetitionDiagnosticRules;
  dialogue?: DialogueDiagnosticRules;
  style?: StyleDiagnosticRules;
  plot?: PlotDiagnosticRules;
  publishing?: PublishingDiagnosticRules;
  disabledRuleCodes?: string[];
  enabledCategories?: StoryDiagnosticsCategory[];
}

/**
 * A single immutable view of the prose branch and every structured story-state
 * table needed by diagnostics. Callers should build this in one transaction so
 * diagnostics never compare records from different revisions.
 */
export interface StoryDiagnosticsInput {
  projectId: string;
  buildRunId: string;
  buildRevision?: number;
  chapters: DiagnosticChapterSnapshot[];
  characters: DiagnosticCharacterSnapshot[];
  locations: DiagnosticLocationSnapshot[];
  artifacts: StoryArtifact[];
  canonFacts: CanonFact[];
  entityStates: EntityState[];
  timelineEvents: TimelineEvent[];
  openLoops: OpenLoop[];
  setupPayoffs: SetupPayoffLink[];
  plotThreads: PlotThread[];
  projectRules?: StoryDiagnosticProjectRules;
  metadata?: StoryDiagnosticsMetadata;
}

export interface StoryDiagnosticsEngineOptions {
  now?: () => Date;
}

/** Internal shape before the SDK-compatible stable ID is attached. */
export interface DiagnosticDraft {
  code: string;
  category: StoryDiagnosticsCategory;
  severity: StoryDiagnostic['severity'];
  message: string;
  evidence: StorySourceSpan[];
  relatedRefs: StoryReference[];
  suggestedResolution: string | null;
}

export interface DiagnosticContext {
  input: StoryDiagnosticsInput;
  chapters: DiagnosticChapterSnapshot[];
  scenes: DiagnosticSceneSnapshot[];
  chapterById: Map<string, DiagnosticChapterSnapshot>;
  sceneById: Map<string, DiagnosticSceneSnapshot>;
  sceneOrder: Map<string, number>;
  characterById: Map<string, DiagnosticCharacterSnapshot>;
  locationById: Map<string, DiagnosticLocationSnapshot>;
  activeArtifacts: StoryArtifact[];
  artifactsById: Map<string, StoryArtifact>;
  diagnostics: DiagnosticDraft[];
  add: (draft: DiagnosticDraft) => void;
}

export type SdkStoryDiagnostic = StoryDiagnostic;
export type SdkStoryDiagnosticsResult = StoryDiagnosticsResult;
export type DiagnosticJsonValue = JsonValue;
