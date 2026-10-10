'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const projectDirectory = path.resolve(__dirname, '..');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jiao-reader-recent-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    const temporaryRoot = await fs.realpath(os.tmpdir());
    assert.ok(resolved.startsWith(temporaryRoot + path.sep));
    assert.ok(path.basename(resolved).startsWith('jiao-reader-recent-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const first = path.join(directory, 'first.pdf');
  const second = path.join(directory, 'second.pdf');
  const third = path.join(directory, 'third.pdf');
  await Promise.all([first, second, third].map(file => fs.writeFile(file, '%PDF-1.7\nfixture')));
  return { directory, first, second, third };
}

async function readerHarness(directory, { delayWrites = false, failFirstWrite = false } = {}) {
  const handlers = new Map();
  let instance;
  let selectedPath;
  let writeCount = 0;
  class BrowserWindow {
    constructor() {
      instance = this;
      this.webContents = {
        mainFrame: { url: pathToFileURL(path.join(projectDirectory, 'app', 'index.html')).href },
        setWindowOpenHandler() {},
        on() {}
      };
    }
    isDestroyed() { return false; }
    removeMenu() {}
    loadFile() {}
    on() {}
    static getAllWindows() { return [instance]; }
  }
  const mockFs = {
    ...fs,
    async writeFile(...args) {
      writeCount += 1;
      if (failFirstWrite && writeCount === 1) throw new Error('Fixture disk write failed');
      if (delayWrites) await new Promise(resolve => setTimeout(resolve, 12));
      return fs.writeFile(...args);
    }
  };
  const electron = {
    app: { setAppUserModelId() {}, getPath: () => directory, whenReady: () => Promise.resolve(), on() {}, quit() {} },
    BrowserWindow,
    dialog: { showOpenDialog: async () => ({ canceled: !selectedPath, filePaths: selectedPath ? [selectedPath] : [] }) },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    shell: { openExternal() {} }
  };
  const context = vm.createContext({
    require(moduleName) {
      if (moduleName === 'electron') return electron;
      if (moduleName === 'node:fs/promises') return mockFs;
      if (moduleName === './ollama.cjs') return { createOllamaService: () => ({}) };
      if (moduleName === './reading-store.cjs') return require('../reading-store.cjs');
      return require(moduleName);
    },
    __dirname: projectDirectory,
    process,
    Uint8Array
  });
  vm.runInContext(await fs.readFile(path.join(projectDirectory, 'main.cjs'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const event = { sender: instance.webContents, senderFrame: instance.webContents.mainFrame };
  const invoke = (channel, ...args) => handlers.get(channel)(event, ...args);
  return {
    event,
    invoke,
    async open(filePath) {
      selectedPath = filePath;
      return invoke('reader:open');
    },
    readPersisted: async () => JSON.parse(await fs.readFile(path.join(directory, 'recent.json'), 'utf8')),
    invokeUntrusted: (channel, ...args) => handlers.get(channel)({ ...event, senderFrame: { url: 'https://example.com/' } }, ...args)
  };
}

const pathsOf = entries => Array.from(entries, entry => entry.path);

test('remove one recent entry persists across restart and keeps the PDF files', async t => {
  const { directory, first, second } = await fixture(t);
  const reader = await readerHarness(directory);
  assert.equal((await reader.open(first)).path, first);
  assert.equal((await reader.open(second)).path, second);
  const remaining = await reader.invoke('reader:remove-recent', first);
  assert.deepEqual(pathsOf(remaining), [second]);
  assert.equal(remaining[0].name, 'second.pdf');
  assert.deepEqual(await reader.readPersisted(), [second]);
  const restarted = await readerHarness(directory);
  assert.deepEqual(pathsOf(await restarted.invoke('reader:recent')), [second]);
  await Promise.all([first, second].map(file => fs.access(file)));
  assert.deepEqual(pathsOf(await restarted.invoke('reader:remove-recent', first)), [second]);
});

test('clear recent entries persists an empty list without deleting papers', async t => {
  const { directory, first, second } = await fixture(t);
  const reader = await readerHarness(directory);
  await reader.open(first);
  await reader.open(second);
  assert.deepEqual(pathsOf(await reader.invoke('reader:clear-recent')), []);
  assert.deepEqual(await reader.readPersisted(), []);
  const restarted = await readerHarness(directory);
  assert.deepEqual(pathsOf(await restarted.invoke('reader:recent')), []);
  await Promise.all([first, second].map(file => fs.access(file)));
});

test('recent mutations reject malformed paths and requests outside the trusted reader frame', async t => {
  const { directory, first } = await fixture(t);
  const reader = await readerHarness(directory);
  await reader.open(first);
  for (const invalid of [null, {}, 7, '', '   ', 'bad\0path', 'x'.repeat(32769)]) {
    await assert.rejects(reader.invoke('reader:remove-recent', invalid), /无效文件路径/);
  }
  for (const channel of ['reader:recent', 'reader:remove-recent', 'reader:clear-recent']) {
    await assert.rejects(reader.invokeUntrusted(channel, first), /无效请求/);
  }
  assert.deepEqual(await reader.readPersisted(), [first]);
});

test('overlapping removes and remembers cannot overwrite each other', async t => {
  const { directory, first, second, third } = await fixture(t);
  const reader = await readerHarness(directory, { delayWrites: true });
  await reader.open(first);
  await reader.open(second);
  await Promise.all([
    reader.invoke('reader:remove-recent', first),
    reader.invoke('reader:remove-recent', second),
    reader.open(third)
  ]);
  assert.deepEqual(await reader.readPersisted(), [third]);
  // Both requests read their PDF before remembering it, which previously allowed lost updates.
  await Promise.all([reader.open(first), reader.open(second)]);
  const persisted = await reader.readPersisted();
  assert.equal(persisted.length, 3);
  assert.deepEqual(new Set(persisted), new Set([first, second, third]));
});

test('clear and a subsequent open keep the subsequently opened paper', async t => {
  const { directory, first, second, third } = await fixture(t);
  const reader = await readerHarness(directory, { delayWrites: true });
  await reader.open(first);
  await reader.open(second);
  await Promise.all([
    reader.invoke('reader:remove-recent', first),
    reader.invoke('reader:clear-recent'),
    reader.open(third)
  ]);
  assert.deepEqual(await reader.readPersisted(), [third]);
});

test('a failed disk write does not block the next recent mutation', async t => {
  const { directory, first, second } = await fixture(t);
  const reader = await readerHarness(directory, { failFirstWrite: true });
  await assert.rejects(reader.open(first), /Fixture disk write failed/);
  await reader.open(second);
  assert.deepEqual(await reader.readPersisted(), [second]);
});

test('new reading IPC methods reject untrusted frames before touching storage', async t => {
  const { directory, first } = await fixture(t);
  const reader = await readerHarness(directory);
  await reader.open(first);
  const doc = 'a'.repeat(64);
  const note = { page: 1, source: 'Selected sentence', tags: ['method'], comment: '' };
  for (const [channel, args] of [
    ['reader:set-recent-priority', [first, 'increment']],
    ['reader:annotations', [doc]],
    ['reader:save-annotation', [doc, note]],
    ['reader:remove-annotation', [doc, 'bb3192d8-0e93-45b3-bd4b-2fbfa660e6c7']],
    ['reader:selection-history', [doc]],
    ['reader:save-selection', [doc, { page: 1, source: 'Selected sentence' }]]
  ]) await assert.rejects(reader.invokeUntrusted(channel, ...args), /无效请求/);
  assert.equal((await reader.invoke('reader:set-recent-priority', first, 'increment'))[0].priority, 1);
  const saved = await reader.invoke('reader:save-annotation', doc, note);
  assert.equal((await reader.invoke('reader:annotations', doc))[0].id, saved.id);
  assert.equal((await reader.invoke('reader:remove-annotation', doc, saved.id)).length, 0);
  const selection = await reader.invoke('reader:save-selection', doc, { page: 1, source: 'Selected sentence' });
  assert.equal((await reader.invoke('reader:selection-history', doc))[0].id, selection.id);
});

test('preload exposes the expected reading storage IPC methods', async () => {
  let exposed;
  const calls = [];
  vm.runInNewContext(await fs.readFile(path.join(projectDirectory, 'preload.cjs'), 'utf8'), {
    require(moduleName) {
      assert.equal(moduleName, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, api) => { assert.equal(name, 'jiao'); exposed = api; } },
        ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve([]); } }
      };
    }
  });
  await exposed.removeRecent('paper.pdf');
  await exposed.clearRecent();
  await exposed.setRecentPriority('paper.pdf', 'reset');
  await exposed.annotations('document-id');
  const note = { page: 1, source: 'Selected sentence', tags: ['method'], comment: '' };
  await exposed.saveAnnotation('document-id', note);
  await exposed.removeAnnotation('document-id', 'note-id');
  await exposed.selectionHistory('document-id');
  const selection = { id: 'selection-id', page: 2, source: 'Full selected text' };
  await exposed.saveSelection('document-id', selection);
  assert.deepEqual(calls, [
    ['reader:remove-recent', 'paper.pdf'], ['reader:clear-recent'],
    ['reader:set-recent-priority', 'paper.pdf', 'reset'],
    ['reader:annotations', 'document-id'], ['reader:save-annotation', 'document-id', note],
    ['reader:remove-annotation', 'document-id', 'note-id'],
    ['reader:selection-history', 'document-id'], ['reader:save-selection', 'document-id', selection]
  ]);
});
