'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createOllamaService, findOllamaExecutable, OLLAMA_URL } = require('../ollama.cjs');

function memoryFiles(initial = {}) {
  const files = new Map(Object.entries(initial));
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  return {
    files,
    async readFile(name) { if (!files.has(name)) throw missing(); return files.get(name); },
    async mkdir() {},
    async writeFile(name, content) { files.set(name, content); },
    async rename(from, to) { if (!files.has(from)) throw missing(); files.set(to, files.get(from)); files.delete(from); },
    async realpath(name) { if (!files.has(name)) throw missing(); return name; },
    async stat(name) { if (!files.has(name)) throw missing(); return { isFile: () => true }; }
  };
}

function fixture(options = {}) {
  const fileSystem = options.fileSystem || memoryFiles();
  const calls = [];
  const state = {
    connected: true,
    models: [{ name: 'qwen3:4b-instruct', size: 2400000000 }],
    metadata: {},
    response: { message: { content: '  学术译文。  ' }, done: true, done_reason: 'stop' },
    ...options.state
  };
  const fetchImpl = async (url, init) => {
    assert.ok(url.startsWith(`${OLLAMA_URL}/api/`), 'all inference requests stay on loopback');
    assert.equal(init.redirect, 'error');
    const endpoint = url.slice(OLLAMA_URL.length);
    const body = init.body && JSON.parse(init.body);
    calls.push({ endpoint, body });
    if (!state.connected) throw new TypeError('ECONNREFUSED');
    if (endpoint === '/api/tags') return Response.json({ models: state.models });
    if (endpoint === '/api/show') {
      if (state.showError) return Response.json({ error: 'model not found' }, { status: 404 });
      return Response.json(state.metadata[body.model] || { capabilities: ['completion'], details: { format: 'gguf' } });
    }
    if (endpoint === '/api/chat') {
      if (options.chat) return options.chat(body, calls);
      return Response.json(state.response);
    }
    throw new Error(`unexpected request ${endpoint}`);
  };
  const service = createOllamaService({ settingsPath: 'C:\\ReaderData\\settings.json', fileSystem, fetchImpl, env: {}, platform: 'win32', ...options.dependencies });
  return { service, state, calls, fileSystem };
}

test('offline state distinguishes an installed executable from not detected', async () => {
  const absent = fixture({ state: { connected: false } });
  assert.deepEqual(await absent.service.status(), {
    connected: false, installation: 'not-found', models: [], selectedModel: '',
    error: '无法连接本机 Ollama（127.0.0.1:11434）。请先启动 Ollama。'
  });
  const fileSystem = memoryFiles({ 'C:\\Users\\Student\\AppData\\Local\\Programs\\Ollama\\ollama.exe': '' });
  const installed = fixture({ fileSystem, state: { connected: false }, dependencies: { env: { LOCALAPPDATA: 'C:\\Users\\Student\\AppData\\Local' } } });
  assert.equal((await installed.service.status()).installation, 'installed');
});

test('detection searches absolute PATH entries and reports unreadable installations as unknown', async () => {
  const executable = 'D:\\LocalTools\\Ollama\\ollama.exe';
  assert.equal((await findOllamaExecutable({ fileSystem: memoryFiles({ [executable]: '' }), env: { Path: 'relative;"D:\\LocalTools\\Ollama"' }, platform: 'win32' })).executable, executable);
  const fileSystem = { realpath: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  assert.equal((await findOllamaExecutable({ fileSystem, env: { ProgramFiles: 'C:\\Program Files' }, platform: 'win32' })).installation, 'unknown');
});

test('an online service is installed even without a detected CLI; empty model list stays empty', async () => {
  const { service } = fixture({ state: { models: [] } });
  assert.deepEqual(await service.status(), { connected: true, installation: 'installed', models: [], selectedModel: '' });
  await assert.rejects(service.translate('Paper'), /选择一个已有/);
});

test('first use retains the previous qwen default but never automatically chooses another model', async () => {
  assert.equal((await fixture().service.status()).selectedModel, 'qwen3:4b-instruct');
  const { service } = fixture({ state: { models: [{ name: 'other:4b', size: 100 }] } });
  assert.equal((await service.status()).selectedModel, '');
});

test('selection persists across restarts and translation uses the selected model', async () => {
  const item = fixture({ state: { models: [{ name: 'local-paper:8b', size: 100 }] } });
  assert.equal((await item.service.selectModel('local-paper:8b')).selectedModel, 'local-paper:8b');
  const restarted = fixture({ fileSystem: item.fileSystem, state: { models: item.state.models } });
  assert.equal((await restarted.service.status()).selectedModel, 'local-paper:8b');
  assert.equal(await restarted.service.translate('  Academic paper  '), '学术译文。');
  const chat = restarted.calls.find(call => call.endpoint === '/api/chat').body;
  assert.equal(chat.model, 'local-paper:8b');
  assert.equal(chat.messages[1].content, 'Academic paper');
  assert.equal(chat.stream, false);
  assert.ok(!Object.hasOwn(chat, 'think'), 'ordinary models must not receive fixed think:false');
  assert.equal(chat.options.num_predict, 4096);
});

test('removed selected models are rejected without silently choosing a replacement', async () => {
  const { service, state, calls } = fixture();
  await service.selectModel('qwen3:4b-instruct');
  state.models = [{ name: 'other:4b', size: 100 }];
  assert.equal((await service.status()).selectedModel, '');
  await assert.rejects(service.translate('Paper'), /不在本机/);
  await assert.rejects(service.selectModel('missing:7b'), /不在本机/);
  assert.equal(calls.filter(call => call.endpoint === '/api/chat').length, 0);
});

test('embedding-only and remote models cannot be selected or sent document text', async () => {
  const { service } = fixture({ state: {
    models: [{ name: 'embed:latest' }, { name: 'hidden-cloud-alias' }, { name: 'llama:cloud' }],
    metadata: {
      'embed:latest': { capabilities: ['embedding'] },
      'hidden-cloud-alias': { capabilities: ['completion'], remote_host: 'https://ollama.com', remote_model: 'large' }
    }
  } });
  const status = await service.status();
  assert.ok(status.models.every(model => model.available === false));
  await assert.rejects(service.selectModel('embed:latest'), /不支持文字生成/);
  await assert.rejects(service.selectModel('hidden-cloud-alias'), /云端模型/);
  await assert.rejects(service.selectModel('llama:cloud'), /云端模型/);
});

test('failed model metadata checks cannot send text to an unverified model', async () => {
  const { service, state, calls } = fixture();
  await service.selectModel('qwen3:4b-instruct');
  state.showError = true;
  await assert.rejects(service.translate('Private paper'), /无法读取模型信息/);
  assert.equal(calls.filter(call => call.endpoint === '/api/chat').length, 0);
});

test('thinking is disabled only when supported and retries unsupported think errors once', async () => {
  let generations = 0;
  const { service, calls } = fixture({
    state: { metadata: { 'qwen3:4b-instruct': { capabilities: ['completion', 'thinking'], thinking: { values: [false, true], default: true } } } },
    chat: async body => {
      generations += 1;
      return generations === 1
        ? Response.json({ error: 'think is not supported' }, { status: 400 })
        : Response.json({ message: { content: '译文' }, done_reason: 'stop' });
    }
  });
  assert.equal(await service.translate('Paper'), '译文');
  const requests = calls.filter(call => call.endpoint === '/api/chat');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.think, false);
  assert.ok(!Object.hasOwn(requests[1].body, 'think'));
});

test('truncated, oversized and empty translation responses show actionable failures', async () => {
  const { service, state } = fixture();
  state.response = { message: { content: 'Partial translation' }, done_reason: 'length' };
  await assert.rejects(service.translate('Paper'), /输出上限/);
  state.response = { message: { content: 'a'.repeat(16001) } };
  await assert.rejects(service.translate('Paper'), /译文过长/);
  state.response = { message: { content: '' } };
  await assert.rejects(service.translate('Paper'), /没有返回译文/);
  await assert.rejects(service.translate('a'.repeat(3001)), /1–3000/);
});

test('request timeout terminates unresponsive status checks', async () => {
  const { service } = fixture({ dependencies: {
    requestTimeoutMs: 10,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
  } });
  assert.match((await service.status()).error, /超时/);
});

test('start does nothing to an already running service', async () => {
  const { service } = fixture({ dependencies: { spawnImpl: () => { throw new Error('must not launch'); } } });
  assert.equal((await service.startOllama()).connected, true);
});

test('start only launches a confirmed executable, with hidden window and local cloud-disabled service', async () => {
  const executable = 'C:\\Programs\\Ollama\\ollama.exe';
  const spawned = [];
  const item = fixture({
    fileSystem: memoryFiles({ [executable]: '' }), state: { connected: false },
    dependencies: {
      env: { PATH: 'C:\\Programs\\Ollama', OLLAMA_HOST: '0.0.0.0:5555' },
      sleep: async () => {},
      spawnImpl: (file, args, settings) => {
        spawned.push({ file, args, settings });
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => { item.state.connected = true; child.emit('spawn'); });
        return child;
      }
    }
  });
  assert.equal((await item.service.startOllama()).connected, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].file, executable);
  assert.deepEqual(spawned[0].args, ['serve']);
  assert.equal(spawned[0].settings.shell, false);
  assert.equal(spawned[0].settings.windowsHide, true);
  assert.equal(spawned[0].settings.env.OLLAMA_HOST, '127.0.0.1:11434');
  assert.equal(spawned[0].settings.env.OLLAMA_NO_CLOUD, '1');
});

test('start reports not detected without executing commands or downloading anything', async () => {
  const { service, calls } = fixture({ state: { connected: false }, dependencies: { spawnImpl: () => { throw new Error('must not launch'); } } });
  await assert.rejects(service.startOllama(), /未检测到可启动/);
  assert.ok(calls.every(call => call.endpoint === '/api/tags'));
});
