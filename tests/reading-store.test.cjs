'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createReadingStore } = require('../reading-store.cjs');

const firstDocument = 'a'.repeat(64);
const secondDocument = 'b'.repeat(64);
const note = (overrides = {}) => ({ page: 3, source: 'A selected academic sentence.', tags: ['method'], comment: '', ...overrides });
const paths = entries => entries.map(entry => entry.path);

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jiao-reader-store-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    const temporaryRoot = await fs.realpath(os.tmpdir());
    assert.ok(resolved.startsWith(temporaryRoot + path.sep));
    assert.ok(path.basename(resolved).startsWith('jiao-reader-store-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { directory, store: createReadingStore({ directory, ...options }) };
}

test('legacy string history migrates without changing its order and remains compatible on disk', async t => {
  const { directory, store } = await fixture(t, { now: () => 1000 });
  const recentPath = path.join(directory, 'recent.json');
  await fs.writeFile(recentPath, JSON.stringify(['second.pdf', 'first.pdf', 'first.pdf', 42]));
  const initial = await store.recent();
  assert.deepEqual(paths(initial), ['second.pdf', 'first.pdf']);
  assert.ok(initial.every(entry => entry.priority === 0 && entry.lastReadAt === 0));
  const promoted = await store.setRecentPriority('first.pdf', 'increment');
  assert.equal(promoted[0].lastReadAt, 0);
  await store.remember('third.pdf');
  assert.deepEqual(JSON.parse(await fs.readFile(recentPath, 'utf8')), ['third.pdf', 'second.pdf', 'first.pdf']);
  const restarted = createReadingStore({ directory });
  assert.deepEqual(paths(await restarted.recent()), ['first.pdf', 'third.pdf', 'second.pdf']);
});

test('priority sorts descending, ties use read time, and increment/reset never change read time', async t => {
  const { directory, store } = await fixture(t, { now: () => 1000 });
  await store.remember('first.pdf');
  await store.remember('second.pdf');
  const initial = await store.remember('third.pdf');
  const originalTimes = new Map(initial.map(entry => [entry.path, entry.lastReadAt]));
  assert.deepEqual(paths(initial), ['third.pdf', 'second.pdf', 'first.pdf']);
  await store.setRecentPriority('first.pdf', 'increment');
  let result = await store.setRecentPriority('second.pdf', 'increment');
  assert.deepEqual(paths(result), ['second.pdf', 'first.pdf', 'third.pdf']);
  result = await store.setRecentPriority('first.pdf', 'increment');
  assert.deepEqual(paths(result), ['first.pdf', 'second.pdf', 'third.pdf']);
  result = await store.setRecentPriority('first.pdf', 'reset');
  assert.deepEqual(paths(result), ['second.pdf', 'third.pdf', 'first.pdf']);
  assert.ok(result.every(entry => entry.lastReadAt === originalTimes.get(entry.path)));
  const restarted = createReadingStore({ directory });
  assert.deepEqual(await restarted.recent(), result);
});

test('concurrent priority operations and opens preserve increments and monotonic timestamps', async t => {
  const { store } = await fixture(t, { now: () => 1000 });
  await store.remember('first.pdf');
  await Promise.all(Array.from({ length: 12 }, () => store.setRecentPriority('first.pdf', 'increment')));
  await Promise.all([store.remember('second.pdf'), store.remember('first.pdf'), store.remember('third.pdf')]);
  const result = await store.recent();
  assert.equal(result[0].path, 'first.pdf');
  assert.equal(result[0].priority, 12);
  assert.deepEqual(new Set(result.map(entry => entry.lastReadAt)), new Set([1001, 1002, 1003]));
  assert.deepEqual(paths(await store.setRecentPriority('first.pdf', 'reset')), ['third.pdf', 'first.pdf', 'second.pdf']);
});

test('recent history keeps up to 100 documents rather than the previous eight', async t => {
  const { directory, store } = await fixture(t, { now: () => 1000 });
  for (let index = 0; index <= 100; index += 1) await store.remember(`paper-${index}.pdf`);
  const result = await store.recent();
  assert.equal(result.length, 100);
  assert.equal(result[0].path, 'paper-100.pdf');
  assert.ok(!paths(result).includes('paper-0.pdf'));
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'recent.json'), 'utf8')).length, 100);
});

test('annotations support create, update, restart, per-document isolation and deletion', async t => {
  const { directory, store } = await fixture(t, { now: () => 1000 });
  const first = await store.saveAnnotation(firstDocument, note({ tags: [' method ', 'method', 'result'] }));
  const second = await store.saveAnnotation(firstDocument, note({ page: 5, tags: [], comment: 'Compare this result.' }));
  const other = await store.saveAnnotation(secondDocument, note({ page: 9 }));
  assert.deepEqual(first.tags, ['method', 'result']);
  assert.deepEqual((await store.annotations(firstDocument)).map(record => record.id), [second.id, first.id]);
  const edited = await store.saveAnnotation(firstDocument, note({ id: first.id, comment: 'Check assumptions.' }));
  assert.equal(edited.createdAt, first.createdAt);
  assert.ok(edited.updatedAt > second.updatedAt);
  const restarted = createReadingStore({ directory });
  assert.deepEqual((await restarted.annotations(firstDocument)).map(record => record.id), [first.id, second.id]);
  assert.deepEqual((await restarted.annotations(secondDocument)).map(record => record.id), [other.id]);
  assert.deepEqual((await restarted.removeAnnotation(firstDocument, first.id)).map(record => record.id), [second.id]);
  assert.deepEqual((await restarted.removeAnnotation(firstDocument, first.id)).map(record => record.id), [second.id]);
});

test('concurrent note saves cannot overwrite notes and read waits for pending writes', async t => {
  const { store } = await fixture(t, { now: () => 1000 });
  const saving = Array.from({ length: 8 }, (_, index) => store.saveAnnotation(firstDocument, note({ page: index + 1 })));
  const reading = store.annotations(firstDocument);
  await Promise.all(saving);
  const records = await reading;
  assert.equal(records.length, 8);
  assert.equal(new Set(records.map(record => record.id)).size, 8);
  assert.deepEqual(records.map(record => record.page), [8, 7, 6, 5, 4, 3, 2, 1]);
});

test('removing and clearing recent history keep annotation records and original PDF bytes', async t => {
  const { directory, store } = await fixture(t);
  const paper = path.join(directory, 'paper.pdf');
  const original = Buffer.from('%PDF-1.7\nUnmodified original paper.');
  await fs.writeFile(paper, original);
  await store.remember(paper);
  const saved = await store.saveAnnotation(firstDocument, note());
  await store.removeRecent(paper);
  await store.remember(paper);
  await store.clearRecent();
  assert.deepEqual(await fs.readFile(paper), original);
  assert.equal((await store.annotations(firstDocument))[0].id, saved.id);
});

test('malformed document IDs, annotation fields and priority actions are rejected without writing', async t => {
  const { directory, store } = await fixture(t);
  for (const id of [null, 7, '../notes', 'x'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    await assert.rejects(async () => store.annotations(id), /无效文献标识/);
    await assert.rejects(async () => store.saveAnnotation(id, note()), /无效文献标识/);
  }
  for (const invalid of [
    null, [], note({ page: 0 }), note({ page: 1.5 }), note({ page: Number.MAX_SAFE_INTEGER }),
    note({ source: '' }), note({ source: 'x'.repeat(12001) }), note({ tags: 'method' }),
    note({ tags: ['x'.repeat(51)] }), note({ tags: Array(21).fill('tag') }), note({ tags: [42] }),
    note({ comment: 'x'.repeat(6001) }), note({ comment: null }), note({ tags: [], comment: '  ' }), note({ id: '../escape' })
  ]) await assert.rejects(async () => store.saveAnnotation(firstDocument, invalid));
  await assert.rejects(async () => store.removeAnnotation(firstDocument, 'not-a-uuid'), /无效笔记标识/);
  await assert.rejects(async () => store.setRecentPriority('paper.pdf', 'decrement'), /无效优先级操作/);
  await assert.rejects(async () => store.setRecentPriority('missing.pdf', 'increment'), /不在最近阅读/);
  await assert.rejects(async () => store.saveAnnotation(firstDocument, note({ id: 'bb3192d8-0e93-45b3-bd4b-2fbfa660e6c7' })), /笔记不存在/);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('corrupt annotation JSON and structurally invalid records are preserved instead of overwritten', async t => {
  const { directory, store } = await fixture(t);
  const filename = path.join(directory, 'annotations', `${firstDocument}.json`);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  for (const corrupt of ['{"unfinished":', '{"wrong":"shape"}', '[{"id":"not-a-uuid"}]']) {
    await fs.writeFile(filename, corrupt);
    await assert.rejects(store.annotations(firstDocument), /损坏|格式无效/);
    await assert.rejects(store.saveAnnotation(firstDocument, note()), /损坏|格式无效/);
    await assert.rejects(store.removeAnnotation(firstDocument, 'bb3192d8-0e93-45b3-bd4b-2fbfa660e6c7'), /损坏|格式无效/);
    assert.equal(await fs.readFile(filename, 'utf8'), corrupt);
  }
});

test('an atomic annotation replacement failure leaves old notes intact and allows the next write', async t => {
  const { directory, store } = await fixture(t);
  const initial = await store.saveAnnotation(firstDocument, note());
  const filename = path.join(directory, 'annotations', `${firstDocument}.json`);
  const original = await fs.readFile(filename, 'utf8');
  let shouldFail = true;
  const failedStore = createReadingStore({ directory, fs: {
    ...fs,
    async rename(...args) {
      if (shouldFail) { shouldFail = false; throw new Error('Fixture replacement failed'); }
      return fs.rename(...args);
    }
  } });
  await assert.rejects(failedStore.saveAnnotation(firstDocument, note({ id: initial.id, comment: 'New comment' })), /Fixture replacement failed/);
  assert.equal(await fs.readFile(filename, 'utf8'), original);
  assert.deepEqual(await fs.readdir(path.dirname(filename)), [`${firstDocument}.json`]);
  const saved = await failedStore.saveAnnotation(firstDocument, note({ comment: 'Another note' }));
  assert.equal((await failedStore.annotations(firstDocument))[0].id, saved.id);
});

test('permission errors reading notes are surfaced and never treated as an empty document', async t => {
  const { directory } = await fixture(t);
  let wrote = false;
  const store = createReadingStore({ directory, fs: {
    ...fs,
    async readFile() { const error = new Error('Fixture permission denied'); error.code = 'EACCES'; throw error; },
    async writeFile() { wrote = true; }
  } });
  await assert.rejects(store.annotations(firstDocument), /Fixture permission denied/);
  await assert.rejects(store.saveAnnotation(firstDocument, note()), /Fixture permission denied/);
  assert.equal(wrote, false);
});

test('legacy notes gain stable amber defaults without rewriting their files or comments', async t => {
  const { directory, store } = await fixture(t);
  const filename = path.join(directory, 'annotations', `${firstDocument}.json`);
  const legacy = [{
    id: 'bb3192d8-0e93-45b3-bd4b-2fbfa660e6c7', page: 3, source: 'Legacy selected sentence.',
    tags: ['method'], comment: '  An independent comment.\n', createdAt: 1000, updatedAt: 1000
  }];
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const original = JSON.stringify(legacy);
  await fs.writeFile(filename, original);
  const [record] = await store.annotations(firstDocument);
  assert.equal(record.color, 'amber');
  assert.deepEqual(record.tagColors, { method: 'amber' });
  assert.equal(record.comment, legacy[0].comment);
  assert.equal(record.rects, undefined);
  assert.equal(await fs.readFile(filename, 'utf8'), original);
  assert.deepEqual(await createReadingStore({ directory }).annotations(firstDocument), [record]);
});

test('all six note colors persist and omitted optional fields preserve highlight geometry on edit', async t => {
  const { directory, store } = await fixture(t, { now: () => 1000 });
  const rects = [{ x: 0.12, y: 0.2, width: 0.32, height: 0.015 }];
  for (const color of ['amber', 'sage', 'blue', 'violet', 'peach', 'rose']) {
    const saved = await store.saveAnnotation(firstDocument, note({ tags: [], comment: color, color, rects }));
    assert.equal(saved.color, color);
    assert.deepEqual(saved.tagColors, {});
    assert.deepEqual(saved.rects, rects);
    const edited = await store.saveAnnotation(firstDocument, note({ id: saved.id, tags: [], comment: `${color} edited` }));
    assert.equal(edited.color, color);
    assert.deepEqual(edited.rects, rects);
    assert.equal(edited.createdAt, saved.createdAt);
  }
  const restarted = await createReadingStore({ directory }).annotations(firstDocument);
  assert.deepEqual(restarted.map(record => record.color), ['rose', 'peach', 'violet', 'blue', 'sage', 'amber']);
  assert.ok(restarted.every(record => record.rects.length === 1));
});

test('same-tag selections share colors while retaining independent comments, text, dates and order', async t => {
  const { directory, store } = await fixture(t, { now: () => 1000 });
  const first = await store.saveAnnotation(firstDocument, note({ source: 'First paragraph.', comment: 'First comment.', tagColors: { method: 'blue' } }));
  const second = await store.saveAnnotation(firstDocument, note({ source: 'Second paragraph.', comment: 'Second comment.' }));
  const unrelated = await store.saveAnnotation(firstDocument, note({ tags: ['result'], comment: 'Unrelated comment.', tagColors: { result: 'sage' } }));
  const otherPdf = await store.saveAnnotation(secondDocument, note({ tagColors: { method: 'peach' }, comment: 'Other PDF comment.' }));
  assert.equal(second.tagColors.method, 'blue');
  const current = await store.saveAnnotation(firstDocument, note({ source: 'Third paragraph.', tagColors: { method: 'violet' } }));
  const records = await store.annotations(firstDocument);
  assert.deepEqual(records.map(record => record.id), [current.id, unrelated.id, second.id, first.id]);
  for (const original of [first, second, unrelated]) {
    const record = records.find(item => item.id === original.id);
    assert.equal(record.source, original.source);
    assert.equal(record.comment, original.comment);
    assert.equal(record.createdAt, original.createdAt);
    assert.equal(record.updatedAt, original.updatedAt);
  }
  assert.ok(records.filter(record => record.tags.includes('method')).every(record => record.tagColors.method === 'violet'));
  assert.equal(records.find(record => record.id === unrelated.id).tagColors.result, 'sage');
  const restarted = createReadingStore({ directory });
  assert.deepEqual(await restarted.annotations(firstDocument), records);
  assert.equal((await restarted.annotations(secondDocument))[0].tagColors.method, 'peach');
  assert.equal((await restarted.annotations(secondDocument))[0].comment, otherPdf.comment);
  const remaining = await restarted.removeAnnotation(firstDocument, current.id);
  assert.deepEqual(remaining.map(record => record.id), [unrelated.id, second.id, first.id]);
  assert.equal(remaining.find(record => record.id === first.id).tagColors.method, 'violet');
});

test('legacy saves and empty color dictionaries inherit previously assigned document tag colors', async t => {
  const { store } = await fixture(t);
  const colored = await store.saveAnnotation(firstDocument, note({ tagColors: { method: 'rose' }, color: 'blue' }));
  const legacyEdit = await store.saveAnnotation(firstDocument, note({ id: colored.id, comment: 'Old client update.' }));
  assert.equal(legacyEdit.tagColors.method, 'rose');
  assert.equal(legacyEdit.color, 'blue');
  const inherited = await store.saveAnnotation(firstDocument, note({ tagColors: {} }));
  assert.equal(inherited.tagColors.method, 'rose');
  assert.equal(inherited.color, 'amber');
});

test('prototype-like tag names are ordinary own properties and cannot modify dictionary prototypes', async t => {
  const { directory, store } = await fixture(t);
  const tags = ['__proto__', 'constructor', 'toString'];
  const tagColors = Object.fromEntries(tags.map(tag => [tag, 'blue']));
  const saved = await store.saveAnnotation(firstDocument, note({ tags, tagColors }));
  assert.equal(Object.getPrototypeOf(saved.tagColors), Object.prototype);
  for (const tag of tags) {
    assert.ok(Object.hasOwn(saved.tagColors, tag));
    assert.equal(saved.tagColors[tag], 'blue');
  }
  const inherited = await store.saveAnnotation(firstDocument, note({ tags }));
  assert.deepEqual(inherited.tagColors, saved.tagColors);
  const restarted = await createReadingStore({ directory }).annotations(firstDocument);
  assert.ok(restarted.every(record => Object.hasOwn(record.tagColors, '__proto__') && record.tagColors.__proto__ === 'blue'));
  assert.equal({}.method, undefined);
});

test('invalid palettes and out-of-page or malformed rectangles cannot write annotations', async t => {
  const { directory, store } = await fixture(t);
  for (const fields of [
    { color: 'red' }, { color: null }, { tagColors: { method: '#abcdef' } }, { tagColors: null },
    { tagColors: [] }, { tagColors: { missing: 'blue' } }, { rects: null }, { rects: {} },
    { rects: [{ x: NaN, y: 0, width: 0.1, height: 0.1 }] },
    { rects: [{ x: 0, y: Infinity, width: 0.1, height: 0.1 }] },
    { rects: [{ x: 0, y: 0, width: 0, height: 0.1 }] },
    { rects: [{ x: 0, y: 0, width: 0.1, height: -1 }] },
    { rects: [{ x: -0.1, y: 0, width: 0.1, height: 0.1 }] },
    { rects: [{ x: 0.95, y: 0.2, width: 0.1, height: 0.1 }] },
    { rects: [{ x: 0.2, y: 0.95, width: 0.1, height: 0.1 }] },
    { rects: [{ x: 1, y: 0, width: 0.000001, height: 0.1 }] },
    { rects: [null] }, { rects: Array(2001).fill({ x: 0, y: 0, width: 0.1, height: 0.1 }) }
  ]) await assert.rejects(async () => store.saveAnnotation(firstDocument, note(fields)), /无效/);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('rectangles accept floating-point boundary tolerance, normalize edges and permit explicit clearing', async t => {
  const { store } = await fixture(t);
  const saved = await store.saveAnnotation(firstDocument, note({ rects: [
    { x: -0.000001, y: 0, width: 0.5, height: 0.02 },
    { x: 0.8, y: 0.98, width: 0.200001, height: 0.020001 }
  ] }));
  assert.equal(saved.rects[0].x, 0);
  assert.equal(saved.rects[1].x + saved.rects[1].width, 1);
  assert.equal(saved.rects[1].y + saved.rects[1].height, 1);
  const maximum = await store.saveAnnotation(firstDocument, note({ rects: Array(2000).fill({ x: 0.1, y: 0.1, width: 0.1, height: 0.01 }) }));
  assert.equal(maximum.rects.length, 2000);
  const cleared = await store.saveAnnotation(firstDocument, note({ id: saved.id, rects: [] }));
  assert.deepEqual(cleared.rects, []);
});

test('corrupt stored palettes or rectangle geometry preserve the original annotation file', async t => {
  const { directory, store } = await fixture(t);
  const saved = await store.saveAnnotation(firstDocument, note());
  const filename = path.join(directory, 'annotations', `${firstDocument}.json`);
  for (const fields of [
    { color: 'red' }, { tagColors: { method: 'red' } },
    { rects: [{ x: 0.9, y: 0.1, width: 0.4, height: 0.1 }] }
  ]) {
    const corrupt = JSON.stringify([{ ...saved, ...fields }]);
    await fs.writeFile(filename, corrupt);
    await assert.rejects(store.annotations(firstDocument), /格式无效/);
    await assert.rejects(store.saveAnnotation(firstDocument, note()), /格式无效/);
    assert.equal(await fs.readFile(filename, 'utf8'), corrupt);
  }
});

test('a failed atomic recolor preserves every group member and a retry updates colors without merging comments', async t => {
  const { directory, store } = await fixture(t);
  const first = await store.saveAnnotation(firstDocument, note({ comment: 'First comment.', tagColors: { method: 'sage' } }));
  const second = await store.saveAnnotation(firstDocument, note({ comment: 'Second comment.' }));
  const filename = path.join(directory, 'annotations', `${firstDocument}.json`);
  const original = await fs.readFile(filename, 'utf8');
  let failOnce = true;
  const failedStore = createReadingStore({ directory, fs: {
    ...fs,
    async rename(...args) {
      if (failOnce) { failOnce = false; throw new Error('Fixture recolor failure'); }
      return fs.rename(...args);
    }
  } });
  const fields = note({ id: first.id, comment: first.comment, tagColors: { method: 'peach' } });
  await assert.rejects(failedStore.saveAnnotation(firstDocument, fields), /Fixture recolor failure/);
  assert.equal(await fs.readFile(filename, 'utf8'), original);
  await failedStore.saveAnnotation(firstDocument, fields);
  const records = await failedStore.annotations(firstDocument);
  assert.ok(records.every(record => record.tagColors.method === 'peach'));
  assert.equal(records.find(record => record.id === first.id).comment, first.comment);
  const unchanged = records.find(record => record.id === second.id);
  assert.equal(unchanged.comment, second.comment);
  assert.equal(unchanged.updatedAt, second.updatedAt);
});
