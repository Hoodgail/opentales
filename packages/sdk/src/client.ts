import type {
  AcceptInviteResult,
  AttachCharacterAssetInput,
  Asset,
  AssetKind,
  AuthSession,
  AuthUser,
  BetaShareLink,
  BetaShareView,
  CreateActInput,
  CreateBetaShareCommentInput,
  CreateBetaShareLinkInput,
  CreateChapterInput,
  CreateCharacterInput,
  CreateCharacterRelationshipInput,
  CreateInviteInput,
  CreateLocationInput,
  CreateObstacleInput,
  CreateProjectDocInput,
  CreateProjectInput,
  LoginInput,
  ManuscriptProject,
  MembersAndInvites,
  AddSubmissionCommentInput,
  ApproveAiToolCallInput,
  ApproveAiToolCallsInput,
  AiAgentSessionEvent,
  AiAgentSession,
  AiAgentSessionSummary,
  AiCharacterDialogueSuggestion,
  AiContinuityReview,
  AiOutlineExpansion,
  AiRewriteSuggestion,
  AiToolManifest,
  CreateSubmissionInput,
  CreateAiCharacterDialogueInput,
  CreateAiAgentSessionInput,
  CreateAiOutlineExpansionInput,
  CreateAiRewriteSuggestionInput,
  CollaborationDocumentRef,
  CollaborationEditInput,
  CollaborationEvent,
  CollaborationLeaveInput,
  CollaborationPresenceInput,
  ListProjectDocsInput,
  PaginatedProjectDocs,
  QueueAiAgentPromptInput,
  PatchChapterResult,
  PatchCharacterResult,
  PatchLocationResult,
  PatchObstacleResult,
  PatchStructureResult,
  ProjectInvite,
  ProjectAiSettings,
  ProjectDoc,
  ProjectStats,
  ProjectSummary,
  PublicProject,
  RegisterInput,
  TrashItem,
  Role,
  SubmissionDetail,
  SubmissionStatus,
  SubmissionSummary,
  UpdateActInput,
  UpdateBetaShareLinkInput,
  UpdateChapterInput,
  UpdateCharacterInput,
  UpdateLocationInput,
  UpdateObstacleInput,
  UpdateProjectDocInput,
  UpdateProjectAiSettingsInput,
  UpdateProjectInput,
  UpdateStructureInput
} from './types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface OpenTalesClientOptions {
  baseUrl: string;
  token?: string;
  fetcher?: typeof fetch;
}

export class OpenTalesClient {
  private token?: string;
  readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: OpenTalesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.fetcher = options.fetcher ?? fetch;
  }

  setToken(token: string | undefined) {
    this.token = token;
  }

  async register(input: RegisterInput): Promise<AuthSession> {
    const session = await this.request<AuthSession>('/auth/register', {
      method: 'POST',
      body: input,
      auth: false
    });
    this.token = session.token;
    return session;
  }

  async login(input: LoginInput): Promise<AuthSession> {
    const session = await this.request<AuthSession>('/auth/login', {
      method: 'POST',
      body: input,
      auth: false
    });
    this.token = session.token;
    return session;
  }

  me(): Promise<AuthUser> {
    return this.request<AuthUser>('/auth/me');
  }

  listProjects(): Promise<ProjectSummary[]> {
    return this.request<ProjectSummary[]>('/projects');
  }

  createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    return this.request<ProjectSummary>('/projects', { method: 'POST', body: input });
  }

  getProject(projectId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}`);
  }

  updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectSummary> {
    return this.request<ProjectSummary>(`/projects/${projectId}`, { method: 'PATCH', body: input });
  }

  listMembers(projectId: string): Promise<MembersAndInvites> {
    return this.request<MembersAndInvites>(`/projects/${projectId}/members`);
  }

  updateMemberRole(projectId: string, userId: string, role: Role): Promise<MembersAndInvites> {
    return this.request<MembersAndInvites>(`/projects/${projectId}/members/${userId}`, {
      method: 'PATCH',
      body: { role }
    });
  }

  removeMember(projectId: string, userId: string): Promise<MembersAndInvites> {
    return this.request<MembersAndInvites>(`/projects/${projectId}/members/${userId}`, {
      method: 'DELETE'
    });
  }

  createInvite(projectId: string, input: CreateInviteInput): Promise<ProjectInvite> {
    return this.request<ProjectInvite>(`/projects/${projectId}/invites`, {
      method: 'POST',
      body: input
    });
  }

  revokeInvite(projectId: string, inviteId: string): Promise<MembersAndInvites> {
    return this.request<MembersAndInvites>(`/projects/${projectId}/invites/${inviteId}`, {
      method: 'DELETE'
    });
  }

  acceptInvite(token: string): Promise<AcceptInviteResult> {
    return this.request<AcceptInviteResult>(`/invites/accept`, {
      method: 'POST',
      body: { token }
    });
  }

  getPublicProject(orgSlug: string, projectSlug: string): Promise<PublicProject> {
    return this.request<PublicProject>(
      `/public/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}`
    );
  }

  listSubmissions(
    projectId: string,
    filter?: { status?: SubmissionStatus }
  ): Promise<SubmissionSummary[]> {
    const qs = filter?.status ? `?status=${encodeURIComponent(filter.status)}` : '';
    return this.request<SubmissionSummary[]>(`/projects/${projectId}/submissions${qs}`);
  }

  createSubmission(
    projectId: string,
    input: CreateSubmissionInput
  ): Promise<SubmissionSummary> {
    return this.request<SubmissionSummary>(`/projects/${projectId}/submissions`, {
      method: 'POST',
      body: input
    });
  }

  getSubmission(submissionId: string): Promise<SubmissionDetail> {
    return this.request<SubmissionDetail>(`/submissions/${submissionId}`);
  }

  mergeSubmission(submissionId: string): Promise<SubmissionDetail> {
    return this.request<SubmissionDetail>(`/submissions/${submissionId}/merge`, {
      method: 'PATCH'
    });
  }

  declineSubmission(submissionId: string): Promise<SubmissionDetail> {
    return this.request<SubmissionDetail>(`/submissions/${submissionId}/decline`, {
      method: 'PATCH'
    });
  }

  commentSubmission(
    submissionId: string,
    input: AddSubmissionCommentInput
  ): Promise<SubmissionDetail> {
    return this.request<SubmissionDetail>(`/submissions/${submissionId}/comments`, {
      method: 'POST',
      body: input
    });
  }

  listBetaShareLinks(projectId: string): Promise<BetaShareLink[]> {
    return this.request<BetaShareLink[]>(`/projects/${projectId}/share-links`);
  }

  createBetaShareLink(
    projectId: string,
    input: CreateBetaShareLinkInput
  ): Promise<BetaShareLink> {
    return this.request<BetaShareLink>(`/projects/${projectId}/share-links`, {
      method: 'POST',
      body: input
    });
  }

  updateBetaShareLink(
    projectId: string,
    shareLinkId: string,
    input: UpdateBetaShareLinkInput
  ): Promise<BetaShareLink> {
    return this.request<BetaShareLink>(
      `/projects/${projectId}/share-links/${shareLinkId}`,
      {
        method: 'PATCH',
        body: input
      }
    );
  }

  revokeBetaShareLink(projectId: string, shareLinkId: string): Promise<BetaShareLink> {
    return this.request<BetaShareLink>(
      `/projects/${projectId}/share-links/${shareLinkId}`,
      {
        method: 'DELETE'
      }
    );
  }

  // Public — no auth required.
  getBetaShareView(token: string): Promise<BetaShareView> {
    return this.request<BetaShareView>(`/public/share/${token}`, { auth: false });
  }

  postBetaShareComment(
    token: string,
    input: CreateBetaShareCommentInput
  ): Promise<BetaShareView> {
    return this.request<BetaShareView>(`/public/share/${token}/comments`, {
      method: 'POST',
      body: input,
      auth: false
    });
  }

  updateChapter(projectId: string, chapterId: string, input: UpdateChapterInput): Promise<PatchChapterResult> {
    return this.request<PatchChapterResult>(`/projects/${projectId}/chapters/${chapterId}`, {
      method: 'PATCH',
      body: input
    });
  }

  updateCharacter(projectId: string, characterId: string, input: UpdateCharacterInput): Promise<PatchCharacterResult> {
    return this.request<PatchCharacterResult>(`/projects/${projectId}/characters/${characterId}`, {
      method: 'PATCH',
      body: input
    });
  }

  updateLocation(projectId: string, locationId: string, input: UpdateLocationInput): Promise<PatchLocationResult> {
    return this.request<PatchLocationResult>(`/projects/${projectId}/locations/${locationId}`, {
      method: 'PATCH',
      body: input
    });
  }

  updateStructure(projectId: string, input: UpdateStructureInput): Promise<PatchStructureResult> {
    return this.request<PatchStructureResult>(`/projects/${projectId}/structure`, {
      method: 'PATCH',
      body: input
    });
  }

  createAct(projectId: string, input: CreateActInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/acts`, {
      method: 'POST',
      body: input
    });
  }

  updateAct(projectId: string, actId: string, input: UpdateActInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/acts/${actId}`, {
      method: 'PATCH',
      body: input
    });
  }

  deleteAct(projectId: string, actId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/acts/${actId}`, {
      method: 'DELETE'
    });
  }

  createCharacter(projectId: string, input: CreateCharacterInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/characters`, {
      method: 'POST',
      body: input
    });
  }

  attachCharacterAsset(
    projectId: string,
    characterId: string,
    input: AttachCharacterAssetInput
  ): Promise<PatchCharacterResult> {
    return this.request<PatchCharacterResult>(
      `/projects/${projectId}/characters/${characterId}/assets`,
      { method: 'POST', body: input }
    );
  }

  detachCharacterAsset(
    projectId: string,
    characterId: string,
    attachmentId: string
  ): Promise<PatchCharacterResult> {
    return this.request<PatchCharacterResult>(
      `/projects/${projectId}/characters/${characterId}/assets/${attachmentId}`,
      { method: 'DELETE' }
    );
  }

  deleteCharacter(projectId: string, characterId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/characters/${characterId}`, {
      method: 'DELETE'
    });
  }

  createLocation(projectId: string, input: CreateLocationInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/locations`, {
      method: 'POST',
      body: input
    });
  }

  deleteLocation(projectId: string, locationId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/locations/${locationId}`, {
      method: 'DELETE'
    });
  }

  createChapter(projectId: string, input: CreateChapterInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/chapters`, {
      method: 'POST',
      body: input
    });
  }

  deleteChapter(projectId: string, chapterId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/chapters/${chapterId}`, {
      method: 'DELETE'
    });
  }

  listProjectDocs(
    projectId: string,
    input: ListProjectDocsInput = {}
  ): Promise<PaginatedProjectDocs> {
    const params = new URLSearchParams();
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    if (input.offset !== undefined) params.set('offset', String(input.offset));
    if (input.kind !== undefined) params.set('kind', input.kind);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<PaginatedProjectDocs>(`/projects/${projectId}/docs${qs}`);
  }

  createProjectDoc(projectId: string, input: CreateProjectDocInput): Promise<ProjectDoc> {
    return this.request<ProjectDoc>(`/projects/${projectId}/docs`, {
      method: 'POST',
      body: input
    });
  }

  getProjectDoc(projectId: string, docId: string): Promise<ProjectDoc> {
    return this.request<ProjectDoc>(`/projects/${projectId}/docs/${docId}`);
  }

  updateProjectDoc(
    projectId: string,
    docId: string,
    input: UpdateProjectDocInput
  ): Promise<ProjectDoc> {
    return this.request<ProjectDoc>(`/projects/${projectId}/docs/${docId}`, {
      method: 'PATCH',
      body: input
    });
  }

  deleteProjectDoc(projectId: string, docId: string): Promise<{ id: string; deleted: true }> {
    return this.request<{ id: string; deleted: true }>(`/projects/${projectId}/docs/${docId}`, {
      method: 'DELETE'
    });
  }

  createObstacle(projectId: string, input: CreateObstacleInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/obstacles`, {
      method: 'POST',
      body: input
    });
  }

  updateObstacle(
    projectId: string,
    obstacleId: string,
    input: UpdateObstacleInput
  ): Promise<PatchObstacleResult> {
    return this.request<PatchObstacleResult>(`/projects/${projectId}/obstacles/${obstacleId}`, {
      method: 'PATCH',
      body: input
    });
  }

  deleteObstacle(projectId: string, obstacleId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/obstacles/${obstacleId}`, {
      method: 'DELETE'
    });
  }

  createCharacterRelationship(
    projectId: string,
    fromCharacterId: string,
    input: CreateCharacterRelationshipInput
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/characters/${fromCharacterId}/relationships`,
      { method: 'POST', body: input }
    );
  }

  deleteCharacterRelationship(
    projectId: string,
    fromCharacterId: string,
    relationshipId: string
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/characters/${fromCharacterId}/relationships/${relationshipId}`,
      { method: 'DELETE' }
    );
  }

  async uploadAsset(
    projectId: string,
    file: Blob,
    options: { kind?: AssetKind; filename?: string } = {}
  ): Promise<Asset> {
    const form = new FormData();
    const filename =
      options.filename ?? (file instanceof File ? file.name : `upload-${Date.now()}`);
    form.append('kind', options.kind ?? 'image');
    form.append('file', file, filename);

    const headers = new Headers();
    headers.set('accept', 'application/json');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);

    const response = await this.fetcher(`${this.baseUrl}/projects/${projectId}/assets`, {
      method: 'POST',
      headers,
      body: form
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new ApiError(payload?.message ?? 'Upload failed', response.status, payload);
    }
    return payload as Asset;
  }

  listTrash(projectId: string): Promise<TrashItem[]> {
    return this.request<TrashItem[]>(`/projects/${projectId}/trash`);
  }

  restoreTrashChapter(projectId: string, chapterId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/trash/chapters/${chapterId}/restore`,
      { method: 'POST' }
    );
  }

  purgeTrashChapter(projectId: string, chapterId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/trash/chapters/${chapterId}`,
      { method: 'DELETE' }
    );
  }

  getProjectStats(projectId: string, days?: number): Promise<ProjectStats> {
    const qs = days ? `?days=${days}` : '';
    return this.request<ProjectStats>(`/projects/${projectId}/stats${qs}`);
  }

  getProjectAiSettings(projectId: string): Promise<ProjectAiSettings> {
    return this.request<ProjectAiSettings>(`/projects/${projectId}/ai-settings`);
  }

  updateProjectAiSettings(
    projectId: string,
    input: UpdateProjectAiSettingsInput
  ): Promise<ProjectAiSettings> {
    return this.request<ProjectAiSettings>(`/projects/${projectId}/ai-settings`, {
      method: 'PATCH',
      body: input
    });
  }

  runContinuityReview(projectId: string, submissionId: string): Promise<AiContinuityReview> {
    return this.request<AiContinuityReview>(
      `/projects/${projectId}/ai/continuity-reviews`,
      {
        method: 'POST',
        body: { submissionId }
      }
    );
  }

  createRewriteSuggestion(
    projectId: string,
    input: CreateAiRewriteSuggestionInput
  ): Promise<AiRewriteSuggestion> {
    return this.request<AiRewriteSuggestion>(`/projects/${projectId}/ai/rewrite-suggestions`, {
      method: 'POST',
      body: input
    });
  }

  createCharacterDialogueSuggestion(
    projectId: string,
    input: CreateAiCharacterDialogueInput
  ): Promise<AiCharacterDialogueSuggestion> {
    return this.request<AiCharacterDialogueSuggestion>(
      `/projects/${projectId}/ai/character-dialogue`,
      {
        method: 'POST',
        body: input
      }
    );
  }

  createOutlineExpansion(
    projectId: string,
    input: CreateAiOutlineExpansionInput
  ): Promise<AiOutlineExpansion> {
    return this.request<AiOutlineExpansion>(`/projects/${projectId}/ai/outline-expansions`, {
      method: 'POST',
      body: input
    });
  }

  listAiTools(projectId: string): Promise<AiToolManifest> {
    return this.request<AiToolManifest>(`/projects/${projectId}/ai/tools`);
  }

  listAiAgentSessions(projectId: string): Promise<AiAgentSessionSummary[]> {
    return this.request<AiAgentSessionSummary[]>(`/projects/${projectId}/ai/agent-sessions`);
  }

  createAiAgentSession(
    projectId: string,
    input: CreateAiAgentSessionInput = {}
  ): Promise<AiAgentSession> {
    return this.request<AiAgentSession>(`/projects/${projectId}/ai/agent-sessions`, {
      method: 'POST',
      body: input
    });
  }

  getAiAgentSession(projectId: string, sessionId?: string): Promise<AiAgentSession> {
    const suffix = sessionId ? `/agent-sessions/${sessionId}` : '/agent-session';
    return this.request<AiAgentSession>(`/projects/${projectId}/ai${suffix}`);
  }

  queueAiAgentPrompt(
    projectId: string,
    input: QueueAiAgentPromptInput,
    sessionId?: string
  ): Promise<AiAgentSession> {
    const suffix = sessionId ? `/agent-sessions/${sessionId}` : '/agent-session';
    return this.request<AiAgentSession>(`/projects/${projectId}/ai${suffix}/prompts`, {
      method: 'POST',
      body: input
    });
  }

  cancelAiAgentSession(projectId: string, sessionId?: string): Promise<AiAgentSession> {
    const suffix = sessionId ? `/agent-sessions/${sessionId}` : '/agent-session';
    return this.request<AiAgentSession>(`/projects/${projectId}/ai${suffix}/cancel`, {
      method: 'POST'
    });
  }

  approveAiToolCall(
    projectId: string,
    toolCallId: string,
    input: ApproveAiToolCallInput,
    sessionId?: string
  ): Promise<AiAgentSession> {
    const suffix = sessionId ? `/agent-sessions/${sessionId}` : '/agent-session';
    return this.request<AiAgentSession>(
      `/projects/${projectId}/ai${suffix}/tool-calls/${toolCallId}/approval`,
      {
        method: 'POST',
        body: input
      }
    );
  }

  approveAiToolCalls(
    projectId: string,
    input: ApproveAiToolCallsInput,
    sessionId?: string
  ): Promise<AiAgentSession> {
    const suffix = sessionId ? `/agent-sessions/${sessionId}` : '/agent-session';
    return this.request<AiAgentSession>(`/projects/${projectId}/ai${suffix}/tool-calls/approvals`, {
      method: 'POST',
      body: input
    });
  }

  async streamAiAgentSession(
    projectId: string,
    sessionId: string | undefined,
    onEvent: (event: AiAgentSessionEvent) => void,
    options: { signal?: AbortSignal } = {}
  ): Promise<void> {
    const headers = new Headers();
    headers.set('accept', 'text/event-stream');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);

    const suffix = sessionId ? `/agent-sessions/${sessionId}` : '/agent-session';
    const response = await this.fetcher(
      `${this.baseUrl}/projects/${projectId}/ai${suffix}/events`,
      {
        method: 'GET',
        headers,
        signal: options.signal
      }
    );

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      throw new ApiError(payload?.message ?? 'Request failed', response.status, payload);
    }
    await this.readEventStream(response, onEvent);
  }

  getCollaborationSnapshot(
    projectId: string,
    document: CollaborationDocumentRef
  ): Promise<CollaborationEvent> {
    return this.request<CollaborationEvent>(
      `/projects/${projectId}/collaboration/documents/${encodeURIComponent(document.kind)}/${encodeURIComponent(document.entityId)}/${encodeURIComponent(document.field)}`
    );
  }

  applyCollaborationEdit(
    projectId: string,
    document: CollaborationDocumentRef,
    input: CollaborationEditInput
  ): Promise<CollaborationEvent> {
    return this.request<CollaborationEvent>(
      `/projects/${projectId}/collaboration/documents/${encodeURIComponent(document.kind)}/${encodeURIComponent(document.entityId)}/${encodeURIComponent(document.field)}/edits`,
      { method: 'POST', body: input }
    );
  }

  updateCollaborationPresence(
    projectId: string,
    document: CollaborationDocumentRef,
    input: CollaborationPresenceInput
  ): Promise<CollaborationEvent> {
    return this.request<CollaborationEvent>(
      `/projects/${projectId}/collaboration/documents/${encodeURIComponent(document.kind)}/${encodeURIComponent(document.entityId)}/${encodeURIComponent(document.field)}/presence`,
      { method: 'POST', body: input }
    );
  }

  leaveProjectCollaboration(projectId: string, input: CollaborationLeaveInput): Promise<CollaborationEvent> {
    return this.request<CollaborationEvent>(`/projects/${projectId}/collaboration/leave`, {
      method: 'POST',
      body: input
    });
  }

  async streamProjectCollaboration(
    projectId: string,
    onEvent: (event: CollaborationEvent) => void,
    options: { signal?: AbortSignal } = {}
  ): Promise<void> {
    const headers = new Headers();
    headers.set('accept', 'text/event-stream');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);

    const response = await this.fetcher(`${this.baseUrl}/projects/${projectId}/collaboration/events`, {
      method: 'GET',
      headers,
      signal: options.signal
    });

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      throw new ApiError(payload?.message ?? 'Request failed', response.status, payload);
    }
    if (!response.body) return;

    await this.readEventStream(response, onEvent);
  }

  async streamCollaborationDocument(
    projectId: string,
    document: CollaborationDocumentRef,
    clientId: string,
    onEvent: (event: CollaborationEvent) => void,
    options: { signal?: AbortSignal } = {}
  ): Promise<void> {
    const headers = new Headers();
    headers.set('accept', 'text/event-stream');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);

    const response = await this.fetcher(
      `${this.baseUrl}/projects/${projectId}/collaboration/documents/${encodeURIComponent(document.kind)}/${encodeURIComponent(document.entityId)}/${encodeURIComponent(document.field)}/events?clientId=${encodeURIComponent(clientId)}`,
      {
        method: 'GET',
        headers,
        signal: options.signal
      }
    );

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      throw new ApiError(payload?.message ?? 'Request failed', response.status, payload);
    }
    if (!response.body) return;

    await this.readEventStream(response, onEvent);
  }

  private async readEventStream<T>(response: Response, onEvent: (event: T) => void): Promise<void> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const data = chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) onEvent(JSON.parse(data) as T);
      }
    }
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; auth?: boolean } = {}
  ): Promise<T> {
    const headers = new Headers();
    headers.set('accept', 'application/json');

    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    if (options.auth !== false && this.token) {
      headers.set('authorization', `Bearer ${this.token}`);
    }

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new ApiError(payload?.message ?? 'Request failed', response.status, payload);
    }

    return payload as T;
  }
}
