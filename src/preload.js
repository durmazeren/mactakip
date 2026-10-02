const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sofa', {
  get: (apiPath) => ipcRenderer.invoke('sofa:get', apiPath),
});
