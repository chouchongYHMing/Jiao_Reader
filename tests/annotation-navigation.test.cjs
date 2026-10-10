'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const panelModule = import('../app/annotations.mjs');
const cardModule = import('../app/annotation-card.mjs');
const firstDocument = 'a'.repeat(64);
const secondDocument = 'b'.repeat(64);
const firstRects = [{ x: .1, y: .2, width: .35, height: .02 }];
const secondRects = [{ x: .1, y: .7, width: .35, height: .02 }];
const note = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', page: 3, source: 'A repeated academic quotation.',
  tags: ['method'], comment: 'First independent comment.', color: 'amber', tagColors: { method: 'amber' },
  rects: firstRects, ...overrides
});

test('equal quotations at different positions keep independent annotations while tiny geometry differences match', async () => {
  const { AnnotationPanel } = await panelModule;
  const first = note();
  const second = note({ id: '22222222-2222-4222-8222-222222222222', rects: secondRects, comment: 'Second independent comment.' });
  const panel = Object.assign(Object.create(AnnotationPanel.prototype), { notes: [first, second] });
  assert.equal(panel.getAnnotation(3, first.source, firstRects), first);
  assert.equal(panel.getAnnotation(3, first.source, secondRects), second);
  assert.equal(panel.getAnnotation(3, first.source, [{ ...firstRects[0], x: .10005, y: .19995 }]), first);
  assert.equal(panel.getAnnotation(3, first.source, [{ ...firstRects[0], y: .4 }]), null);
  assert.equal(panel.getAnnotation(3, first.source), null);
  panel.notes = [first];
  assert.equal(panel.getAnnotation(3, first.source, secondRects), null, 'different geometry cannot fall back to quotation text');
  const multiple = [{ ...firstRects[0] }, { ...secondRects[0] }];
  panel.notes = [note({ rects: multiple })];
  assert.equal(panel.getAnnotation(3, first.source, multiple.slice().reverse()), null, 'rectangle order is part of the selection');
  assert.equal(panel.getAnnotation(3, first.source, [multiple[0]]), null, 'rectangle count is part of the selection');
});

test('legacy annotations without geometry match only a unique quotation on that page', async () => {
  const { AnnotationPanel } = await panelModule;
  const legacy = note({ rects: undefined });
  const panel = Object.assign(Object.create(AnnotationPanel.prototype), { notes: [legacy] });
  assert.equal(panel.getAnnotation(3, legacy.source, secondRects), legacy);
  assert.equal(panel.getAnnotation(3, legacy.source), legacy);
  assert.equal(panel.getAnnotation(4, legacy.source, secondRects), null);
  panel.notes.push(note({ id: '22222222-2222-4222-8222-222222222222', rects: secondRects }));
  assert.equal(panel.getAnnotation(3, legacy.source, firstRects), null, 'legacy text is ambiguous when another positioned note exists');
  assert.equal(panel.getAnnotation(3, legacy.source), null);
});

async function cardFixture(t) {
  const { AnnotationCard } = await cardModule;
  const first = note();
  const second = note({ id: '22222222-2222-4222-8222-222222222222', rects: secondRects, comment: 'Second independent comment.' });
  const saved = { ...first, comment: 'Saved replacement comment.' };
  let commit;
  const committed = new Promise(resolve => { commit = resolve; });
  const calls = { saves: [], reads: [], synced: [] };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true, writable: true,
    value: { jiao: {
      saveAnnotation(documentId, payload) { calls.saves.push({ documentId, payload }); return committed; },
      async annotations(documentId) { calls.reads.push(documentId); return [saved, second]; }
    } }
  });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
  // Only visual surfaces are substituted. Save, document/session guards, closing,
  // opening and note refresh execute the production AnnotationCard methods.
  const card = Object.assign(Object.create(AnnotationCard.prototype), {
    documentId: firstDocument, documentName: 'First PDF', generation: 1, session: 1,
    note: first, notes: [first, second], editing: true, saving: false,
    element: { hidden: false, dataset: {} }, draft: { value: saved.comment, focus() {} },
    body: { scrollTop: 0 }, editButton: { focus() {} },
    setError() {}, setSaving(value) { this.saving = value; }, render() {}, position() { return true; }, onToast() {},
    onSaved(notes) { calls.synced.push(notes); card.setNotes(notes); }
  });
  return { card, calls, second, saved, commit: () => commit(saved) };
}

test('a submitted comment save refreshes annotations even when its card closes before completion', async t => {
  const { card, calls, saved, commit } = await cardFixture(t);
  const pending = card.save();
  assert.equal(calls.saves.length, 1);
  assert.equal(calls.saves[0].documentId, firstDocument);
  assert.deepEqual(calls.saves[0].payload.rects, firstRects);
  card.close();
  commit();
  await pending;
  assert.deepEqual(calls.reads, [firstDocument]);
  assert.equal(calls.synced.length, 1);
  assert.equal(card.notes.find(item => item.id === saved.id).comment, saved.comment);
  assert.equal(card.element.hidden, true);
  assert.equal(card.note, null);
});

test('a completed save updates the list while preserving another open card and its unsaved comment', async t => {
  const { card, calls, second, saved, commit } = await cardFixture(t);
  const pending = card.save();
  card.open(second, {});
  card.editing = true;
  card.draft.value = 'Unsaved draft for the second excerpt.';
  commit();
  await pending;
  assert.equal(calls.synced.length, 1);
  assert.equal(card.notes.find(item => item.id === saved.id).comment, saved.comment);
  assert.equal(card.note.id, second.id);
  assert.equal(card.note.comment, second.comment);
  assert.equal(card.draft.value, 'Unsaved draft for the second excerpt.');
  assert.equal(card.editing, true);
  assert.equal(card.element.hidden, false);
});

test('a save from the previous PDF never refreshes or changes the newly opened PDF', async t => {
  const { card, calls, commit } = await cardFixture(t);
  const pending = card.save();
  card.setDocument(secondDocument, 'Second PDF');
  commit();
  await pending;
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.synced, []);
  assert.equal(card.documentId, secondDocument);
  assert.equal(card.documentName, 'Second PDF');
  assert.deepEqual(card.notes, []);
  assert.equal(card.element.hidden, true);
});
