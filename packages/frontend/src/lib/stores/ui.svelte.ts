// Responsive workspace chrome: mobile drawers plus persisted desktop pane state.

export type Drawer = 'side' | 'inspector' | null;
export const SIDE_PANEL_DEFAULT_SIZE = 28;
export const SIDE_PANEL_MIN_SIZE = 14;
export const SIDE_PANEL_MAX_SIZE = 42;
export const SIDE_PANEL_SNAP_SIZE = 4;
const SIDE_PANEL_SIZE_KEY = 'opentales.ui.side-panel-size';
const SIDE_PANEL_COLLAPSED_KEY = 'opentales.ui.side-panel-collapsed';

export function createUi() {
  let drawer = $state<Drawer>(null);
  let sidePanelSize = $state(SIDE_PANEL_DEFAULT_SIZE);
  let sidePanelCollapsed = $state(false);
  let hydrated = false;

  function open(next: Exclude<Drawer, null>) {
    drawer = next;
  }
  function close() {
    drawer = null;
  }
  function toggle(next: Exclude<Drawer, null>) {
    drawer = drawer === next ? null : next;
  }

  function hydrate(storage = browserStorage()) {
    if (hydrated) return;
    hydrated = true;
    const savedSize = Number(storage?.getItem(SIDE_PANEL_SIZE_KEY));
    if (Number.isFinite(savedSize) && savedSize > 0) {
      sidePanelSize = clampSidePanelSize(savedSize);
    }
    sidePanelCollapsed = storage?.getItem(SIDE_PANEL_COLLAPSED_KEY) === 'true';
  }

  function setSidePanelSize(next: number, storage = browserStorage()) {
    if (!Number.isFinite(next)) return;
    if (next <= SIDE_PANEL_SNAP_SIZE) {
      collapseSidePanel(storage);
      return;
    }
    sidePanelSize = clampSidePanelSize(next);
    sidePanelCollapsed = false;
    storage?.setItem(SIDE_PANEL_SIZE_KEY, String(sidePanelSize));
    storage?.setItem(SIDE_PANEL_COLLAPSED_KEY, 'false');
  }

  function collapseSidePanel(storage = browserStorage()) {
    sidePanelCollapsed = true;
    storage?.setItem(SIDE_PANEL_COLLAPSED_KEY, 'true');
  }

  function expandSidePanel(storage = browserStorage()) {
    sidePanelCollapsed = false;
    storage?.setItem(SIDE_PANEL_COLLAPSED_KEY, 'false');
  }

  function toggleSidePanel(storage = browserStorage()) {
    if (sidePanelCollapsed) expandSidePanel(storage);
    else collapseSidePanel(storage);
  }

  return {
    get drawer() {
      return drawer;
    },
    get sidePanelSize() { return sidePanelSize; },
    get sidePanelCollapsed() { return sidePanelCollapsed; },
    open,
    close,
    toggle,
    hydrate,
    setSidePanelSize,
    collapseSidePanel,
    expandSidePanel,
    toggleSidePanel
  };
}

export const ui = createUi();

function clampSidePanelSize(value: number): number {
  return Math.min(SIDE_PANEL_MAX_SIZE, Math.max(SIDE_PANEL_MIN_SIZE, Math.round(value * 10) / 10));
}

function browserStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}
