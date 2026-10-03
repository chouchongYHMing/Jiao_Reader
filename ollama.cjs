'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3:4b-instruct';
const MAX_TEXT_CHARS = 3000;
const MAX_TRANSLATION_CHARS = 16000;

class OllamaError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function environmentValue(env, name) {
  const key = Object.keys(env).find(key => key.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

// Never search the current directory or execute a shell command supplied by the renderer.
async function findOllamaExecutable({ fileSystem = fs, env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return { installation: 'unknown', executable: null };
  const candidates = [];
  const local = environmentValue(env, 'LOCALAPPDATA');
  const profile = environmentValue(env, 'USERPROFILE');
  if (local) candidates.push(path.win32.join(local, 'Programs', 'Ollama', 'ollama.exe'));
  if (profile) candidates.push(path.win32.join(profile, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'));
  for (const key of ['ProgramW6432', 'ProgramFiles', 'ProgramFiles(x86)']) {
    const base = environmentValue(env, key);
    if (base) candidates.push(path.win32.join(base, 'Ollama', 'ollama.exe'));
  }
  for (const entry of (environmentValue(env, 'PATH') || '').split(';')) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    if (/^[A-Za-z]:[\\/]/.test(directory)) candidates.push(path.win32.join(directory, 'ollama.exe'));
  }
  let incomplete = false;
  for (const candidate of [...new Set(candidates)]) {
    if (!/^[A-Za-z]:[\\/]/.test(candidate)) continue;
    try {
      const resolved = await fileSystem.realpath(candidate);
      if (!/^[A-Za-z]:[\\/]/.test(resolved) || path.win32.basename(resolved).toLowerCase() !== 'ollama.exe') continue;
      if ((await fileSystem.stat(resolved)).isFile()) return { installation: 'installed', executable: resolved };
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) incomplete = true;
    }
  }
  return { installation: incomplete ? 'unknown' : 'not-found', executable: null };
}

function isRemoteModel(model) {
  return Boolean(model.remote_host || model.remote_model || /(?:^|[:-])cloud(?:$|[-:])/i.test(model.name || ''));
}

function createOllamaService({
  settingsPath,
  fetchImpl = globalThis.fetch,
  fileSystem = fs,
  spawnImpl = spawn,
  env = process.env,
  platform = process.platform,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  requestTimeoutMs = 4000,
  translationTimeoutMs = 180000,
  startAttempts = 20
} = {}) {
  if (!settingsPath) throw new Error('缺少设置文件路径。');
  let preferencesPromise;
  let preferences = { selectedModel: '', initialized: false };
  let selectionQueue = Promise.resolve();
  let startPromise;
  let translating = false;
  const metadataCache = new Map();

  async function loadPreferences() {
    preferencesPromise ||= (async () => {
      try {
        const saved = JSON.parse(await fileSystem.readFile(settingsPath, 'utf8'));
        preferences = { selectedModel: typeof saved.selectedModel === 'string' ? saved.selectedModel : '', initialized: true };
      } catch { /* A missing/corrupt preference file must not prevent PDF reading. */ }
    })();
    await preferencesPromise;
  }

  async function saveSelection(name) {
    const next = { selectedModel: name, initialized: true };
    const temporary = `${settingsPath}.tmp`;
    try {
      await fileSystem.mkdir(path.dirname(settingsPath), { recursive: true });
      await fileSystem.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
      await fileSystem.rename(temporary, settingsPath);
      preferences = next;
    } catch {
      throw new OllamaError('无法保存所选模型。请检查用户设置目录的写入权限。', 'settings');
    }
  }

  async function request(endpoint, { body, timeout = requestTimeoutMs, maxBytes = 4 * 1024 * 1024 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let reader;
    try {
      const response = await fetchImpl(`${OLLAMA_URL}${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error'
      });
      if (!response.body) throw new OllamaError('Ollama 返回了空响应。', 'invalid-response');
      reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new OllamaError('Ollama 返回的内容过大，请缩小选中文字后重试。', 'response-limit');
        }
        chunks.push(Buffer.from(value));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let data;
      try { data = JSON.parse(raw); } catch {
        throw new OllamaError(`Ollama 返回了无法解析的响应${response.ok ? '' : `（HTTP ${response.status}）`}。`, 'invalid-response', response.status);
      }
      if (!response.ok || data?.error) {
        const detail = typeof data?.error === 'string' ? data.error.slice(0, 300) : '请求失败';
        throw new OllamaError(`Ollama 返回 ${response.status}：${detail}`, 'http', response.status);
      }
      return data;
    } catch (error) {
      if (error instanceof OllamaError) throw error;
      if (controller.signal.aborted) throw new OllamaError('Ollama 响应超时。首次加载模型可能较慢，请稍后重试或选择更小的模型。', 'timeout');
      throw new OllamaError('无法连接本机 Ollama（127.0.0.1:11434）。请先启动 Ollama。', 'connection');
    } finally {
      clearTimeout(timer);
      reader?.releaseLock();
    }
  }

  async function listModels(timeout) {
    const data = await request('/api/tags', { timeout, maxBytes: 1024 * 1024 });
    if (!Array.isArray(data?.models)) throw new OllamaError('Ollama 返回的模型列表无效。', 'invalid-response');
    const names = new Set();
    return data.models.filter(model => {
      const name = model?.name || model?.model;
      if (typeof name !== 'string' || !name || name.length > 256 || names.has(name)) return false;
      names.add(name);
      model.name = name;
      return true;
    });
  }

  async function inspectModel(model, fresh = false) {
    const result = { name: model.name, size: Number.isFinite(model.size) ? model.size : 0, available: true };
    if (isRemoteModel(model)) return { ...result, available: false, reason: '云端模型不能用于本地翻译。' };
    try {
      const cacheKey = `${model.name}:${model.digest || ''}`;
      let cached = metadataCache.get(cacheKey);
      if (fresh || !cached || Date.now() - cached.time > 30000) {
        cached = { time: Date.now(), data: await request('/api/show', { body: { model: model.name, verbose: false } }) };
        if (metadataCache.size > 256) metadataCache.clear();
        metadataCache.set(cacheKey, cached);
      }
      const info = cached.data;
      if (!info || typeof info !== 'object') throw new Error('Invalid metadata');
      if (isRemoteModel(info)) return { ...result, available: false, reason: '云端模型不能用于本地翻译。' };
      if (Array.isArray(info.capabilities)) {
        result.capabilities = info.capabilities.filter(value => typeof value === 'string');
        if (!result.capabilities.includes('completion')) {
          result.available = false;
          result.reason = '该模型不支持文字生成，无法翻译（例如向量模型）。';
        }
      }
      // Old Ollama versions omit capabilities; retain compatibility with their local model metadata.
      if (!info.model_info && !info.details && !Array.isArray(info.capabilities)) {
        return { ...result, available: false, reason: '无法确认该模型为本地模型，请更新 Ollama 后重新检查。' };
      }
      return { ...result, thinking: info.thinking };
    } catch (error) {
      return { ...result, available: false, reason: `无法读取模型信息，请重新检查。${error instanceof OllamaError ? error.message : ''}` };
    }
  }

  function publicModel(model) {
    const { thinking, ...result } = model;
    return result;
  }

  async function status() {
    await loadPreferences();
    let listed;
    try { listed = await listModels(); } catch (error) {
      const installation = await findOllamaExecutable({ fileSystem, env, platform });
      return { connected: false, installation: installation.installation, models: [], selectedModel: '', error: error.message };
    }
    const models = [];
    // A bounded number of parallel metadata calls keeps large local libraries responsive.
    for (let index = 0; index < listed.length; index += 4) {
      models.push(...await Promise.all(listed.slice(index, index + 4).map(model => inspectModel(model))));
    }
    let selected = models.find(model => model.name === preferences.selectedModel && model.available);
    if (!preferences.initialized) selected = models.find(model => model.name === DEFAULT_MODEL && model.available);
    return {
      connected: true,
      installation: 'installed',
      models: models.map(publicModel),
      selectedModel: selected?.name || '',
      ...(!selected && preferences.selectedModel ? { error: '之前选择的模型已不可用，请重新选择已有的本地模型。' } : {})
    };
  }

  async function validateModel(name) {
    if (typeof name !== 'string' || !name || name.length > 256) throw new OllamaError('请选择列表中的本地模型。', 'model');
    const model = (await listModels()).find(item => item.name === name);
    if (!model) throw new OllamaError('所选模型不在本机 Ollama 模型列表中。请重新检查模型列表。', 'model');
    const inspected = await inspectModel(model, true);
    if (!inspected.available) throw new OllamaError(inspected.reason, 'model');
    return inspected;
  }

  function selectModel(name) {
    const action = selectionQueue.then(async () => {
      await loadPreferences();
      await validateModel(name);
      await saveSelection(name);
      return status();
    });
    selectionQueue = action.catch(() => {});
    return action;
  }

  async function translate(source) {
    if (typeof source !== 'string' || !source.trim() || source.trim().length > MAX_TEXT_CHARS) {
      throw new OllamaError('请选择 1–3000 字的文字。', 'input');
    }
    if (translating) throw new OllamaError('已有翻译正在进行，请等待完成。', 'busy');
    translating = true;
    try {
      await loadPreferences();
      let name = preferences.selectedModel;
      if (!preferences.initialized) {
        name = (await listModels()).find(model => model.name === DEFAULT_MODEL)?.name || '';
      }
      if (!name) throw new OllamaError('请先在模型面板选择一个已有的本地模型。', 'model');
      const model = await validateModel(name);
      const body = {
        model: model.name,
        stream: false,
        messages: [
          { role: 'system', content: '你是论文翻译助手。请把英文论文文本翻译成简体中文，保留公式、变量、引用编号和专业术语。只输出译文，不要解释。' },
          { role: 'user', content: source.trim() }
        ],
        options: { temperature: 0.2, num_predict: 4096 }
      };
      // Only send a thinking control that this particular model advertises.
      if (model.thinking?.values?.includes(false)) body.think = false;
      let data;
      try {
        data = await request('/api/chat', { body, timeout: translationTimeoutMs, maxBytes: 512 * 1024 });
      } catch (error) {
        if ('think' in body && error.status === 400 && /think/i.test(error.message)) {
          delete body.think;
          data = await request('/api/chat', { body, timeout: translationTimeoutMs, maxBytes: 512 * 1024 });
        } else throw error;
      }
      const translation = typeof data?.message?.content === 'string' ? data.message.content.trim() : '';
      if (!translation) throw new OllamaError('模型没有返回译文。请尝试更短的选文或更换文字生成模型。', 'empty');
      if (translation.length > MAX_TRANSLATION_CHARS) throw new OllamaError('译文过长，请缩小选中文字后重试。', 'response-limit');
      if (data.done_reason === 'length') throw new OllamaError('本次译文达到输出上限，请缩小选中文字后重试，以获得完整译文。', 'response-limit');
      return translation;
    } finally { translating = false; }
  }

  function startOllama() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try { await listModels(); return status(); } catch { /* Only launch when the local service cannot be reached. */ }
      const found = await findOllamaExecutable({ fileSystem, env, platform });
      if (!found.executable) {
        throw new OllamaError('未检测到可启动的 Ollama 程序。请安装 Ollama，或从开始菜单手动启动后重新检查。', 'installation');
      }
      await new Promise((resolve, reject) => {
        const child = spawnImpl(found.executable, ['serve'], {
          shell: false,
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
          env: { ...env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_NO_CLOUD: '1' }
        });
        child.once('error', () => reject(new OllamaError('无法启动 Ollama。请从开始菜单手动启动后重新检查。', 'launch')));
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      for (let attempt = 0; attempt < startAttempts; attempt += 1) {
        await sleep(500);
        try { await listModels(1000); return status(); } catch { /* Give the new service time to bind. */ }
      }
      return { connected: false, installation: 'installed', models: [], selectedModel: '', error: '已尝试启动 Ollama，但本地服务尚未就绪。请稍后重新检查，或从开始菜单手动启动 Ollama。' };
    })().finally(() => { startPromise = null; });
    return startPromise;
  }

  return { status, selectModel, translate, startOllama };
}

module.exports = { createOllamaService, findOllamaExecutable, MAX_TEXT_CHARS, MAX_TRANSLATION_CHARS, OLLAMA_URL };
