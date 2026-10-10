'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jiao', {
  open: () => ipcRenderer.invoke('reader:open'),
  openRecent: filePath => ipcRenderer.invoke('reader:open-recent', filePath),
  recent: () => ipcRenderer.invoke('reader:recent'),
  removeRecent: filePath => ipcRenderer.invoke('reader:remove-recent', filePath),
  clearRecent: () => ipcRenderer.invoke('reader:clear-recent'),
  setRecentPriority: (filePath, action) => ipcRenderer.invoke('reader:set-recent-priority', filePath, action),
  annotations: documentId => ipcRenderer.invoke('reader:annotations', documentId),
  saveAnnotation: (documentId, annotation) => ipcRenderer.invoke('reader:save-annotation', documentId, annotation),
  removeAnnotation: (documentId, annotationId) => ipcRenderer.invoke('reader:remove-annotation', documentId, annotationId),
  selectionHistory: documentId => ipcRenderer.invoke('reader:selection-history', documentId),
  saveSelection: (documentId, selection) => ipcRenderer.invoke('reader:save-selection', documentId, selection),
  status: () => ipcRenderer.invoke('reader:status'),
  selectModel: name => ipcRenderer.invoke('reader:select-model', name),
  startOllama: () => ipcRenderer.invoke('reader:start-ollama'),
  translate: text => ipcRenderer.invoke('reader:translate', text),
  ollamaSite: () => ipcRenderer.invoke('reader:ollama-site')
});
