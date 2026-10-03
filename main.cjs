'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createOllamaService } = require('./ollama.cjs');

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const READER_URL = pathToFileURL(path.join(__dirname, 'app', 'index.html')).href;
let mainWindow;
let ollama;

app.setAppUserModelId('com.jiao.reader');

function preferencesPath() {
  return path.join(app.getPath('userData'), 'recent.json');
}

async function getRecent() {
  try {
    const entries = JSON.parse(await fs.readFile(preferencesPath(), 'utf8'));
    return Array.isArray(entries) ? entries.filter(entry => typeof entry === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

async function remember(filePath) {
  const entries = await getRecent();
  const next = [filePath, ...entries.filter(entry => entry !== filePath)].slice(0, 8);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(preferencesPath(), JSON.stringify(next), 'utf8');
  return next.map(entry => ({ path: entry, name: path.basename(entry) }));
}

async function readPdf(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.pdf') throw new Error('只能打开 PDF 文件。');
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_PDF_BYTES) throw new Error('PDF 文件超过 200 MB，或无法读取。');
  const file = await fs.readFile(filePath);
  if (file.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('文件不是有效的 PDF。');
  return { name: path.basename(filePath), data: new Uint8Array(file) };
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
    return (await getRecent()).map(entry => ({ path: entry, name: path.basename(entry) }));
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
    result.recent = await remember(choice.filePaths[0]);
    return result;
  });

  ipcMain.handle('reader:open-recent', async (event, filePath) => {
    if (!trusted(event)) throw new Error('无效请求');
    const entries = await getRecent();
    if (typeof filePath !== 'string' || !entries.includes(filePath)) throw new Error('文件不在最近阅读记录中。');
    const result = await readPdf(filePath);
    result.recent = await remember(filePath);
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
  ollama = createOllamaService({ settingsPath: path.join(app.getPath('userData'), 'settings.json') });
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
