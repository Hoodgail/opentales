// Reactive viewport breakpoint store. We use it to switch between the
// desktop IDE layout (3-column) and a mobile drawer-based layout.

import { browser } from '$app/environment';

const MOBILE_QUERY = '(max-width: 767px)';

function createViewport() {
  let mobile = $state(false);

  if (browser) {
    const mql = window.matchMedia(MOBILE_QUERY);
    mobile = mql.matches;
    const onChange = (e: MediaQueryListEvent) => {
      mobile = e.matches;
    };
    // Newer browsers prefer addEventListener; Safari < 14 still uses addListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mql as any).addListener(onChange);
    }
  }

  return {
    get mobile() {
      return mobile;
    }
  };
}

export const viewport = createViewport();
