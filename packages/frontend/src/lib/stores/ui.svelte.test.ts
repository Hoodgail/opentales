import { beforeEach, describe, expect, it } from 'vitest';
import {
  SIDE_PANEL_DEFAULT_SIZE,
  SIDE_PANEL_MAX_SIZE,
  SIDE_PANEL_MIN_SIZE,
  createUi
} from './ui.svelte';

describe('workspace UI pane state', () => {
  beforeEach(() => localStorage.clear());

  it('persists bounded resize and collapse preferences', () => {
    const store = createUi();
    store.hydrate();
    expect(store.sidePanelSize).toBe(SIDE_PANEL_DEFAULT_SIZE);

    store.setSidePanelSize(30.26);
    expect(store.sidePanelSize).toBe(30.3);
    expect(store.sidePanelCollapsed).toBe(false);
    store.collapseSidePanel();
    expect(store.sidePanelCollapsed).toBe(true);

    const restored = createUi();
    restored.hydrate();
    expect(restored.sidePanelSize).toBe(30.3);
    expect(restored.sidePanelCollapsed).toBe(true);
    restored.toggleSidePanel();
    expect(restored.sidePanelCollapsed).toBe(false);
  });

  it('snaps tiny panes closed and clamps expanded sizes', () => {
    const store = createUi();
    store.setSidePanelSize(1);
    expect(store.sidePanelCollapsed).toBe(true);
    store.setSidePanelSize(2_000);
    expect(store.sidePanelSize).toBe(SIDE_PANEL_MAX_SIZE);
    expect(store.sidePanelCollapsed).toBe(false);
    store.setSidePanelSize(5);
    expect(store.sidePanelSize).toBe(SIDE_PANEL_MIN_SIZE);
  });
});
