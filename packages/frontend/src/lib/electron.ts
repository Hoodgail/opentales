// Renderer-side bridge to the Electron preload (`packages/electron/preload.cjs`).
// Always returns a value: when running in a browser, calls degrade to no-ops
// and `isElectron` is false.

export interface ElectronAPI {
  isElectron: boolean;
  platform: NodeJS.Platform | 'browser';
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

const noopElectron: ElectronAPI = {
  isElectron: false,
  platform: 'browser',
  window: {
    minimize: async () => undefined,
    toggleMaximize: async () => false,
    close: async () => undefined,
    isMaximized: async () => false,
    onMaximizeChange: () => () => undefined
  }
};

export function electron(): ElectronAPI {
  if (typeof window === 'undefined') return noopElectron;
  return window.electronAPI ?? noopElectron;
}
