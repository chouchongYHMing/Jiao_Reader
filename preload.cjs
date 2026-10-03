'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jiao', {
  open: () => ipcRenderer.invoke('reader:open'),
  openRecent: filePath => ipcRenderer.invoke('reader:open-recent', filePath),
  recent: () => ipcRenderer.invoke('reader:recent'),
  status: () => ipcRenderer.invoke('reader:status'),
  selectModel: name => ipcRenderer.invoke('reader:select-model', name),
  startOllama: () => ipcRenderer.invoke('reader:start-ollama'),
  translate: text => ipcRenderer.invoke('reader:translate', text),
  ollamaSite: () => ipcRenderer.invoke('reader:ollama-site')
});
