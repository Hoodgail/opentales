export type ChapterStatus = 'draft' | 'in-progress' | 'review' | 'final';
export type SceneStatus = 'planned' | 'draft' | 'in-progress' | 'review' | 'revised' | 'final';
export type ObstacleType = 'internal' | 'external' | 'interpersonal';
export type AssetKind = 'image' | 'audio' | 'video' | 'document';
export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
export type CoverOrientation = 'landscape' | 'portrait';
export type ProjectVisibility = 'private' | 'public';
export type AiProviderKind = 'gateway' | 'openai-compatible' | 'github-copilot' | 'codex';
export type ProjectMcpApiKeyPermission = 'read-only' | 'read-write';
export type AiRewriteMode = 'tighter' | 'softer' | 'more-visceral' | 'more-lyrical';
export type ProjectDocKind = 'note' | 'brainstorm' | 'instructions' | 'reference' | 'other';
export type CollaborationDocumentKind =
  | 'chapter'
  | 'character'
  | 'location'
  | 'structure'
  | 'obstacle'
  | 'doc'
  | 'ai-skill';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  name?: string;
}

export interface LoginInput {
  emailOrUsername: string;
  password: string;
}

export interface CharacterRelationship {
  id: string;
  characterId: string;
  type: string;
  note: string;
}

export interface CharacterAsset {
  id: string;
  assetId: string;
  role: string;
  order: number | null;
  kind: AssetKind;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  age: string;
  occupation: string;
  avatar?: string;
  avatarAssetId?: string;
  description: string;
  appearance: string;
  motivation: string;
  arc: string;
  traits: string[];
  aliases: string[];
  relationships: CharacterRelationship[];
  assets: CharacterAsset[];
}

export interface Location {
  id: string;
  name: string;
  aliases: string[];
  type: string;
  image?: string;
  imageAssetId?: string;
  description: string;
  atmosphere: string;
  significance: string;
  sensoryDetails: string;
}

export interface Asset {
  id: string;
  projectId: string | null;
  folderId?: string | null;
  name?: string | null;
  kind: AssetKind;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface Chapter {
  id: string;
  writingId: string;
  branchId: string | null;
  headVersionId: string | null;
  number: number;
  title: string;
  status: ChapterStatus;
  povCharacterId?: string;
  locationId?: string;
  summary: string;
  wordCount: number;
  content: string;
  publishedAt: string | null;
  scenes: Scene[];
}

export interface Scene {
  id: string;
  writingId: string;
  branchId: string | null;
  headVersionId: string | null;
  chapterId: string;
  order: number;
  title: string;
  status: SceneStatus;
  povCharacterId: string | null;
  locationId: string | null;
  storyDate: string | null;
  storyTime: string | null;
  estimatedWordCount: number | null;
  actualWordCount: number;
  sceneFunction: string;
  goal: string;
  obstacle: string;
  stakes: string;
  conflict: string;
  turn: string;
  revelation: string;
  outcome: string;
  emotionalValueShift: string;
  tension: number | null;
  characterPresentIds: string[];
  characterReferencedIds: string[];
  plotThreadIds: string[];
  setupPayoffIds: string[];
  knowledgeDeltas: JsonValue | null;
  objectTransfers: JsonValue | null;
  injuryStateChanges: JsonValue | null;
  worldRuleRefs: JsonValue | null;
  entryState: JsonValue | null;
  exitState: JsonValue | null;
  summary: string;
  writerNotes: string;
  aiNotes: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ProjectDoc {
  id: string;
  projectId: string;
  folderId?: string | null;
  title: string;
  path?: string;
  kind: ProjectDocKind;
  content: string;
  wordCount: number;
  order?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFolder {
  id: string;
  projectId: string;
  parentFolderId: string | null;
  name: string;
  path: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTreeAsset extends Asset {
  folderId: string | null;
  name: string;
  path: string;
  order: number;
}

export interface ProjectFileTree {
  folders: ProjectFolder[];
  docs: ProjectDoc[];
  assets: ProjectTreeAsset[];
}

export interface CollaborationDocumentRef {
  kind: CollaborationDocumentKind;
  entityId: string;
  field: string;
}

export interface CollaborationUser {
  id: string;
  username: string;
  name: string | null;
}

export interface CollaborationTextChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

export interface CollaborationEditInput {
  clientId: string;
  baseRevision: number;
  changes: CollaborationTextChange[];
  selection?: {
    lineNumber: number;
    column: number;
  } | null;
  focused?: boolean;
  location?: CollaborationLocation | null;
}

export interface CollaborationEdit {
  id: string;
  clientId: string;
  revision: number;
  user: CollaborationUser;
  changes: CollaborationTextChange[];
  selection: CollaborationEditInput['selection'];
}

export interface CollaborationPresence {
  clientId: string;
  user: CollaborationUser;
  selection: CollaborationEditInput['selection'];
  document: CollaborationDocumentRef;
  focused: boolean;
  location: CollaborationLocation | null;
  updatedAt: string;
}

export interface CollaborationPresenceInput {
  clientId: string;
  selection?: CollaborationEditInput['selection'];
  focused?: boolean;
  location?: CollaborationLocation | null;
}

export interface CollaborationLeaveInput {
  clientId: string;
}

export interface CollaborationLocation {
  tabType: 'chapter' | 'character' | 'location' | 'structure' | 'outline' | 'submission' | 'doc' | 'ai-skill' | 'ai-approval' | 'settings';
  refId: string;
  title: string;
  field?: string;
}

export interface CollaborationSnapshot {
  document: CollaborationDocumentRef;
  revision: number;
  content: string;
  collaborators: CollaborationPresence[];
}

export type CollaborationDocumentEvent =
  | { type: 'snapshot'; snapshot: CollaborationSnapshot }
  | { type: 'edit'; edit: CollaborationEdit }
  | { type: 'presence'; presence: CollaborationPresence }
  | { type: 'leave'; clientId: string };

export type CollaborationEvent =
  | CollaborationDocumentEvent
  | { type: 'project-presence'; collaborators: CollaborationPresence[] }
  | { type: 'document-event'; document: CollaborationDocumentRef; event: CollaborationDocumentEvent };

export interface PaginatedProjectDocs {
  items: ProjectDoc[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
}

export interface ListProjectDocsInput {
  limit?: number;
  offset?: number;
  folderId?: string | null;
  kind?: ProjectDocKind;
}

export interface CreateProjectDocInput {
  title: string;
  folderId?: string | null;
  kind?: ProjectDocKind;
  content?: string;
  order?: number;
}

export interface UpdateProjectDocInput {
  title?: string;
  folderId?: string | null;
  kind?: ProjectDocKind;
  content?: string;
  order?: number;
}

export interface CreateProjectFolderInput {
  name: string;
  parentFolderId?: string | null;
  order?: number;
}

export interface UpdateProjectFolderInput {
  name?: string;
  parentFolderId?: string | null;
  order?: number;
}

export interface UpdateProjectAssetInput {
  name?: string;
  folderId?: string | null;
  order?: number;
}

export interface Act {
  id: string;
  title: string;
  chapterIds: string[];
}

export interface Obstacle {
  id: string;
  title: string;
  type: ObstacleType;
  description: string;
  resolution: string;
}

export interface StoryStructure {
  title: string;
  genre: string;
  perspective: string;
  pov: string;
  voice: string;
  tone: string;
  themes: string[];
  logline: string;
  outline: string;
  climax: string;
  obstacles: Obstacle[];
}

export interface ProjectSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  genre: string;
  updatedAt: string;
  visibility: ProjectVisibility;
  coverUrl: string | null;
  coverOrientation: CoverOrientation;
}

export interface ManuscriptProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  visibility: ProjectVisibility;
  coverUrl: string | null;
  coverAssetId: string | null;
  coverOrientation: CoverOrientation;
  orgSlug: string;
  characters: Character[];
  locations: Location[];
  chapters: Chapter[];
  docs: ProjectDoc[];
  acts: Act[];
  structure: StoryStructure;
}

export type PatchProjectResult = ProjectSummary;
export type PatchChapterResult = Chapter;
export type PatchSceneResult = Scene;
export type PatchCharacterResult = Character;
export type PatchLocationResult = Location;
export type PatchStructureResult = StoryStructure;
export type PatchObstacleResult = Obstacle;

export interface PublicChapter {
  id: string;
  number: number;
  title: string;
  summary: string;
  wordCount: number;
  content: string;
  publishedAt: string;
}

export interface PublicProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  genre: string;
  orgSlug: string;
  orgName: string;
  coverUrl: string | null;
  coverOrientation: CoverOrientation;
  publishedAt: string | null;
  chapters: PublicChapter[];
}

export interface TrashItem {
  kind: 'chapter';
  id: string;
  title: string;
  number: number;
  wordCount: number;
  /** ISO timestamp when the item was moved to trash. */
  deletedAt: string;
  /** ISO timestamp when the item is scheduled to be permanently purged. */
  purgesAt: string;
}

export interface ProjectStatsDay {
  /** ISO date (YYYY-MM-DD) in UTC. */
  date: string;
  /** Words added that day, summed across all writings in the project. */
  wordsAdded: number;
  /** Number of writing-version snapshots created that day. */
  versions: number;
}

export interface ProjectStats {
  projectId: string;
  /** Sum of head-version word counts across non-trashed chapters. */
  totalWords: number;
  totalWordsAddedInWindow: number;
  totalVersionsInWindow: number;
  /** Consecutive days (ending today) with at least one word added. */
  currentStreakDays: number;
  windowDays: number;
  days: ProjectStatsDay[];
}

export interface ProjectStorageUsage {
  projectId: string;
  assetBytes: number;
  writingContentBytes: number;
  writingBodyAssetBytes: number;
  totalBytes: number;
  assetCount: number;
  writingVersionCount: number;
  writingBodyAssetCount: number;
}

export interface ProjectAiSettings {
  projectId: string;
  enabled: boolean;
  providerKind: AiProviderKind;
  model: string;
  baseUrl: string | null;
  hasApiKey: boolean;
  updatedAt: string | null;
}

export interface ProjectMcpApiKey {
  id: string;
  projectId: string;
  name: string;
  permission: ProjectMcpApiKeyPermission;
  prefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateProjectMcpApiKeyInput {
  name: string;
  permission?: ProjectMcpApiKeyPermission;
  expiresAt?: string | null;
}

export interface CreateProjectMcpApiKeyResult {
  key: ProjectMcpApiKey;
  /** The bearer secret is returned exactly once and cannot be retrieved later. */
  secret: string;
}

export interface UpdateProjectAiSettingsInput {
  enabled?: boolean;
  providerKind?: AiProviderKind;
  model?: string;
  baseUrl?: string | null;
  /**
   * Write-only. Omit to keep the existing key, pass null to clear it.
   */
  apiKey?: string | null;
}

export interface StartGithubCopilotAuthResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface PollGithubCopilotAuthInput {
  deviceCode: string;
}

export interface PollGithubCopilotAuthResult {
  status: 'pending' | 'slow_down' | 'authorized' | 'failed';
  interval?: number;
  settings?: ProjectAiSettings;
  message?: string;
}

export interface StartCodexAuthResult {
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface PollCodexAuthInput {
  deviceAuthId: string;
  userCode: string;
}

export interface PollCodexAuthResult {
  status: 'pending' | 'authorized' | 'failed';
  interval?: number;
  settings?: ProjectAiSettings;
  message?: string;
}

export interface AiModelCatalogApi {
  id: string;
  url: string | null;
  npm: string | null;
}

export interface AiModelCatalogCost {
  input: number | null;
  output: number | null;
}

export interface AiModelCatalogModel {
  id: string;
  providerId: string;
  name: string;
  family: string;
  releaseDate: string | null;
  status: string;
  api: AiModelCatalogApi;
  cost: AiModelCatalogCost | null;
  context: number | null;
  maxInput: number | null;
  maxOutput: number | null;
  supportsTools: boolean;
  supportsVision: boolean;
  latest: boolean;
  visible: boolean;
}

export interface AiModelCatalogProvider {
  id: string;
  name: string;
  api: string | null;
  npm: string | null;
  popular: boolean;
  models: AiModelCatalogModel[];
}

export interface AiModelCatalog {
  providers: AiModelCatalogProvider[];
  updatedAt: string;
  source: 'models.dev' | 'unavailable';
}

export interface ProjectAiSkill {
  id: string;
  projectId: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectAiSkillInput {
  name: string;
  description: string;
  content?: string;
  enabled?: boolean;
}

export interface UpdateProjectAiSkillInput {
  name?: string;
  description?: string;
  content?: string;
  enabled?: boolean;
}

export interface AiContinuityIssue {
  severity: 'info' | 'warning' | 'error';
  title: string;
  evidence: string;
  earlierContext: string;
  suggestion: string;
}

export interface AiContinuityReview {
  summary: string;
  issues: AiContinuityIssue[];
  postedActivityId?: string;
}

export interface AiRewriteSuggestion {
  original: string;
  suggested: string;
  mode: AiRewriteMode;
  rationale: string;
}

export interface CreateAiRewriteSuggestionInput {
  text: string;
  mode: AiRewriteMode;
  context?: string;
}

export interface CreateAiCharacterDialogueInput {
  characterId: string;
  situation: string;
  count?: number;
}

export interface AiCharacterDialogueSuggestion {
  characterId: string;
  characterName: string;
  lines: string[];
  notes: string;
}

export interface CreateAiOutlineExpansionInput {
  synopsis: string;
  targetLength?: 'short' | 'medium' | 'long';
  povCharacterId?: string;
  locationId?: string;
}

export interface AiOutlineExpansion {
  draft: string;
  label: 'AI draft';
  acceptRequiresEdits: true;
  notes: string;
}

export interface AiToolDescriptor {
  name: string;
  description: string;
  requiresApproval: boolean;
  inputSchema: Record<string, unknown>;
}

export interface AiToolManifest {
  tools: AiToolDescriptor[];
}

export type AiAgentSessionStatus = 'idle' | 'running' | 'cancelled' | 'error';
export type AiAgentApprovalMode = 'manual' | 'auto';
export type AiToolCallStatus = 'pending-approval' | 'approved' | 'rejected' | 'running' | 'executed' | 'error';
export type AiAgentSessionEventType =
  | 'session'
  | 'prompt-queued'
  | 'prompt-started'
  | 'text-delta'
  | 'tool-call'
  | 'tool-result'
  | 'tool-approval'
  | 'question-asked'
  | 'question-answered'
  | 'subtask-started'
  | 'subtask-finished'
  | 'prompt-finished'
  | 'error';

export interface AiAgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string | null;
  attachments?: AiAgentAttachment[];
  createdAt: string;
}

export interface AiAgentSubtaskPart {
  sessionId: string;
  /** Provider tool-call identity for correlating task lifecycle parts. */
  toolCallId?: string | null;
  description: string;
  subagentType: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  output?: unknown;
  outputTruncated?: boolean;
  outputBytes?: number;
  error?: string | null;
}

export type AiAgentTimelineChronology = 'exact' | 'approximate' | 'mixed';

/** Describes the fidelity and server-side windowing of `AiAgentSession.timeline`. */
export interface AiAgentTimelineInfo {
  mode: AiAgentTimelineChronology;
  truncated: boolean;
  earliestSequence: number | null;
  hasMoreBefore: boolean;
  /** Cursor for loading older best-effort legacy history after the initial snapshot. */
  legacyCursor?: string | null;
}

interface AiAgentSessionPartBase {
  id: string;
  sequence: number;
  promptId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A durable, ordered projection of an agent session. Contiguous assistant text
 * is deliberately split around tool and subtask activity so consumers can
 * render the conversation in the order it actually happened.
 */
export type AiAgentSessionPart =
  | (AiAgentSessionPartBase & {
      kind: 'message';
      message: AiAgentMessage;
    })
  | (AiAgentSessionPartBase & {
      kind: 'text';
      messageId: string;
      content: string;
      streaming: boolean;
    })
  | (AiAgentSessionPartBase & {
      kind: 'tool-call' | 'tool-result';
      toolCall: AiAgentToolCall;
    })
  | (AiAgentSessionPartBase & {
      kind: 'task';
      task: AiAgentSubtaskPart;
    });

export interface GetAiAgentTimelineInput {
  /** Return durable parts with sequence values strictly below this cursor. */
  beforeSequence?: number;
  /** Requested page size; the server may clamp this to its configured maximum. */
  limit?: number;
  /** Opaque cursor used only for best-effort pre-sequencing legacy history. */
  legacyCursor?: string;
}

export interface AiAgentTimelinePage {
  parts: AiAgentSessionPart[];
  timelineInfo: AiAgentTimelineInfo;
  nextBeforeSequence: number | null;
  nextLegacyCursor?: string | null;
  hasMore: boolean;
  limitation?: 'legacy-history-best-effort';
}

export interface AiAgentQueuedPrompt {
  id: string;
  prompt: string;
  model?: string | null;
  attachments?: AiAgentAttachment[];
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'error';
  createdAt: string;
}

export interface AiAgentAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: AssetKind;
  sizeBytes: number;
  url?: string;
  assetId?: string;
  reference?: AiAgentProjectReference;
}

export interface AiAgentAttachmentInput extends AiAgentAttachment {
  base64?: string;
}

export type AiAgentProjectReferenceType =
  | 'folder'
  | 'doc'
  | 'asset'
  | 'chapter'
  | 'character'
  | 'location'
  | 'act'
  | 'structure'
  | 'obstacle';

export interface AiAgentProjectReference {
  type: AiAgentProjectReferenceType;
  id: string;
  path?: string;
  startLine?: number;
  endLine?: number;
}

export interface AiAgentContextUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  model: string | null;
}

export interface AiAgentToolCall {
  id: string;
  toolCallId: string | null;
  toolName: string;
  input: unknown;
  inputTruncated?: boolean;
  inputBytes?: number;
  status: AiToolCallStatus;
  output: unknown;
  /** True when `output` is a bounded preview; fetch the tool-call detail for the full value. */
  outputTruncated?: boolean;
  outputBytes?: number;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface AiAgentSession {
  id: string;
  projectId: string;
  title: string;
  approvalMode?: AiAgentApprovalMode;
  status: AiAgentSessionStatus;
  activePromptId: string | null;
  queue: AiAgentQueuedPrompt[];
  messages: AiAgentMessage[];
  toolCalls: AiAgentToolCall[];
  timeline?: AiAgentSessionPart[];
  timelineInfo?: AiAgentTimelineInfo;
  pendingToolCalls: AiAgentToolCall[];
  activeBuildRunId?: string | null;
  contextUsage: AiAgentContextUsage | null;
  error: string | null;
  updatedAt: string;
}

export interface AiAgentSessionSummary {
  id: string;
  projectId: string;
  title: string;
  approvalMode?: AiAgentApprovalMode;
  status: AiAgentSessionStatus;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface CreateAiAgentSessionInput {
  title?: string;
  buildRunId?: string | null;
  approvalMode?: AiAgentApprovalMode;
}

export interface UpdateAiAgentSessionInput {
  approvalMode: AiAgentApprovalMode;
}

export interface QueueAiAgentPromptInput {
  prompt: string;
  model?: string;
  attachments?: AiAgentAttachmentInput[];
  /** Bind this prompt and any delegated tasks to a known Novel Build. */
  buildRunId?: string | null;
  /**
   * If true, cancels the active generation and runs this prompt next.
   */
  interrupt?: boolean;
}

export interface AiAgentSessionEvent {
  type: AiAgentSessionEventType;
  /** Omitted for high-frequency incremental patches such as text deltas. */
  session?: AiAgentSession;
  data?: unknown;
}

export interface ApproveAiToolCallInput {
  approved: boolean;
}

export interface ApproveAiToolCallsInput {
  toolCallIds: string[];
  approved: boolean;
}

export interface AiQuestionOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface AiQuestionPrompt {
  question: string;
  header: string;
  options: AiQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface AskUserToolInput {
  questions: AiQuestionPrompt[];
}

export interface AnswerAiQuestionInput {
  answers: string[][];
}

export interface OrgMember {
  userId: string;
  username: string;
  email: string;
  name: string | null;
  role: Role;
  joinedAt: string;
}

export interface ProjectInvite {
  id: string;
  username: string | null;
  email: string | null;
  role: Role;
  token: string;
  expiresAt: string;
  invitedById: string;
  invitedByUsername: string;
  createdAt: string;
}

export interface MembersAndInvites {
  members: OrgMember[];
  invites: ProjectInvite[];
  currentUserRole: Role;
}

export interface CreateInviteInput {
  username?: string;
  email?: string;
  role: Role;
}

export interface AcceptInviteResult {
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: Role;
  projectId: string | null;
  projectSlug: string | null;
  projectTitle: string | null;
}

export interface CreateProjectInput {
  title: string;
  slug?: string;
  description?: string;
  genre?: string;
  perspective?: string;
  pov?: string;
  voice?: string;
  tone?: string;
  themes?: string[];
}

export interface UpdateProjectInput {
  title?: string;
  slug?: string;
  description?: string | null;
  genre?: string | null;
  perspective?: string | null;
  pov?: string | null;
  voice?: string | null;
  tone?: string | null;
  themes?: string[];
  visibility?: ProjectVisibility;
  coverAssetId?: string | null;
  coverOrientation?: CoverOrientation;
}

export type UpdateChapterInput = Partial<
  Pick<Chapter, 'title' | 'status' | 'povCharacterId' | 'locationId' | 'summary' | 'content'>
> & {
  publishedAt?: string | null;
};
export type UpdateCharacterInput = Partial<Omit<Character, 'id' | 'relationships' | 'assets'>> & {
  avatarAssetId?: string | null;
};
export type UpdateLocationInput = Partial<Omit<Location, 'id'>> & {
  imageAssetId?: string | null;
};
export type UpdateStructureInput = Partial<StoryStructure>;

export interface CreateActInput {
  title: string;
}

export interface UpdateActInput {
  title?: string;
  chapterIds?: string[];
}

export interface CreateCharacterInput {
  name: string;
  role?: string;
  age?: string;
  occupation?: string;
  traits?: string[];
  aliases?: string[];
  description?: string;
  appearance?: string;
  motivation?: string;
  arc?: string;
}

export interface AttachCharacterAssetInput {
  assetId: string;
  role?: string;
  order?: number | null;
}

export interface CreateLocationInput {
  name: string;
  aliases?: string[];
  type?: string;
  description?: string;
  atmosphere?: string;
  significance?: string;
  sensoryDetails?: string;
}

export interface CreateChapterInput {
  title: string;
  actId?: string;
  status?: ChapterStatus;
  povCharacterId?: string;
  locationId?: string;
  summary?: string;
  content?: string;
}

export interface CreateSceneInput {
  title?: string;
  order?: number;
  status?: SceneStatus;
  povCharacterId?: string | null;
  locationId?: string | null;
  storyDate?: string | null;
  storyTime?: string | null;
  estimatedWordCount?: number | null;
  sceneFunction?: string;
  goal?: string;
  obstacle?: string;
  stakes?: string;
  conflict?: string;
  turn?: string;
  revelation?: string;
  outcome?: string;
  emotionalValueShift?: string;
  tension?: number | null;
  characterPresentIds?: string[];
  characterReferencedIds?: string[];
  plotThreadIds?: string[];
  setupPayoffIds?: string[];
  knowledgeDeltas?: JsonValue | null;
  objectTransfers?: JsonValue | null;
  injuryStateChanges?: JsonValue | null;
  worldRuleRefs?: JsonValue | null;
  entryState?: JsonValue | null;
  exitState?: JsonValue | null;
  summary?: string;
  writerNotes?: string;
  aiNotes?: string;
  content?: string;
}

export type UpdateSceneInput = Partial<CreateSceneInput> & { expectedRevision: number };

export interface DeleteSceneInput {
  expectedRevision?: number;
}

export interface ReorderScenesInput {
  sceneIds: string[];
  expectedRevisions: Record<string, number>;
  buildRunId?: string;
}

export interface CreateObstacleInput {
  title: string;
  type: ObstacleType;
  description?: string;
  resolution?: string;
}

export interface UpdateObstacleInput {
  title?: string;
  type?: ObstacleType;
  description?: string;
  resolution?: string;
  order?: number;
}

export interface CreateCharacterRelationshipInput {
  toCharacterId: string;
  type: string;
  note?: string;
}

export type SubmissionKind = 'chapter-edit' | 'new-chapter';
export type SubmissionStatus = 'open' | 'merged' | 'declined';
export type ActivityType =
  | 'submission-opened'
  | 'submission-merged'
  | 'submission-declined'
  | 'comment-added'
  | 'ai-review-posted';

export interface SubmissionAuthor {
  id: string;
  username: string;
  name: string | null;
}

export interface SubmissionSummary {
  id: string;
  projectId: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  title: string;
  message: string | null;
  chapterId: string | null;
  chapterTitle: string | null;
  proposedTitle: string | null;
  proposedNumber: number | null;
  proposedActId: string | null;
  author: SubmissionAuthor;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: SubmissionAuthor | null;
}

export interface SubmissionActivity {
  id: string;
  type: ActivityType;
  content: unknown;
  author: SubmissionAuthor | null;
  createdAt: string;
}

export interface SubmissionDetail extends SubmissionSummary {
  // Snapshot of chapter body at the moment the submission was created.
  baseBody: string;
  // Latest body in the submission's branch (the proposed change).
  headBody: string;
  activities: SubmissionActivity[];
}

export interface CreateSubmissionInput {
  kind: SubmissionKind;
  title: string;
  message?: string;
  // For chapter-edit: required.
  chapterId?: string;
  // The proposed full body (will be saved as a version on a fresh branch).
  body: string;
  // For new-chapter: required.
  proposedTitle?: string;
  proposedNumber?: number;
  proposedActId?: string | null;
}

export interface SubmissionCommentAnchor {
  // Inclusive 1-indexed line numbers within the rendered diff.
  lineStart: number;
  lineEnd: number;
  // Which side of the diff the anchor refers to.
  side: 'base' | 'head';
}

export interface AddSubmissionCommentInput {
  body: string;
  // Optional anchor to a specific line range within the diff. When set, the
  // comment renders as a thread next to those lines instead of in the timeline.
  anchor?: SubmissionCommentAnchor;
}

export interface BetaShareLink {
  id: string;
  projectId: string;
  token: string;
  // Empty array means the entire manuscript is shared.
  chapterIds: string[];
  allowComments: boolean;
  label: string | null;
  createdById: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CreateBetaShareLinkInput {
  label?: string;
  // ISO date string. Omit / null for no expiration.
  expiresAt?: string | null;
  allowComments?: boolean;
  chapterIds?: string[];
}

export interface UpdateBetaShareLinkInput {
  label?: string | null;
  expiresAt?: string | null;
  allowComments?: boolean;
  chapterIds?: string[];
}

export interface BetaShareChapter {
  id: string;
  number: number;
  title: string;
  summary: string;
  wordCount: number;
  content: string;
}

export interface BetaShareComment {
  id: string;
  visitorName: string;
  body: string;
  chapterId: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  createdAt: string;
}

export interface BetaShareView {
  projectTitle: string;
  projectDescription: string;
  shareLabel: string | null;
  allowComments: boolean;
  expiresAt: string | null;
  chapters: BetaShareChapter[];
  comments: BetaShareComment[];
}

export interface CreateBetaShareCommentInput {
  visitorName: string;
  body: string;
  chapterId?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
}

// Durable Novel Build and structured story-state contracts.
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type BuildAutonomyMode = 'assist' | 'plan-review' | 'autonomous-draft';
export type BuildRunStatus =
  | 'planning'
  | 'drafting'
  | 'revising'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type BuildTaskStatus =
  | 'blocked'
  | 'ready'
  | 'running'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled';
export type StoryArtifactType =
  | 'story-brief'
  | 'narrative-contract'
  | 'character-bible'
  | 'relationship-graph'
  | 'world-bible'
  | 'plot-thread'
  | 'act-architecture'
  | 'chapter-brief'
  | 'scene-plan'
  | 'timeline'
  | 'setup-payoff-map'
  | 'research-questions'
  | 'open-questions'
  | 'beat'
  | 'chapter-draft'
  | 'revision-issue'
  | 'finale-plan'
  | 'export-manifest';
export type StoryArtifactStatus =
  | 'draft'
  | 'validated'
  | 'accepted'
  | 'superseded'
  | 'invalidated';
export type CanonFactStatus =
  | 'proposed'
  | 'canonical'
  | 'disputed'
  | 'retracted'
  | 'invalidated';
export type EntityStateStatus = 'proposed' | 'active' | 'superseded' | 'invalidated';
export type OpenLoopKind =
  | 'promise'
  | 'question'
  | 'clue'
  | 'setup'
  | 'mystery'
  | 'foreshadowing'
  | 'other';
export type OpenLoopStatus = 'open' | 'reinforced' | 'resolved' | 'abandoned' | 'invalidated';
export type SetupPayoffStatus =
  | 'planned'
  | 'setup'
  | 'reinforced'
  | 'paid-off'
  | 'abandoned'
  | 'invalidated';
export type PlotThreadKind =
  | 'main'
  | 'subplot'
  | 'character-arc'
  | 'mystery'
  | 'romance'
  | 'thematic'
  | 'other';
export type PlotThreadStatus = 'planned' | 'active' | 'resolved' | 'abandoned' | 'invalidated';
export type BuildTraceStatus = 'started' | 'completed' | 'failed';
export type BuildEvaluationKind = 'deterministic' | 'model' | 'human';

export interface StoryReference {
  type: string;
  id: string;
  key?: string;
  label?: string;
}

export interface StorySourceSpan {
  chapterId?: string;
  sceneId?: string;
  artifactId?: string;
  unitId?: string;
  branchId?: string;
  writingVersionId?: string;
  start?: number;
  end?: number;
  lineStart?: number;
  lineEnd?: number;
  quote?: string;
}

export interface StoryBriefContent {
  premise: string;
  genre: string;
  targetAudience?: string;
  tone: string[];
  promises: string[];
  constraints: string[];
  thematicQuestion?: string;
  targetWordCount?: number;
  minWordCount?: number;
  maxWordCount?: number;
  targetChapterCount?: number;
  targetSceneCount?: number;
  targetCharacterCount?: number;
}

export interface NarrativeContractContent {
  pov: string;
  tense: string;
  narrativeDistance: string;
  sentenceRhythm: string;
  diction: string;
  metaphorDensity: string;
  interiority: string;
  dialogueCompression: string;
  expositionStyle: string;
  descriptionDensity: string;
  contentConstraints: string[];
}

export interface CharacterBibleContent {
  characterKey: string;
  name: string;
  aliases: string[];
  role?: string;
  wants: string[];
  needs: string[];
  contradictions: string[];
  backstory?: string;
  arc?: string;
  voice?: string;
  knowledge: string[];
  secrets: string[];
  relationships: StoryReference[];
}

export interface ScenePlanContent {
  sceneKey: string;
  chapterKey: string;
  ordinal: number;
  title?: string;
  povRef?: StoryReference;
  locationRef?: StoryReference;
  storyDate?: string;
  storyTime?: string;
  estimatedWordCount?: number;
  function: string;
  goal: string;
  obstacle: string;
  stakes: string;
  conflict: string;
  turn: string;
  outcome: string;
  emotionalValueShift: string;
  tension: number;
  dependencies: string[];
  characterRefs: StoryReference[];
  plotThreadRefs: StoryReference[];
  setupPayoffRefs: StoryReference[];
  revelations: string[];
  characterPresentIds?: string[];
  characterReferencedIds?: string[];
  knowledgeDeltas?: JsonValue;
  objectTransfers?: JsonValue;
  injuryStateChanges?: JsonValue;
  worldRuleRefs?: JsonValue;
  summary?: string;
  writerNotes?: string;
  aiNotes?: string;
  entryState: JsonObject;
  exitState: JsonObject;
}

export type KnownStoryArtifactContent =
  | StoryBriefContent
  | NarrativeContractContent
  | CharacterBibleContent
  | ScenePlanContent
  | JsonObject;

export interface BuildManifestArtifactSpec {
  type: StoryArtifactType;
  key: string;
  required: boolean;
  minCount: number;
  maxCount?: number;
  dependsOn: string[];
}

export interface BuildManifestPhase {
  key: string;
  title: string;
  taskKeys: string[];
  checkpoint: boolean;
}

export interface BuildManifest {
  version: string;
  sourceBrainstormHash: string;
  target: JsonObject;
  artifactSpecs: BuildManifestArtifactSpec[];
  phases: BuildManifestPhase[];
}

export interface BuildAuthorizationScope {
  artifactTypes: StoryArtifactType[];
  chapterIds: string[];
  sceneIds: string[];
  allowPlanningArtifacts: boolean;
  allowCanonWrites: boolean;
  allowChapterWrites: boolean;
  allowSceneWrites: boolean;
  allowDiagnostics: boolean;
  expiresAt?: string | null;
}

export interface BuildProgress {
  percent: number;
  total: number;
  blocked: number;
  ready: number;
  running: number;
  review: number;
  done: number;
  failed: number;
  cancelled: number;
}

export interface BuildTaskTransition {
  id: string;
  taskId: string;
  fromStatus: BuildTaskStatus;
  toStatus: BuildTaskStatus;
  idempotencyKey: string;
  reason: string | null;
  metadata: JsonValue | null;
  createdAt: string;
}

export interface BuildTask {
  id: string;
  buildRunId: string;
  key: string;
  type: string;
  phase: string;
  status: BuildTaskStatus;
  dependencyIds: string[];
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  scopeUnitIds: string[];
  assignedAgent: string;
  skillVersions: JsonObject;
  acceptanceCriteria: JsonValue;
  executionPolicy: JsonValue;
  attempts: number;
  maxAttempts: number;
  revisionIteration: number;
  maxRevisionIterations: number;
  qualityThreshold: number | null;
  priority: number;
  progress: number;
  revision: number;
  leaseOwner: string | null;
  leaseGeneration: number;
  runGeneration: number;
  reservedTokens: number;
  reservedCostMicros: number;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  invalidatedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  transitions: BuildTaskTransition[];
}

export interface BuildCheckpoint {
  id: string;
  projectId: string;
  buildRunId: string;
  taskId: string | null;
  sequence: number;
  label: string;
  phase: string;
  stateSnapshot: JsonValue;
  contentHash: string;
  createdAt: string;
}

export interface BuildRun {
  id: string;
  projectId: string;
  objective: string;
  brainstorm: string;
  manifest: BuildManifest;
  autonomyMode: BuildAutonomyMode;
  status: BuildRunStatus;
  currentPhase: string;
  workflowVersion: string;
  branchName: string;
  authorizationScope: BuildAuthorizationScope;
  maxTokens: number | null;
  tokensUsed: number;
  tokensReserved: number;
  maxCostMicros: number | null;
  costMicrosUsed: number;
  costMicrosReserved: number;
  revision: number;
  executionGeneration: number;
  lastError: string | null;
  authorizedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  progress: BuildProgress;
  tasks: BuildTask[];
  latestCheckpoint: BuildCheckpoint | null;
  activeDirective: BuildDirective | null;
}

export interface BuildDirective {
  id: string;
  projectId: string;
  buildRunId: string;
  fromTaskId: string;
  checkpointId: string | null;
  directive: string;
  pinnedArtifactIds: string[];
  createdAt: string;
}

export interface ReplanBuildInput {
  idempotencyKey: string;
  expectedRevision: number;
  fromTaskId: string;
  checkpointId?: string | null;
  directive: string;
  pinnedArtifactIds?: string[];
}

export interface BranchBuildFromCheckpointInput extends ReplanBuildInput {
  checkpointId: string;
}

export interface ReplanBuildResult {
  buildRun: BuildRun;
  directive: BuildDirective;
  invalidatedTaskIds: string[];
  invalidatedArtifactIds: string[];
  preservedArtifactIds: string[];
}

export interface CreateBuildRunInput {
  idempotencyKey: string;
  brainstorm: string;
  objective?: string;
  targetWordCount?: number;
  minWordCount?: number;
  maxWordCount?: number;
  targetChapterCount?: number;
  targetSceneCount?: number;
  targetCharacterCount?: number;
  genre?: string;
  targetAudience?: string;
  tone?: string[];
  constraints?: string[];
  autonomyMode?: BuildAutonomyMode;
  authorizationScope?: Partial<BuildAuthorizationScope>;
  maxTokens?: number | null;
  maxCostMicros?: number | null;
  workflowVersion?: string;
}

export interface BuildLifecycleInput {
  idempotencyKey: string;
  expectedRevision: number;
  reason?: string;
}

export interface AuthorizeBuildRunInput extends BuildLifecycleInput {
  authorizationScope: BuildAuthorizationScope;
  maxTokens?: number | null;
  maxCostMicros?: number | null;
}

export interface ClaimBuildTaskInput {
  idempotencyKey: string;
  workerId: string;
  leaseMs?: number;
  taskTypes?: string[];
  reserveTokens?: number;
  reserveCostMicros?: number;
}

export interface BuildTaskLease {
  taskId: string;
  workerId: string;
  leaseToken: string;
  leaseGeneration: number;
  runGeneration: number;
  expiresAt: string;
}

export interface BuildTaskLeaseInput {
  taskId: string;
  workerId: string;
  leaseToken: string;
  leaseGeneration: number;
  runGeneration: number;
}

export interface HeartbeatBuildTaskInput {
  idempotencyKey: string;
  workerId: string;
  leaseToken: string;
  leaseGeneration: number;
  runGeneration: number;
  expectedRevision: number;
  leaseMs?: number;
  progress?: number;
}

export interface CompleteBuildTaskInput {
  idempotencyKey: string;
  workerId: string;
  leaseToken: string;
  leaseGeneration: number;
  runGeneration: number;
  expectedRevision: number;
  outputArtifactIds?: string[];
  result?: JsonValue;
  qualityScore?: number;
  createCheckpoint?: boolean;
}

export interface FailBuildTaskInput {
  idempotencyKey: string;
  workerId: string;
  leaseToken: string;
  leaseGeneration: number;
  runGeneration: number;
  expectedRevision: number;
  error: string;
  retryable?: boolean;
}

export interface BuildTaskActionResult {
  buildRun: BuildRun;
  task: BuildTask;
  unblockedTaskIds: string[];
  invalidatedTaskIds: string[];
  checkpoint: BuildCheckpoint | null;
  lease: BuildTaskLease | null;
}

export interface RecoverBuildTasksInput {
  idempotencyKey: string;
}

export interface RecoverBuildTasksResult {
  buildRun: BuildRun;
  recoveredTaskIds: string[];
  failedTaskIds: string[];
}

export interface CreateChapterBuildTasksInput {
  idempotencyKey: string;
  chapterKey: string;
  chapterId?: string;
  chapterBriefArtifactId: string;
  scenePlanArtifactIds: string[];
}

export interface BuildWritingBranch {
  id: string;
  buildRunId: string;
  writingId: string;
  name: string;
  parentBranchId: string | null;
  headVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuildWritingBranchInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  writingId?: string;
  chapterId?: string;
  sceneId?: string;
}

export interface ApplyBuildWritingPatchInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  branchId: string;
  expectedHeadVersionId: string | null;
  body: string;
  message?: string;
  taskId?: string | null;
  lease: BuildTaskLeaseInput;
}

export interface ApplyBuildWritingPatchResult {
  branch: BuildWritingBranch;
  writingVersionId: string;
  wordCount: number;
  buildRevision: number;
}

export type BuildManuscriptUnitKind = 'chapter' | 'scene';
export type BuildManuscriptUnitStatus = 'planned' | 'drafting' | 'review' | 'accepted' | 'invalidated';

export interface BuildManuscriptUnit {
  id: string;
  projectId: string;
  buildRunId: string;
  sourceTaskId: string | null;
  planArtifactId: string | null;
  parentUnitId: string | null;
  sourceChapterId: string | null;
  sourceSceneId: string | null;
  writingId: string;
  branchId: string;
  headVersionId: string | null;
  kind: BuildManuscriptUnitKind;
  status: BuildManuscriptUnitStatus;
  key: string;
  containerKey: string;
  order: number;
  chapterNumber: number | null;
  title: string;
  povCharacterId: string | null;
  locationId: string | null;
  storyDate: string | null;
  storyTime: string | null;
  tension: number | null;
  metadata: JsonValue;
  revision: number;
  body: string;
  wordCount: number;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuildManuscriptUnitInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  lease?: BuildTaskLeaseInput;
  kind: BuildManuscriptUnitKind;
  key: string;
  parentUnitId?: string | null;
  sourceChapterId?: string | null;
  sourceSceneId?: string | null;
  planArtifactId: string;
  order: number;
  chapterNumber?: number | null;
  title: string;
  povCharacterId?: string | null;
  locationId?: string | null;
  storyDate?: string | null;
  storyTime?: string | null;
  tension?: number | null;
  metadata?: JsonValue;
  initialBody?: string;
}

export interface PatchBuildManuscriptUnitInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  expectedUnitRevision: number;
  expectedHeadVersionId: string | null;
  lease?: BuildTaskLeaseInput;
  body?: string;
  title?: string;
  status?: BuildManuscriptUnitStatus;
  tension?: number | null;
  metadata?: JsonValue;
  message?: string;
}

export interface ReorderBuildManuscriptUnitsInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  parentUnitId: string;
  unitIds: string[];
  expectedUnitRevisions: Record<string, number>;
}

export interface BuildCompilationUnit {
  id: string;
  unitId: string;
  writingVersionId: string;
  order: number;
  wordCount: number;
  contentHash: string;
}

export interface BuildCompilation {
  id: string;
  projectId: string;
  buildRunId: string;
  checkpointId: string | null;
  exportManifestArtifactId: string | null;
  manifest: JsonValue;
  totalWordCount: number;
  contentHash: string;
  chapterDraftArtifactIds: string[];
  createdAt: string;
  units: BuildCompilationUnit[];
}

export interface CompileBuildManuscriptInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  checkpointId?: string | null;
  lease?: BuildTaskLeaseInput;
  exportManifestArtifactId?: string | null;
}

export interface BuildProseDiff {
  unitId: string;
  unitKey: string;
  kind: BuildManuscriptUnitKind;
  title: string;
  mainRefId: string | null;
  mainVersionId: string | null;
  buildVersionId: string | null;
  mainBody: string;
  buildBody: string;
  wordDelta: number;
  changed: boolean;
}

export interface BuildSemanticDiff {
  addedCanonFactIds: string[];
  changedEntityStateIds: string[];
  timelineEventIds: string[];
  unresolvedOpenLoopIds: string[];
  activePlotThreadIds: string[];
}

export interface BuildComparison {
  projectId: string;
  buildRunId: string;
  compilationId: string | null;
  prose: BuildProseDiff[];
  semantic: BuildSemanticDiff;
}

export type BuildReviewStatus = 'open' | 'approved' | 'merged' | 'rejected';
export type BuildReviewUnitAction = 'create' | 'update';

export interface BuildReviewUnit {
  id: string;
  unitId: string;
  action: BuildReviewUnitAction;
  targetChapterId: string | null;
  targetSceneId: string | null;
  expectedMainHeadVersionId: string | null;
  sourceBuildVersionId: string;
  reviewedUnitRevision: number;
  reviewedUnitSnapshot: JsonValue;
  reviewedUnitSnapshotHash: string;
  /** Prose read from the exact frozen sourceBuildVersionId, never the mutable branch head. */
  reviewedBody: string;
  reviewedWordCount: number;
  reviewedContentHash: string;
  resultMainVersionId: string | null;
  order: number;
}

export interface BuildReview {
  id: string;
  projectId: string;
  buildRunId: string;
  compilationId: string;
  checkpointId: string | null;
  title: string;
  message: string | null;
  status: BuildReviewStatus;
  revision: number;
  approvedAt: string | null;
  mergedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  units: BuildReviewUnit[];
}

export interface CreateBuildReviewInput {
  idempotencyKey: string;
  compilationId: string;
  checkpointId?: string | null;
  title: string;
  message?: string;
}

export interface ApproveBuildReviewInput {
  idempotencyKey: string;
  expectedRevision: number;
  confirm: true;
}

export interface MergeBuildReviewInput {
  idempotencyKey: string;
  expectedRevision: number;
  confirm: true;
}

export interface RejectBuildReviewInput {
  idempotencyKey: string;
  expectedRevision: number;
  confirm: true;
  reason: string;
}

export interface UnpinBuildArtifactsInput {
  idempotencyKey: string;
  expectedRevision: number;
  artifactIds: string[];
}

export interface RegisterBuildExportInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  compilationId: string;
  outputs: Array<{
    projectExportId: string;
    format: 'docx' | 'pdf' | 'epub' | 'markdown' | 'text' | 'html' | 'project-archive';
    assetId: string;
    mimeType: string;
    checksum?: string | null;
  }>;
}

export type ProjectExportFormat = 'docx' | 'pdf' | 'epub' | 'markdown' | 'text' | 'html' | 'project-archive';
export type ProjectExportPreset = 'standard-manuscript' | 'reading-copy' | 'ebook' | 'web' | 'archive';
export type ProjectExportStatus = 'pending' | 'generating' | 'ready' | 'failed' | 'deleted';
export type ProjectExportTarget =
  | { kind: 'main' }
  | { kind: 'build'; buildRunId: string; compilationId?: string | null };

export interface ProjectExportOptions {
  authorName?: string;
  includeTitlePage?: boolean;
  includeAssets?: boolean;
  chapterNumbering?: boolean;
}

export interface CreateProjectExportInput {
  idempotencyKey: string;
  format: ProjectExportFormat;
  preset: ProjectExportPreset;
  target: ProjectExportTarget;
  options?: ProjectExportOptions;
}

export interface ProjectExport {
  id: string;
  projectId: string;
  buildRunId: string | null;
  compilationId: string | null;
  assetId: string | null;
  regeneratedFromId: string | null;
  target: 'main' | 'build';
  format: ProjectExportFormat;
  preset: ProjectExportPreset;
  status: ProjectExportStatus;
  filename: string;
  mimeType: string | null;
  checksum: string | null;
  sizeBytes: number | null;
  options: ProjectExportOptions;
  provenance: JsonValue;
  branchHeads: JsonValue;
  error: string | null;
  downloadUrl: string | null;
  generatedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegenerateProjectExportInput {
  idempotencyKey: string;
}

export type ProjectImportFormat = 'docx' | 'markdown' | 'text' | 'html' | 'project-archive';
export type ProjectImportStatus = 'previewed' | 'applying' | 'applied' | 'failed';

export interface ImportPreviewScene {
  sourceId?: string | null;
  title: string | null;
  order: number;
  body: string;
  metadata?: JsonValue;
}

export interface ImportPreviewChapter {
  sourceId?: string | null;
  number: number;
  title: string;
  summary?: string | null;
  body: string;
  scenes: ImportPreviewScene[];
}

export interface ProjectImportConflict {
  kind: 'chapter-number' | 'chapter-title' | 'artifact-key';
  sourceKey: string;
  existingId: string;
  message: string;
}

export interface ProjectImportPreview {
  id: string;
  projectId: string;
  assetId: string | null;
  format: ProjectImportFormat;
  status: ProjectImportStatus;
  filename: string;
  mimeType: string;
  checksum: string;
  sizeBytes: number;
  chapters: ImportPreviewChapter[];
  conflicts: ProjectImportConflict[];
  sourceMetadata: JsonValue;
  expiresAt: string;
  appliedAt: string | null;
  applyResult: JsonValue | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PreviewProjectImportInput {
  idempotencyKey: string;
  file: Blob;
  filename?: string;
  mimeType?: string;
}

export interface ApplyProjectImportInput {
  idempotencyKey: string;
  confirmConflicts: boolean;
  restoreStructuredState?: boolean;
  targetBuildRunId?: string | null;
}

export interface StoryArtifact {
  id: string;
  projectId: string;
  buildRunId: string;
  taskId: string | null;
  type: StoryArtifactType;
  key: string;
  title: string;
  version: number;
  schemaVersion: string;
  status: StoryArtifactStatus;
  content: KnownStoryArtifactContent;
  contentHash: string;
  replacesArtifactId: string | null;
  acceptedAt: string | null;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  bindings?: StoryArtifactBinding[];
}

export type StoryArtifactBindingKind = 'build-unit' | 'entity' | 'ledger';

export interface StoryArtifactBinding {
  id: string;
  projectId: string;
  buildRunId: string;
  artifactId: string;
  taskId: string | null;
  unitId: string | null;
  bindingKind: StoryArtifactBindingKind;
  entityType: string | null;
  entityId: string | null;
  role: string;
  createdAt: string;
}

export interface CreateStoryArtifactBindingInput {
  bindingKind: StoryArtifactBindingKind;
  unitId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  role: string;
}

export interface StoryArtifactLink {
  id: string;
  projectId: string;
  buildRunId: string;
  fromArtifactId: string;
  toArtifactId: string;
  relationType: string;
  metadata: JsonValue | null;
  createdAt: string;
}

export interface ListStoryArtifactsInput {
  types?: StoryArtifactType[];
  statuses?: StoryArtifactStatus[];
  taskId?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedStoryArtifacts {
  items: StoryArtifact[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
}

export interface CreateStoryArtifactInput {
  taskId?: string | null;
  type: StoryArtifactType;
  key: string;
  title: string;
  schemaVersion?: string;
  status?: Extract<StoryArtifactStatus, 'draft' | 'validated' | 'accepted'>;
  content: KnownStoryArtifactContent;
  bindings?: CreateStoryArtifactBindingInput[];
}

export type StoryArtifactBatchOperation =
  | { op: 'create'; artifact: CreateStoryArtifactInput }
  | {
      op: 'replace';
      artifactId: string;
      expectedVersion: number;
      artifact: CreateStoryArtifactInput;
    }
  | {
      op: 'set-status';
      artifactId: string;
      expectedVersion: number;
      status: Extract<StoryArtifactStatus, 'draft' | 'validated' | 'accepted'>;
    }
  | { op: 'invalidate'; artifactId: string; expectedVersion: number; reason?: string }
  | {
      op: 'link';
      fromArtifactId: string;
      toArtifactId: string;
      relationType: string;
      metadata?: JsonValue;
    }
  | { op: 'unlink'; fromArtifactId: string; toArtifactId: string; relationType: string };

export interface ApplyStoryArtifactBatchInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  operations: StoryArtifactBatchOperation[];
}

export interface ApplyStoryArtifactBatchResult {
  buildRevision: number;
  artifacts: StoryArtifact[];
  links: StoryArtifactLink[];
  createdChapterTaskIds: string[];
}

export interface CanonFact {
  id: string;
  projectId: string;
  buildRunId: string;
  sourceArtifactId: string | null;
  sourceTaskId: string | null;
  sourceUnitId: string | null;
  supersedesFactId: string | null;
  key: string;
  version: number;
  isCurrent: boolean;
  subjectType: string;
  subjectId: string;
  predicate: string;
  object: JsonValue;
  status: CanonFactStatus;
  validFromSceneId: string | null;
  validToSceneId: string | null;
  validFromOrder: number | null;
  validToOrder: number | null;
  sourceChapterId: string | null;
  sourceSceneId: string | null;
  sourceSpan: StorySourceSpan | null;
  confidence: number;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntityState {
  id: string;
  projectId: string;
  buildRunId: string;
  sourceArtifactId: string | null;
  sourceTaskId: string | null;
  sourceUnitId: string | null;
  sourceFactId: string | null;
  supersedesStateId: string | null;
  key: string;
  version: number;
  isCurrent: boolean;
  entityType: string;
  entityId: string;
  stateKey: string;
  value: JsonValue;
  status: EntityStateStatus;
  validFromSceneId: string | null;
  validToSceneId: string | null;
  validFromOrder: number | null;
  validToOrder: number | null;
  storyOrder: number | null;
  sourceSpan: StorySourceSpan | null;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  projectId: string;
  buildRunId: string;
  sourceArtifactId: string | null;
  sourceTaskId: string | null;
  sourceUnitId: string | null;
  supersedesEventId: string | null;
  key: string;
  version: number;
  isCurrent: boolean;
  title: string;
  description: string | null;
  chronology: JsonValue;
  sortOrder: number | null;
  chapterId: string | null;
  sceneId: string | null;
  dependencyIds: string[];
  participantRefs: StoryReference[];
  sourceSpan: StorySourceSpan | null;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenLoop {
  id: string;
  projectId: string;
  buildRunId: string;
  sourceTaskId: string | null;
  sourceUnitId: string | null;
  supersedesLoopId: string | null;
  key: string;
  version: number;
  isCurrent: boolean;
  kind: OpenLoopKind;
  status: OpenLoopStatus;
  title: string;
  description: string;
  introducedSceneId: string | null;
  resolvedSceneId: string | null;
  introducedArtifactId: string | null;
  resolvedArtifactId: string | null;
  targetPayoff: string | null;
  metadata: JsonValue | null;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SetupPayoffLink {
  id: string;
  projectId: string;
  buildRunId: string;
  sourceTaskId: string | null;
  sourceUnitId: string | null;
  supersedesLinkId: string | null;
  plotThreadId: string | null;
  key: string;
  version: number;
  isCurrent: boolean;
  title: string;
  description: string;
  status: SetupPayoffStatus;
  setupSceneId: string | null;
  payoffSceneId: string | null;
  reinforcementSceneIds: string[];
  setupArtifactId: string | null;
  payoffArtifactId: string | null;
  metadata: JsonValue | null;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlotThread {
  id: string;
  projectId: string;
  buildRunId: string;
  sourceArtifactId: string | null;
  sourceTaskId: string | null;
  sourceUnitId: string | null;
  supersedesThreadId: string | null;
  parentThreadId: string | null;
  key: string;
  version: number;
  isCurrent: boolean;
  title: string;
  kind: PlotThreadKind;
  status: PlotThreadStatus;
  summary: string;
  stakes: string | null;
  sceneIds: string[];
  introducedSceneId: string | null;
  resolvedSceneId: string | null;
  metadata: JsonValue | null;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UpsertCanonFactInput = Omit<
  CanonFact,
  'id' | 'projectId' | 'buildRunId' | 'sourceTaskId' | 'sourceUnitId' | 'supersedesFactId' | 'version' | 'isCurrent' | 'validFromOrder' | 'validToOrder' | 'invalidatedAt' | 'createdAt' | 'updatedAt'
> & { sourceUnitId?: string | null; validFromOrder?: number | null; validToOrder?: number | null };
export type UpsertEntityStateInput = Omit<
  EntityState,
  'id' | 'projectId' | 'buildRunId' | 'sourceTaskId' | 'sourceUnitId' | 'supersedesStateId' | 'version' | 'isCurrent' | 'validFromOrder' | 'validToOrder' | 'invalidatedAt' | 'createdAt' | 'updatedAt'
> & { sourceUnitId?: string | null; validFromOrder?: number | null; validToOrder?: number | null };
export type UpsertTimelineEventInput = Omit<
  TimelineEvent,
  'id' | 'projectId' | 'buildRunId' | 'sourceTaskId' | 'sourceUnitId' | 'supersedesEventId' | 'version' | 'isCurrent' | 'invalidatedAt' | 'createdAt' | 'updatedAt'
> & { sourceUnitId?: string | null };
export type UpsertOpenLoopInput = Omit<
  OpenLoop,
  'id' | 'projectId' | 'buildRunId' | 'sourceTaskId' | 'sourceUnitId' | 'supersedesLoopId' | 'version' | 'isCurrent' | 'invalidatedAt' | 'createdAt' | 'updatedAt'
> & { sourceUnitId?: string | null };
export type UpsertSetupPayoffLinkInput = Omit<
  SetupPayoffLink,
  'id' | 'projectId' | 'buildRunId' | 'sourceTaskId' | 'sourceUnitId' | 'supersedesLinkId' | 'version' | 'isCurrent' | 'invalidatedAt' | 'createdAt' | 'updatedAt'
> & { sourceUnitId?: string | null };
export type UpsertPlotThreadInput = Omit<
  PlotThread,
  'id' | 'projectId' | 'buildRunId' | 'sourceTaskId' | 'sourceUnitId' | 'supersedesThreadId' | 'version' | 'isCurrent' | 'invalidatedAt' | 'createdAt' | 'updatedAt'
> & { sourceUnitId?: string | null };

export type StoryStateEntityKind =
  | 'canon-fact'
  | 'entity-state'
  | 'timeline-event'
  | 'open-loop'
  | 'setup-payoff'
  | 'plot-thread';

export type StoryStateBatchOperation =
  | { op: 'upsert-canon-fact'; value: UpsertCanonFactInput }
  | { op: 'upsert-entity-state'; value: UpsertEntityStateInput }
  | { op: 'upsert-timeline-event'; value: UpsertTimelineEventInput }
  | { op: 'upsert-open-loop'; value: UpsertOpenLoopInput }
  | { op: 'upsert-setup-payoff'; value: UpsertSetupPayoffLinkInput }
  | { op: 'upsert-plot-thread'; value: UpsertPlotThreadInput }
  | { op: 'invalidate'; entityKind: StoryStateEntityKind; key: string; reason?: string }
  | { op: 'restore'; entityKind: StoryStateEntityKind; key: string; version: number };

export interface ApplyStoryStateBatchInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  operations: StoryStateBatchOperation[];
}

export interface StoryStateSnapshot {
  projectId: string;
  buildRunId: string;
  canonFacts: CanonFact[];
  entityStates: EntityState[];
  timelineEvents: TimelineEvent[];
  openLoops: OpenLoop[];
  setupPayoffs: SetupPayoffLink[];
  plotThreads: PlotThread[];
}

export interface GetStoryStateInput {
  sinceUpdatedAt?: string;
  limit?: number;
  offset?: number;
  includeHistory?: boolean;
}

export interface StoryStateDelta extends StoryStateSnapshot {
  generatedAt: string;
  sinceUpdatedAt: string | null;
  nextOffset: number | null;
}

export interface StoryStateHistoryResult {
  entityKind: StoryStateEntityKind;
  key: string;
  versions: Array<CanonFact | EntityState | TimelineEvent | OpenLoop | SetupPayoffLink | PlotThread>;
}

export interface TemporalStoryStateQuery {
  sceneId?: string;
  storyOrder?: number;
  entityType?: string;
  entityId?: string;
  predicate?: string;
  stateKey?: string;
  participantId?: string;
  limit?: number;
  offset?: number;
}

export interface TemporalStoryStateResult {
  storyOrder: number | null;
  canonFacts: CanonFact[];
  entityStates: EntityState[];
  timelineEvents: TimelineEvent[];
  totalTimelineEvents: number;
  nextTimelineOffset: number | null;
}

export interface ApplyStoryStateBatchResult extends StoryStateSnapshot {
  buildRevision: number;
}

export interface CreateBuildCheckpointInput {
  idempotencyKey: string;
  expectedBuildRevision: number;
  taskId?: string | null;
  label: string;
  phase?: string;
}

export interface BuildTrace {
  id: string;
  projectId: string;
  buildRunId: string;
  taskId: string | null;
  idempotencyKey: string;
  attempt: number;
  status: BuildTraceStatus;
  provider: string | null;
  model: string | null;
  modelParameters: JsonValue | null;
  workflowVersion: string;
  systemPromptVersion: string | null;
  skillVersions: JsonValue;
  toolSchemaVersions: JsonValue;
  inputs: JsonValue;
  retrievedArtifactIds: string[];
  contextTokenCount: number | null;
  toolCalls: JsonValue;
  toolResults: JsonValue;
  outputs: JsonValue;
  validatorResults: JsonValue;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
  latencyMs: number | null;
  retries: number;
  completionState: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export type AppendBuildTraceInput = Omit<BuildTrace, 'id' | 'projectId' | 'buildRunId'>;

export interface StartBuildTraceInput {
  taskId: string;
  idempotencyKey: string;
  attempt: number;
  provider?: string | null;
  model?: string | null;
  modelParameters?: JsonValue | null;
  workflowVersion: string;
  systemPromptVersion?: string | null;
  skillVersions: JsonValue;
  toolSchemaVersions: JsonValue;
  inputs: JsonValue;
  retrievedArtifactIds?: string[];
  contextTokenCount?: number | null;
  startedAt?: string;
}

export interface FinishBuildTraceInput {
  lease: BuildTaskLeaseInput;
  requestHash: string;
  status: Extract<BuildTraceStatus, 'completed' | 'failed'>;
  provider?: string | null;
  model?: string | null;
  modelParameters?: JsonValue | null;
  toolCalls: JsonValue;
  toolResults: JsonValue;
  outputs: JsonValue;
  validatorResults: JsonValue;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  latencyMs?: number | null;
  retries?: number;
  completionState?: string | null;
  error?: string | null;
  completedAt?: string;
}

export interface BuildEvaluationResult {
  id: string;
  projectId: string;
  buildRunId: string;
  taskId: string | null;
  artifactId: string | null;
  idempotencyKey: string;
  kind: BuildEvaluationKind;
  rubric: string;
  rubricVersion: string;
  scores: JsonValue;
  checks: JsonValue;
  passed: boolean;
  threshold: number | null;
  feedback: string | null;
  evidence: JsonValue | null;
  createdAt: string;
}

export type AppendBuildEvaluationInput = Omit<
  BuildEvaluationResult,
  'id' | 'projectId' | 'buildRunId' | 'createdAt'
>;

export interface BuildObservability {
  projectId: string;
  buildRunId: string;
  traces: BuildTrace[];
  evaluations: BuildEvaluationResult[];
  checkpoints: BuildCheckpoint[];
  directives: BuildDirective[];
}

export interface GetBuildObservabilityInput {
  taskId?: string;
  limit?: number;
  offset?: number;
}

export type StorySearchKind = StoryStateEntityKind | 'artifact' | 'build-unit' | 'chapter' | 'scene' | 'character' | 'location' | 'doc' | 'obstacle' | 'act' | 'story-structure' | 'relationship' | 'asset';

export interface SearchStoryInput {
  query: string;
  strategy?: 'hybrid' | 'fts' | 'exact' | 'regex' | 'semantic';
  kinds?: StorySearchKind[];
  artifactTypes?: StoryArtifactType[];
  statuses?: string[];
  fields?: string[];
  filters?: Record<string, string[]>;
  caseSensitive?: boolean;
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface StorySearchHit {
  kind: StorySearchKind;
  id: string;
  key: string | null;
  title: string;
  snippet: string;
  score: number;
  ref: StoryReference;
  sourceSpan: StorySourceSpan | null;
}

export interface StorySearchResult {
  query: string;
  strategyUsed: Exclude<NonNullable<SearchStoryInput['strategy']>, 'semantic'>;
  warnings: string[];
  hits: StorySearchHit[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  nextCursor: string | null;
}

export interface FindStoryReferencesInput {
  refType: string;
  refId: string;
  limit?: number;
  offset?: number;
}

export interface FindStoryReferencesResult {
  ref: StoryReference;
  hits: StoryReferenceHit[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
}

export type RenameSymbolTargetType = 'character' | 'location';
export type RenameSymbolScope = 'main' | 'build' | 'all';
export type RenameSymbolOccurrenceKind = 'canonical-writing' | 'build-writing' | 'artifact' | 'structured-label';

export interface PreviewRenameSymbolInput {
  targetType: RenameSymbolTargetType;
  targetId: string;
  newName: string;
  scope: RenameSymbolScope;
  buildRunId?: string | null;
  caseSensitive: boolean;
  includeAliases: string[];
  limit?: number;
}

export interface RenameSymbolExpectedHead {
  writingId: string;
  branchId: string;
  versionId: string;
  bodyHash: string;
}

export interface RenameSymbolOccurrence {
  id: string;
  kind: RenameSymbolOccurrenceKind;
  entityType: string;
  entityId: string;
  title: string;
  writingId: string | null;
  branchId: string | null;
  versionId: string | null;
  buildRunId: string | null;
  artifactId: string | null;
  unitId: string | null;
  field: string;
  start: number;
  end: number;
  matchedText: string;
  beforeSnippet: string;
  afterSnippet: string;
}

export interface RenameSymbolPreview {
  projectId: string;
  targetType: RenameSymbolTargetType;
  targetId: string;
  oldName: string;
  aliases: string[];
  newName: string;
  scope: RenameSymbolScope;
  buildRunId: string | null;
  caseSensitive: boolean;
  selectedNames: string[];
  occurrences: RenameSymbolOccurrence[];
  totalOccurrences: number;
  truncated: boolean;
  expectedHeads: RenameSymbolExpectedHead[];
  expectedRevisions: Record<string, string>;
  expectedEntityUpdatedAt: string;
  previewHash: string;
  conflicts: string[];
}

export interface ApplyRenameSymbolInput extends PreviewRenameSymbolInput {
  idempotencyKey: string;
  confirm: true;
  previewHash: string;
  expectedHeads: RenameSymbolExpectedHead[];
  expectedRevisions: Record<string, string>;
  expectedEntityUpdatedAt: string;
}

export interface ApplyRenameSymbolResult {
  previewHash: string;
  targetType: RenameSymbolTargetType;
  targetId: string;
  oldName: string;
  newName: string;
  aliases: string[];
  scope: RenameSymbolScope;
  buildRunId: string | null;
  appliedOccurrences: number;
  updatedBranches: Array<{ writingId: string; branchId: string; previousVersionId: string; newVersionId: string }>;
  updatedArtifactIds: string[];
  updatedUnitIds: string[];
  appliedAt: string;
}

export type NamedSnapshotScope = 'project' | 'chapter' | 'scene' | 'project-doc' | 'writing' | 'build-checkpoint' | 'build-compilation';

export interface SnapshotWritingHead {
  entityType: string;
  entityId: string;
  writingId: string;
  branchId: string;
  versionId: string;
  wordCount: number;
  bodyHash: string;
}

export interface CreateNamedSnapshotInput {
  idempotencyKey: string;
  label: string;
  message?: string | null;
  scope: NamedSnapshotScope;
  chapterId?: string | null;
  sceneId?: string | null;
  projectDocId?: string | null;
  writingId?: string | null;
  buildRunId?: string | null;
  checkpointId?: string | null;
  compilationId?: string | null;
}

export interface NamedSnapshot {
  id: string;
  projectId: string;
  createdById: string | null;
  label: string;
  message: string | null;
  scope: NamedSnapshotScope;
  chapterId: string | null;
  sceneId: string | null;
  projectDocId: string | null;
  writingId: string | null;
  buildRunId: string | null;
  checkpointId: string | null;
  compilationId: string | null;
  heads: SnapshotWritingHead[];
  structuredState: JsonValue;
  contentHash: string;
  sizeBytes: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface SnapshotListFilter { scope?: NamedSnapshotScope; includeDeleted?: boolean }
export interface CompareNamedSnapshotsInput { leftSnapshotId: string; rightSnapshotId?: string | null }
export interface SnapshotLineChange { kind: 'equal' | 'added' | 'removed'; leftStart: number; rightStart: number; lines: string[] }
export interface SnapshotProseDiff { writingId: string; entityType: string; entityId: string; leftVersionId: string | null; rightVersionId: string | null; leftWordCount: number; rightWordCount: number; wordDelta: number; changes: SnapshotLineChange[] }
export interface SnapshotSemanticChange { path: string; before: JsonValue | null; after: JsonValue | null }
export interface NamedSnapshotComparison { leftSnapshotId: string; rightSnapshotId: string | null; prose: SnapshotProseDiff[]; semantic: SnapshotSemanticChange[] }
export interface RestoreNamedSnapshotInput { idempotencyKey: string; confirm: true; expectedHeads: Record<string, string | null>; expectedEntityRevisions?: Record<string, number> }
export interface RestoreNamedSnapshotResult { snapshotId: string; restoredVersionIds: Record<string, string>; restoredAt: string }
export interface BranchFromNamedSnapshotInput { idempotencyKey: string; name: string }
export interface BranchFromNamedSnapshotResult { snapshotId: string; branches: Array<{ writingId: string; branchId: string; name: string; headVersionId: string }> }

export type WritingAnnotationKind = 'comment' | 'note' | 'suggestion';
export type WritingAnnotationStatus = 'open' | 'resolved' | 'accepted' | 'rejected';
export interface WritingAnnotationReply { id: string; threadId: string; authorId: string | null; body: string; createdAt: string }
export interface WritingAnnotationThread {
  id: string; projectId: string; writingId: string; branchId: string; anchorVersionId: string;
  authorId: string | null; resolvedById: string | null; acceptedVersionId: string | null;
  chapterId: string | null; sceneId: string | null; kind: WritingAnnotationKind; status: WritingAnnotationStatus;
  revision: number; start: number; end: number; quote: string; anchorHash: string; body: string;
  suggestedReplacement: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string;
  replies: WritingAnnotationReply[];
}
export interface ListWritingAnnotationsInput { writingId?: string; chapterId?: string; sceneId?: string; status?: WritingAnnotationStatus; kind?: WritingAnnotationKind }
export interface CreateWritingAnnotationInput {
  idempotencyKey: string; writingId: string; branchId: string; versionId: string; chapterId?: string | null; sceneId?: string | null;
  kind: WritingAnnotationKind; start: number; end: number; quote: string; anchorHash?: string; body: string; suggestedReplacement?: string | null;
}
export interface ReplyToWritingAnnotationInput { idempotencyKey: string; body: string }
export interface UpdateWritingAnnotationStatusInput { expectedRevision: number }
export interface AcceptWritingSuggestionInput { idempotencyKey: string; confirm: true; expectedRevision: number; expectedHeadVersionId: string }

export interface StoryReferenceHit extends StorySearchHit {
  path: string;
  relationship: string;
}

export type StoryDiagnosticSeverity = 'info' | 'warning' | 'error';
export type StoryDiagnosticCategory =
  | 'schema'
  | 'cross-link'
  | 'continuity'
  | 'chronology'
  | 'knowledge'
  | 'location'
  | 'world-rule'
  | 'setup-payoff'
  | 'plot'
  | 'workflow'
  | 'character'
  | 'pov'
  | 'pacing'
  | 'repetition'
  | 'dialogue'
  | 'style'
  | 'metadata'
  | 'publishing';

export interface StoryDiagnostic {
  id: string;
  code: string;
  category: StoryDiagnosticCategory;
  severity: StoryDiagnosticSeverity;
  message: string;
  evidence: StorySourceSpan[];
  relatedRefs: StoryReference[];
  suggestedResolution: string | null;
}

export interface StoryDiagnosticsResult {
  projectId: string;
  buildRunId: string;
  generatedAt: string;
  diagnostics: StoryDiagnostic[];
}
