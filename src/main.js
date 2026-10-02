const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const path = require('path');

const API_BASE = 'https://www.sofascore.com/api/v1/';

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0f17',
    title: 'Maç Takip',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  // Animasyon içindeki linkler uygulamanın içinde değil, tarayıcıda açılsın
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

// Sofascore isteklerini Chromium ağ katmanından yapıyoruz: sunucu tarafı
// istemcileri (curl, node fetch) 403 alıyor, Electron'un net modülü almıyor.
ipcMain.handle('sofa:get', async (_e, apiPath) => {
  if (typeof apiPath !== 'string' || apiPath.includes('..')) throw new Error('Geçersiz yol');
  const res = await net.fetch(API_BASE + apiPath.replace(/^\/+/, ''), {
    headers: { Accept: 'application/json', Referer: 'https://www.sofascore.com/' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sofascore ${res.status}`);
  return res.json();
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
