const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sofa', {
  get: async (apiPath, options) => {
    const result = await ipcRenderer.invoke('sofa:get', apiPath, options);
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return result.data;
  },
  connection: () => ipcRenderer.invoke('sofa:state'),
  watch: (ids) => ipcRenderer.invoke('sofa:watch', ids),
  retry: () => ipcRenderer.invoke('sofa:retry'),
  open: () => ipcRenderer.invoke('sofa:open'),
  onConnection: (cb) => {
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('sofa:status', listener);
    return () => ipcRenderer.removeListener('sofa:status', listener);
  },
});

contextBridge.exposeInMainWorld('boxScore', {
  players: (query) => ipcRenderer.invoke('box:players', query),
});

contextBridge.exposeInMainWorld('appShortcut', {
  on: (cb) => ipcRenderer.on('shortcut', (_e, key) => cb(key)),
});

contextBridge.exposeInMainWorld('appUpdate', {
  onStatus: (cb) => ipcRenderer.on('update:status', (_e, payload) => cb(payload)),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  version: () => ipcRenderer.invoke('app:version'),
});

contextBridge.exposeInMainWorld('appNotify', {
  show: (payload) => ipcRenderer.invoke('notify', payload),
  onClick: (cb) => ipcRenderer.on('notify:click', (_e, matchId) => cb(matchId)),
});

contextBridge.exposeInMainWorld('appToast', {
  onShow: (cb) => ipcRenderer.on('toast:show', (_e, p) => cb(p)),
  open: (matchId) => ipcRenderer.invoke('toast:open', matchId),
  done: () => ipcRenderer.invoke('toast:done'),
});

contextBridge.exposeInMainWorld('appSoundBoard', {
  open: () => ipcRenderer.invoke('soundboard:open'),
  pin: (on) => ipcRenderer.invoke('soundboard:pin', !!on),
});
