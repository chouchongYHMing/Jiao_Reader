'use strict';

// Real Electron UI and reading-store IPC, disposable preferences, no model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require(process.env.JIAO_PLAYWRIGHT_MODULE || 'playwright');

const COLORS = ['amber', 'sage', 'blue', 'violet', 'peach', 'rose'];
const SHARED_TAG = '研究方法';
const OTHER_TAG = '实验结果';
const COMMENT_ONE = '第一段：检查样本选择与方法假设。';
const COMMENT_TWO = '第二段：复现参数设置，并比较基线。';
const COMMENT_THREE = '结果段：记录误差和实验限制。';
const normalize = value => String(value).replace(/\s+/g, ' ').trim();

function makePdf(marker) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let number = 1; number <= 3; number++) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    let content = `BT /F1 16 Tf 55 770 Td (${marker} PAGE ${number}) Tj ET\n`;
    for (let line = 1; line <= 5; line++) content += `BT /F1 12 Tf 55 ${735 - line * 24} Td (${marker} research line ${line} on page ${number}.) Tj ET\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count 3 >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

const root = path.resolve(__dirname, '..');
const appRoot = path.resolve(process.env.JIAO_APP_ROOT || root);
const packaged = process.env.JIAO_PACKAGED_EXECUTABLE;
const label = packaged ? 'packaged-tag-colors' : 'tag-colors';
const output = path.join(root, '.test-output');
fs.mkdirSync(output, { recursive: true });
const fixtures = fs.mkdtempSync(path.join(output, `${label}-fixtures-`));
const profile = path.join(fixtures, 'user-data');
fs.mkdirSync(profile, { recursive: true });
const first = path.join(fixtures, 'first', 'same-name.pdf');
const second = path.join(fixtures, 'second', 'same-name.pdf');
for (const [file, marker] of [[first, 'FIRST DOCUMENT'], [second, 'SECOND DOCUMENT']]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, makePdf(marker));
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalHashes = new Map([first, second].map(file => [file, hash(file)]));
const documentId = originalHashes.get(first);
const checks = [];
const errors = [];
let app;
let page;
let step = 'initialization';
let isolatedUserData = false;
let isolatedWindow = false;

function report(passed, error) {
  return { passed, step, checks, isolatedUserData, isolatedWindow, profile, documentId, rendererErrors: errors, ...(error ? { error: String(error.stack || error) } : {}) };
}

function checkpoint(name) {
  checks.push(name);
  fs.writeFileSync(path.join(output, `${label}-result.json`), JSON.stringify(report(false), null, 2));
  console.log(`passed: ${name}`);
}

async function launch() {
  app = await _electron.launch({
    executablePath: packaged || process.env.JIAO_ELECTRON_EXECUTABLE || require('electron'),
    args: [...(packaged ? [] : [appRoot]), `--user-data-dir=${profile}`], timeout: 30000
  });
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))).toLowerCase(), path.resolve(profile).toLowerCase());
  isolatedUserData = true;
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  const isolation = await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.hide();
    ipcMain.removeHandler('reader:status');
    ipcMain.removeHandler('reader:translate');
    ipcMain.handle('reader:status', () => ({ connected: false, installation: 'not-found', selectedModel: '', models: [] }));
    globalThis.tagSmokeTranslationCalls = [];
    ipcMain.handle('reader:translate', (_, text) => {
      globalThis.tagSmokeTranslationCalls.push(text);
      throw new Error('Offline tag/highlight tests must not call a model');
    });
    return { visible: window.isVisible(), backgroundThrottling: window.webContents.getBackgroundThrottling() };
  });
  assert.deepEqual(isolation, { visible: false, backgroundThrottling: false });
  isolatedWindow = true;
  await page.locator('#emptyOpenButton').waitFor();
  await page.locator('#refreshStatus').click();
  await page.waitForFunction(() => !document.getElementById('refreshStatus').disabled && document.querySelector('#modelStatus strong').textContent.includes('未检测到'));
  await page.waitForFunction(() => document.querySelectorAll('.recent-row').length === 2);
}

async function close() { if (app) { await app.close(); app = null; } }

async function screenshot(filename) {
  // This Windows runtime does not paint hidden captures. Show without activation
  // only for the snapshot; all mouse gestures still run in the hidden window.
  const capture = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.isVisible()) throw new Error('The test window must be hidden outside snapshot capture');
    let timer;
    let capture;
    try {
      window.showInactive();
      await new Promise(resolve => setTimeout(resolve, 150));
      const image = await Promise.race([
        window.webContents.capturePage(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron snapshot capture timed out after 10 seconds')), 10000); })
      ]);
      capture = { empty: image.isEmpty(), size: image.getSize(), png: image.toPNG().toString('base64') };
    } finally {
      clearTimeout(timer);
      window.hide();
    }
    return { ...capture, visibleAfter: window.isVisible() };
  });
  assert.equal(capture.visibleAfter, false, 'Snapshot capture must restore physical-input isolation');
  assert.ok(!capture.empty && capture.size.width > 0 && capture.size.height > 0, 'The hidden Electron capture must contain an image');
  const png = Buffer.from(capture.png, 'base64');
  assert.ok(png.length > 24 && png.subarray(1, 4).toString('ascii') === 'PNG', 'The hidden Electron capture must contain a nonempty PNG');
  fs.writeFileSync(path.join(output, filename), png);
}

async function open(file, marker) {
  await page.getByTitle(file, { exact: true }).click();
  await page.waitForFunction(() => document.getElementById('pageTotal').textContent === '3' && !document.getElementById('pageInput').disabled);
  await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').filter({ hasText: `${marker} PAGE 1` }).waitFor();
  assert.equal(await page.locator('.recent-row.active .recent-item').getAttribute('title'), file);
}

async function showNotes() {
  if (!await page.locator('#annotationPanel').isVisible()) await page.locator('#annotationsButton').click();
  await page.locator('#annotationPanel').waitFor();
}

async function hideNotes() {
  if (await page.locator('#annotationPanel').isVisible()) await page.locator('#annotationsButton').click();
  await page.locator('#annotationPanel').waitFor({ state: 'hidden' });
}

async function displayedCount(count) {
  await showNotes();
  await page.waitForFunction(count => document.querySelectorAll('#annotationList .annotation-item').length === count, count);
}

async function goTo(number, marker = 'FIRST DOCUMENT') {
  await hideNotes();
  await page.locator('#pageInput').fill(String(number));
  await page.locator('#pageInput').press('Enter');
  await page.locator(`[data-page="${number}"] .pdf-page.rendered .textLayer span`).filter({ hasText: `${marker} PAGE ${number}` }).waitFor();
}

async function dragPage(number, marker = 'FIRST DOCUMENT') {
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false, 'Every PDF mouse gesture must run in the physically isolated hidden window');
  await goTo(number, marker);
  const line = page.locator(`[data-page="${number}"] .textLayer span`).filter({ hasText: `${marker} PAGE ${number}` }).first();
  await line.scrollIntoViewIfNeeded();
  const geometry = await line.evaluate(span => {
    const node = span.firstChild;
    if (node?.nodeType !== Node.TEXT_NODE || !node.length) throw new Error('Missing PDF text node');
    const range = document.createRange();
    range.setStart(node, 0); range.setEnd(node, 1);
    const first = [...range.getClientRects()].find(rect => rect.width && rect.height);
    range.setStart(node, node.length - 1); range.setEnd(node, node.length);
    const last = [...range.getClientRects()].filter(rect => rect.width && rect.height).at(-1);
    if (!first || !last) throw new Error('Missing real glyph coordinates');
    return { text: node.textContent, first: first.toJSON(), last: last.toJSON() };
  });
  const before = await page.locator('.history-item').count();
  await page.mouse.move(geometry.first.left + 0.25, geometry.first.top + geometry.first.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(geometry.last.right - 0.25, geometry.last.top + geometry.last.height / 2, { steps: 12 });
    await page.waitForTimeout(550);
    assert.equal(await page.locator('.history-item').count(), before, 'A held drag must not create a partial note source');
  } finally { await page.mouse.up(); }
  await page.waitForFunction(previous => document.querySelectorAll('.history-item').length > previous, before);
  const chosen = normalize(await page.evaluate(() => window.getSelection().toString()));
  assert.equal(chosen, geometry.text, `Drag must select the complete intended line; geometry=${JSON.stringify(geometry)}`);
  assert.equal(normalize(await page.locator('#sourceText').textContent()), chosen);
  assert.equal(await page.locator('.history-item').first().getAttribute('data-page'), String(number));
  assert.equal(await app.evaluate(() => globalThis.tagSmokeTranslationCalls.length), 0);
  return chosen;
}

async function editLatest() {
  await page.locator('.history-item').first().click({ button: 'right' });
  await page.locator('.reading-context-menu').getByText('添加标签', { exact: true }).click();
  await page.locator('#annotationEditor').waitFor();
}

function colorRow(tag = SHARED_TAG) {
  return page.locator(`.annotation-tag-color-row[data-tag="${tag}"]`);
}

async function chooseColor(color, tag = SHARED_TAG) {
  const row = colorRow(tag);
  await row.waitFor();
  assert.deepEqual(await row.locator('.annotation-color-choice').evaluateAll(buttons => buttons.map(button => button.dataset.color)), COLORS);
  await row.locator(`.annotation-color-choice[data-color="${color}"]`).click();
  await page.waitForFunction(({ tag, color }) => {
    const row = [...document.querySelectorAll('.annotation-tag-color-row')].find(row => row.dataset.tag === tag);
    return row?.querySelector(`.annotation-color-choice[data-color="${color}"]`)?.getAttribute('aria-pressed') === 'true';
  }, { tag, color });
  assert.equal(await row.locator('.annotation-color-choice[aria-pressed="true"]').count(), 1);
}

async function records(id = documentId) { return page.evaluate(id => window.jiao.annotations(id), id); }
function noteItem(id) { return page.locator(`.annotation-item[data-annotation-id="${id}"]`); }
function highlights(id, number) { return page.locator(`[data-page="${number}"] .pdf-annotation-layer .pdf-annotation-highlight[data-annotation-id="${id}"]`); }

async function createNote(number, tag, color, comment, traversePalette = false) {
  const source = await dragPage(number);
  await editLatest();
  await page.locator('#annotationTags').fill(tag);
  if ((await records()).some(note => note.tags.includes(tag))) {
    await colorRow(tag).waitFor();
    assert.equal(await colorRow(tag).locator(`.annotation-color-choice[data-color="${color}"]`).getAttribute('aria-pressed'), 'true', 'Reusing a tag must inherit its existing color before any new color is chosen');
  }
  if (traversePalette) for (const candidate of COLORS) await chooseColor(candidate, tag);
  await chooseColor(color, tag);
  await page.locator('#annotationComment').fill(comment);
  if (traversePalette) await screenshot(`${label}-six-colors.png`);
  await page.locator('#annotationSave').click();
  await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
  const saved = (await records()).find(note => note.page === number && normalize(note.source) === source);
  assert.ok(saved, 'Saving from the editor must persist through real annotation IPC');
  assert.equal(saved.comment, comment);
  assert.deepEqual(saved.tags, [tag]);
  assert.ok(Array.isArray(saved.rects) && saved.rects.length > 0, 'New drag annotations must persist highlight rectangles');
  for (const rect of saved.rects) {
    assert.ok(['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])));
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 1.00001 && rect.y + rect.height <= 1.00001, 'Highlight rectangles must be normalized to their PDF page');
  }
  await highlights(saved.id, number).first().waitFor();
  assert.equal(await highlights(saved.id, number).first().getAttribute('data-color'), color);
  return saved;
}

async function assertComments(notes) {
  const saved = await records();
  for (const expected of notes) {
    const actual = saved.find(note => note.id === expected.id);
    assert.ok(actual);
    assert.equal(actual.comment, expected.comment, 'Changing a shared tag color must preserve each segment\'s independent comment');
    assert.equal(actual.source, expected.source);
    assert.ok(normalize(await noteItem(expected.id).locator('.annotation-note').textContent()).includes(normalize(expected.comment)));
  }
}

async function assertSharedColor(notes, color) {
  await showNotes();
  for (const note of notes) {
    assert.equal(await noteItem(note.id).locator(`.annotation-tag[data-tag="${SHARED_TAG}"]`).getAttribute('data-color'), color);
    await page.waitForFunction(({ id, pageNumber, color }) => {
      const nodes = document.querySelectorAll(`[data-page="${pageNumber}"] .pdf-annotation-highlight[data-annotation-id="${id}"]`);
      return nodes.length > 0 && [...nodes].every(node => node.dataset.color === color);
    }, { id: note.id, pageNumber: note.page, color });
  }
}

async function minimumEditor(note) {
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 620));
    await page.waitForFunction(() => innerWidth <= 980 && innerHeight <= 620);
    await showNotes();
    await noteItem(note.id).locator('.annotation-edit').click();
    await page.locator('#annotationEditor').waitFor();
    await page.locator('#annotationTags').fill([SHARED_TAG, ...Array.from({ length: 12 }, (_, index) => `待整理${index + 1}`)].join('，'));
    await page.waitForFunction(() => document.querySelectorAll('.annotation-tag-color-row').length === 13);
    const lastColor = page.locator('.annotation-tag-color-row').last().locator('.annotation-color-choice').last();
    await lastColor.scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => {
      const dialog = document.getElementById('annotationEditor');
      const rows = document.querySelectorAll('.annotation-tag-color-row');
      let scrollContainer = rows[rows.length - 1];
      while (scrollContainer && scrollContainer !== dialog && scrollContainer.scrollHeight <= scrollContainer.clientHeight + 1) scrollContainer = scrollContainer.parentElement;
      const selectors = ['#annotationEditor', '#annotationSave', '#annotationCancel'];
      return {
        viewport: { width: innerWidth, height: innerHeight },
        scrollable: Boolean(scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight + 1),
        nodes: selectors.map(selector => {
          const node = document.querySelector(selector), rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { selector, rect: rect.toJSON(), within: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, hit: hit === node || node.contains(hit) };
        })
      };
    });
    await screenshot(`${label}-minimum-editor.png`);
    fs.writeFileSync(path.join(output, `${label}-minimum-layout.json`), JSON.stringify(layout, null, 2));
    assert.ok(layout.scrollable, 'Many tag color rows must have a usable scroll container');
    assert.ok(layout.nodes.every(node => node.within), `Editor and footer must fit the minimum window: ${JSON.stringify(layout)}`);
    assert.ok(layout.nodes.slice(1).every(node => node.hit), 'Save/cancel footer must remain reachable while the colors scroll');
    const lastRect = await lastColor.boundingBox();
    assert.ok(lastRect && lastRect.y >= 0 && lastRect.y + lastRect.height <= layout.viewport.height + 1, 'The final color row must be reachable by scrolling');
    await page.locator('#annotationCancel').click();
    await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
  } finally {
    if (await page.locator('#annotationEditor').isVisible()) await page.locator('#annotationCancel').click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 960));
    await page.waitForFunction(() => innerWidth > 1200 && innerHeight > 700);
    await showNotes();
  }
}

function papersUnchanged() { for (const [file, original] of originalHashes) assert.equal(hash(file), original); }

(async () => {
  fs.writeFileSync(path.join(profile, 'recent.json'), JSON.stringify([first, second]));
  try {
    await launch();
    await open(first, 'FIRST DOCUMENT');
    step = 'six colors and normalized PDF highlight';
    const one = await createNote(1, SHARED_TAG, 'blue', COMMENT_ONE, true);
    checkpoint('all six colors are selectable and saved highlights use normalized page rectangles');

    step = 'independent comments on one shared tag';
    const two = await createNote(2, SHARED_TAG, 'blue', COMMENT_TWO);
    const three = await createNote(3, OTHER_TAG, 'rose', COMMENT_THREE);
    await displayedCount(3);
    await assertComments([one, two, three]);
    await assertSharedColor([one, two], 'blue');
    const summary = page.locator('#annotationTagSummary');
    assert.equal(await summary.locator(`.annotation-tag-filter[data-tag="${SHARED_TAG}"]`).count(), 1);
    assert.equal(await summary.locator(`.annotation-tag-filter[data-tag="${SHARED_TAG}"]`).getAttribute('data-count'), '2');
    assert.equal(await summary.locator(`.annotation-tag-filter[data-tag="${OTHER_TAG}"]`).getAttribute('data-count'), '1');
    assert.equal(await summary.locator('.annotation-tag-filter[data-tag=""]').getAttribute('data-count'), '3');
    await summary.locator(`.annotation-tag-filter[data-tag="${SHARED_TAG}"]`).click();
    await displayedCount(2);
    assert.equal(await noteItem(three.id).count(), 0, 'Filtering a shared tag must exclude unrelated segments');
    await assertComments([one, two]);
    assert.equal(await summary.locator(`.annotation-tag-filter[data-tag="${SHARED_TAG}"]`).getAttribute('aria-pressed'), 'true');
    await screenshot(`${label}-filtered-notes.png`);
    await summary.locator('.annotation-tag-filter[data-tag=""]').click();
    await displayedCount(3);
    checkpoint('one tag groups two segments, preserves their independent comments, and filters the note list');

    step = 'cancelled color edits';
    await noteItem(one.id).locator('.annotation-edit').click();
    await page.locator('#annotationEditor').waitFor();
    assert.equal(await page.locator('#annotationComment').inputValue(), COMMENT_ONE);
    await chooseColor('sage');
    await page.locator('#annotationCancel').click();
    await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
    await displayedCount(3);
    await assertSharedColor([one, two], 'blue');
    await assertComments([one, two, three]);
    checkpoint('cancelling a color change leaves shared colors and every segment comment unchanged');

    step = 'shared color update';
    await noteItem(one.id).locator('.annotation-edit').click();
    await page.locator('#annotationEditor').waitFor();
    await chooseColor('violet');
    await page.locator('#annotationSave').click();
    await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
    await displayedCount(3);
    await assertSharedColor([one, two], 'violet');
    await assertComments([one, two, three]);
    assert.equal(await noteItem(three.id).locator(`.annotation-tag[data-tag="${OTHER_TAG}"]`).getAttribute('data-color'), 'rose');
    checkpoint('changing one tag color updates its chips and highlights across segments without overwriting comments');

    step = 'minimum-window color editor';
    await minimumEditor(one);
    await displayedCount(3);
    await assertSharedColor([one, two], 'violet');
    await assertComments([one, two, three]);
    const afterMinimumCancel = await records();
    for (const original of [one, two, three]) assert.deepEqual(afterMinimumCancel.find(note => note.id === original.id).tags, original.tags, 'Cancelling the long color editor must not save its extra draft tags');
    checkpoint('many color rows scroll in the minimum window while save/cancel remain reachable; cancelling adds no tags');

    step = 'highlight scaling and pointer interaction';
    await goTo(1);
    const mark = highlights(one.id, 1).first();
    await mark.waitFor();
    const before = await mark.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), styles: ['left', 'top', 'width', 'height'].map(key => node.style[key]), pointerEvents: getComputedStyle(node.closest('.pdf-annotation-layer')).pointerEvents }));
    assert.equal(before.pointerEvents, 'none', 'Highlights must not intercept text gestures');
    const zoomBefore = Number((await page.locator('#zoomValue').textContent()).replace('%', ''));
    await page.locator('#zoomIn').click();
    await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').filter({ hasText: 'FIRST DOCUMENT PAGE 1' }).waitFor();
    const after = await mark.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), styles: ['left', 'top', 'width', 'height'].map(key => node.style[key]) }));
    const zoomAfter = Number((await page.locator('#zoomValue').textContent()).replace('%', ''));
    assert.deepEqual(after.styles, before.styles, 'Normalized highlight coordinates must remain constant when zooming');
    assert.ok(Math.abs(after.rect.width - before.rect.width * zoomAfter / zoomBefore) < 2 && Math.abs(after.rect.height - before.rect.height * zoomAfter / zoomBefore) < 2, 'Visible highlights must scale with the PDF page');
    const again = await dragPage(1);
    assert.equal(again, normalize(one.source), 'A highlight must allow selecting its original text again');
    await screenshot(`${label}-pdf-highlights.png`);
    checkpoint('highlights scale with zoom and permit a new genuine mouse drag over the same text');
    papersUnchanged();
    await close();

    step = 'restart and same-name document isolation';
    await launch();
    await open(first, 'FIRST DOCUMENT');
    await displayedCount(3);
    await assertSharedColor([one, two], 'violet');
    await assertComments([one, two, three]);
    await hideNotes();
    await open(second, 'SECOND DOCUMENT');
    await displayedCount(0);
    assert.equal(await page.locator('.pdf-annotation-highlight').count(), 0, 'Same-name PDFs with different content must not share highlights');
    assert.equal((await records(originalHashes.get(second))).length, 0);
    checkpoint('colors, comments and PDF highlights survive restart; different same-name PDF content is isolated');

    step = 'annotation deletion removes PDF highlights';
    await hideNotes();
    await open(first, 'FIRST DOCUMENT');
    await displayedCount(3);
    await noteItem(one.id).locator('.annotation-delete').click();
    await displayedCount(2);
    await page.waitForFunction(id => !document.querySelector(`.pdf-annotation-highlight[data-annotation-id="${id}"]`), one.id);
    const remaining = await records();
    assert.ok(!remaining.some(note => note.id === one.id));
    await assertComments([two, three]);
    assert.equal(await app.evaluate(() => globalThis.tagSmokeTranslationCalls.length), 0);
    papersUnchanged();
    assert.deepEqual(errors, []);
    checkpoint('deleting one segment removes its highlight and preserves the remaining independent comments');
    fs.writeFileSync(path.join(output, `${label}-result.json`), JSON.stringify(report(true), null, 2));
    console.log(JSON.stringify({ passed: true, checks: checks.length, report: path.join(output, `${label}-result.json`), rendererErrors: errors }));
  } catch (error) {
    fs.writeFileSync(path.join(output, `${label}-result.json`), JSON.stringify(report(false, error), null, 2));
    if (page && !page.isClosed()) await screenshot(`${label}-failure.png`).catch(() => {});
    throw error;
  } finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
