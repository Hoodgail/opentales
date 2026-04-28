import {
  OpenTalesClient,
  type AcceptInviteResult,
  type Asset,
  type AssetKind,
  type CreateChapterInput,
  type CreateCharacterInput,
  type CreateCharacterRelationshipInput,
  type CreateInviteInput,
  type CreateLocationInput,
  type CreateObstacleInput,
  type CreateProjectInput,
  type ManuscriptProject,
  type MembersAndInvites,
  type OrgMember,
  type ProjectInvite,
  type ProjectSummary,
  type BetaShareLink,
  type CreateBetaShareLinkInput,
  type Role,
  type SubmissionCommentAnchor,
  type SubmissionDetail,
  type SubmissionSummary,
  type TrashItem,
  type ProjectStats,
  type UpdateChapterInput,
  type UpdateObstacleInput,
  type UpdateProjectInput
} from '@opentales/sdk';
import { syncAiToken } from '$lib/stores/ai.svelte';
import type {
  Act,
  ActivityView,
  Chapter,
  Character,
  Location,
  OpenTab,
  StoryStructure
} from '$lib/data/manuscript-types';

const api = new OpenTalesClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  token: browserLocalStorage().getItem('opentales.token') ?? undefined
});

const initialToken = browserLocalStorage().getItem('opentales.token');

function browserLocalStorage(): Storage {
  if (typeof localStorage !== 'undefined') return localStorage;
  return {
    length: 0,
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    removeItem: () => undefined,
    setItem: () => undefined
  };
}

function emptyStructure(): StoryStructure {
  return {
    title: 'OpenTales',
    genre: '',
    perspective: '',
    pov: '',
    voice: '',
    tone: '',
    themes: [],
    logline: '',
    outline: '',
    climax: '',
    obstacles: []
  };
}

function applyProject(
  project: ManuscriptProject,
  state: {
    projectId: { value: string | null };
    characters: Character[];
    locations: Location[];
    chapters: Chapter[];
    acts: Act[];
    structure: StoryStructure;
    projectMeta: {
      title: string;
      description: string;
      visibility: 'private' | 'public';
      coverUrl: string | null;
      coverOrientation: 'landscape' | 'portrait';
      orgSlug: string;
    };
  }
) {
  state.projectId.value = project.id;
  state.characters.splice(0, state.characters.length, ...project.characters);
  state.locations.splice(0, state.locations.length, ...project.locations);
  state.chapters.splice(0, state.chapters.length, ...project.chapters);
  state.acts.splice(0, state.acts.length, ...project.acts);
  Object.assign(state.structure, project.structure);
  state.projectMeta.title = project.title;
  state.projectMeta.description = project.description;
  state.projectMeta.visibility = project.visibility;
  state.projectMeta.coverUrl = project.coverUrl;
  state.projectMeta.coverOrientation = project.coverOrientation;
  state.projectMeta.orgSlug = project.orgSlug;
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function createStore() {
  const projectId = $state<{ value: string | null }>({ value: null });
  const characters = $state<Character[]>([]);
  const locations = $state<Location[]>([]);
  const chapters = $state<Chapter[]>([]);
  const acts = $state<Act[]>([]);
  const structure = $state<StoryStructure>(emptyStructure());
  const projects = $state<ProjectSummary[]>([]);
  const members = $state<OrgMember[]>([]);
  const invites = $state<ProjectInvite[]>([]);
  const projectMeta = $state<{
    title: string;
    description: string;
    visibility: 'private' | 'public';
    coverUrl: string | null;
    coverOrientation: 'landscape' | 'portrait';
    orgSlug: string;
  }>({
    title: '',
    description: '',
    visibility: 'private',
    coverUrl: null,
    coverOrientation: 'landscape',
    orgSlug: ''
  });
  let currentUserRole = $state<Role | null>(null);
  let membersLoaded = $state(false);
  let membersLoading = $state(false);
  const submissions = $state<SubmissionSummary[]>([]);
  let submissionsLoaded = $state(false);
  let submissionsLoading = $state(false);
  const submissionDetails = $state<Record<string, SubmissionDetail>>({});

  const trash = $state<TrashItem[]>([]);
  let trashLoaded = $state(false);
  let trashLoading = $state(false);

  let projectStats = $state<ProjectStats | null>(null);
  let projectStatsLoading = $state(false);

  let initializing = $state(false);
  let authenticating = $state(false);
  let authenticated = $state(Boolean(initialToken));
  let saving = $state(false);
  let error = $state<string | null>(null);
  let activeView = $state<ActivityView>('explorer');
  const tabs = $state<OpenTab[]>([]);
  let activeTabId = $state<string | null>(null);
  let selectedId = $state<string | null>(null);

  async function initialize() {
    if (initializing || projectId.value) return;
    if (!authenticated) return;

    await loadProject();
  }

  async function login(emailOrUsername: string, password: string) {
    authenticating = true;
    error = null;

    try {
      const session = await api.login({ emailOrUsername, password });
      browserLocalStorage().setItem('opentales.token', session.token);
      syncAiToken(session.token);
      authenticated = true;
      await loadProject();
    } catch (caught) {
      authenticated = false;
      api.setToken(undefined);
      browserLocalStorage().removeItem('opentales.token');
      error = caught instanceof Error ? caught.message : 'Login failed';
    } finally {
      authenticating = false;
    }
  }

  async function register(input: {
    username: string;
    email: string;
    password: string;
    name?: string;
  }) {
    authenticating = true;
    error = null;

    try {
      const session = await api.register(input);
      browserLocalStorage().setItem('opentales.token', session.token);
      syncAiToken(session.token);
      authenticated = true;
      await loadProject();
    } catch (caught) {
      authenticated = false;
      api.setToken(undefined);
      browserLocalStorage().removeItem('opentales.token');
      error = caught instanceof Error ? caught.message : 'Registration failed';
    } finally {
      authenticating = false;
    }
  }

  async function logout() {
    api.setToken(undefined);
    syncAiToken(undefined);
    browserLocalStorage().removeItem('opentales.token');
    authenticated = false;
    error = null;
    clearProject();
  }

  async function loadProject(targetProjectId?: string) {
    initializing = true;
    error = null;

    try {
      let summaries = await api.listProjects();
      if (summaries.length === 0) {
        await api.createProject({ title: 'Untitled Manuscript', slug: 'untitled-manuscript' });
        summaries = await api.listProjects();
      }
      projects.splice(0, projects.length, ...summaries);

      const target = targetProjectId
        ? summaries.find((p) => p.id === targetProjectId) ?? summaries[0]
        : summaries[0];

      const project = await api.getProject(target.id);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });

      tabs.splice(0, tabs.length);
      activeTabId = null;
      selectedId = null;

      const firstChapter = project.chapters[0];
      if (firstChapter) {
        const tab = {
          id: `tab-${firstChapter.id}`,
          type: 'chapter',
          refId: firstChapter.id,
          title: firstChapter.title
        } satisfies OpenTab;
        tabs.splice(0, tabs.length, tab);
        activeTabId = tab.id;
        selectedId = firstChapter.id;
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to load manuscript';
      if (message === 'Invalid authentication token' || message === 'Authentication required') {
        await logout();
        error = 'Please sign in again.';
        return;
      }
      error = caught instanceof Error ? caught.message : 'Failed to load manuscript';
    } finally {
      initializing = false;
    }
  }

  function clearProject() {
    projectId.value = null;
    characters.splice(0, characters.length);
    locations.splice(0, locations.length);
    chapters.splice(0, chapters.length);
    acts.splice(0, acts.length);
    projects.splice(0, projects.length);
    members.splice(0, members.length);
    invites.splice(0, invites.length);
    currentUserRole = null;
    membersLoaded = false;
    submissions.splice(0, submissions.length);
    submissionsLoaded = false;
    for (const key of Object.keys(submissionDetails)) delete submissionDetails[key];
    trash.splice(0, trash.length);
    trashLoaded = false;
    projectStats = null;
    Object.assign(structure, emptyStructure());
    projectMeta.title = '';
    projectMeta.description = '';
    projectMeta.visibility = 'private';
    projectMeta.coverUrl = null;
    projectMeta.coverOrientation = 'landscape';
    projectMeta.orgSlug = '';
    tabs.splice(0, tabs.length);
    activeTabId = null;
    selectedId = null;
  }

  async function switchProject(id: string) {
    if (id === projectId.value) return;
    membersLoaded = false;
    submissionsLoaded = false;
    trashLoaded = false;
    trash.splice(0, trash.length);
    projectStats = null;
    await loadProject(id);
  }

  function applyMembers(payload: MembersAndInvites) {
    members.splice(0, members.length, ...payload.members);
    invites.splice(0, invites.length, ...payload.invites);
    currentUserRole = payload.currentUserRole;
    membersLoaded = true;
  }

  async function loadMembers(force = false) {
    if (!projectId.value) return;
    if (membersLoading) return;
    if (membersLoaded && !force) return;
    membersLoading = true;
    try {
      const payload = await api.listMembers(projectId.value);
      applyMembers(payload);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to load members';
    } finally {
      membersLoading = false;
    }
  }

  async function loadSubmissions(force = false) {
    if (!projectId.value) return;
    if (submissionsLoading) return;
    if (submissionsLoaded && !force) return;
    submissionsLoading = true;
    try {
      const list = await api.listSubmissions(projectId.value);
      submissions.splice(0, submissions.length, ...list);
      submissionsLoaded = true;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to load submissions';
    } finally {
      submissionsLoading = false;
    }
  }

  async function loadTrash(force = false) {
    if (!projectId.value) return;
    if (trashLoading) return;
    if (trashLoaded && !force) return;
    trashLoading = true;
    try {
      const list = await api.listTrash(projectId.value);
      trash.splice(0, trash.length, ...list);
      trashLoaded = true;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to load trash';
    } finally {
      trashLoading = false;
    }
  }

  async function restoreTrashChapter(chapterId: string) {
    if (!projectId.value) return;
    await persist(async () => {
      const project = await api.restoreTrashChapter(projectId.value!, chapterId);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
    const idx = trash.findIndex((item) => item.id === chapterId);
    if (idx >= 0) trash.splice(idx, 1);
  }

  async function purgeTrashChapter(chapterId: string) {
    if (!projectId.value) return;
    await persist(async () => {
      const project = await api.purgeTrashChapter(projectId.value!, chapterId);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
    const idx = trash.findIndex((item) => item.id === chapterId);
    if (idx >= 0) trash.splice(idx, 1);
  }

  async function loadProjectStats(days?: number) {
    if (!projectId.value) return;
    if (projectStatsLoading) return;
    projectStatsLoading = true;
    try {
      const stats = await api.getProjectStats(projectId.value, days);
      projectStats = stats;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to load writing stats';
    } finally {
      projectStatsLoading = false;
    }
  }

  async function loadSubmission(id: string): Promise<SubmissionDetail | null> {
    try {
      const detail = await api.getSubmission(id);
      submissionDetails[id] = detail;
      const idx = submissions.findIndex((s) => s.id === id);
      if (idx >= 0) submissions[idx] = stripDetail(detail);
      return detail;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to load submission';
      return null;
    }
  }

  function stripDetail(detail: SubmissionDetail): SubmissionSummary {
    const { baseBody, headBody, activities, ...summary } = detail;
    void baseBody;
    void headBody;
    void activities;
    return summary;
  }

  async function submitDraft(input: {
    kind: 'chapter-edit' | 'new-chapter';
    title: string;
    message?: string;
    chapterId?: string;
    body: string;
    proposedTitle?: string;
    proposedActId?: string | null;
  }) {
    if (!projectId.value) return null;
    try {
      const summary = await api.createSubmission(projectId.value, input);
      submissions.unshift(summary);
      return summary;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to submit draft';
      return null;
    }
  }

  async function mergeSubmission(id: string) {
    try {
      const detail = await api.mergeSubmission(id);
      submissionDetails[id] = detail;
      const idx = submissions.findIndex((s) => s.id === id);
      if (idx >= 0) submissions[idx] = stripDetail(detail);
      // The canonical text changed — reload manuscript.
      if (projectId.value) {
        const project = await api.getProject(projectId.value);
        applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
      }
      return detail;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to merge submission';
      return null;
    }
  }

  async function declineSubmission(id: string) {
    try {
      const detail = await api.declineSubmission(id);
      submissionDetails[id] = detail;
      const idx = submissions.findIndex((s) => s.id === id);
      if (idx >= 0) submissions[idx] = stripDetail(detail);
      return detail;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to decline submission';
      return null;
    }
  }

  async function commentOnSubmission(
    id: string,
    body: string,
    anchor?: SubmissionCommentAnchor
  ) {
    try {
      const detail = await api.commentSubmission(id, { body, anchor });
      submissionDetails[id] = detail;
      return detail;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to post comment';
      return null;
    }
  }

  async function listBetaShareLinks(): Promise<BetaShareLink[]> {
    if (!projectId.value) return [];
    return api.listBetaShareLinks(projectId.value);
  }

  async function createBetaShareLink(input: CreateBetaShareLinkInput): Promise<BetaShareLink | null> {
    if (!projectId.value) return null;
    try {
      return await api.createBetaShareLink(projectId.value, input);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to create share link';
      return null;
    }
  }

  async function revokeBetaShareLink(shareLinkId: string): Promise<BetaShareLink | null> {
    if (!projectId.value) return null;
    try {
      return await api.revokeBetaShareLink(projectId.value, shareLinkId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to revoke share link';
      return null;
    }
  }

  async function changeMemberRole(userId: string, role: Role) {
    if (!projectId.value) return;
    await persist(async () => {
      const payload = await api.updateMemberRole(projectId.value!, userId, role);
      applyMembers(payload);
    });
  }

  async function removeMember(userId: string) {
    if (!projectId.value) return;
    await persist(async () => {
      const payload = await api.removeMember(projectId.value!, userId);
      applyMembers(payload);
    });
  }

  async function createInvite(input: CreateInviteInput): Promise<ProjectInvite | null> {
    if (!projectId.value) return null;
    const ref: { value: ProjectInvite | null } = { value: null };
    await persist(async () => {
      ref.value = await api.createInvite(projectId.value!, input);
      const payload = await api.listMembers(projectId.value!);
      applyMembers(payload);
    });
    return ref.value;
  }

  async function revokeInvite(inviteId: string) {
    if (!projectId.value) return;
    await persist(async () => {
      const payload = await api.revokeInvite(projectId.value!, inviteId);
      applyMembers(payload);
    });
  }

  async function acceptInvite(token: string): Promise<AcceptInviteResult | null> {
    if (!authenticated) {
      error = 'Sign in to accept this invitation';
      return null;
    }
    const ref: { value: AcceptInviteResult | null } = { value: null };
    await persist(async () => {
      ref.value = await api.acceptInvite(token);
    });
    if (ref.value?.projectId) {
      await loadProject(ref.value.projectId);
    }
    return ref.value;
  }

  async function updateProject(input: UpdateProjectInput) {
    if (!projectId.value) return;
    await persist(async () => {
      const summary = await api.updateProject(projectId.value!, input);
      const idx = projects.findIndex((p) => p.id === summary.id);
      if (idx >= 0) projects[idx] = summary;
      projectMeta.title = summary.title;
      projectMeta.description = summary.description;
      // Refresh full project so derived state stays consistent
      const project = await api.getProject(summary.id);
      applyProject(project, {
        projectId,
        characters,
        locations,
        chapters,
        acts,
        structure,
        projectMeta
      });
    });
  }

  async function createNewProject(input: CreateProjectInput): Promise<ProjectSummary | null> {
    const result: { value: ProjectSummary | null } = { value: null };
    await persist(async () => {
      result.value = await api.createProject(input);
    });
    if (result.value) {
      await loadProject(result.value.id);
    }
    return result.value;
  }

  async function uploadAsset(file: Blob, kind: AssetKind = 'image'): Promise<Asset | null> {
    if (!projectId.value) return null;
    let asset: Asset | null = null;
    await persist(async () => {
      asset = await api.uploadAsset(projectId.value!, file, { kind });
    });
    return asset;
  }

  async function setActiveView(v: ActivityView) {
    activeView = v;
    if (v === 'members') void loadMembers();
    if (v === 'inbox') void loadSubmissions();
  }

  async function openTab(tab: OpenTab) {
    const existing = tabs.find((t) => t.id === tab.id);
    if (!existing) tabs.push(tab);
    activeTabId = tab.id;
    selectedId = tab.refId;
  }

  async function closeTab(id: string) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    tabs.splice(idx, 1);
    if (activeTabId === id) {
      if (tabs.length === 0) activeTabId = null;
      else {
        const newIdx = Math.max(0, idx - 1);
        activeTabId = tabs[newIdx]?.id ?? null;
      }
    }
  }

  async function setActiveTab(id: string) {
    activeTabId = id;
    selectedId = tabs.find((tab) => tab.id === id)?.refId ?? selectedId;
  }

  async function setSelectedId(id: string | null) {
    selectedId = id;
  }

  async function updateChapterContent(id: string, content: string) {
    const chapter = chapters.find((candidate) => candidate.id === id);
    if (!chapter || !projectId.value) return;

    chapter.content = content;
    chapter.wordCount = countWords(content);
    await persist(async () => {
      const project = await api.updateChapter(projectId.value!, id, { content });
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function updateChapter(id: string, updates: UpdateChapterInput) {
    const chapter = chapters.find((candidate) => candidate.id === id);
    if (!chapter || !projectId.value) return;

    Object.assign(chapter, updates);
    await persist(async () => {
      const project = await api.updateChapter(projectId.value!, id, updates);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function updateCharacter(id: string, updates: Partial<Character>) {
    const character = characters.find((candidate) => candidate.id === id);
    if (!character || !projectId.value) return;

    Object.assign(character, updates);
    await persist(async () => {
      const project = await api.updateCharacter(projectId.value!, id, updates);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function updateLocation(id: string, updates: Partial<Location>) {
    const location = locations.find((candidate) => candidate.id === id);
    if (!location || !projectId.value) return;

    Object.assign(location, updates);
    await persist(async () => {
      const project = await api.updateLocation(projectId.value!, id, updates);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function setCharacterAvatar(id: string, file: Blob) {
    if (!projectId.value) return;
    const asset = await uploadAsset(file, 'image');
    if (!asset) return;
    await persist(async () => {
      const project = await api.updateCharacter(projectId.value!, id, {
        avatarAssetId: asset.id
      });
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function setProjectCover(file: Blob) {
    if (!projectId.value) return;
    const asset = await uploadAsset(file, 'image');
    if (!asset) return;
    await updateProject({ coverAssetId: asset.id });
  }

  async function setLocationImage(id: string, file: Blob) {
    if (!projectId.value) return;
    const asset = await uploadAsset(file, 'image');
    if (!asset) return;
    await persist(async () => {
      const project = await api.updateLocation(projectId.value!, id, {
        imageAssetId: asset.id
      });
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function updateStructure(updates: Partial<StoryStructure>) {
    if (!projectId.value) return;

    Object.assign(structure, updates);
    await persist(async () => {
      const project = await api.updateStructure(projectId.value!, updates);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  function findCreated<T extends { id: string }>(known: Set<string>, after: T[]): T | null {
    return after.find((item) => !known.has(item.id)) ?? null;
  }

  async function createAct(title: string): Promise<Act | null> {
    if (!projectId.value) return null;

    const known = new Set(acts.map((act) => act.id));
    let created: Act | null = null;

    await persist(async () => {
      const project = await api.createAct(projectId.value!, { title });
      created = findCreated(known, project.acts);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });

    return created;
  }

  async function renameAct(actId: string, title: string) {
    if (!projectId.value) return;

    const act = acts.find((candidate) => candidate.id === actId);
    if (act) act.title = title;

    await persist(async () => {
      const project = await api.updateAct(projectId.value!, actId, { title });
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function deleteAct(actId: string) {
    if (!projectId.value) return;

    await persist(async () => {
      const project = await api.deleteAct(projectId.value!, actId);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function createCharacter(input: CreateCharacterInput): Promise<Character | null> {
    if (!projectId.value) return null;

    const known = new Set(characters.map((character) => character.id));
    let created: Character | null = null;

    await persist(async () => {
      const project = await api.createCharacter(projectId.value!, input);
      created = findCreated(known, project.characters);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });

    if (created) {
      const newCharacter: Character = created;
      await openTab({
        id: `tab-${newCharacter.id}`,
        type: 'character',
        refId: newCharacter.id,
        title: newCharacter.name
      });
    }

    return created;
  }

  async function deleteCharacter(characterId: string) {
    if (!projectId.value) return;

    await persist(async () => {
      const project = await api.deleteCharacter(projectId.value!, characterId);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });

    await closeTab(`tab-${characterId}`);
  }

  async function createLocation(input: CreateLocationInput): Promise<Location | null> {
    if (!projectId.value) return null;

    const known = new Set(locations.map((location) => location.id));
    let created: Location | null = null;

    await persist(async () => {
      const project = await api.createLocation(projectId.value!, input);
      created = findCreated(known, project.locations);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });

    if (created) {
      const newLocation: Location = created;
      await openTab({
        id: `tab-${newLocation.id}`,
        type: 'location',
        refId: newLocation.id,
        title: newLocation.name
      });
    }

    return created;
  }

  async function deleteLocation(locationId: string) {
    if (!projectId.value) return;

    await persist(async () => {
      const project = await api.deleteLocation(projectId.value!, locationId);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });

    await closeTab(`tab-${locationId}`);
  }

  async function createChapter(input: CreateChapterInput): Promise<Chapter | null> {
    if (!projectId.value) return null;

    const known = new Set(chapters.map((chapter) => chapter.id));
    let created: Chapter | null = null;

    await persist(async () => {
      const project = await api.createChapter(projectId.value!, input);
      created = findCreated(known, project.chapters);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });

    if (created) {
      const newChapter: Chapter = created;
      await openTab({
        id: `tab-${newChapter.id}`,
        type: 'chapter',
        refId: newChapter.id,
        title: newChapter.title
      });
    }

    return created;
  }

  async function deleteChapter(chapterId: string) {
    if (!projectId.value) return;

    await persist(async () => {
      const project = await api.deleteChapter(projectId.value!, chapterId);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });

    // The chapter is now in trash on the server; force a reload next time.
    trashLoaded = false;
    await closeTab(`tab-${chapterId}`);
  }

  async function createObstacle(input: CreateObstacleInput) {
    if (!projectId.value) return;

    await persist(async () => {
      const project = await api.createObstacle(projectId.value!, input);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function updateObstacle(obstacleId: string, updates: UpdateObstacleInput) {
    if (!projectId.value) return;

    const obstacle = structure.obstacles.find((candidate) => candidate.id === obstacleId);
    if (obstacle) Object.assign(obstacle, updates);

    await persist(async () => {
      const project = await api.updateObstacle(projectId.value!, obstacleId, updates);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function deleteObstacle(obstacleId: string) {
    if (!projectId.value) return;

    await persist(async () => {
      const project = await api.deleteObstacle(projectId.value!, obstacleId);
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function addCharacterRelationship(
    fromCharacterId: string,
    input: CreateCharacterRelationshipInput
  ) {
    if (!projectId.value) return;

    await persist(async () => {
      const project = await api.createCharacterRelationship(
        projectId.value!,
        fromCharacterId,
        input
      );
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function removeCharacterRelationship(fromCharacterId: string, relationshipId: string) {
    if (!projectId.value) return;

    await persist(async () => {
      const project = await api.deleteCharacterRelationship(
        projectId.value!,
        fromCharacterId,
        relationshipId
      );
      applyProject(project, { projectId, characters, locations, chapters, acts, structure, projectMeta });
    });
  }

  async function persist(operation: () => Promise<void>) {
    saving = true;
    error = null;
    try {
      await operation();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to save changes';
    } finally {
      saving = false;
    }
  }

  return {
    get projectId() {
      return projectId.value;
    },
    get characters() {
      return characters;
    },
    get locations() {
      return locations;
    },
    get chapters() {
      return chapters;
    },
    get acts() {
      return acts;
    },
    get structure() {
      return structure;
    },
    get initializing() {
      return initializing;
    },
    get authenticating() {
      return authenticating;
    },
    get authenticated() {
      return authenticated;
    },
    get saving() {
      return saving;
    },
    get error() {
      return error;
    },
    get activeView() {
      return activeView;
    },
    setActiveView,
    get tabs() {
      return tabs;
    },
    get activeTabId() {
      return activeTabId;
    },
    openTab,
    closeTab,
    setActiveTab,
    get selectedId() {
      return selectedId;
    },
    setSelectedId,
    initialize,
    loadProject,
    login,
    register,
    logout,
    get projects() {
      return projects;
    },
    get projectMeta() {
      return projectMeta;
    },
    get members() {
      return members;
    },
    get invites() {
      return invites;
    },
    get currentUserRole() {
      return currentUserRole;
    },
    get membersLoaded() {
      return membersLoaded;
    },
    get membersLoading() {
      return membersLoading;
    },
    loadMembers,
    get submissions() {
      return submissions;
    },
    get submissionsLoaded() {
      return submissionsLoaded;
    },
    get submissionsLoading() {
      return submissionsLoading;
    },
    get submissionDetails() {
      return submissionDetails;
    },
    loadSubmissions,
    loadSubmission,
    submitDraft,
    mergeSubmission,
    declineSubmission,
    commentOnSubmission,
    listBetaShareLinks,
    createBetaShareLink,
    revokeBetaShareLink,
    changeMemberRole,
    removeMember,
    createInvite,
    revokeInvite,
    acceptInvite,
    updateProject,
    switchProject,
    createNewProject,
    uploadAsset,
    setCharacterAvatar,
    setLocationImage,
    setProjectCover,
    updateChapterContent,
    updateChapter,
    updateCharacter,
    updateLocation,
    updateStructure,
    createAct,
    renameAct,
    deleteAct,
    createCharacter,
    deleteCharacter,
    createLocation,
    deleteLocation,
    createChapter,
    deleteChapter,
    createObstacle,
    updateObstacle,
    deleteObstacle,
    addCharacterRelationship,
    removeCharacterRelationship,
    get trash() {
      return trash;
    },
    get trashLoaded() {
      return trashLoaded;
    },
    get trashLoading() {
      return trashLoading;
    },
    loadTrash,
    restoreTrashChapter,
    purgeTrashChapter,
    get projectStats() {
      return projectStats;
    },
    get projectStatsLoading() {
      return projectStatsLoading;
    },
    loadProjectStats
  };
}

export type ManuscriptStore = ReturnType<typeof createStore>;
export const manuscript: ManuscriptStore = createStore();
