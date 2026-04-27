// Mobile-only UI chrome state — which slide-over drawer (if any) is open.
// On desktop these stay null and the layout uses fixed panels.

export type Drawer = 'side' | 'inspector' | null;

function createUi() {
  let drawer = $state<Drawer>(null);

  function open(next: Exclude<Drawer, null>) {
    drawer = next;
  }
  function close() {
    drawer = null;
  }
  function toggle(next: Exclude<Drawer, null>) {
    drawer = drawer === next ? null : next;
  }

  return {
    get drawer() {
      return drawer;
    },
    open,
    close,
    toggle
  };
}

export const ui = createUi();
