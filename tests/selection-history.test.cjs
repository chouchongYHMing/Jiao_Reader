'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createReadingStore } = require('../reading-store.cjs');

const firstDocument = 'a'.repeat(64);
const secondDocument = 'b'.repeat(64);
const selection = (overrides = {}) => ({
  page: 4, source: 'A full academic paragraph selected by the reader.',
  rects: [{ x: 0.1, y: 0.2, width: 0.35, height: 0.015 }], ...overrides
});

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jiao-reader-selections-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    const temporaryRoot = await fs.realpath(os.tmpdir());
    assert.ok(resolved.startsWith(temporaryRoot + path.sep));
    assert.ok(path.basename(resolved).startsWith('jiao-reader-selections-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { directory, store: createReadingStore({ directory, ...options }) };
}

test('selection capture accepts client UUIDs, generates missing IDs and ignores client timestamps', async t => {
  const { directory, store } = await fixture(t, { now: () => 1000 });
  const id = randomUUID();
  const fullSource = 'Academic line\n'.repeat(700);
  const saved = await store.saveSelection(firstDocument, selection({ id, source: fullSource, createdAt: 1, updatedAt: Number.MAX_SAFE_INTEGER }));
  assert.equal(saved.id, id);
  assert.equal(saved.source, fullSource);
  assert.equal(saved.result, '');
  assert.equal(saved.model, '');
  assert.equal(saved.createdAt, 1000);
  assert.equal(saved.updatedAt, 1000);
  const generated = await store.saveSelection(firstDocument, selection({ page: 9 }));
  assert.match(generated.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(generated.id, id);
  assert.equal(generated.createdAt, 1001);
  const restarted = createReadingStore({ directory });
  assert.deepEqual(await restarted.selectionHistory(firstDocument), [generated, saved]);
});

test('late translation updates keep selection time and capture order across restart', async t => {
  const { directory, store } = await fixture(t, { now: () => 1000 });
  const first = await store.saveSelection(firstDocument, selection({ id: randomUUID(), source: 'First paragraph.' }));
  const second = await store.saveSelection(firstDocument, selection({ id: randomUUID(), source: 'Second paragraph.' }));
  const translated = await store.saveSelection(firstDocument, selection({
    id: first.id, source: first.source, result: '第一段译文。', model: 'qwen3:4b-instruct'
  }));
  assert.equal(translated.createdAt, first.createdAt);
  assert.ok(translated.updatedAt > second.updatedAt);
  assert.equal(translated.result, '第一段译文。');
  assert.deepEqual((await store.selectionHistory(firstDocument)).map(record => record.id), [second.id, first.id]);
  const restarted = createReadingStore({ directory });
  assert.deepEqual(await restarted.selectionHistory(firstDocument), [second, translated]);
  const retained = await restarted.saveSelection(firstDocument, { id: first.id, page: first.page, source: first.source });
  assert.deepEqual(retained.rects, first.rects);
  assert.equal(retained.result, translated.result);
  assert.equal(retained.model, translated.model);
});

test('identical UUIDs in different PDFs are isolated and history operations preserve notes and recent data', async t => {
  const { directory, store } = await fixture(t);
  const id = randomUUID();
  const first = await store.saveSelection(firstDocument, selection({ id, result: 'First PDF translation.' }));
  const other = await store.saveSelection(secondDocument, selection({ id, source: 'Other PDF paragraph.' }));
  await store.remember('paper.pdf');
  const annotation = await store.saveAnnotation(firstDocument, {
    page: 2, source: 'Annotated source.', tags: ['method'], comment: 'Independent comment.', tagColors: { method: 'blue' }
  });
  await store.saveSelection(firstDocument, selection({ id, result: 'Updated first PDF translation.' }));
  assert.deepEqual(await store.selectionHistory(secondDocument), [other]);
  assert.deepEqual(await store.annotations(firstDocument), [annotation]);
  assert.equal((await store.recent())[0].path, 'paper.pdf');
  await store.clearRecent();
  const restarted = createReadingStore({ directory });
  assert.equal((await restarted.selectionHistory(firstDocument))[0].createdAt, first.createdAt);
  assert.equal((await restarted.selectionHistory(secondDocument))[0].source, other.source);
});

test('history retains the latest 100 captures and updating an older retained record does not move it', async t => {
  const { directory, store } = await fixture(t, { now: () => 1000 });
  const records = [];
  for (let index = 0; index < 102; index += 1) {
    records.push(await store.saveSelection(firstDocument, selection({ id: randomUUID(), source: `Paragraph ${index}` })));
  }
  let history = await store.selectionHistory(firstDocument);
  assert.equal(history.length, 100);
  assert.deepEqual(history.map(record => record.source), records.slice(2).reverse().map(record => record.source));
  const oldest = records[2];
  await store.saveSelection(firstDocument, selection({ id: oldest.id, source: oldest.source, result: 'Late translation.' }));
  history = await store.selectionHistory(firstDocument);
  assert.equal(history.at(-1).id, oldest.id);
  assert.equal(history.at(-1).createdAt, oldest.createdAt);
  assert.equal(history.at(-1).result, 'Late translation.');
  const persisted = JSON.parse(await fs.readFile(path.join(directory, 'selection-history', `${firstDocument}.json`), 'utf8'));
  assert.equal(persisted.length, 100);
});

test('concurrent captures and translation saves serialize without duplicating IDs or losing records', async t => {
  const { store } = await fixture(t, { now: () => 1000 });
  const id = randomUUID();
  const saving = [
    store.saveSelection(firstDocument, selection({ id })),
    store.saveSelection(firstDocument, selection({ id, result: 'Translated.', model: 'model-name' })),
    ...Array.from({ length: 6 }, (_, index) => store.saveSelection(firstDocument, selection({ source: `New paragraph ${index}` })))
  ];
  const reading = store.selectionHistory(firstDocument);
  await Promise.all(saving);
  const records = await reading;
  assert.equal(records.length, 7);
  assert.equal(new Set(records.map(record => record.id)).size, 7);
  assert.equal(records.at(-1).id, id);
  assert.equal(records.at(-1).createdAt, 1000);
  assert.equal(records.at(-1).result, 'Translated.');
  assert.deepEqual(records.slice(0, 6).map(record => record.source), [5, 4, 3, 2, 1, 0].map(index => `New paragraph ${index}`));
});

test('history without optional geometry or translation fields remains readable and updatable', async t => {
  const { directory, store } = await fixture(t, { now: () => 2000 });
  const filename = path.join(directory, 'selection-history', `${firstDocument}.json`);
  const legacy = { id: randomUUID(), page: 1, source: 'Legacy source.', createdAt: 1000, updatedAt: 1000 };
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const original = JSON.stringify([legacy]);
  await fs.writeFile(filename, original);
  const [record] = await store.selectionHistory(firstDocument);
  assert.equal(record.rects, undefined);
  assert.equal(record.result, '');
  assert.equal(record.model, '');
  assert.equal(await fs.readFile(filename, 'utf8'), original);
  const updated = await store.saveSelection(firstDocument, { ...legacy, result: 'Legacy translation.' });
  assert.equal(updated.createdAt, 1000);
  assert.equal(updated.updatedAt, 2000);
});

test('selection fields reject invalid IDs, oversized text/results/model names and invalid geometry', async t => {
  const { directory, store } = await fixture(t);
  for (const documentId of [null, '../escape', 'x'.repeat(64)]) {
    await assert.rejects(async () => store.selectionHistory(documentId), /无效文献标识/);
    await assert.rejects(async () => store.saveSelection(documentId, selection()), /无效文献标识/);
  }
  for (const invalid of [
    null, [], selection({ id: '../escape' }), selection({ page: 0 }), selection({ page: 1.5 }),
    selection({ source: ' ' }), selection({ source: 'x'.repeat(12001) }), selection({ result: null }),
    selection({ result: 'x'.repeat(64001) }), selection({ model: 42 }), selection({ model: 'x'.repeat(201) }),
    selection({ rects: null }), selection({ rects: [{ x: 0.9, y: 0, width: 0.2, height: 0.1 }] }),
    selection({ rects: [{ x: 0, y: 0, width: 0, height: 0.1 }] }),
    selection({ rects: Array(2001).fill({ x: 0, y: 0, width: 0.1, height: 0.1 }) })
  ]) await assert.rejects(async () => store.saveSelection(firstDocument, invalid));
  assert.deepEqual(await fs.readdir(directory), []);
  const limit = await store.saveSelection(firstDocument, selection({ source: 'x'.repeat(12000), result: 'y'.repeat(64000), model: 'm'.repeat(200) }));
  assert.equal(limit.source.length, 12000);
  assert.equal(limit.result.length, 64000);
  assert.equal(limit.model.length, 200);
});

test('malformed JSON, duplicate IDs and invalid stored history are never overwritten', async t => {
  const { directory, store } = await fixture(t);
  const valid = await store.saveSelection(firstDocument, selection());
  const filename = path.join(directory, 'selection-history', `${firstDocument}.json`);
  for (const corrupt of [
    '{"unfinished":', '{"wrong":"shape"}', JSON.stringify([valid, valid]),
    JSON.stringify([{ ...valid, updatedAt: valid.createdAt - 1 }]),
    JSON.stringify([{ ...valid, result: 42 }]),
    JSON.stringify([{ ...valid, rects: [{ x: 0.9, y: 0, width: 0.2, height: 0.1 }] }])
  ]) {
    await fs.writeFile(filename, corrupt);
    await assert.rejects(store.selectionHistory(firstDocument), /损坏|格式无效/);
    await assert.rejects(store.saveSelection(firstDocument, selection()), /损坏|格式无效/);
    assert.equal(await fs.readFile(filename, 'utf8'), corrupt);
  }
});

test('an atomic history replacement failure retains old translations and allows a later retry', async t => {
  const { directory, store } = await fixture(t);
  const initial = await store.saveSelection(firstDocument, selection({ result: 'Original translation.' }));
  const filename = path.join(directory, 'selection-history', `${firstDocument}.json`);
  const original = await fs.readFile(filename, 'utf8');
  let failOnce = true;
  const failing = createReadingStore({ directory, fs: {
    ...fs,
    async rename(...args) {
      if (failOnce) { failOnce = false; throw new Error('Fixture history replacement failed'); }
      return fs.rename(...args);
    }
  } });
  const updatedFields = selection({ id: initial.id, result: 'Updated translation.' });
  await assert.rejects(failing.saveSelection(firstDocument, updatedFields), /Fixture history replacement failed/);
  assert.equal(await fs.readFile(filename, 'utf8'), original);
  assert.deepEqual(await fs.readdir(path.dirname(filename)), [`${firstDocument}.json`]);
  const retried = await failing.saveSelection(firstDocument, updatedFields);
  assert.equal(retried.result, 'Updated translation.');
  assert.equal(retried.createdAt, initial.createdAt);
});

test('history permission errors reject reads and saves without treating storage as an empty list', async t => {
  const { directory } = await fixture(t);
  let wrote = false;
  const store = createReadingStore({ directory, fs: {
    ...fs,
    async readFile() { const error = new Error('Fixture history permission denied'); error.code = 'EACCES'; throw error; },
    async writeFile() { wrote = true; }
  } });
  await assert.rejects(store.selectionHistory(firstDocument), /Fixture history permission denied/);
  await assert.rejects(store.saveSelection(firstDocument, selection()), /Fixture history permission denied/);
  assert.equal(wrote, false);
});
