'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createOllamaService } = require('./ollama.cjs');
const { createReadingStore } = require('./reading-store.cjs');

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const READER_URL = pathToFileURL(path.join(__dirname, 'app', 'index.html')).href;
let mainWindow;
let ollama;
let readingStore;

if (process.platform === 'win32') app.setAppUserModelId('com.jiao.reader');

// macOS keeps a global menu bar. Edit roles are required for Cmd+C / Cmd+V / Cmd+A
// in text fields and the PDF text layer; zoom roles are left out so Cmd + / − reach the reader.
function installMacMenu() {
  if (process.platform !== 'darwin') return;
  const name = 'Jiao_Reader';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: name, submenu: [
      { role: 'about', label: `关于 ${name}` },
      { type: 'separator' },
      { role: 'services', label: '服务' },
      { type: 'separator' },
      { role: 'hide', label: `隐藏 ${name}` },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      { type: 'separator' },
      { role: 'quit', label: `退出 ${name}` }
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '拷贝' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
    ] },
    { label: '窗口', role: 'window', submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放' },
      { type: 'separator' },
      { role: 'front', label: '前置全部窗口' },
      { role: 'close', label: '关闭窗口' }
    ] }
  ]));
}

async function readPdf(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.pdf') throw new Error('只能打开 PDF 文件。');
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_PDF_BYTES) throw new Error('PDF 文件超过 200 MB，或无法读取。');
  const file = await fs.readFile(filePath);
  if (file.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('文件不是有效的 PDF。');
  return { path: filePath, name: path.basename(filePath), data: new Uint8Array(file) };
}

function trusted(event) {
  try {
    return mainWindow && !mainWindow.isDestroyed()
      && event.sender === mainWindow.webContents
      && event.senderFrame === mainWindow.webContents.mainFrame
      && event.senderFrame.url === READER_URL;
  } catch { return false; }
}

function registerIpc() {
  ipcMain.handle('reader:recent', async event => {
    if (!trusted(event)) throw new Error('无效请求');
    return readingStore.recent();
  });

  ipcMain.handle('reader:remove-recent', async (event, filePath) => {
    if (!trusted(event)) throw new Error('无效请求');
    return readingStore.removeRecent(filePath);
  });

  ipcMain.handle('reader:clear-recent', async event => {
    if (!trusted(event)) throw new Error('无效请求');
    return readingStore.clearRecent();
  });

  ipcMain.handle('reader:set-recent-priority', async (event, filePath, action) => {
    if (!trusted(event)) throw new Error('无效请求');
    return readingStore.setRecentPriority(filePath, action);
  });

  ipcMain.handle('reader:annotations', async (event, documentId) => {
    if (!trusted(event)) throw new Error('无效请求');
    return readingStore.annotations(documentId);
  });

  ipcMain.handle('reader:save-annotation', async (event, documentId, annotation) => {
    if (!trusted(event)) throw new Error('无效请求');
    return readingStore.saveAnnotation(documentId, annotation);
  });

  ipcMain.handle('reader:remove-annotation', async (event, documentId, annotationId) => {
    if (!trusted(event)) throw new Error('无效请求');
    return readingStore.removeAnnotation(documentId, annotationId);
  });

  ipcMain.handle('reader:open', async event => {
    if (!trusted(event)) throw new Error('无效请求');
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: '打开论文 PDF',
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      properties: ['openFile']
    });
    if (choice.canceled || !choice.filePaths.length) return null;
    const result = await readPdf(choice.filePaths[0]);
    result.recent = await readingStore.remember(choice.filePaths[0]);
    return result;
  });

  ipcMain.handle('reader:open-recent', async (event, filePath) => {
    if (!trusted(event)) throw new Error('无效请求');
    const entries = await readingStore.recent();
    if (typeof filePath !== 'string' || !entries.some(entry => entry.path === filePath)) throw new Error('文件不在最近阅读记录中。');
    const result = await readPdf(filePath);
    result.recent = await readingStore.remember(filePath);
    return result;
  });

  ipcMain.handle('reader:status', async event => {
    if (!trusted(event)) throw new Error('无效请求');
    return ollama.status();
  });

  ipcMain.handle('reader:select-model', async (event, name) => {
    if (!trusted(event)) throw new Error('无效请求');
    return ollama.selectModel(name);
  });

  ipcMain.handle('reader:start-ollama', async event => {
    if (!trusted(event)) throw new Error('无效请求');
    return ollama.startOllama();
  });

  ipcMain.handle('reader:translate', async (event, source) => {
    if (!trusted(event)) throw new Error('无效请求');
    return ollama.translate(source);
  });

  ipcMain.handle('reader:ollama-site', async event => {
    if (!trusted(event)) throw new Error('无效请求');
    await shell.openExternal('https://ollama.com/download');
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 980,
    minHeight: 620,
    title: 'Jiao Reader',
    backgroundColor: '#f5f3ee',
    icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  readingStore = createReadingStore({ directory: app.getPath('userData'), fs });
  ollama = createOllamaService({ settingsPath: path.join(app.getPath('userData'), 'settings.json') });
  registerIpc();
  installMacMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
