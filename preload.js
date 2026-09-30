const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dash', {
  loadItems: () => ipcRenderer.invoke('items:load'),
  saveItems: (items) => ipcRenderer.invoke('items:save', items),
  pickExe: () => ipcRenderer.invoke('items:pickExe'),
  pickFolder: () => ipcRenderer.invoke('items:pickFolder'),
  startLaunch: () => ipcRenderer.invoke('launch:start'),
  cancelLaunch: () => ipcRenderer.invoke('launch:cancel'),
  onStatus: (cb) => ipcRenderer.on('launch:status', (_e, payload) => cb(payload)),
  onProgress: (cb) => ipcRenderer.on('launch:progress', (_e, payload) => cb(payload)),
  onBlocked: (cb) => ipcRenderer.on('launch:blocked', (_e, payload) => cb(payload)),
  onDone: (cb) => ipcRenderer.on('launch:done', (_e, payload) => cb(payload))
});
