'use strict';

const filesystem = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_RECENT = 100;
const MAX_SOURCE_LENGTH = 12000;
const MAX_COMMENT_LENGTH = 6000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const PALETTE_IDS = new Set(['amber', 'sage', 'blue', 'violet', 'peach', 'rose']);
const DEFAULT_COLOR = 'amber';
const RECT_TOLERANCE = 1e-5;
const MAX_RECTS = 2000;
const MAX_SELECTIONS = 100;
const MAX_RESULT_LENGTH = 64000;
const MAX_MODEL_LENGTH = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateFilePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.length > 32768 || filePath.includes('\0')) {
    throw new Error('无效文件路径。');
  }
  return filePath;
}

function validateDocumentId(documentId) {
  if (typeof documentId !== 'string' || !/^[0-9a-f]{64}$/i.test(documentId)) {
    throw new Error('无效文献标识。');
  }
  return documentId.toLowerCase();
}

function validateAnnotationId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('无效笔记标识。');
  return id.toLowerCase();
}

function validateSelectionId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('无效划选标识。');
  return id.toLowerCase();
}

function validatePaletteId(color) {
  if (typeof color !== 'string' || !PALETTE_IDS.has(color)) throw new Error('无效高亮颜色。');
  return color;
}

function annotationRects(rects) {
  if (!Array.isArray(rects) || rects.length > MAX_RECTS) throw new Error('无效选文位置。');
  return rects.map(rect => {
    if (!rect || typeof rect !== 'object' || Array.isArray(rect)) throw new Error('无效选文位置。');
    const { x, y, width, height } = rect;
    if (![x, y, width, height].every(Number.isFinite)
      || x < -RECT_TOLERANCE || y < -RECT_TOLERANCE
      || x > 1 + RECT_TOLERANCE || y > 1 + RECT_TOLERANCE
      || width <= 0 || height <= 0 || width > 1 + RECT_TOLERANCE || height > 1 + RECT_TOLERANCE
      || x + width > 1 + RECT_TOLERANCE || y + height > 1 + RECT_TOLERANCE) {
      throw new Error('无效选文位置。');
    }
    const normalizedX = Math.max(0, Math.min(1, x));
    const normalizedY = Math.max(0, Math.min(1, y));
    const normalizedWidth = Math.min(width, 1 - normalizedX);
    const normalizedHeight = Math.min(height, 1 - normalizedY);
    if (normalizedWidth <= 0 || normalizedHeight <= 0) throw new Error('无效选文位置。');
    return { x: normalizedX, y: normalizedY, width: normalizedWidth, height: normalizedHeight };
  });
}

function annotationFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效笔记。');
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 1000000) throw new Error('无效页码。');
  if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > MAX_SOURCE_LENGTH) {
    throw new Error('笔记原文不能为空，且不能超过 12000 个字符。');
  }
  if (!Array.isArray(input.tags) || input.tags.length > MAX_TAGS
    || input.tags.some(tag => typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH)) {
    throw new Error('最多添加 20 个标签，每个标签不能超过 50 个字符。');
  }
  if (typeof input.comment !== 'string' || input.comment.length > MAX_COMMENT_LENGTH) {
    throw new Error('评论不能超过 6000 个字符。');
  }
  const tags = [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))];
  const comment = input.comment.trim();
  if (!tags.length && !comment) throw new Error('请至少添加一个标签或一条评论。');
  const fields = { page: input.page, source: input.source, tags, comment };
  if (input.color !== undefined) fields.color = validatePaletteId(input.color);
  if (input.rects !== undefined) fields.rects = annotationRects(input.rects);
  if (input.tagColors !== undefined) {
    if (!input.tagColors || typeof input.tagColors !== 'object' || Array.isArray(input.tagColors)) {
      throw new Error('无效标签颜色。');
    }
    const entries = Object.entries(input.tagColors);
    if (entries.length > MAX_TAGS) throw new Error('无效标签颜色。');
    const canonical = new Map();
    for (const [rawTag, color] of entries) {
      const tag = rawTag.trim();
      if (!tags.includes(tag) || rawTag.length > MAX_TAG_LENGTH || canonical.has(tag)) throw new Error('无效标签颜色。');
      canonical.set(tag, validatePaletteId(color));
    }
    // Object.fromEntries creates own properties, including a tag literally named __proto__.
    fields.tagColors = Object.fromEntries(canonical);
  }
  return fields;
}

function selectionFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效划选记录。');
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 1000000) throw new Error('无效页码。');
  if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > MAX_SOURCE_LENGTH) {
    throw new Error('划选原文不能为空，且不能超过 12000 个字符。');
  }
  const fields = { page: input.page, source: input.source };
  if (input.rects !== undefined) fields.rects = annotationRects(input.rects);
  if (input.result !== undefined) {
    if (typeof input.result !== 'string' || input.result.length > MAX_RESULT_LENGTH) {
      throw new Error('翻译结果不能超过 64000 个字符。');
    }
    fields.result = input.result;
  }
  if (input.model !== undefined) {
    if (typeof input.model !== 'string' || input.model.length > MAX_MODEL_LENGTH) throw new Error('无效翻译模型。');
    fields.model = input.model;
  }
  return fields;
}

function documentTagColors(records) {
  const colors = new Map();
  for (const record of records) {
    for (const tag of record.tags) {
      if (!colors.has(tag) && record.tagColors && Object.hasOwn(record.tagColors, tag)) {
        colors.set(tag, record.tagColors[tag]);
      }
    }
  }
  return colors;
}

function colorsForTags(tags, colors) {
  return Object.fromEntries(tags.map(tag => [tag, colors.get(tag) ?? DEFAULT_COLOR]));
}

function createReadingStore({ directory, fs = filesystem, now = Date.now, uuid = randomUUID } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('无效阅读记录目录。');
  const recentPath = path.join(directory, 'recent.json');
  const metadataPath = path.join(directory, 'recent-meta.json');
  let writeQueue = Promise.resolve();

  function enqueue(operation) {
    const result = writeQueue.then(operation);
    // A failed operation must not block subsequent requests.
    writeQueue = result.catch(() => {});
    return result;
  }

  async function readJson(filename, missing) {
    let contents;
    try { contents = await fs.readFile(filename, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return missing;
      throw error;
    }
    try { return JSON.parse(contents); }
    catch { throw new Error('阅读记录文件损坏，未覆盖原文件。'); }
  }

  async function writeJson(filename, data) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(data), 'utf8');
      await fs.rename(temporary, filename);
    } finally {
      try { await fs.unlink(temporary); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  async function readRecentState() {
    const stored = await readJson(recentPath, []);
    if (!Array.isArray(stored)) throw new Error('最近阅读记录格式无效，未覆盖原文件。');
    const entries = [...new Set(stored.filter(entry => typeof entry === 'string' && entry.trim()
      && entry.length <= 32768 && !entry.includes('\0')))].slice(0, MAX_RECENT);
    const rawMetadata = await readJson(metadataPath, { version: 1, entries: {} });
    if (!rawMetadata || rawMetadata.version !== 1 || typeof rawMetadata.entries !== 'object'
      || !rawMetadata.entries || Array.isArray(rawMetadata.entries)) {
      throw new Error('阅读优先级记录格式无效，未覆盖原文件。');
    }
    const metadata = new Map();
    for (const [filePath, value] of Object.entries(rawMetadata.entries)) {
      validateFilePath(filePath);
      if (!value || !Number.isSafeInteger(value.priority) || value.priority < 0
        || !Number.isSafeInteger(value.lastReadAt) || value.lastReadAt < 0) {
        throw new Error('阅读优先级记录格式无效，未覆盖原文件。');
      }
      metadata.set(filePath, { priority: value.priority, lastReadAt: value.lastReadAt });
    }
    return { entries, metadata };
  }

  function recentList({ entries, metadata }) {
    return entries.map((filePath, index) => ({
      path: filePath,
      name: path.basename(filePath),
      priority: metadata.get(filePath)?.priority ?? 0,
      lastReadAt: metadata.get(filePath)?.lastReadAt ?? 0,
      index
    })).sort((a, b) => b.priority - a.priority || b.lastReadAt - a.lastReadAt || a.index - b.index)
      .map(({ index, ...entry }) => entry);
  }

  function nextTimestamp(values) {
    const clock = now();
    const latest = values.reduce((maximum, value) => Math.max(maximum, value), 0);
    const next = Math.max(Number.isSafeInteger(clock) && clock > 0 ? clock : 1, latest + 1);
    if (!Number.isSafeInteger(next)) throw new Error('阅读时间超出可保存范围。');
    return next;
  }

  async function writeMetadata(metadata) {
    await writeJson(metadataPath, { version: 1, entries: Object.fromEntries(metadata) });
  }

  async function recent() {
    await writeQueue;
    return recentList(await readRecentState());
  }

  function remember(filePath) {
    validateFilePath(filePath);
    return enqueue(async () => {
      const state = await readRecentState();
      const timestamp = nextTimestamp([...state.metadata.values()].map(entry => entry.lastReadAt));
      state.entries = [filePath, ...state.entries.filter(entry => entry !== filePath)].slice(0, MAX_RECENT);
      state.metadata.set(filePath, { priority: state.metadata.get(filePath)?.priority ?? 0, lastReadAt: timestamp });
      // Metadata first: a failed metadata write cannot silently record an open with an old timestamp.
      await writeMetadata(state.metadata);
      await writeJson(recentPath, state.entries);
      return recentList(state);
    });
  }

  function setRecentPriority(filePath, action) {
    validateFilePath(filePath);
    if (!['increment', 'reset'].includes(action)) return Promise.reject(new Error('无效优先级操作。'));
    return enqueue(async () => {
      const state = await readRecentState();
      if (!state.entries.includes(filePath)) throw new Error('文件不在最近阅读记录中。');
      const previous = state.metadata.get(filePath) ?? { priority: 0, lastReadAt: 0 };
      if (action === 'increment' && previous.priority === Number.MAX_SAFE_INTEGER) throw new Error('优先级已达到上限。');
      state.metadata.set(filePath, { ...previous, priority: action === 'reset' ? 0 : previous.priority + 1 });
      await writeMetadata(state.metadata);
      return recentList(state);
    });
  }

  function removeRecent(filePath) {
    validateFilePath(filePath);
    return enqueue(async () => {
      const state = await readRecentState();
      state.entries = state.entries.filter(entry => entry !== filePath);
      await writeJson(recentPath, state.entries);
      return recentList(state);
    });
  }

  function clearRecent() {
    return enqueue(async () => {
      await writeJson(recentPath, []);
      return [];
    });
  }

  function annotationPath(documentId) {
    return path.join(directory, 'annotations', `${validateDocumentId(documentId)}.json`);
  }

  async function readAnnotations(filename) {
    const records = await readJson(filename, []);
    if (!Array.isArray(records)) throw new Error('笔记文件格式无效，未覆盖原文件。');
    const seen = new Set();
    let normalized;
    try {
      normalized = records.map(record => {
        const id = validateAnnotationId(record?.id);
        const fields = annotationFields(record);
        if (seen.has(id) || !Number.isSafeInteger(record.createdAt) || record.createdAt < 1
          || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < record.createdAt) throw new Error('Invalid stored annotation');
        seen.add(id);
        return {
          id, ...fields, comment: record.comment, color: fields.color ?? DEFAULT_COLOR,
          createdAt: record.createdAt, updatedAt: record.updatedAt
        };
      });
    } catch { throw new Error('笔记文件格式无效，未覆盖原文件。'); }
    normalized.sort((a, b) => b.updatedAt - a.updatedAt);
    const colors = documentTagColors(normalized);
    return normalized.map(record => ({ ...record, tagColors: colorsForTags(record.tags, colors) }));
  }

  async function annotations(documentId) {
    const filename = annotationPath(documentId);
    await writeQueue;
    return readAnnotations(filename);
  }

  function saveAnnotation(documentId, input) {
    const filename = annotationPath(documentId);
    const fields = annotationFields(input);
    const id = input.id === undefined ? null : validateAnnotationId(input.id);
    return enqueue(async () => {
      const records = await readAnnotations(filename);
      const previous = id ? records.find(record => record.id === id) : null;
      if (id && !previous) throw new Error('笔记不存在。');
      const timestamp = nextTimestamp(records.map(record => record.updatedAt));
      const colors = documentTagColors(records);
      if (fields.tagColors) {
        for (const [tag, color] of Object.entries(fields.tagColors)) colors.set(tag, color);
      }
      const saved = {
        id: previous?.id ?? uuid(), ...fields,
        color: fields.color ?? previous?.color ?? DEFAULT_COLOR,
        tagColors: colorsForTags(fields.tags, colors),
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      if (fields.rects === undefined && previous?.rects !== undefined) saved.rects = previous.rects;
      validateAnnotationId(saved.id);
      // A tag identifies a group of independently commented selections within this PDF.
      // Recoloring the group only changes colors; related notes retain their text and timestamps.
      const next = [saved, ...records.filter(record => record.id !== saved.id)
        .map(record => ({ ...record, tagColors: colorsForTags(record.tags, colors) }))];
      await writeJson(filename, next);
      return saved;
    });
  }

  function removeAnnotation(documentId, id) {
    const filename = annotationPath(documentId);
    const validatedId = validateAnnotationId(id);
    return enqueue(async () => {
      const records = (await readAnnotations(filename)).filter(record => record.id !== validatedId);
      await writeJson(filename, records);
      return records;
    });
  }

  function selectionHistoryPath(documentId) {
    return path.join(directory, 'selection-history', `${validateDocumentId(documentId)}.json`);
  }

  async function readSelectionHistory(filename) {
    const records = await readJson(filename, []);
    if (!Array.isArray(records)) throw new Error('划选记录文件格式无效，未覆盖原文件。');
    const seen = new Set();
    let normalized;
    try {
      normalized = records.map(record => {
        const id = validateSelectionId(record?.id);
        const fields = selectionFields(record);
        if (seen.has(id) || !Number.isSafeInteger(record.createdAt) || record.createdAt < 1
          || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < record.createdAt) {
          throw new Error('Invalid stored selection');
        }
        seen.add(id);
        return {
          id, ...fields, result: fields.result ?? '', model: fields.model ?? '',
          createdAt: record.createdAt, updatedAt: record.updatedAt
        };
      });
    } catch { throw new Error('划选记录文件格式无效，未覆盖原文件。'); }
    return normalized.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SELECTIONS);
  }

  async function selectionHistory(documentId) {
    const filename = selectionHistoryPath(documentId);
    await writeQueue;
    return readSelectionHistory(filename);
  }

  function saveSelection(documentId, input) {
    const filename = selectionHistoryPath(documentId);
    const fields = selectionFields(input);
    const id = input.id === undefined ? null : validateSelectionId(input.id);
    return enqueue(async () => {
      const records = await readSelectionHistory(filename);
      const previous = id ? records.find(record => record.id === id) : null;
      const timestamp = nextTimestamp(records.map(record => record.updatedAt));
      const saved = {
        id: previous?.id ?? id ?? validateSelectionId(uuid()), ...fields,
        result: fields.result ?? previous?.result ?? '',
        model: fields.model ?? previous?.model ?? '',
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp
      };
      if (fields.rects === undefined && previous?.rects !== undefined) saved.rects = previous.rects;
      // Translation can finish after another selection. Keep the original capture order.
      const next = [saved, ...records.filter(record => record.id !== saved.id)]
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SELECTIONS);
      await writeJson(filename, next);
      return saved;
    });
  }

  return {
    recent, remember, setRecentPriority, removeRecent, clearRecent, annotations, saveAnnotation, removeAnnotation,
    selectionHistory, saveSelection
  };
}

module.exports = { createReadingStore };
