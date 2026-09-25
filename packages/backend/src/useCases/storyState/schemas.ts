import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  BuildAuthorizationScope,
  BuildManifest,
  BuildManifestArtifactSpec,
  BuildManifestPhase,
  CreateBuildRunInput,
  JsonObject,
  JsonValue,
  StoryArtifactType,
} from "@opentales/sdk";

export const STORY_SCHEMA_VERSION = "story-ir-v1";

const trimmedString = (label: string, max = 20_000) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long`);
const stringList = z.array(z.string().trim().min(1).max(2_000)).max(1_000);
const referenceSchema = z
  .object({
    type: trimmedString("Reference type", 100).describe(
      "Entity or artifact kind, for example character, location, scene-plan, or plot-thread. Never a relationship label such as sibling.",
    ),
    id: trimmedString("Reference id", 500).describe(
      "Copy an exact persisted identifier or stable content key from the input artifacts; never invent an opaque database ID.",
    ),
    key: z.string().trim().min(1).max(500).optional(),
    label: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
const sourceSpanSchema = z
  .object({
    chapterId: z.string().trim().min(1).max(500).optional(),
    sceneId: z.string().trim().min(1).max(500).optional(),
    artifactId: z.string().trim().min(1).max(500).optional(),
    unitId: z.string().trim().min(1).max(500).optional(),
    start: z.number().int().min(0).optional(),
    end: z.number().int().min(0).optional(),
    quote: z.string().max(4_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.end === undefined ||
      value.start === undefined ||
      value.end >= value.start,
    {
      message: "Source span end must be greater than or equal to start",
    },
  );

const storyBriefSchema = z
  .object({
    premise: trimmedString("Premise"),
    genre: trimmedString("Genre", 500),
    targetAudience: z.string().trim().max(500).optional(),
    tone: stringList,
    promises: stringList,
    constraints: stringList,
    thematicQuestion: z.string().trim().max(2_000).optional(),
    targetWordCount: z.number().int().min(1_000).max(1_000_000).optional(),
    minWordCount: z.number().int().min(1_000).max(1_000_000).optional(),
    maxWordCount: z.number().int().min(1_000).max(1_000_000).optional(),
    targetChapterCount: z.number().int().min(1).max(500).optional(),
    targetSceneCount: z.number().int().min(1).max(5_000).optional(),
    targetCharacterCount: z.number().int().min(1).max(1_000).optional(),
  })
  .strict();

const narrativeContractSchema = z
  .object({
    pov: trimmedString("POV", 500),
    tense: trimmedString("Tense", 500),
    narrativeDistance: trimmedString("Narrative distance", 500),
    sentenceRhythm: trimmedString("Sentence rhythm", 1_000),
    diction: trimmedString("Diction", 1_000),
    metaphorDensity: trimmedString("Metaphor density", 500),
    interiority: trimmedString("Interiority", 500),
    dialogueCompression: trimmedString("Dialogue compression", 500),
    expositionStyle: trimmedString("Exposition style", 1_000),
    descriptionDensity: trimmedString("Description density", 500),
    contentConstraints: stringList,
  })
  .strict();

const characterBibleSchema = z
  .object({
    characterKey: trimmedString("Character key", 500),
    name: trimmedString("Character name", 500),
    aliases: z
      .array(z.string().trim().min(1).max(500))
      .max(1_000)
      .refine(
        (values) =>
          new Set(values.map((value) => value.toLocaleLowerCase())).size ===
          values.length,
        "Character aliases must be unique",
      ),
    role: z.string().trim().max(500).optional(),
    wants: stringList,
    needs: stringList,
    contradictions: stringList,
    backstory: z.string().max(20_000).optional(),
    arc: z.string().max(20_000).optional(),
    voice: z.string().max(10_000).optional(),
    knowledge: stringList,
    secrets: stringList,
    relationships: z
      .array(referenceSchema.extend({ type: z.literal("character") }))
      .max(1_000)
      .describe(
        "References to other characters. Put sibling, parent, friend, etc. in label; type must be character.",
      ),
  })
  .strict();

const relationshipGraphSchema = z
  .object({
    nodes: z.array(referenceSchema).min(1).max(5_000),
    edges: z
      .array(
        z
          .object({
            key: trimmedString("Relationship key", 500),
            from: referenceSchema,
            to: referenceSchema,
            type: trimmedString("Relationship type", 500),
            description: z.string().max(5_000).optional(),
            state: z.string().max(2_000).optional(),
          })
          .strict(),
      )
      .max(20_000),
  })
  .strict();

const worldBibleSchema = z
  .object({
    rules: z
      .array(
        z
          .object({
            key: trimmedString("Rule key", 500),
            statement: trimmedString("Rule"),
          })
          .strict(),
      )
      .max(5_000),
    institutions: z
      .array(
        z
          .object({
            key: trimmedString("Institution key", 500),
            name: trimmedString("Institution name", 500),
            description: trimmedString("Institution description"),
          })
          .strict(),
      )
      .max(5_000),
    geography: z
      .array(
        z
          .object({
            key: trimmedString("Geography key", 500),
            name: trimmedString("Geography name", 500),
            description: trimmedString("Geography description"),
          })
          .strict(),
      )
      .max(5_000),
    factions: z
      .array(
        z
          .object({
            key: trimmedString("Faction key", 500),
            name: trimmedString("Faction name", 500),
            description: trimmedString("Faction description"),
          })
          .strict(),
      )
      .max(5_000),
    terminology: z
      .array(
        z
          .object({
            term: trimmedString("Term", 500),
            definition: trimmedString("Definition"),
          })
          .strict(),
      )
      .max(10_000),
    technologyOrMagicConstraints: stringList,
  })
  .strict();

const plotThreadSchema = z
  .object({
    threadKey: trimmedString("Plot thread key", 500),
    kind: z.enum([
      "main",
      "subplot",
      "character-arc",
      "mystery",
      "romance",
      "thematic",
      "other",
    ]),
    summary: trimmedString("Plot thread summary"),
    stakes: z.string().max(5_000).optional(),
    characterRefs: z.array(referenceSchema).max(1_000),
    beatKeys: stringList,
    setupPayoffKeys: stringList,
    resolution: z.string().max(10_000).optional(),
  })
  .strict();

const beatSchema = z
  .object({
    beatKey: trimmedString("Beat key", 500),
    title: trimmedString("Beat title", 1_000),
    function: trimmedString("Beat function", 5_000),
    causeKeys: stringList.describe(
      "Exact beatKey values of causal predecessor beats, never descriptions or backstory. Use [] when no beat causes this beat.",
    ),
    consequenceKeys: stringList.describe(
      "Exact beatKey values of consequence beats, never prose. Use [] when no linked beat exists.",
    ),
    threadRefs: z.array(referenceSchema).max(1_000),
    expectedPayoff: z.string().max(5_000).optional(),
  })
  .strict();

const actArchitectureSchema = z
  .object({
    acts: z
      .array(
        z
          .object({
            actKey: trimmedString("Act key", 500),
            title: trimmedString("Act title", 1_000),
            purpose: trimmedString("Act purpose", 5_000),
            entryState: trimmedString("Act entry state", 5_000),
            exitState: trimmedString("Act exit state", 5_000),
            beatKeys: stringList,
            chapterKeys: stringList,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

const chapterBriefSchema = z
  .object({
    chapterKey: trimmedString("Chapter key", 500),
    number: z.number().int().min(1).max(10_000),
    title: trimmedString("Chapter title", 1_000),
    actKey: z.string().trim().min(1).max(500).optional(),
    purpose: trimmedString("Chapter purpose", 10_000),
    povRef: referenceSchema.optional(),
    sceneKeys: stringList,
    threadRefs: z.array(referenceSchema).max(1_000),
    entryState: z.record(z.string(), z.unknown()),
    exitState: z.record(z.string(), z.unknown()),
    targetWordCount: z.number().int().min(100).max(100_000).optional(),
  })
  .strict();

const scenePlanSchema = z
  .object({
    sceneKey: trimmedString("Scene key", 500),
    chapterKey: trimmedString("Chapter key", 500),
    ordinal: z.number().int().min(1).max(100_000),
    title: z.string().trim().max(1_000).optional(),
    povRef: referenceSchema.optional(),
    locationRef: referenceSchema.optional(),
    storyDate: z.iso
      .date()
      .optional()
      .describe(
        "Exact YYYY-MM-DD calendar date only. Omit when unknown; put relative labels such as final morning in entryState instead.",
      ),
    storyTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
      .optional()
      .describe(
        "Exact 24-hour HH:MM or HH:MM:SS start time only, without AM/PM or ranges. Put durations in entryState.",
      ),
    estimatedWordCount: z.number().int().min(0).max(1_000_000).optional(),
    function: trimmedString("Scene function", 5_000),
    goal: trimmedString("Scene goal", 5_000),
    obstacle: trimmedString("Scene obstacle", 5_000),
    stakes: trimmedString("Scene stakes", 5_000),
    conflict: trimmedString("Scene conflict", 10_000),
    turn: trimmedString("Scene turn", 10_000),
    outcome: trimmedString("Scene outcome", 10_000),
    emotionalValueShift: trimmedString("Emotional value shift", 5_000),
    tension: z.number().min(0).max(1),
    dependencies: stringList,
    characterRefs: z.array(referenceSchema).max(1_000),
    plotThreadRefs: z.array(referenceSchema).max(1_000),
    setupPayoffRefs: z.array(referenceSchema).max(1_000),
    revelations: stringList,
    characterPresentIds: stringList.optional(),
    characterReferencedIds: stringList.optional(),
    knowledgeDeltas: z.unknown().optional(),
    objectTransfers: z.unknown().optional(),
    injuryStateChanges: z.unknown().optional(),
    worldRuleRefs: z.unknown().optional(),
    summary: z.string().max(20_000).optional(),
    writerNotes: z.string().max(50_000).optional(),
    aiNotes: z.string().max(50_000).optional(),
    entryState: z.record(z.string(), z.unknown()),
    exitState: z.record(z.string(), z.unknown()),
  })
  .strict();

const timelineSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            eventKey: trimmedString("Timeline event key", 500),
            title: trimmedString("Timeline event title", 1_000),
            chronology: z.unknown(),
            dependencyKeys: stringList,
            sceneRef: referenceSchema.optional(),
            participantRefs: z.array(referenceSchema).max(1_000),
          })
          .strict(),
      )
      .max(100_000),
  })
  .strict();

const setupPayoffMapSchema = z
  .object({
    links: z
      .array(
        z
          .object({
            key: trimmedString("Setup/payoff key", 500),
            description: trimmedString("Setup/payoff description", 10_000),
            setupRef: referenceSchema,
            reinforcementRefs: z.array(referenceSchema).max(1_000),
            payoffRef: referenceSchema.optional(),
            threadRef: referenceSchema.optional(),
          })
          .strict(),
      )
      .max(100_000),
  })
  .strict();

const questionSetSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            key: trimmedString("Question key", 500),
            question: trimmedString("Question", 5_000),
            priority: z.enum(["low", "medium", "high", "critical"]),
            status: z.enum(["open", "answered", "deferred"]),
            answer: z.string().max(20_000).optional(),
            references: z.array(referenceSchema).max(1_000),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();

const chapterDraftSchema = z
  .object({
    chapterKey: trimmedString("Chapter key", 500),
    chapterId: z.string().trim().min(1).max(500).optional(),
    planArtifactId: trimmedString("Plan artifact id", 500),
    writingBranchId: trimmedString("Writing branch id", 500),
    writingVersionId: trimmedString("Writing version id", 500),
    wordCount: z.number().int().min(0),
    summary: trimmedString("Chapter summary", 10_000),
  })
  .strict();

const revisionIssueSchema = z
  .object({
    code: trimmedString("Issue code", 500),
    severity: z.enum(["info", "warning", "error"]),
    category: trimmedString("Issue category", 500),
    message: trimmedString("Issue message", 10_000),
    evidence: z.array(sourceSpanSchema).max(1_000),
    candidateResolution: z.string().max(20_000).optional(),
  })
  .strict();

const finalePlanSchema = z
  .object({
    finaleKey: trimmedString("Finale key", 500),
    mainThreadKey: trimmedString("Main thread key", 500),
    resolvesMainThread: z.literal(true),
    climax: trimmedString("Finale climax", 20_000),
    endingCost: trimmedString("Ending cost", 10_000),
    thematicResolution: trimmedString("Thematic resolution", 10_000),
    intentionallyOpenLoopKeys: stringList,
  })
  .strict();

const exportManifestSchema = z
  .object({
    compilationId: trimmedString("Compilation id", 500),
    totalWordCount: z.number().int().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    outputs: z
      .array(
        z
          .object({
            format: z.enum([
              "docx",
              "pdf",
              "epub",
              "markdown",
              "text",
              "html",
              "project-archive",
            ]),
            assetId: trimmedString("Export asset id", 500),
            mimeType: trimmedString("Export MIME type", 500),
            checksum: z.string().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    generatedAt: z.string().datetime(),
  })
  .strict();

export const ARTIFACT_CONTENT_SCHEMAS: Record<StoryArtifactType, z.ZodType> = {
  "story-brief": storyBriefSchema,
  "narrative-contract": narrativeContractSchema,
  "character-bible": characterBibleSchema,
  "relationship-graph": relationshipGraphSchema,
  "world-bible": worldBibleSchema,
  "plot-thread": plotThreadSchema,
  "act-architecture": actArchitectureSchema,
  "chapter-brief": chapterBriefSchema,
  "scene-plan": scenePlanSchema,
  timeline: timelineSchema,
  "setup-payoff-map": setupPayoffMapSchema,
  "research-questions": questionSetSchema,
  "open-questions": questionSetSchema,
  beat: beatSchema,
  "chapter-draft": chapterDraftSchema,
  "revision-issue": revisionIssueSchema,
  "finale-plan": finalePlanSchema,
  "export-manifest": exportManifestSchema,
};

export const ARTIFACT_TYPES = Object.freeze(
  Object.keys(ARTIFACT_CONTENT_SCHEMAS) as StoryArtifactType[],
);

export const authorizationScopeSchema = z
  .object({
    artifactTypes: z
      .array(
        z.enum(ARTIFACT_TYPES as [StoryArtifactType, ...StoryArtifactType[]]),
      )
      .max(100),
    chapterIds: z.array(z.string().trim().min(1).max(500)).max(100_000),
    sceneIds: z.array(z.string().trim().min(1).max(500)).max(500_000),
    allowPlanningArtifacts: z.boolean(),
    allowCanonWrites: z.boolean(),
    allowChapterWrites: z.boolean(),
    allowSceneWrites: z.boolean(),
    allowDiagnostics: z.boolean(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export function validateArtifactContent(
  type: StoryArtifactType,
  content: unknown,
): JsonObject {
  const parsed = ARTIFACT_CONTENT_SCHEMAS[type].parse(content);
  assertJsonValue(parsed);
  return parsed as JsonObject;
}

export function assertJsonValue(
  value: unknown,
  path = "$",
): asserts value is JsonValue {
  if (
    value === null ||
    ["string", "number", "boolean"].includes(typeof value)
  ) {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (child === undefined) throw new Error(`${path}.${key} is undefined`);
      assertJsonValue(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} is not valid JSON`);
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
