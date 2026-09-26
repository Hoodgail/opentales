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
  CreateProjectFolderInput,
  CreateProjectDocInput,
  CreateProjectInput,
  CreateProjectAiSkillInput,
  LoginInput,
  ManuscriptProject,
  MembersAndInvites,
  AddSubmissionCommentInput,
  AnswerAiQuestionInput,
  AiAgentSession,
  AiAgentSessionSummary,
  AiAgentCapabilities,
  AiAgentMessagePage,
  AiAgentStreamEvent,
  ReplyAiPermissionInput,
  SendAiAgentPromptInput,
  AiCharacterDialogueSuggestion,
  AiContinuityReview,
  AiModelCatalog,
  DiscoverAiModelsInput,
  AiOutlineExpansion,
  AiRewriteSuggestion,
  AiToolManifest,
  PollCodexAuthInput,
  PollCodexAuthResult,
  PollGithubCopilotAuthInput,
  PollGithubCopilotAuthResult,
  CreateSubmissionInput,
  DeleteSceneInput,
  CreateAiCharacterDialogueInput,
  CreateAiAgentSessionInput,
  UpdateAiAgentSessionInput,
  CreateAiOutlineExpansionInput,
  CreateAiRewriteSuggestionInput,
  CollaborationDocumentEvent,
  CollaborationDocumentRef,
  CollaborationEditInput,
  CollaborationEvent,
  CollaborationLeaveInput,
  CollaborationPresenceInput,
  ListProjectDocsInput,
  PaginatedProjectDocs,
  PatchChapterResult,
  PatchCharacterResult,
  PatchLocationResult,
  PatchObstacleResult,
  PatchStructureResult,
  ProjectInvite,
  ProjectAiSettings,
  ProjectAiSkill,
  ProjectMcpApiKey,
  CreateProjectMcpApiKeyInput,
  CreateProjectMcpApiKeyResult,
  McpOAuthAuthorizationRequest,
  McpOAuthAuthorizationContext,
  MergeSubmissionInput,
  AuthorizeMcpOAuthInput,
  AuthorizeMcpOAuthResult,
  ProjectDoc,
  ProjectFileTree,
  ProjectFolder,
  ProjectStats,
  ProjectStorageUsage,
  ProjectSummary,
  PublicProject,
  RegisterInput,
  ReplanBuildInput,
  ReplanBuildResult,
  BranchBuildFromCheckpointInput,
  StartCodexAuthResult,
  StartGithubCopilotAuthResult,
  TrashItem,
  Role,
  SubmissionDetail,
  SubmissionStatus,
  SubmissionSummary,
  UpdateSubmissionInput,
  UpdateActInput,
  UpdateBetaShareLinkInput,
  UpdateChapterInput,
  UpdateCharacterInput,
  UpdateLocationInput,
  UpdateObstacleInput,
  UpdateProjectAssetInput,
  UpdateProjectDocInput,
  UpdateProjectFolderInput,
  UpdateProjectAiSettingsInput,
  UpdateProjectAiSkillInput,
  UpdateProjectInput,
  UpdateStructureInput,
  ApplyStoryArtifactBatchInput,
  ApplyStoryArtifactBatchResult,
  ApplyStoryStateBatchInput,
  ApplyStoryStateBatchResult,
  AuthorizeBuildRunInput,
  BuildCheckpoint,
  BuildLifecycleInput,
  BuildObservability,
  BuildRun,
  BuildTaskActionResult,
  CreateBuildCheckpointInput,
  CreateBuildRunInput,
  CreateSceneInput,
  FindStoryReferencesInput,
  FindStoryReferencesResult,
  GetBuildObservabilityInput,
  ListStoryArtifactsInput,
  PaginatedStoryArtifacts,
  PatchSceneResult,
  Scene,
  SearchStoryInput,
  StoryDiagnosticsResult,
  StorySearchResult,
  StoryStateSnapshot,
  UpdateSceneInput,
  BuildManuscriptUnit,
  BuildCompilation,
  BuildComparison,
  BuildReview,
  CreateBuildManuscriptUnitInput,
  PatchBuildManuscriptUnitInput,
  CompileBuildManuscriptInput,
  CreateBuildReviewInput,
  ApproveBuildReviewInput,
  MergeBuildReviewInput,
  RejectBuildReviewInput,
  UnpinBuildArtifactsInput,
  ReorderScenesInput,
  GetStoryStateInput,
  StoryStateDelta,
  StoryStateEntityKind,
  StoryStateHistoryResult,
  TemporalStoryStateQuery,
  TemporalStoryStateResult,
  RegisterBuildExportInput,
  StoryArtifact,
  ProjectExport,
  CreateProjectExportInput,
  RegenerateProjectExportInput,
  ReorderBuildManuscriptUnitsInput,
  ProjectImportPreview,
  PreviewProjectImportInput,
  ApplyProjectImportInput,
  NamedSnapshot,
  SnapshotListFilter,
  CreateNamedSnapshotInput,
  CompareNamedSnapshotsInput,
  NamedSnapshotComparison,
  RestoreNamedSnapshotInput,
  RestoreNamedSnapshotResult,
  BranchFromNamedSnapshotInput,
  BranchFromNamedSnapshotResult,
  WritingAnnotationThread,
  ListWritingAnnotationsInput,
  CreateWritingAnnotationInput,
  ReplyToWritingAnnotationInput,
  UpdateWritingAnnotationStatusInput,
  AcceptWritingSuggestionInput,
  PreviewRenameSymbolInput,
  RenameSymbolPreview,
  ApplyRenameSymbolInput,
  ApplyRenameSymbolResult,
} from "./types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
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
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetcher = options.fetcher ?? fetch;
  }

  setToken(token: string | undefined) {
    this.token = token;
  }

  async register(input: RegisterInput): Promise<AuthSession> {
    const session = await this.request<AuthSession>("/auth/register", {
      method: "POST",
      body: input,
      auth: false,
    });
    this.token = session.token;
    return session;
  }

  async login(input: LoginInput): Promise<AuthSession> {
    const session = await this.request<AuthSession>("/auth/login", {
      method: "POST",
      body: input,
      auth: false,
    });
    this.token = session.token;
    return session;
  }

  me(): Promise<AuthUser> {
    return this.request<AuthUser>("/auth/me");
  }

  listProjects(): Promise<ProjectSummary[]> {
    return this.request<ProjectSummary[]>("/projects");
  }

  createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    return this.request<ProjectSummary>("/projects", {
      method: "POST",
      body: input,
    });
  }

  getProject(projectId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}`);
  }

  updateProject(
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectSummary> {
    return this.request<ProjectSummary>(`/projects/${projectId}`, {
      method: "PATCH",
      body: input,
    });
  }

  listScenes(projectId: string, chapterId: string): Promise<Scene[]> {
    return this.request<Scene[]>(
      `/projects/${projectId}/chapters/${chapterId}/scenes`,
    );
  }

  getScene(
    projectId: string,
    chapterId: string,
    sceneId: string,
  ): Promise<Scene> {
    return this.request<Scene>(
      `/projects/${projectId}/chapters/${chapterId}/scenes/${sceneId}`,
    );
  }

  createScene(
    projectId: string,
    chapterId: string,
    input: CreateSceneInput,
  ): Promise<Scene> {
    return this.request<Scene>(
      `/projects/${projectId}/chapters/${chapterId}/scenes`,
      { method: "POST", body: input },
    );
  }

  updateScene(
    projectId: string,
    chapterId: string,
    sceneId: string,
    input: UpdateSceneInput,
  ): Promise<PatchSceneResult> {
    return this.request<PatchSceneResult>(
      `/projects/${projectId}/chapters/${chapterId}/scenes/${sceneId}`,
      { method: "PATCH", body: input },
    );
  }

  deleteScene(
    projectId: string,
    chapterId: string,
    sceneId: string,
    input: DeleteSceneInput = {},
  ): Promise<{ id: string; deleted: true }> {
    return this.request<{ id: string; deleted: true }>(
      `/projects/${projectId}/chapters/${chapterId}/scenes/${sceneId}`,
      { method: "DELETE", body: input },
    );
  }

  reorderScenes(
    projectId: string,
    chapterId: string,
    input: ReorderScenesInput,
  ): Promise<Scene[]> {
    return this.request<Scene[]>(
      `/projects/${projectId}/chapters/${chapterId}/scenes/reorder`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  listProjectExports(projectId: string): Promise<ProjectExport[]> {
    return this.request<ProjectExport[]>(`/projects/${projectId}/exports`);
  }

  createProjectExport(
    projectId: string,
    input: CreateProjectExportInput,
  ): Promise<ProjectExport> {
    return this.request<ProjectExport>(`/projects/${projectId}/exports`, {
      method: "POST",
      body: input,
    });
  }

  regenerateProjectExport(
    projectId: string,
    exportId: string,
    input: RegenerateProjectExportInput,
  ): Promise<ProjectExport> {
    return this.request<ProjectExport>(
      `/projects/${projectId}/exports/${exportId}/regenerate`,
      { method: "POST", body: input },
    );
  }

  deleteProjectExport(
    projectId: string,
    exportId: string,
  ): Promise<ProjectExport> {
    return this.request<ProjectExport>(
      `/projects/${projectId}/exports/${exportId}`,
      { method: "DELETE" },
    );
  }

  async downloadProjectExport(
    projectId: string,
    exportId: string,
  ): Promise<{ blob: Blob; filename: string; mimeType: string }> {
    const headers = new Headers({ accept: "application/octet-stream" });
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    const response = await this.fetcher(
      `${this.baseUrl}/projects/${projectId}/exports/${exportId}/download`,
      { headers },
    );
    if (!response.ok) {
      const text = await response.text();
      let payload: { message?: string } | null = null;
      try {
        payload = text ? (JSON.parse(text) as { message?: string }) : null;
      } catch {
        payload = null;
      }
      throw new ApiError(
        payload?.message ?? "Export download failed",
        response.status,
        payload,
      );
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
    return {
      blob: await response.blob(),
      filename: encoded
        ? decodeURIComponent(encoded)
        : (quoted ?? `opentales-export-${exportId}`),
      mimeType:
        response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  listProjectImports(projectId: string): Promise<ProjectImportPreview[]> {
    return this.request<ProjectImportPreview[]>(
      `/projects/${projectId}/imports`,
    );
  }

  async previewProjectImport(
    projectId: string,
    input: PreviewProjectImportInput,
  ): Promise<ProjectImportPreview> {
    const form = new FormData();
    form.set("idempotencyKey", input.idempotencyKey);
    if (input.mimeType) form.set("mimeType", input.mimeType);
    form.set(
      "file",
      input.file,
      input.filename ??
        ("name" in input.file && typeof input.file.name === "string"
          ? input.file.name
          : "import"),
    );
    const headers = new Headers({ accept: "application/json" });
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    const response = await this.fetcher(
      `${this.baseUrl}/projects/${projectId}/imports/preview`,
      { method: "POST", headers, body: form },
    );
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok)
      throw new ApiError(
        payload?.message ?? "Import preview failed",
        response.status,
        payload,
      );
    return payload as ProjectImportPreview;
  }

  applyProjectImport(
    projectId: string,
    importId: string,
    input: ApplyProjectImportInput,
  ): Promise<ProjectImportPreview> {
    return this.request<ProjectImportPreview>(
      `/projects/${projectId}/imports/${importId}/apply`,
      { method: "POST", body: input },
    );
  }

  listNamedSnapshots(
    projectId: string,
    filter: SnapshotListFilter = {},
  ): Promise<NamedSnapshot[]> {
    return this.request<NamedSnapshot[]>(
      `/projects/${projectId}/snapshots${this.queryString(filter as Record<string, unknown>)}`,
    );
  }
  createNamedSnapshot(
    projectId: string,
    input: CreateNamedSnapshotInput,
  ): Promise<NamedSnapshot> {
    return this.request<NamedSnapshot>(`/projects/${projectId}/snapshots`, {
      method: "POST",
      body: input,
    });
  }
  getNamedSnapshot(
    projectId: string,
    snapshotId: string,
  ): Promise<NamedSnapshot> {
    return this.request<NamedSnapshot>(
      `/projects/${projectId}/snapshots/${snapshotId}`,
    );
  }
  deleteNamedSnapshot(
    projectId: string,
    snapshotId: string,
  ): Promise<NamedSnapshot> {
    return this.request<NamedSnapshot>(
      `/projects/${projectId}/snapshots/${snapshotId}`,
      { method: "DELETE" },
    );
  }
  compareNamedSnapshots(
    projectId: string,
    input: CompareNamedSnapshotsInput,
  ): Promise<NamedSnapshotComparison> {
    return this.request<NamedSnapshotComparison>(
      `/projects/${projectId}/snapshots/compare`,
      { method: "POST", body: input },
    );
  }
  restoreNamedSnapshot(
    projectId: string,
    snapshotId: string,
    input: RestoreNamedSnapshotInput,
  ): Promise<RestoreNamedSnapshotResult> {
    return this.request<RestoreNamedSnapshotResult>(
      `/projects/${projectId}/snapshots/${snapshotId}/restore`,
      { method: "POST", body: input },
    );
  }
  branchFromNamedSnapshot(
    projectId: string,
    snapshotId: string,
    input: BranchFromNamedSnapshotInput,
  ): Promise<BranchFromNamedSnapshotResult> {
    return this.request<BranchFromNamedSnapshotResult>(
      `/projects/${projectId}/snapshots/${snapshotId}/branch`,
      { method: "POST", body: input },
    );
  }
  listWritingAnnotations(
    projectId: string,
    input: ListWritingAnnotationsInput = {},
  ): Promise<WritingAnnotationThread[]> {
    return this.request<WritingAnnotationThread[]>(
      `/projects/${projectId}/annotations${this.queryString(input as Record<string, unknown>)}`,
    );
  }
  createWritingAnnotation(
    projectId: string,
    input: CreateWritingAnnotationInput,
  ): Promise<WritingAnnotationThread> {
    return this.request<WritingAnnotationThread>(
      `/projects/${projectId}/annotations`,
      { method: "POST", body: input },
    );
  }
  getWritingAnnotation(
    projectId: string,
    threadId: string,
  ): Promise<WritingAnnotationThread> {
    return this.request<WritingAnnotationThread>(
      `/projects/${projectId}/annotations/${threadId}`,
    );
  }
  replyToWritingAnnotation(
    projectId: string,
    threadId: string,
    input: ReplyToWritingAnnotationInput,
  ): Promise<WritingAnnotationThread> {
    return this.request<WritingAnnotationThread>(
      `/projects/${projectId}/annotations/${threadId}/replies`,
      { method: "POST", body: input },
    );
  }
  resolveWritingAnnotation(
    projectId: string,
    threadId: string,
    input: UpdateWritingAnnotationStatusInput,
  ): Promise<WritingAnnotationThread> {
    return this.request<WritingAnnotationThread>(
      `/projects/${projectId}/annotations/${threadId}/resolve`,
      { method: "POST", body: input },
    );
  }
  reopenWritingAnnotation(
    projectId: string,
    threadId: string,
    input: UpdateWritingAnnotationStatusInput,
  ): Promise<WritingAnnotationThread> {
    return this.request<WritingAnnotationThread>(
      `/projects/${projectId}/annotations/${threadId}/reopen`,
      { method: "POST", body: input },
    );
  }
  acceptWritingSuggestion(
    projectId: string,
    threadId: string,
    input: AcceptWritingSuggestionInput,
  ): Promise<WritingAnnotationThread> {
    return this.request<WritingAnnotationThread>(
      `/projects/${projectId}/annotations/${threadId}/accept`,
      { method: "POST", body: input },
    );
  }
  rejectWritingSuggestion(
    projectId: string,
    threadId: string,
    input: UpdateWritingAnnotationStatusInput,
  ): Promise<WritingAnnotationThread> {
    return this.request<WritingAnnotationThread>(
      `/projects/${projectId}/annotations/${threadId}/reject`,
      { method: "POST", body: input },
    );
  }

  previewRenameSymbol(
    projectId: string,
    input: PreviewRenameSymbolInput,
  ): Promise<RenameSymbolPreview> {
    return this.request<RenameSymbolPreview>(
      `/projects/${projectId}/refactor/rename/preview`,
      { method: "POST", body: input },
    );
  }
  applyRenameSymbol(
    projectId: string,
    input: ApplyRenameSymbolInput,
  ): Promise<ApplyRenameSymbolResult> {
    return this.request<ApplyRenameSymbolResult>(
      `/projects/${projectId}/refactor/rename/apply`,
      { method: "POST", body: input },
    );
  }

  listMembers(projectId: string): Promise<MembersAndInvites> {
    return this.request<MembersAndInvites>(`/projects/${projectId}/members`);
  }

  updateMemberRole(
    projectId: string,
    userId: string,
    role: Role,
  ): Promise<MembersAndInvites> {
    return this.request<MembersAndInvites>(
      `/projects/${projectId}/members/${userId}`,
      {
        method: "PATCH",
        body: { role },
      },
    );
  }

  removeMember(projectId: string, userId: string): Promise<MembersAndInvites> {
    return this.request<MembersAndInvites>(
      `/projects/${projectId}/members/${userId}`,
      {
        method: "DELETE",
      },
    );
  }

  createInvite(
    projectId: string,
    input: CreateInviteInput,
  ): Promise<ProjectInvite> {
    return this.request<ProjectInvite>(`/projects/${projectId}/invites`, {
      method: "POST",
      body: input,
    });
  }

  revokeInvite(
    projectId: string,
    inviteId: string,
  ): Promise<MembersAndInvites> {
    return this.request<MembersAndInvites>(
      `/projects/${projectId}/invites/${inviteId}`,
      {
        method: "DELETE",
      },
    );
  }

  acceptInvite(token: string): Promise<AcceptInviteResult> {
    return this.request<AcceptInviteResult>(`/invites/accept`, {
      method: "POST",
      body: { token },
    });
  }

  getPublicProject(
    orgSlug: string,
    projectSlug: string,
  ): Promise<PublicProject> {
    return this.request<PublicProject>(
      `/public/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}`,
    );
  }

  listSubmissions(
    projectId: string,
    filter?: { status?: SubmissionStatus },
  ): Promise<SubmissionSummary[]> {
    const qs = filter?.status
      ? `?status=${encodeURIComponent(filter.status)}`
      : "";
    return this.request<SubmissionSummary[]>(
      `/projects/${projectId}/submissions${qs}`,
    );
  }

  createSubmission(
    projectId: string,
    input: CreateSubmissionInput,
  ): Promise<SubmissionSummary> {
    return this.request<SubmissionSummary>(
      `/projects/${projectId}/submissions`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  updateSubmission(
    projectId: string,
    submissionId: string,
    input: UpdateSubmissionInput,
  ): Promise<SubmissionDetail> {
    return this.request<SubmissionDetail>(
      `/projects/${projectId}/submissions/${submissionId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  getSubmission(submissionId: string): Promise<SubmissionDetail> {
    return this.request<SubmissionDetail>(`/submissions/${submissionId}`);
  }

  mergeSubmission(
    submissionId: string,
    input?: MergeSubmissionInput,
  ): Promise<SubmissionDetail> {
    return this.request<SubmissionDetail>(
      `/submissions/${submissionId}/merge`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  declineSubmission(submissionId: string): Promise<SubmissionDetail> {
    return this.request<SubmissionDetail>(
      `/submissions/${submissionId}/decline`,
      {
        method: "PATCH",
      },
    );
  }

  commentSubmission(
    submissionId: string,
    input: AddSubmissionCommentInput,
  ): Promise<SubmissionDetail> {
    return this.request<SubmissionDetail>(
      `/submissions/${submissionId}/comments`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  listBetaShareLinks(projectId: string): Promise<BetaShareLink[]> {
    return this.request<BetaShareLink[]>(`/projects/${projectId}/share-links`);
  }

  createBetaShareLink(
    projectId: string,
    input: CreateBetaShareLinkInput,
  ): Promise<BetaShareLink> {
    return this.request<BetaShareLink>(`/projects/${projectId}/share-links`, {
      method: "POST",
      body: input,
    });
  }

  updateBetaShareLink(
    projectId: string,
    shareLinkId: string,
    input: UpdateBetaShareLinkInput,
  ): Promise<BetaShareLink> {
    return this.request<BetaShareLink>(
      `/projects/${projectId}/share-links/${shareLinkId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  revokeBetaShareLink(
    projectId: string,
    shareLinkId: string,
  ): Promise<BetaShareLink> {
    return this.request<BetaShareLink>(
      `/projects/${projectId}/share-links/${shareLinkId}`,
      {
        method: "DELETE",
      },
    );
  }

  // Public — no auth required.
  getBetaShareView(token: string): Promise<BetaShareView> {
    return this.request<BetaShareView>(`/public/share/${token}`, {
      auth: false,
    });
  }

  postBetaShareComment(
    token: string,
    input: CreateBetaShareCommentInput,
  ): Promise<BetaShareView> {
    return this.request<BetaShareView>(`/public/share/${token}/comments`, {
      method: "POST",
      body: input,
      auth: false,
    });
  }

  updateChapter(
    projectId: string,
    chapterId: string,
    input: UpdateChapterInput,
  ): Promise<PatchChapterResult> {
    return this.request<PatchChapterResult>(
      `/projects/${projectId}/chapters/${chapterId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  updateCharacter(
    projectId: string,
    characterId: string,
    input: UpdateCharacterInput,
  ): Promise<PatchCharacterResult> {
    return this.request<PatchCharacterResult>(
      `/projects/${projectId}/characters/${characterId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  updateLocation(
    projectId: string,
    locationId: string,
    input: UpdateLocationInput,
  ): Promise<PatchLocationResult> {
    return this.request<PatchLocationResult>(
      `/projects/${projectId}/locations/${locationId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  updateStructure(
    projectId: string,
    input: UpdateStructureInput,
  ): Promise<PatchStructureResult> {
    return this.request<PatchStructureResult>(
      `/projects/${projectId}/structure`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  createAct(
    projectId: string,
    input: CreateActInput,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/acts`, {
      method: "POST",
      body: input,
    });
  }

  updateAct(
    projectId: string,
    actId: string,
    input: UpdateActInput,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/acts/${actId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  deleteAct(projectId: string, actId: string): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/acts/${actId}`,
      {
        method: "DELETE",
      },
    );
  }

  createCharacter(
    projectId: string,
    input: CreateCharacterInput,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/characters`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  attachCharacterAsset(
    projectId: string,
    characterId: string,
    input: AttachCharacterAssetInput,
  ): Promise<PatchCharacterResult> {
    return this.request<PatchCharacterResult>(
      `/projects/${projectId}/characters/${characterId}/assets`,
      { method: "POST", body: input },
    );
  }

  detachCharacterAsset(
    projectId: string,
    characterId: string,
    attachmentId: string,
  ): Promise<PatchCharacterResult> {
    return this.request<PatchCharacterResult>(
      `/projects/${projectId}/characters/${characterId}/assets/${attachmentId}`,
      { method: "DELETE" },
    );
  }

  deleteCharacter(
    projectId: string,
    characterId: string,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/characters/${characterId}`,
      {
        method: "DELETE",
      },
    );
  }

  createLocation(
    projectId: string,
    input: CreateLocationInput,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/locations`, {
      method: "POST",
      body: input,
    });
  }

  deleteLocation(
    projectId: string,
    locationId: string,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/locations/${locationId}`,
      {
        method: "DELETE",
      },
    );
  }

  createChapter(
    projectId: string,
    input: CreateChapterInput,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/chapters`, {
      method: "POST",
      body: input,
    });
  }

  deleteChapter(
    projectId: string,
    chapterId: string,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/chapters/${chapterId}`,
      {
        method: "DELETE",
      },
    );
  }

  listProjectDocs(
    projectId: string,
    input: ListProjectDocsInput = {},
  ): Promise<PaginatedProjectDocs> {
    const params = new URLSearchParams();
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    if (input.offset !== undefined) params.set("offset", String(input.offset));
    if (input.folderId !== undefined)
      params.set("folderId", input.folderId ?? "");
    if (input.kind !== undefined) params.set("kind", input.kind);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request<PaginatedProjectDocs>(
      `/projects/${projectId}/docs${qs}`,
    );
  }

  createProjectDoc(
    projectId: string,
    input: CreateProjectDocInput,
  ): Promise<ProjectDoc> {
    return this.request<ProjectDoc>(`/projects/${projectId}/docs`, {
      method: "POST",
      body: input,
    });
  }

  getProjectDoc(projectId: string, docId: string): Promise<ProjectDoc> {
    return this.request<ProjectDoc>(`/projects/${projectId}/docs/${docId}`);
  }

  updateProjectDoc(
    projectId: string,
    docId: string,
    input: UpdateProjectDocInput,
  ): Promise<ProjectDoc> {
    return this.request<ProjectDoc>(`/projects/${projectId}/docs/${docId}`, {
      method: "PATCH",
      body: input,
    });
  }

  deleteProjectDoc(
    projectId: string,
    docId: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.request<{ id: string; deleted: true }>(
      `/projects/${projectId}/docs/${docId}`,
      {
        method: "DELETE",
      },
    );
  }

  getProjectFileTree(projectId: string): Promise<ProjectFileTree> {
    return this.request<ProjectFileTree>(`/projects/${projectId}/docs/tree`);
  }

  createProjectFolder(
    projectId: string,
    input: CreateProjectFolderInput,
  ): Promise<ProjectFolder> {
    return this.request<ProjectFolder>(`/projects/${projectId}/folders`, {
      method: "POST",
      body: input,
    });
  }

  updateProjectFolder(
    projectId: string,
    folderId: string,
    input: UpdateProjectFolderInput,
  ): Promise<ProjectFolder> {
    return this.request<ProjectFolder>(
      `/projects/${projectId}/folders/${folderId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  deleteProjectFolder(
    projectId: string,
    folderId: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.request<{ id: string; deleted: true }>(
      `/projects/${projectId}/folders/${folderId}`,
      {
        method: "DELETE",
      },
    );
  }

  createObstacle(
    projectId: string,
    input: CreateObstacleInput,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(`/projects/${projectId}/obstacles`, {
      method: "POST",
      body: input,
    });
  }

  updateObstacle(
    projectId: string,
    obstacleId: string,
    input: UpdateObstacleInput,
  ): Promise<PatchObstacleResult> {
    return this.request<PatchObstacleResult>(
      `/projects/${projectId}/obstacles/${obstacleId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  deleteObstacle(
    projectId: string,
    obstacleId: string,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/obstacles/${obstacleId}`,
      {
        method: "DELETE",
      },
    );
  }

  createCharacterRelationship(
    projectId: string,
    fromCharacterId: string,
    input: CreateCharacterRelationshipInput,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/characters/${fromCharacterId}/relationships`,
      { method: "POST", body: input },
    );
  }

  deleteCharacterRelationship(
    projectId: string,
    fromCharacterId: string,
    relationshipId: string,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/characters/${fromCharacterId}/relationships/${relationshipId}`,
      { method: "DELETE" },
    );
  }

  async uploadAsset(
    projectId: string,
    file: Blob,
    options: {
      kind?: AssetKind;
      filename?: string;
      folderId?: string | null;
      name?: string;
    } = {},
  ): Promise<Asset> {
    const form = new FormData();
    const filename =
      options.filename ??
      (file instanceof File ? file.name : `upload-${Date.now()}`);
    form.append("kind", options.kind ?? "image");
    if (options.folderId !== undefined && options.folderId !== null)
      form.append("folderId", options.folderId);
    if (options.name !== undefined) form.append("name", options.name);
    form.append("file", file, filename);

    const headers = new Headers();
    headers.set("accept", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);

    const response = await this.fetcher(
      `${this.baseUrl}/projects/${projectId}/assets`,
      {
        method: "POST",
        headers,
        body: form,
      },
    );

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new ApiError(
        payload?.message ?? "Upload failed",
        response.status,
        payload,
      );
    }
    return payload as Asset;
  }

  updateProjectAsset(
    projectId: string,
    assetId: string,
    input: UpdateProjectAssetInput,
  ): Promise<Asset> {
    return this.request<Asset>(`/projects/${projectId}/assets/${assetId}`, {
      method: "PATCH",
      body: input,
    });
  }

  deleteProjectAsset(
    projectId: string,
    assetId: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.request<{ id: string; deleted: true }>(
      `/projects/${projectId}/assets/${assetId}`,
      {
        method: "DELETE",
      },
    );
  }

  listTrash(projectId: string): Promise<TrashItem[]> {
    return this.request<TrashItem[]>(`/projects/${projectId}/trash`);
  }

  restoreTrashChapter(
    projectId: string,
    chapterId: string,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/trash/chapters/${chapterId}/restore`,
      { method: "POST" },
    );
  }

  purgeTrashChapter(
    projectId: string,
    chapterId: string,
  ): Promise<ManuscriptProject> {
    return this.request<ManuscriptProject>(
      `/projects/${projectId}/trash/chapters/${chapterId}`,
      { method: "DELETE" },
    );
  }

  getProjectStats(projectId: string, days?: number): Promise<ProjectStats> {
    const qs = days ? `?days=${days}` : "";
    return this.request<ProjectStats>(`/projects/${projectId}/stats${qs}`);
  }

  getProjectStorage(projectId: string): Promise<ProjectStorageUsage> {
    return this.request<ProjectStorageUsage>(`/projects/${projectId}/storage`);
  }

  getProjectAiSettings(projectId: string): Promise<ProjectAiSettings> {
    return this.request<ProjectAiSettings>(
      `/projects/${projectId}/ai-settings`,
    );
  }

  listProjectMcpApiKeys(projectId: string): Promise<ProjectMcpApiKey[]> {
    return this.request<ProjectMcpApiKey[]>(
      `/projects/${projectId}/mcp-api-keys`,
    );
  }

  createProjectMcpApiKey(
    projectId: string,
    input: CreateProjectMcpApiKeyInput,
  ): Promise<CreateProjectMcpApiKeyResult> {
    return this.request<CreateProjectMcpApiKeyResult>(
      `/projects/${projectId}/mcp-api-keys`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  revokeProjectMcpApiKey(
    projectId: string,
    keyId: string,
  ): Promise<ProjectMcpApiKey> {
    return this.request<ProjectMcpApiKey>(
      `/projects/${projectId}/mcp-api-keys/${keyId}`,
      {
        method: "DELETE",
      },
    );
  }

  getMcpOAuthAuthorizationContext(
    input: McpOAuthAuthorizationRequest,
  ): Promise<McpOAuthAuthorizationContext> {
    return this.request<McpOAuthAuthorizationContext>(
      `/oauth/authorize/context${this.queryString(input as unknown as Record<string, unknown>)}`,
    );
  }

  authorizeMcpOAuth(
    input: AuthorizeMcpOAuthInput,
  ): Promise<AuthorizeMcpOAuthResult> {
    return this.request<AuthorizeMcpOAuthResult>("/oauth/authorize", {
      method: "POST",
      body: input,
    });
  }

  updateProjectAiSettings(
    projectId: string,
    input: UpdateProjectAiSettingsInput,
  ): Promise<ProjectAiSettings> {
    return this.request<ProjectAiSettings>(
      `/projects/${projectId}/ai-settings`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  startGithubCopilotAuth(
    projectId: string,
  ): Promise<StartGithubCopilotAuthResult> {
    return this.request<StartGithubCopilotAuthResult>(
      `/projects/${projectId}/ai-settings/github-copilot/auth/start`,
      { method: "POST" },
    );
  }

  pollGithubCopilotAuth(
    projectId: string,
    input: PollGithubCopilotAuthInput,
  ): Promise<PollGithubCopilotAuthResult> {
    return this.request<PollGithubCopilotAuthResult>(
      `/projects/${projectId}/ai-settings/github-copilot/auth/poll`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  startCodexAuth(projectId: string): Promise<StartCodexAuthResult> {
    return this.request<StartCodexAuthResult>(
      `/projects/${projectId}/ai-settings/codex/auth/start`,
      { method: "POST" },
    );
  }

  pollCodexAuth(
    projectId: string,
    input: PollCodexAuthInput,
  ): Promise<PollCodexAuthResult> {
    return this.request<PollCodexAuthResult>(
      `/projects/${projectId}/ai-settings/codex/auth/poll`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  listAiModels(projectId: string, options: { source?: 'catalog'; refresh?: boolean } = {}): Promise<AiModelCatalog> {
    const query = new URLSearchParams();
    if (options.source === 'catalog') query.set('source', 'catalog');
    if (options.refresh) query.set('refresh', 'true');
    return this.request<AiModelCatalog>(`/projects/${projectId}/ai/models${query.size ? `?${query}` : ''}`);
  }

  discoverAiModels(projectId: string, input: DiscoverAiModelsInput): Promise<AiModelCatalog> {
    return this.request<AiModelCatalog>(`/projects/${projectId}/ai/models/discover`, {
      method: 'POST', body: input
    });
  }

  listProjectAiSkills(projectId: string): Promise<ProjectAiSkill[]> {
    return this.request<ProjectAiSkill[]>(`/projects/${projectId}/ai/skills`);
  }

  createProjectAiSkill(
    projectId: string,
    input: CreateProjectAiSkillInput,
  ): Promise<ProjectAiSkill> {
    return this.request<ProjectAiSkill>(`/projects/${projectId}/ai/skills`, {
      method: "POST",
      body: input,
    });
  }

  updateProjectAiSkill(
    projectId: string,
    skillId: string,
    input: UpdateProjectAiSkillInput,
  ): Promise<ProjectAiSkill> {
    return this.request<ProjectAiSkill>(
      `/projects/${projectId}/ai/skills/${skillId}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  }

  deleteProjectAiSkill(
    projectId: string,
    skillId: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.request<{ id: string; deleted: true }>(
      `/projects/${projectId}/ai/skills/${skillId}`,
      { method: "DELETE" },
    );
  }

  runContinuityReview(
    projectId: string,
    submissionId: string,
  ): Promise<AiContinuityReview> {
    return this.request<AiContinuityReview>(
      `/projects/${projectId}/ai/continuity-reviews`,
      {
        method: "POST",
        body: { submissionId },
      },
    );
  }

  createRewriteSuggestion(
    projectId: string,
    input: CreateAiRewriteSuggestionInput,
  ): Promise<AiRewriteSuggestion> {
    return this.request<AiRewriteSuggestion>(
      `/projects/${projectId}/ai/rewrite-suggestions`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  createCharacterDialogueSuggestion(
    projectId: string,
    input: CreateAiCharacterDialogueInput,
  ): Promise<AiCharacterDialogueSuggestion> {
    return this.request<AiCharacterDialogueSuggestion>(
      `/projects/${projectId}/ai/character-dialogue`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  createOutlineExpansion(
    projectId: string,
    input: CreateAiOutlineExpansionInput,
  ): Promise<AiOutlineExpansion> {
    return this.request<AiOutlineExpansion>(
      `/projects/${projectId}/ai/outline-expansions`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  listAiTools(projectId: string): Promise<AiToolManifest> {
    return this.request<AiToolManifest>(`/projects/${projectId}/ai/tools`);
  }

  listAiAgentSessions(projectId: string): Promise<AiAgentSessionSummary[]> {
    return this.request<AiAgentSessionSummary[]>(
      `/projects/${projectId}/ai/agent-sessions`,
    );
  }

  /** Agents, skills, tools, and the default model available to this project's agent. */
  getAiAgentCapabilities(projectId: string): Promise<AiAgentCapabilities> {
    return this.request<AiAgentCapabilities>(
      `/projects/${projectId}/ai/agent-capabilities`,
    );
  }

  createAiAgentSession(
    projectId: string,
    input: CreateAiAgentSessionInput = {},
  ): Promise<AiAgentSession> {
    return this.request<AiAgentSession>(
      `/projects/${projectId}/ai/agent-sessions`,
      { method: "POST", body: input },
    );
  }

  updateAiAgentSession(
    projectId: string,
    sessionId: string,
    input: UpdateAiAgentSessionInput,
  ): Promise<AiAgentSession> {
    return this.request<AiAgentSession>(
      `/projects/${projectId}/ai/agent-sessions/${sessionId}`,
      { method: "PATCH", body: input },
    );
  }

  deleteAiAgentSession(projectId: string, sessionId: string): Promise<void> {
    return this.request<void>(
      `/projects/${projectId}/ai/agent-sessions/${sessionId}`,
      { method: "DELETE" },
    );
  }

  getAiAgentSession(
    projectId: string,
    sessionId: string,
  ): Promise<AiAgentSession> {
    return this.request<AiAgentSession>(
      `/projects/${projectId}/ai/agent-sessions/${sessionId}`,
    );
  }

  /** Page older transcript messages (newest-first cursor from `AiAgentSession.earlierCursor`). */
  getAiAgentMessages(
    projectId: string,
    sessionId: string,
    input: { cursor?: string; limit?: number } = {},
  ): Promise<AiAgentMessagePage> {
    return this.request<AiAgentMessagePage>(
      `/projects/${projectId}/ai/agent-sessions/${sessionId}/messages${this.queryString(input)}`,
    );
  }

  sendAiAgentPrompt(
    projectId: string,
    sessionId: string,
    input: SendAiAgentPromptInput,
  ): Promise<AiAgentSession> {
    return this.request<AiAgentSession>(
      `/projects/${projectId}/ai/agent-sessions/${sessionId}/prompts`,
      { method: "POST", body: input },
    );
  }

  interruptAiAgentSession(
    projectId: string,
    sessionId: string,
  ): Promise<AiAgentSession> {
    return this.request<AiAgentSession>(
      `/projects/${projectId}/ai/agent-sessions/${sessionId}/interrupt`,
      { method: "POST" },
    );
  }

  /** Reply to a pending project-change permission (Manual mode approval). */
  replyAiPermission(
    projectId: string,
    sessionId: string,
    requestId: string,
    input: ReplyAiPermissionInput,
  ): Promise<void> {
    return this.request<void>(
      `/projects/${projectId}/ai/agent-sessions/${sessionId}/permissions/${requestId}`,
      { method: "POST", body: input },
    );
  }

  answerAiQuestion(
    projectId: string,
    sessionId: string,
    questionId: string,
    input: AnswerAiQuestionInput,
  ): Promise<void> {
    return this.request<void>(
      `/projects/${projectId}/ai/agent-sessions/${sessionId}/questions/${questionId}`,
      { method: "POST", body: input },
    );
  }

  dismissAiQuestion(
    projectId: string,
    sessionId: string,
    questionId: string,
  ): Promise<void> {
    return this.request<void>(
      `/projects/${projectId}/ai/agent-sessions/${sessionId}/questions/${questionId}`,
      { method: "DELETE" },
    );
  }

  /**
   * Subscribe to live agent activity for every session in a project, including
   * subagent child sessions. Resolves when the stream closes.
   */
  async streamAiAgentEvents(
    projectId: string,
    onEvent: (event: AiAgentStreamEvent) => void,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const headers = new Headers();
    headers.set("accept", "text/event-stream");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);

    const response = await this.fetcher(
      `${this.baseUrl}/projects/${projectId}/ai/agent-events`,
      {
        method: "GET",
        headers,
        signal: options.signal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      throw new ApiError(
        payload?.message ?? "Request failed",
        response.status,
        payload,
      );
    }
    await this.readEventStream(response, onEvent);
  }

  getCollaborationSnapshot(
    projectId: string,
    document: CollaborationDocumentRef,
  ): Promise<CollaborationDocumentEvent> {
    return this.request<CollaborationDocumentEvent>(
      `/projects/${projectId}/collaboration/documents/${encodeURIComponent(document.kind)}/${encodeURIComponent(document.entityId)}/${encodeURIComponent(document.field)}`,
    );
  }

  applyCollaborationEdit(
    projectId: string,
    document: CollaborationDocumentRef,
    input: CollaborationEditInput,
  ): Promise<CollaborationEvent> {
    return this.request<CollaborationEvent>(
      `/projects/${projectId}/collaboration/documents/${encodeURIComponent(document.kind)}/${encodeURIComponent(document.entityId)}/${encodeURIComponent(document.field)}/edits`,
      { method: "POST", body: input },
    );
  }

  updateCollaborationPresence(
    projectId: string,
    document: CollaborationDocumentRef,
    input: CollaborationPresenceInput,
  ): Promise<CollaborationEvent> {
    return this.request<CollaborationEvent>(
      `/projects/${projectId}/collaboration/documents/${encodeURIComponent(document.kind)}/${encodeURIComponent(document.entityId)}/${encodeURIComponent(document.field)}/presence`,
      { method: "POST", body: input },
    );
  }

  leaveProjectCollaboration(
    projectId: string,
    input: CollaborationLeaveInput,
  ): Promise<CollaborationEvent> {
    return this.request<CollaborationEvent>(
      `/projects/${projectId}/collaboration/leave`,
      {
        method: "POST",
        body: input,
      },
    );
  }

  async streamProjectCollaboration(
    projectId: string,
    onEvent: (event: CollaborationEvent) => void,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const headers = new Headers();
    headers.set("accept", "text/event-stream");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);

    const response = await this.fetcher(
      `${this.baseUrl}/projects/${projectId}/collaboration/events`,
      {
        method: "GET",
        headers,
        signal: options.signal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      throw new ApiError(
        payload?.message ?? "Request failed",
        response.status,
        payload,
      );
    }
    if (!response.body) return;

    await this.readEventStream(response, onEvent);
  }

  async streamCollaborationDocument(
    projectId: string,
    document: CollaborationDocumentRef,
    clientId: string,
    onEvent: (event: CollaborationEvent) => void,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const headers = new Headers();
    headers.set("accept", "text/event-stream");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);

    const response = await this.fetcher(
      `${this.baseUrl}/projects/${projectId}/collaboration/documents/${encodeURIComponent(document.kind)}/${encodeURIComponent(document.entityId)}/${encodeURIComponent(document.field)}/events?clientId=${encodeURIComponent(clientId)}`,
      {
        method: "GET",
        headers,
        signal: options.signal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      throw new ApiError(
        payload?.message ?? "Request failed",
        response.status,
        payload,
      );
    }
    if (!response.body) return;

    await this.readEventStream(response, onEvent);
  }

  private queryString(input: Record<string, unknown>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value))
        value.forEach((item) => params.append(key, String(item)));
      else params.set(key, String(value));
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  private async readEventStream<T>(
    response: Response,
    onEvent: (event: T) => void,
  ): Promise<void> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) onEvent(JSON.parse(data) as T);
      }
    }
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const headers = new Headers();
    headers.set("accept", "application/json");

    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
    }

    if (options.auth !== false && this.token) {
      headers.set("authorization", `Bearer ${this.token}`);
    }

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new ApiError(
        payload?.message ?? "Request failed",
        response.status,
        payload,
      );
    }

    return payload as T;
  }
}
