const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openExternal: (targetPath) =>
    ipcRenderer.invoke('dialog:openExternal', targetPath),
  processRequest: (payload) =>
    ipcRenderer.invoke('photofinder:process', payload),
  parsePreview: (payload) =>
    ipcRenderer.invoke('photofinder:preview', payload),
  suggestTargetDir: (sourcePath) =>
    ipcRenderer.invoke('fs:suggestTarget', sourcePath),
});
