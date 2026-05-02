import {
  OpenTalesClient,
  type CollaborationDocumentEvent,
  type CollaborationDocumentRef,
  type CollaborationEditInput,
  type CollaborationLocation,
  type CollaborationPresence
} from '@opentales/sdk';
import { browser } from '$app/environment';
import { manuscript } from '$lib/stores/manuscript.svelte';

const api = new OpenTalesClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  token: browserLocalStorage().getItem('opentales.token') ?? undefined
});

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

export function syncCollaborationToken(token: string | undefined) {
  api.setToken(token);
}

let tabClientId: string | null = null;

export function createCollaborationClientId(): string {
  if (tabClientId) return tabClientId;
  tabClientId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return tabClientId;
}

function createStore() {
  const collaborators = $state<CollaborationPresence[]>([]);
  const documentSubscribers = new Map<
    string,
    Set<(event: CollaborationDocumentEvent) => void>
  >();
  let followedClientId = $state<string | null>(null);
  let projectId = $state<string | null>(null);
  let abort: AbortController | null = null;
  let pagehideCleanup: (() => void) | null = null;

  function connect(nextProjectId: string | null) {
    if (!browser || projectId === nextProjectId) return;
    leaveProject();
    abort?.abort();
    projectId = nextProjectId;
    collaborators.splice(0, collaborators.length);
    if (!nextProjectId) return;
    registerPagehideCleanup(nextProjectId);

    abort = new AbortController();
    void api
      .streamProjectCollaboration(
        nextProjectId,
        (event) => {
          if (event.type === 'project-presence') {
            collaborators.splice(0, collaborators.length, ...event.collaborators);
            const followed = followedClientId
              ? event.collaborators.find((presence) => presence.clientId === followedClientId)
              : null;
            if (followed?.location) goToLocation(followed.location);
            return;
          }
          if (event.type === 'document-event') {
            notifyDocumentSubscribers(event.document, event.event);
          }
        },
        { signal: abort.signal }
      )
      .catch((error) => {
        if (abort?.signal.aborted) return;
        console.warn('Project collaboration stream failed', error);
      });
  }

  function leaveProject() {
    pagehideCleanup?.();
    pagehideCleanup = null;
    if (!projectId) return;
    void api
      .leaveProjectCollaboration(projectId, { clientId: createCollaborationClientId() })
      .catch((error) => console.warn('Project collaboration leave failed', error));
  }

  function registerPagehideCleanup(nextProjectId: string) {
    const clientId = createCollaborationClientId();
    const token = browserLocalStorage().getItem('opentales.token');
    const leave = () => {
      const body = JSON.stringify({ clientId });
      const url = `${api.baseUrl}/projects/${nextProjectId}/collaboration/leave`;
      void fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: token ? `Bearer ${token}` : '',
          'content-type': 'application/json'
        },
        body,
        keepalive: true
      });
    };
    window.addEventListener('pagehide', leave, { once: true });
    pagehideCleanup = () => window.removeEventListener('pagehide', leave);
  }

  function currentLocation(field?: string): CollaborationLocation | null {
    const tab = manuscript.tabs.find((candidate) => candidate.id === manuscript.activeTabId);
    if (!tab) return null;
    return {
      tabType: tab.type,
      refId: tab.refId,
      title: tab.title,
      field
    };
  }

  function goToLocation(location: CollaborationLocation) {
    void manuscript.openTab({
      id: tabIdFor(location),
      type: location.tabType,
      refId: location.refId,
      title: location.title
    });
  }

  function follow(clientId: string) {
    followedClientId = followedClientId === clientId ? null : clientId;
  }

  function unfollow() {
    followedClientId = null;
  }

  function subscribeDocument(
    document: CollaborationDocumentRef,
    onEvent: (event: CollaborationDocumentEvent) => void
  ) {
    const key = documentKey(document);
    const subscribers = documentSubscribers.get(key) ?? new Set();
    subscribers.add(onEvent);
    documentSubscribers.set(key, subscribers);
    return () => {
      subscribers.delete(onEvent);
      if (subscribers.size === 0) documentSubscribers.delete(key);
    };
  }

  function notifyDocumentSubscribers(
    document: CollaborationDocumentRef,
    event: CollaborationDocumentEvent
  ) {
    const subscribers = documentSubscribers.get(documentKey(document));
    if (!subscribers) return;
    for (const subscriber of subscribers) subscriber(event);
  }

  return {
    get collaborators() {
      return collaborators;
    },
    get followedClientId() {
      return followedClientId;
    },
    connect,
    subscribeDocument,
    currentLocation,
    goToLocation,
    follow,
    unfollow
  };
}

function documentKey(document: CollaborationDocumentRef): string {
  return `${document.kind}:${document.entityId}:${document.field}`;
}

function tabIdFor(location: CollaborationLocation): string {
  if (location.tabType === 'structure') return 'tab-structure';
  if (location.tabType === 'outline') return 'tab-outline';
  return `tab-${location.refId}`;
}

export const collaboration = createStore();

export type {
  CollaborationDocumentRef,
  CollaborationDocumentEvent,
  CollaborationEditInput,
  CollaborationLocation,
  CollaborationPresence
};

export { api as collaborationApi };
