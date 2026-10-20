const { app, BrowserWindow, ipcMain, net, shell, session, Notification } = require('electron');
const path = require('path');
const { createSofaClient, SOFA_PARTITION } = require('./sofa-client');

const REPO = 'durmazeren/mactakip';
const UPDATE_CHECK_MS = 2 * 60 * 60 * 1000;

let win = null;
let sofaClient = null;
let sofaWindow = null;
let soundBoardWin = null;

// Geliştirme/test için ayrı veri klasörü (açık olan asıl uygulamanın listesine dokunmamak için)
if (process.env.MT_USER_DATA) app.setPath('userData', process.env.MT_USER_DATA);

// İkinci açılış yeni veri sorguları başlatmasın; mevcut pencereye dönsün.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on('second-instance', () => {
  if (!win || win.isDestroyed()) { if (app.isReady()) createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#000000',
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
  win.on('closed', () => {
    if (soundBoardWin && !soundBoardWin.isDestroyed()) soundBoardWin.close();
    if (toastWin && !toastWin.isDestroyed()) toastWin.close();
  });

  // Animasyon içindeki linkler uygulamanın içinde değil, tarayıcıda açılsın
  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    // Odak animasyondayken de F (tam ekran) ve Esc (odaktan çık) çalışsın
    wc.on('before-input-event', (_ev, input) => {
      if (input.type !== 'keyDown' || input.control || input.meta || input.alt) return;
      const key = input.key === 'F' ? 'f' : input.key;
      if (key === 'f' || key === 'Escape') win.webContents.send('shortcut', key);
    });
  });
}

// Veri, animasyon ve kullanıcının açtığı SofaScore sayfası aynı oturumu kullanır.
ipcMain.handle('sofa:get', async (_e, apiPath) => {
  try { return { ok: true, data: await sofaClient.get(apiPath) }; }
  catch (err) { return { ok: false, error: { message: err.message, code: err.code,
    status: err.status, retryAt: err.retryAt } }; }
});
ipcMain.handle('sofa:state', () => sofaClient.getState());
ipcMain.handle('sofa:retry', () => sofaClient.retry());
ipcMain.handle('sofa:open', () => {
  if (sofaWindow && !sofaWindow.isDestroyed()) { sofaWindow.show(); sofaWindow.focus(); return; }
  sofaWindow = new BrowserWindow({
    width: 1100, height: 800, title: 'SofaScore · Bağlantı kontrolü',
    webPreferences: { partition: SOFA_PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  sofaWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  sofaWindow.on('closed', () => { sofaWindow = null; });
  sofaWindow.loadURL('https://www.sofascore.com/').catch(() => {});
});

// Ses panosu: ayrı, küçük pencere. Maç izlerken yanda açık kalır; kapatmak ana uygulamayı kapatmaz.
ipcMain.handle('soundboard:open', () => {
  if (soundBoardWin && !soundBoardWin.isDestroyed()) { soundBoardWin.show(); soundBoardWin.focus(); return; }
  soundBoardWin = new BrowserWindow({
    width: 600, height: 720, minWidth: 340, minHeight: 300, title: 'Ses panosu', backgroundColor: '#121a24',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  soundBoardWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  soundBoardWin.on('closed', () => { soundBoardWin = null; });
  soundBoardWin.loadFile(path.join(__dirname, 'soundboard.html'));
});
ipcMain.handle('soundboard:pin', (_e, on) => { if (soundBoardWin && !soundBoardWin.isDestroyed()) soundBoardWin.setAlwaysOnTop(!!on, 'floating'); });

/* ---------- Güncelleme (isteğe bağlı) ----------
 * Windows: electron-updater ile indirip kurar (kullanıcı onaylarsa).
 * Mac: uygulama imzasız olduğu için kendini güncelleyemez; yeni sürümün
 * indirme sayfasını açar. Kaynak koddan çalışırken (npm start) devre dışı. */

const sendUpdate = (payload) => win?.webContents.send('update:status', payload);
let updater = null;
let manualUrl = null;

function newer(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    if (process.platform === 'win32') {
      await updater.checkForUpdates();
      return;
    }
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    const rel = await res.json();
    if (rel.tag_name && newer(rel.tag_name, app.getVersion())) {
      manualUrl = rel.html_url;
      sendUpdate({ state: 'available', version: rel.tag_name.replace(/^v/, ''), manual: true });
    }
  } catch (err) {
    console.error('Güncelleme kontrolü başarısız:', err.message);
  }
}

function setupUpdater() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version, manual: false }));
  updater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
  updater.on('error', (err) => sendUpdate({ state: 'error', message: err?.message || String(err) }));
}

ipcMain.handle('update:download', async () => {
  if (manualUrl) { shell.openExternal(manualUrl); return; }
  if (updater) await updater.downloadUpdate();
});
ipcMain.handle('update:install', () => {
  if (updater) updater.quitAndInstall();
});
ipcMain.handle('app:version', () => app.getVersion());

// Masaüstü bildirimi (gol, kırmızı kart, hedef sonucu). Ses uygulamanın kendi ayarından çalınır; sistem sesi kapalı.
// Tıklanınca pencere öne gelir ve ilgili maç gösterilir.
// Sağ alt bildirim penceresi: uygulama arka plandayken gol gibi olaylarda masaüstünde (işletim sistemi bildirimi
// izni / Odaklanma modu gerekmeden) görünür. Odağı çalmaz, 7 sn sonra kaybolur; tıklanınca maça gider.
let toastWin = null;
function showToast(payload) {
  const { screen } = require('electron');
  const W = 380, H = 104;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  if (!toastWin || toastWin.isDestroyed()) {
    toastWin = new BrowserWindow({ width: W, height: H, frame: false, transparent: true, resizable: false, movable: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false, fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    toastWin.setAlwaysOnTop(true, 'screen-saver');
    toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    toastWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    toastWin.loadFile(path.join(__dirname, 'toast.html'));
  }
  toastWin.setBounds({ x: area.x + area.width - W - 12, y: area.y + area.height - H - 12, width: W, height: H });
  const send = () => { toastWin.showInactive(); toastWin.webContents.send('toast:show', payload); };
  if (toastWin.webContents.isLoading()) toastWin.webContents.once('did-finish-load', send); else send();
}
ipcMain.handle('toast:done', () => { if (toastWin && !toastWin.isDestroyed()) toastWin.hide(); });
ipcMain.handle('toast:open', (_e, matchId) => {
  if (toastWin && !toastWin.isDestroyed()) toastWin.hide();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('notify:click', matchId ?? null);
});

ipcMain.handle('notify', (_e, payload) => {
  if (!payload || typeof payload.title !== 'string') return false;
  if (win && !win.isDestroyed() && !win.isFocused()) {  // arka planda: kendi penceremiz (her platformda aynı)
    try { showToast({ title: payload.title.slice(0, 80), body: String(payload.body || '').slice(0, 160), matchId: payload.matchId ?? null }); return true; }
    catch { /* olmazsa işletim sistemi bildirimine düş */ }
  }
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title: payload.title.slice(0, 120), body: String(payload.body || '').slice(0, 240), silent: true });
  n.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('notify:click', payload.matchId ?? null);
  });
  n.show();
  return true;
});

app.whenReady().then(() => {
  if (!primaryInstance) return;
  if (process.platform === 'win32') app.setAppUserModelId('com.mactakip.app'); // Windows bildirimleri için
  const sofaSession = session.fromPartition(SOFA_PARTITION);
  sofaClient = createSofaClient({ fetch: (url, options) => sofaSession.fetch(url, options),
    onState: (state) => { if (win && !win.isDestroyed()) win.webContents.send('sofa:status', state); } });
  createWindow();
  setupUpdater();
  win.webContents.once('did-finish-load', () => setTimeout(checkForUpdates, 5000));
  setInterval(checkForUpdates, UPDATE_CHECK_MS);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
