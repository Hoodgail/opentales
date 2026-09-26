import type { Action } from 'svelte/action';

type Options = {
  anchor: HTMLElement;
  placement?: 'above' | 'below';
  close: (restoreFocus: boolean) => void;
};

export function menuPosition(anchor: Pick<DOMRect, 'left' | 'top' | 'bottom'>, width: number, height: number, viewport: { width: number; height: number }, placement: Options['placement']) {
  const gap = 6;
  const margin = 8;
  const above = anchor.top - gap - margin;
  const below = viewport.height - anchor.bottom - gap - margin;
  const upwards = placement === 'above' ? above >= height || above > below : below < height && above > below;
  const maxHeight = Math.max(80, upwards ? above : below);
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    top: upwards ? Math.max(margin, anchor.top - Math.min(height, maxHeight) - gap) : anchor.bottom + gap,
    maxHeight
  };
}

/** Body portal avoids clipping and transformed containing blocks in resizable IDE panes. */
export const floatingMenu: Action<HTMLElement, Options> = (node, initial) => {
  let options = initial;
  document.body.appendChild(node);
  node.style.position = 'fixed';
  node.style.zIndex = '1000';
  node.style.maxWidth = 'calc(100vw - 16px)';

  function position() {
    const result = menuPosition(options.anchor.getBoundingClientRect(), node.offsetWidth, node.scrollHeight, { width: window.innerWidth, height: window.innerHeight }, options.placement);
    node.style.left = `${result.left}px`;
    node.style.top = `${result.top}px`;
    node.style.maxHeight = `${result.maxHeight}px`;
  }
  function outside(event: Event) {
    if (event.target instanceof Node && !node.contains(event.target) && !options.anchor.contains(event.target)) options.close(false);
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      options.close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && ['Home', 'End'].includes(event.key)) return;
    const items = [...node.querySelectorAll<HTMLElement>('[data-menu-item]:not(:disabled)')];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length : current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    items[index]?.focus();
    items[index]?.scrollIntoView?.({ block: 'nearest' });
  }
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : null;
  observer?.observe(node);
  observer?.observe(options.anchor);
  position();
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('focusin', outside);
  node.addEventListener('keydown', keyboard);
  return {
    update(next) { options = next; position(); },
    destroy() {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      node.removeEventListener('keydown', keyboard);
      node.remove();
    }
  };
};
