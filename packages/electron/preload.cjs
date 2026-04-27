// Bridge for the renderer (SvelteKit). Exposes a small, typed surface for
// platform integration and window controls.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manuscript', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (callback) => {
      const handler = (_event, isMaximized) => callback(Boolean(isMaximized));
      ipcRenderer.on('window:maximize-change', handler);
      return () => ipcRenderer.removeListener('window:maximize-change', handler);
    }
  }
});
