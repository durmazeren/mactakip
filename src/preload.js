const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sofa', {
  get: (apiPath) => ipcRenderer.invoke('sofa:get', apiPath),
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
