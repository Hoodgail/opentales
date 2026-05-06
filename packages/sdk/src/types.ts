export type ChapterStatus = 'draft' | 'in-progress' | 'review' | 'final';
export type ObstacleType = 'internal' | 'external' | 'interpersonal';
export type AssetKind = 'image' | 'audio' | 'video' | 'document';
export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
export type CoverOrientation = 'landscape' | 'portrait';
export type ProjectVisibility = 'private' | 'public';
export type AiProviderKind = 'gateway' | 'openai-compatible' | 'github-copilot';
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
  relationships: CharacterRelationship[];
  assets: CharacterAsset[];
}

export interface Location {
  id: string;
  name: string;
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
  number: number;
  title: string;
  status: ChapterStatus;
  povCharacterId?: string;
  locationId?: string;
  summary: string;
  wordCount: number;
  content: string;
  publishedAt: string | null;
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
export type AiToolCallStatus = 'pending-approval' | 'approved' | 'rejected' | 'executed' | 'error';
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
  status: AiToolCallStatus;
  output: unknown;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface AiAgentSession {
  id: string;
  projectId: string;
  title: string;
  status: AiAgentSessionStatus;
  activePromptId: string | null;
  queue: AiAgentQueuedPrompt[];
  messages: AiAgentMessage[];
  toolCalls: AiAgentToolCall[];
  pendingToolCalls: AiAgentToolCall[];
  contextUsage: AiAgentContextUsage | null;
  error: string | null;
  updatedAt: string;
}

export interface AiAgentSessionSummary {
  id: string;
  projectId: string;
  title: string;
  status: AiAgentSessionStatus;
  messageCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface CreateAiAgentSessionInput {
  title?: string;
}

export interface QueueAiAgentPromptInput {
  prompt: string;
  model?: string;
  attachments?: AiAgentAttachmentInput[];
  /**
   * If true, cancels the active generation and runs this prompt next.
   */
  interrupt?: boolean;
}

export interface AiAgentSessionEvent {
  type: AiAgentSessionEventType;
  session: AiAgentSession;
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
