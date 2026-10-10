'use strict';

// Real PDF gestures and reading-store IPC in a disposable user profile.
// Only Ollama is mocked; mouse input stays inside a hidden Electron window.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require(process.env.JIAO_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const appRoot = path.resolve(process.env.JIAO_APP_ROOT || root);
const packaged = process.env.JIAO_PACKAGED_EXECUTABLE;
const reportName = packaged ? 'packaged-navigation-result.json' : 'navigation-result.json';
const screenshotPrefix = packaged ? 'packaged-navigation' : 'navigation';
const output = path.join(root, '.test-output');
fs.mkdirSync(output, { recursive: true });
const fixtures = fs.mkdtempSync(path.join(output, 'navigation-fixtures-'));
const profile = path.join(fixtures, 'user-data');
fs.mkdirSync(profile, { recursive: true });
const first = path.join(fixtures, 'first', 'same-name.pdf');
const second = path.join(fixtures, 'second', 'same-name.pdf');
const renamed = path.join(fixtures, 'renamed-copy.pdf');
const normalize = value => String(value).replace(/\s+/g, ' ').trim();
const COMMENT = '<script>window.navigationInjected = true</script>\nCheck the assumptions behind this result.';
const EDITED_COMMENT = `${COMMENT}\nRechecked the original paragraph.`;
const SAVED_TRANSLATION = '已保存的译文：重新打开文献后，无需再次调用模型。';

function makePdf(marker) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let number = 1; number <= 6; number++) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    let content = `BT /F1 16 Tf 55 770 Td (${marker} PAGE ${number}) Tj ET\n`;
    for (let line = 1; line <= 12; line++) {
      content += `BT /F1 12 Tf 55 ${720 - line * 35} Td (${marker} research line ${line} on page ${number}.) Tj ET\n`;
    }
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count 6 >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

for (const [file, marker] of [[first, 'FIRST DOCUMENT'], [second, 'SECOND DOCUMENT']]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, makePdf(marker));
}
fs.copyFileSync(first, renamed);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalHashes = new Map([first, second, renamed].map(file => [file, hash(file)]));
const documentId = originalHashes.get(first);
const otherDocumentId = originalHashes.get(second);
const checks = [];
const rendererErrors = [];
let app;
let page;
let step = 'initialization';
let isolatedUserData = false;
let isolatedWindow = false;

function report(passed, error) {
  return { passed, step, packaged: Boolean(packaged), checks, isolatedUserData, isolatedWindow,
    profile, documentId, rendererErrors, ...(error ? { error: String(error.stack || error) } : {}) };
}

function checkpoint(name) {
  checks.push(name);
  fs.writeFileSync(path.join(output, reportName), JSON.stringify(report(false), null, 2));
  console.log(`passed: ${name}`);
}

async function launch() {
  app = await _electron.launch({
    executablePath: packaged || process.env.JIAO_ELECTRON_EXECUTABLE || require('electron'),
    args: [...(packaged ? [] : [appRoot]), `--user-data-dir=${profile}`], timeout: 30000
  });
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))).toLowerCase(), profile.toLowerCase());
  isolatedUserData = true;
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => rendererErrors.push(error.message));
  const isolation = await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.hide();
    window.setSize(1500, 960);
    for (const name of ['status', 'select-model', 'translate']) ipcMain.removeHandler(`reader:${name}`);
    globalThis.navigationSmokeOnline = false;
    globalThis.navigationSmokeTranslationCalls = [];
    const status = () => globalThis.navigationSmokeOnline
      ? { connected: true, installation: 'installed', selectedModel: 'navigation-local:latest', models: [{ name: 'navigation-local:latest', size: 1000000 }] }
      : { connected: false, installation: 'not-found', selectedModel: '', models: [] };
    ipcMain.handle('reader:status', status);
    ipcMain.handle('reader:select-model', status);
    ipcMain.handle('reader:translate', (_, source) => {
      globalThis.navigationSmokeTranslationCalls.push(source);
      return 'Mock translation: navigation must not make this request.';
    });
    return { visible: window.isVisible(), backgroundThrottling: window.webContents.getBackgroundThrottling() };
  });
  assert.deepEqual(isolation, { visible: false, backgroundThrottling: false });
  isolatedWindow = true;
  await page.locator('#emptyOpenButton').waitFor();
  await refreshModel(false);
  await page.waitForFunction(() => document.querySelectorAll('.recent-row').length === 3);
}

async function close() { if (app) { await app.close(); app = null; } }

async function refreshModel(online) {
  await app.evaluate((_, enabled) => { globalThis.navigationSmokeOnline = enabled; }, online);
  await page.locator('#refreshStatus').click();
  await page.waitForFunction(online => !document.getElementById('refreshStatus').disabled &&
    document.querySelector('#modelStatus strong').textContent.includes(online ? '已就绪' : '未检测到'), online);
}

async function screenshot(filename) {
  // Windows does not paint this runtime's hidden captures. Briefly show without
  // activation, capture, and restore hiding before any further input.
  const capture = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isVisible()) throw new Error('The test window must remain hidden outside capture');
    let timer;
    let result;
    try {
      window.showInactive();
      await new Promise(resolve => setTimeout(resolve, 150));
      const image = await Promise.race([
        window.webContents.capturePage(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Snapshot timed out')), 10000); })
      ]);
      result = { empty: image.isEmpty(), size: image.getSize(), png: image.toPNG().toString('base64') };
    } finally { clearTimeout(timer); window.hide(); }
    return { ...result, visibleAfter: window.isVisible() };
  });
  assert.equal(capture.visibleAfter, false, 'Capture must restore physical-input isolation');
  assert.ok(!capture.empty && capture.size.width && capture.size.height);
  const png = Buffer.from(capture.png, 'base64');
  assert.ok(png.length > 24 && png.subarray(1, 4).toString('ascii') === 'PNG');
  fs.writeFileSync(path.join(output, filename), png);
}

async function open(file, marker = 'FIRST DOCUMENT') {
  await page.getByTitle(file, { exact: true }).click();
  await page.waitForFunction(() => document.getElementById('pageTotal').textContent === '6' && !document.getElementById('pageInput').disabled);
  await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').filter({ hasText: `${marker} PAGE 1` }).waitFor();
  assert.equal(await page.locator('.recent-row.active .recent-item').getAttribute('title'), file);
}

async function dismissPanels() {
  if (await page.locator('#annotationCard').isVisible()) await page.locator('#annotationCard').press('Escape');
  if (await page.locator('#annotationPanel').isVisible()) await page.locator('#annotationsButton').click();
}

async function goTo(number, marker = 'FIRST DOCUMENT') {
  await dismissPanels();
  await page.locator('#pageInput').fill(String(number));
  await page.locator('#pageInput').press('Enter');
  await page.locator(`[data-page="${number}"] .pdf-page.rendered .textLayer span`).filter({ hasText: `${marker} PAGE ${number}` }).waitFor();
}

async function histories(id = documentId) { return page.evaluate(id => window.jiao.selectionHistory(id), id); }
async function notes(id = documentId) { return page.evaluate(id => window.jiao.annotations(id), id); }
async function waitForStored(read, predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await page.waitForTimeout(80);
  }
  throw new Error('Timed out waiting for the real storage operation');
}
const markerFor = id => page.locator(`.pdf-note-marker[data-annotation-id="${id}"]`);
const historyFor = id => page.locator(`.history-item[data-selection-id="${id}"]`);
const overlayFor = id => page.locator(`.pdf-history-highlight[data-selection-id="${id}"]`);

async function selectLine(number, lineNumber) {
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false,
    'All drag gestures must use the hidden test window');
  await goTo(number);
  const line = page.locator(`[data-page="${number}"] .textLayer span`).filter({ hasText: `FIRST DOCUMENT research line ${lineNumber} on page ${number}.` }).first();
  await line.scrollIntoViewIfNeeded();
  const geometry = await line.evaluate(span => {
    const node = span.firstChild;
    if (node?.nodeType !== Node.TEXT_NODE || !node.length) throw new Error('Missing PDF glyphs');
    const range = document.createRange();
    range.setStart(node, 0); range.setEnd(node, 1);
    const first = [...range.getClientRects()].find(rect => rect.width && rect.height);
    range.setStart(node, node.length - 1); range.setEnd(node, node.length);
    const last = [...range.getClientRects()].filter(rect => rect.width && rect.height).at(-1);
    if (!first || !last) throw new Error('Missing glyph coordinates');
    return { text: node.textContent, first: first.toJSON(), last: last.toJSON() };
  });
  const before = (await histories()).length;
  await page.mouse.move(geometry.first.left + 0.25, geometry.first.top + geometry.first.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(geometry.last.right - 0.25, geometry.last.top + geometry.last.height / 2, { steps: 12 });
    await page.waitForTimeout(550);
    assert.equal((await histories()).length, before, 'Held drags must not persist partial history');
  } finally { await page.mouse.up(); }
  await waitForStored(() => histories(), records => records.length > before);
  const selected = normalize(await page.evaluate(() => window.getSelection().toString()));
  assert.equal(selected, geometry.text, 'Real drag must select precisely the intended line');
  const saved = (await histories()).find(item => item.page === number && normalize(item.source) === selected);
  assert.ok(saved && /^[0-9a-f-]{36}$/i.test(saved.id));
  assert.ok(saved.rects?.length, 'Real selection IPC must persist original glyph rectangles');
  await historyFor(saved.id).waitFor();
  assert.equal(normalize(await page.locator('#sourceText').textContent()), selected);
  return saved;
}

async function annotate(selection, comment) {
  await historyFor(selection.id).click({ button: 'right' });
  await page.locator('.reading-context-menu').getByText('添加标签', { exact: true }).click();
  await page.locator('#annotationEditor').waitFor();
  await page.locator('#annotationTags').fill(comment ? '方法评论' : '仅标签');
  await page.locator('#annotationComment').fill(comment);
  await page.locator('#annotationSave').click();
  await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
  const saved = (await notes()).find(note => note.page === selection.page && normalize(note.source) === normalize(selection.source));
  assert.ok(saved);
  assert.equal(saved.comment, comment);
  await page.locator(`.pdf-annotation-highlight[data-annotation-id="${saved.id}"]`).first().waitFor();
  return saved;
}

async function assertOverlay(selection) {
  await overlayFor(selection.id).first().waitFor();
  await page.waitForFunction(number => Number(document.getElementById('pageInput').value) === number, selection.page);
  const geometry = await overlayFor(selection.id).evaluateAll(nodes => {
    const reader = document.getElementById('readerScroll').getBoundingClientRect();
    return nodes.map(node => ({
      page: Number(node.closest('[data-page]').dataset.page),
      normalized: Object.fromEntries(['left', 'top', 'width', 'height'].map(key => [key, parseFloat(node.style[key]) / 100])),
      rect: node.getBoundingClientRect().toJSON(), reader: reader.toJSON(), pointerEvents: getComputedStyle(node).pointerEvents
    }));
  });
  assert.equal(geometry.length, selection.rects.length);
  geometry.forEach((item, index) => {
    assert.equal(item.page, selection.page);
    assert.equal(item.pointerEvents, 'none', 'Restored selection must not intercept fresh text gestures');
    for (const [style, key] of [['left', 'x'], ['top', 'y'], ['width', 'width'], ['height', 'height']]) {
      assert.ok(Math.abs(item.normalized[style] - selection.rects[index][key]) < 0.00001, 'The visible selection must preserve the recorded glyph bounds');
    }
  });
  const first = geometry[0];
  assert.ok(first.rect.top >= first.reader.top - 1 && first.rect.bottom <= first.reader.bottom + 1,
    `The original selected line must be visible after navigation: ${JSON.stringify(first)}`);
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'Navigation must scroll the reader, not the application shell');
}

async function clickHistory(selection) {
  const before = await histories();
  const callsBefore = await app.evaluate(() => globalThis.navigationSmokeTranslationCalls.length);
  await historyFor(selection.id).click();
  await assertOverlay(selection);
  assert.equal(normalize(await page.locator('#sourceText').textContent()), normalize(selection.source));
  if (selection.result) assert.equal(await page.locator('#translationText').textContent(), selection.result);
  await page.waitForTimeout(700); // Allow the normal text-selection debounce to expose accidental retranslation.
  assert.deepEqual(await histories(), before, 'Navigation must not duplicate or rewrite saved history');
  assert.equal(await app.evaluate(() => globalThis.navigationSmokeTranslationCalls.length), callsBefore,
    'Restoring a selection must not call the model even when a model is ready');
}

function papersUnchanged() {
  for (const [file, expected] of originalHashes) assert.equal(hash(file), expected, 'History and comments must not rewrite PDF files');
}

(async () => {
  fs.writeFileSync(path.join(profile, 'recent.json'), JSON.stringify([first, second, renamed]));
  try {
    await launch();
    await open(first);
    step = 'offline history without annotation';
    let unannotated = await selectLine(4, 10);
    assert.equal(unannotated.result, '');
    assert.equal((await notes()).length, 0);
    checkpoint('offline text dragging persists UUID history and glyph positions without requiring a note');

    step = 'comment marker location and literal content';
    const commentSelection = await selectLine(2, 7);
    const commentNote = await annotate(commentSelection, COMMENT);
    await markerFor(commentNote.id).waitFor();
    const markerGeometry = await markerFor(commentNote.id).evaluate(marker => {
      const highlighted = [...document.querySelectorAll(`.pdf-annotation-highlight[data-annotation-id="${marker.dataset.annotationId}"]`)].at(-1);
      return { marker: marker.getBoundingClientRect().toJSON(), last: highlighted.getBoundingClientRect().toJSON() };
    });
    assert.ok(Math.abs(markerGeometry.marker.left - markerGeometry.last.right) <= 28 &&
      Math.abs(markerGeometry.marker.top - markerGeometry.last.bottom) <= 28,
    'The comment button must sit near the last highlighted glyph');
    await markerFor(commentNote.id).click();
    await page.locator('#annotationCard').waitFor();
    assert.ok((await page.locator('#annotationCard').textContent()).includes(COMMENT));
    assert.equal(await page.locator('#annotationCard script').count(), 0);
    assert.equal(await page.evaluate(() => window.navigationInjected), undefined, 'HTML-looking comments must stay literal');
    await screenshot(`${screenshotPrefix}-comment-card.png`);
    checkpoint('comment marker sits by the original passage and its card renders untrusted comment text literally');

    step = 'direct comment edit save and cancellation';
    await page.locator('#annotationCardEdit').click();
    await page.locator('#annotationCardDraft').fill('A cancelled draft must never overwrite the original comment.');
    await page.locator('#annotationCardCancel').click();
    assert.equal((await notes()).find(note => note.id === commentNote.id).comment, COMMENT);
    if (!await page.locator('#annotationCard').isVisible()) await markerFor(commentNote.id).click();
    await page.locator('#annotationCardEdit').click();
    await page.locator('#annotationCardDraft').fill(EDITED_COMMENT);
    await page.locator('#annotationCardSave').click();
    await waitForStored(() => notes(), records => records.find(note => note.id === commentNote.id)?.comment === EDITED_COMMENT);
    assert.equal((await notes()).length, 1, 'Direct editing must update, not duplicate, the original note');
    assert.deepEqual((await notes())[0].tags, commentNote.tags);
    checkpoint('comment-card cancel preserves the original; save updates the same note and retains its tags');

    step = 'comment-card tag editor handoff';
    await dismissPanels();
    await markerFor(commentNote.id).click();
    await page.locator('#annotationCardEditTags').click();
    await page.locator('#annotationEditor').waitFor();
    assert.equal(await page.locator('#annotationComment').inputValue(), EDITED_COMMENT);
    assert.ok((await page.locator('#annotationTags').inputValue()).includes(commentNote.tags[0]));
    assert.equal(await page.locator('.annotation-tag-color-row').first().locator('.annotation-color-choice').count(), 6);
    await page.locator('#annotationCancel').click();
    await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
    checkpoint('the comment card opens the existing tag editor with the current comment and all six colors');

    step = 'tag-only annotations omit comment markers';
    const tagSelection = await selectLine(1, 5);
    const tagNote = await annotate(tagSelection, '');
    assert.equal(await markerFor(tagNote.id).count(), 0);
    assert.equal((await notes()).find(note => note.id === commentNote.id).comment, EDITED_COMMENT);
    checkpoint('tag-only highlights have no comment button and other passage comments remain independent');

    step = 'saved translation and history navigation';
    unannotated = await page.evaluate(({ documentId, selection, result }) =>
      window.jiao.saveSelection(documentId, { ...selection, result, model: 'navigation-local:latest' }),
    { documentId, selection: unannotated, result: SAVED_TRANSLATION });
    await open(second, 'SECOND DOCUMENT');
    await page.waitForFunction(() => document.querySelectorAll('.history-item').length === 0);
    assert.deepEqual(await histories(otherDocumentId), []);
    await open(first);
    await historyFor(unannotated.id).waitFor();
    await refreshModel(true);
    await clickHistory(unannotated);
    checkpoint('history restores the exact page, glyph bounds, source and saved translation without new model calls or duplicate records');

    step = 'note page-button navigation';
    await goTo(1);
    await page.locator('#annotationsButton').click();
    await page.locator('#annotationPanel').waitFor();
    await page.locator(`.annotation-item[data-annotation-id="${commentNote.id}"] .annotation-jump`).click();
    await assertOverlay(commentNote);
    assert.equal(await app.evaluate(() => globalThis.navigationSmokeTranslationCalls.length), 0);
    checkpoint('the toolbar note-list page button returns to the original paragraph and shows its recorded selection');

    step = 'zoom redraw and minimum-window comment editing';
    await goTo(2);
    await page.locator('#zoomIn').click();
    await page.locator('[data-page="2"] .pdf-page.rendered .textLayer span').filter({ hasText: 'FIRST DOCUMENT PAGE 2' }).waitFor();
    await markerFor(commentNote.id).scrollIntoViewIfNeeded();
    await markerFor(commentNote.id).click();
    await page.locator('#annotationCard').waitFor();
    assert.ok((await page.locator('#annotationCard').textContent()).includes(EDITED_COMMENT));
    await dismissPanels();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 620));
    await page.waitForFunction(() => innerWidth <= 980 && innerHeight <= 620);
    await markerFor(commentNote.id).scrollIntoViewIfNeeded();
    await markerFor(commentNote.id).click();
    await page.locator('#annotationCardEdit').click();
    await page.locator('#annotationCardDraft').fill('Minimum-window draft that will be cancelled.');
    const layout = await page.evaluate(() => ['annotationCard', 'annotationCardDraft', 'annotationCardSave', 'annotationCardCancel'].map(id => {
      const node = document.getElementById(id), rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { id, rect: rect.toJSON(), within: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        hit: hit === node || node.contains(hit) };
    }));
    assert.ok(layout.every(item => item.within && item.rect.width > 0 && item.rect.height > 0), JSON.stringify(layout));
    assert.ok(layout.slice(1).every(item => item.hit), 'Minimum-window draft and save/cancel controls must be usable');
    await screenshot(`${screenshotPrefix}-minimum-card.png`);
    await page.locator('#annotationCardCancel').click();
    assert.equal((await notes()).find(note => note.id === commentNote.id).comment, EDITED_COMMENT);
    checkpoint('comment markers remain clickable after zoom; the minimum 980x620 window supports card editing and cancellation');
    const beforeRestart = await histories();
    await close();

    step = 'restart and full-content identity';
    await launch();
    await open(renamed);
    await historyFor(unannotated.id).waitFor();
    assert.deepEqual(await histories(), beforeRestart, 'Renaming or copying the same PDF must preserve history across restart');
    assert.equal((await notes()).length, 2);
    assert.ok(!(await notes()).some(note => note.source === unannotated.source), 'The restored target must be a history-only selection');
    await refreshModel(true);
    await clickHistory(unannotated);
    await open(second, 'SECOND DOCUMENT');
    await page.waitForFunction(() => document.querySelectorAll('.history-item').length === 0);
    assert.deepEqual(await histories(otherDocumentId), []);
    assert.deepEqual(await notes(otherDocumentId), []);
    checkpoint('unannotated history survives restart and a renamed identical copy; different content with the same filename remains isolated');

    step = 'history capacity through real IPC';
    const overflow = await page.evaluate(async ({ documentId }) => {
      const ids = [];
      for (let index = 0; index < 102; index++) {
        const saved = await window.jiao.saveSelection(documentId, { source: `Capacity fixture ${index}`, page: 1,
          result: index === 101 ? 'Latest saved result' : '', rects: [{ x: 0.1, y: 0.2, width: 0.25, height: 0.02 }] });
        ids.push(saved.id);
      }
      return { ids, stored: await window.jiao.selectionHistory(documentId) };
    }, { documentId: otherDocumentId });
    assert.equal(overflow.stored.length, 100);
    assert.equal(new Set(overflow.stored.map(item => item.id)).size, 100);
    assert.equal(overflow.stored[0].id, overflow.ids[101]);
    assert.ok(!overflow.stored.some(item => overflow.ids.slice(0, 2).includes(item.id)), 'Only the newest 100 selections should remain');
    assert.deepEqual(await histories(), beforeRestart, 'Another document reaching capacity must not change the original history');
    assert.equal(await app.evaluate(() => globalThis.navigationSmokeTranslationCalls.length), 0);
    papersUnchanged();
    assert.deepEqual(rendererErrors, []);
    checkpoint('real IPC keeps the newest 100 records per document; original PDFs and unrelated histories remain unchanged');

    fs.writeFileSync(path.join(output, reportName), JSON.stringify(report(true), null, 2));
    console.log(JSON.stringify({ passed: true, checks: checks.length, report: path.join(output, reportName), rendererErrors }));
  } catch (error) {
    fs.writeFileSync(path.join(output, reportName), JSON.stringify(report(false, error), null, 2));
    throw error;
  } finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
