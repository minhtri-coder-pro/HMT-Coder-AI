// JavaScript, preload.cjs, Electron isolated preload runtime; target: secure credential IPC.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hmtDesktop', {
  saveApiKey: key => ipcRenderer.invoke('credential:save', key),
  clearApiKey: () => ipcRenderer.invoke('credential:clear'),
  saveGitHubToken: token => ipcRenderer.invoke('github-credential:save', token),
  clearGitHubToken: () => ipcRenderer.invoke('github-credential:clear'),
  reportRendererError: detail => ipcRenderer.invoke('diagnostic:renderer-error', String(detail).slice(0, 16000)),
  loadAppData: () => ipcRenderer.invoke('app-data:load'),
  saveAppData: data => ipcRenderer.invoke('app-data:save', data),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  saveWorkspaceFiles: (files, confirmedReplace = false) => ipcRenderer.invoke('workspace:save-files', files, confirmedReplace),
  deleteWorkspaceFile: (relativePath, confirmed = false) => ipcRenderer.invoke('workspace:delete-file', relativePath, confirmed),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  }
});
