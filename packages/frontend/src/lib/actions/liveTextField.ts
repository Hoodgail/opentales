import {
  collaboration,
  collaborationApi,
  createCollaborationClientId,
  type CollaborationDocumentEvent,
  type CollaborationDocumentRef,
  type CollaborationPresence
} from '$lib/stores/collaboration.svelte';
import { manuscript } from '$lib/stores/manuscript.svelte';

type TextNode = HTMLInputElement | HTMLTextAreaElement;

interface Params {
  document: CollaborationDocumentRef;
  getValue: () => string;
  onRemoteValue: (value: string) => void;
}

export function liveTextField(node: TextNode, params: Params) {
  const clientId = createCollaborationClientId();
  let current = params;
  let revision = 0;
  let focused = false;
  let lockedBy: CollaborationPresence | null = null;
  let unsubscribe: (() => void) | null = null;
  let localValue = params.getValue();

  async function connect() {
    if (!manuscript.projectId) return;
    unsubscribe?.();
    unsubscribe = collaboration.subscribeDocument(current.document, handleEvent);
    try {
      handleEvent(await collaborationApi.getCollaborationSnapshot(manuscript.projectId, current.document));
    } catch (error) {
      console.warn('Live text field snapshot failed', error);
    }
  }

  function handleEvent(event: CollaborationDocumentEvent) {
    if (event.type === 'snapshot') {
      revision = event.snapshot.revision;
      localValue = event.snapshot.content;
      if (event.snapshot.content !== node.value) {
        node.value = event.snapshot.content;
        current.onRemoteValue(event.snapshot.content);
      }
      updateLock();
      return;
    }
    if (event.type === 'edit') {
      revision = Math.max(revision, event.edit.revision);
      if (event.edit.clientId !== clientId) {
        const next = applyChanges(localValue, event.edit.changes);
        localValue = next;
        node.value = next;
        current.onRemoteValue(next);
      }
      updateLock();
      return;
    }
    if (event.type === 'presence' || event.type === 'leave') updateLock();
  }

  function sendEdit() {
    if (!manuscript.projectId || lockedBy) return;
    const next = node.value;
    const previous = localValue;
    localValue = next;
    void collaborationApi
      .applyCollaborationEdit(manuscript.projectId, current.document, {
        clientId,
        baseRevision: revision,
        changes: [{ rangeOffset: 0, rangeLength: previous.length, text: next }],
        selection: null,
        focused,
        location: collaboration.currentLocation(current.document.field)
      })
      .then((response) => {
        if (response.type === 'edit') revision = response.edit.revision;
      })
      .catch((error) => console.warn('Live text field edit failed', error));
  }

  function sendPresence(nextFocused: boolean) {
    focused = nextFocused;
    if (!manuscript.projectId) return;
    void collaborationApi
      .updateCollaborationPresence(manuscript.projectId, current.document, {
        clientId,
        selection: null,
        focused,
        location: focused ? collaboration.currentLocation(current.document.field) : null
      })
      .catch((error) => console.warn('Live text field presence failed', error));
  }

  function updateLock() {
    lockedBy =
      collaboration.collaborators.find(
        (presence) =>
          presence.clientId !== clientId &&
          presence.focused &&
          sameDocument(presence.document, current.document)
      ) ?? null;
    node.toggleAttribute('readonly', Boolean(lockedBy));
    node.classList.toggle('opentales-live-locked', Boolean(lockedBy));
    node.title = lockedBy
      ? `${lockedBy.user.name ?? lockedBy.user.username} is editing this field`
      : '';
  }

  function handleFocus() {
    updateLock();
    if (lockedBy) node.blur();
    else sendPresence(true);
  }

  function handleBlur() {
    sendPresence(false);
  }

  function handleInput() {
    current.onRemoteValue(node.value);
    sendEdit();
  }

  node.addEventListener('focus', handleFocus);
  node.addEventListener('blur', handleBlur);
  node.addEventListener('input', handleInput);
  connect();

  return {
    update(next: Params) {
      const keyChanged = !sameDocument(current.document, next.document);
      current = next;
      if (!focused) localValue = next.getValue();
      if (keyChanged) connect();
      updateLock();
    },
    destroy() {
      sendPresence(false);
      unsubscribe?.();
      node.removeEventListener('focus', handleFocus);
      node.removeEventListener('blur', handleBlur);
      node.removeEventListener('input', handleInput);
    }
  };
}

function sameDocument(a: CollaborationDocumentRef, b: CollaborationDocumentRef): boolean {
  return a.kind === b.kind && a.entityId === b.entityId && a.field === b.field;
}

function applyChanges(
  value: string,
  changes: { rangeOffset: number; rangeLength: number; text: string }[]
): string {
  return [...changes]
    .sort((a, b) => b.rangeOffset - a.rangeOffset)
    .reduce((next, change) => {
      const start = Math.min(change.rangeOffset, next.length);
      const end = Math.min(start + change.rangeLength, next.length);
      return next.slice(0, start) + change.text + next.slice(end);
    }, value);
}
