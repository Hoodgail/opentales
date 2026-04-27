function createCommandPaletteStore() {
  let open = $state(false);
  let shortcutsOpen = $state(false);

  return {
    get open() {
      return open;
    },
    get shortcutsOpen() {
      return shortcutsOpen;
    },
    show() {
      open = true;
    },
    hide() {
      open = false;
    },
    toggle() {
      open = !open;
    },
    showShortcuts() {
      shortcutsOpen = true;
    },
    hideShortcuts() {
      shortcutsOpen = false;
    }
  };
}

export const commandPalette = createCommandPaletteStore();
