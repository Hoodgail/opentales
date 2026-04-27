const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const url = require('node:url');

const isDev = !!process.env.ELECTRON_DEV_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    title: 'Manuscript',
    autoHideMenuBar: true,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Open external links in the OS browser instead of new electron windows.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) {
      shell.openExternal(target);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.on('maximize', () => win.webContents.send('window:maximize-change', true));
  win.on('unmaximize', () => win.webContents.send('window:maximize-change', false));

  if (isDev) {
    win.loadURL(process.env.ELECTRON_DEV_URL);
  } else {
    const indexPath = path.join(__dirname, '..', 'build', 'index.html');
    win.loadURL(
      url.format({ pathname: indexPath, protocol: 'file:', slashes: true })
    );
  }

  return win;
}

function focusedWindow() {
  return BrowserWindow.getFocusedWindow();
}

ipcMain.handle('window:minimize', () => focusedWindow()?.minimize());
ipcMain.handle('window:toggle-maximize', () => {
  const win = focusedWindow();
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  }
  win.maximize();
  return true;
});
ipcMain.handle('window:close', () => focusedWindow()?.close());
ipcMain.handle('window:is-maximized', () => focusedWindow()?.isMaximized() ?? false);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
