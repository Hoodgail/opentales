import type {
  AcceptInviteResult,
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
  CreateProjectInput,
  LoginInput,
  ManuscriptProject,
  MembersAndInvites,
  AddSubmissionCommentInput,
  CreateSubmissionInput,
  ProjectInvite,
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
  private readonly baseUrl: string;
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

  updateChapter(projectId: string, chapterId: string, input: UpdateChapterInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/chapters/${chapterId}`, {
      method: 'PATCH',
      body: input
    });
  }

  updateCharacter(projectId: string, characterId: string, input: UpdateCharacterInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/characters/${characterId}`, {
      method: 'PATCH',
      body: input
    });
  }

  updateLocation(projectId: string, locationId: string, input: UpdateLocationInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/locations/${locationId}`, {
      method: 'PATCH',
      body: input
    });
  }

  updateStructure(projectId: string, input: UpdateStructureInput): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/structure`, {
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
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/obstacles/${obstacleId}`, {
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
