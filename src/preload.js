const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sofa', {
  get: async (apiPath) => {
    const result = await ipcRenderer.invoke('sofa:get', apiPath);
    if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
    return result.data;
  },
  connection: () => ipcRenderer.invoke('sofa:state'),
  retry: () => ipcRenderer.invoke('sofa:retry'),
  open: () => ipcRenderer.invoke('sofa:open'),
  onConnection: (cb) => {
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('sofa:status', listener);
    return () => ipcRenderer.removeListener('sofa:status', listener);
  },
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
