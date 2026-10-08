'use strict';

// Exercise the shipped UI and its real persistence IPC in a disposable profile.
// Only Ollama status/translation are mocked: personal papers/preferences stay untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require(process.env.JIAO_PLAYWRIGHT_MODULE || 'playwright');

function makePdf(marker) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let number = 1; number <= 3; number++) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    let content = `BT /F1 16 Tf 55 770 Td (${marker} PAGE ${number}) Tj ET\n`;
    for (let line = 1; line <= 5; line++) {
      content += `BT /F1 12 Tf 55 ${735 - line * 24} Td (${marker} research line ${line} on page ${number}.) Tj ET\n`;
    }
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count 3 >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

const root = path.resolve(__dirname, '..');
const appRoot = path.resolve(process.env.JIAO_APP_ROOT || root);
const packaged = process.env.JIAO_PACKAGED_EXECUTABLE;
const label = packaged ? 'packaged-reading' : 'reading';
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
const recentFile = path.join(profile, 'recent.json');
const fileHash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalHashes = new Map([first, second].map(file => [file, fileHash(file)]));
const normalText = value => String(value).replace(/\s+/g, ' ').trim();
const errors = [];
const checks = [];
let app;
let page;
let step = 'initialization';
let isolatedUserData = false;
let priorityMenuCaptured = false;
let editorCaptured = false;

function result(passed, failure) {
  return { passed, step, checks, isolatedUserData, profile, rendererErrors: errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) };
}

function checkpoint(name) {
  checks.push(name);
  fs.writeFileSync(path.join(output, `${label}-result.json`), JSON.stringify(result(false), null, 2));
  console.log(`passed: ${name}`);
}

async function launch() {
  app = await _electron.launch({
    executablePath: packaged || process.env.JIAO_ELECTRON_EXECUTABLE || require('electron'),
    args: [...(packaged ? [] : [appRoot]), `--user-data-dir=${profile}`],
    timeout: 30000
  });
  assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))).toLowerCase(), path.resolve(profile).toLowerCase(), 'Tests must isolate real recent/annotation persistence');
  isolatedUserData = true;
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('reader:status');
    ipcMain.removeHandler('reader:translate');
    ipcMain.handle('reader:status', () => ({ connected: false, installation: 'not-found', selectedModel: '', models: [] }));
    globalThis.readingSmokeTranslationCalls = [];
    ipcMain.handle('reader:translate', (_, text) => {
      globalThis.readingSmokeTranslationCalls.push(text);
      throw new Error('Offline annotation tests must not invoke model translation');
    });
  });
  await page.locator('#emptyOpenButton').waitFor();
  await page.locator('#refreshStatus').click();
  await page.waitForFunction(() => !document.getElementById('refreshStatus').disabled && document.querySelector('#modelStatus strong').textContent.includes('未检测到'));
  return page;
}

async function close() {
  if (!app) return;
  await app.close();
  app = null;
}

async function recentOrder() {
  return page.locator('.recent-item').evaluateAll(items => items.map(item => item.title));
}

async function recentRecords() {
  return page.evaluate(() => window.jiao.recent());
}

async function timestamps() {
  return Object.fromEntries((await recentRecords()).map(item => [item.path, item.lastReadAt]));
}

async function priorityAction(file, action, expectedOrder, priority) {
  await page.getByTitle(file, { exact: true }).locator('..').click({ button: 'right' });
  const menu = page.locator('.reading-context-menu');
  await menu.waitFor();
  assert.deepEqual((await menu.locator('button').allTextContents()).map(normalText), ['优先级 +1', '优先级清零'], 'Recent menu must expose exactly increment and reset');
  if (!priorityMenuCaptured) {
    await page.screenshot({ path: path.join(output, `${label}-priority-menu.png`) });
    priorityMenuCaptured = true;
  }
  await menu.getByText(action, { exact: true }).click();
  await page.waitForFunction(({ file, priority }) => {
    const item = [...document.querySelectorAll('.recent-item')].find(item => item.title === file);
    const badge = item?.parentElement.querySelector('.recent-priority');
    return priority ? badge?.textContent.includes(String(priority)) : !badge || badge.hidden || !badge.textContent.trim() || /\b0\b/.test(badge.textContent);
  }, { file, priority });
  assert.deepEqual(await recentOrder(), expectedOrder);
  const stored = (await recentRecords()).find(item => item.path === file);
  assert.equal(stored.priority, priority, 'Visible priority must be persisted through real IPC');
}

async function goTo(number, marker) {
  await page.locator('#pageInput').fill(String(number));
  await page.locator('#pageInput').press('Enter');
  await page.locator(`[data-page="${number}"] .pdf-page.rendered .textLayer span`).filter({ hasText: `${marker} PAGE ${number}` }).waitFor();
  assert.equal(await page.locator('#pageInput').inputValue(), String(number));
}

async function open(file, marker) {
  await page.getByTitle(file, { exact: true }).click();
  await page.waitForFunction(() => document.getElementById('pageTotal').textContent === '3' && !document.getElementById('pageInput').disabled);
  await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').filter({ hasText: `${marker} PAGE 1` }).waitFor();
  assert.equal(await page.locator('.recent-row.active .recent-item').getAttribute('title'), file, 'Same-name PDFs must identify the active path correctly');
}

async function selectPage(number, marker) {
  await goTo(number, marker);
  const line = page.locator(`[data-page="${number}"] .textLayer span`).filter({ hasText: `${marker} PAGE ${number}` }).first();
  await line.scrollIntoViewIfNeeded();
  const geometry = await line.evaluate(span => {
    const node = span.firstChild;
    if (node?.nodeType !== Node.TEXT_NODE || !node.length) throw new Error('Expected a rendered PDF text node');
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 1);
    const first = [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0);
    range.setStart(node, node.length - 1);
    range.setEnd(node, node.length);
    const last = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).at(-1);
    if (!first || !last) throw new Error('PDF glyph coordinates are unavailable');
    return { text: node.textContent, first: first.toJSON(), last: last.toJSON(), span: span.getBoundingClientRect().toJSON() };
  });
  assert.ok(geometry.last.right - geometry.first.left > 50, 'The rendered PDF line must have a measurable glyph range');
  const previous = await page.locator('.history-item').count();
  await page.mouse.move(geometry.first.left + 0.25, geometry.first.top + geometry.first.height / 2);
  await page.mouse.down();
  await page.mouse.move(geometry.last.right - 0.25, geometry.last.top + geometry.last.height / 2, { steps: 12 });
  await page.waitForFunction(() => window.getSelection().toString().trim().length > 8);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.history-item').count(), previous, 'Holding a text drag must not prematurely add a history entry');
  const selected = normalText(await page.evaluate(() => window.getSelection().toString()));
  await page.mouse.up();
  await page.waitForFunction(previous => document.querySelectorAll('.history-item').length > previous, previous);
  assert.ok(selected.includes(`PAGE ${number}`), `The genuine PDF drag must select the intended page; chosen=${JSON.stringify(selected)}, geometry=${JSON.stringify(geometry)}`);
  assert.equal(await page.locator('.history-item').first().getAttribute('data-page'), String(number), 'History must retain the selected page even without Ollama');
  assert.equal(normalText(await page.locator('#sourceText').textContent()), selected);
  assert.equal(await app.evaluate(() => globalThis.readingSmokeTranslationCalls.length), 0);
  return selected;
}

async function editLatest(action) {
  await page.locator('.history-item').first().click({ button: 'right' });
  const menu = page.locator('.reading-context-menu');
  await menu.waitFor();
  await menu.getByText(action, { exact: true }).click();
  await page.locator('#annotationEditor').waitFor();
}

async function showNotes() {
  if (!await page.locator('#annotationPanel').isVisible()) await page.locator('#annotationsButton').click();
  await page.locator('#annotationPanel').waitFor();
}

async function notesCount(count) {
  await showNotes();
  await page.waitForFunction(count => document.querySelectorAll('#annotationList .annotation-item').length === count, count);
}

async function hideNotes() {
  if (await page.locator('#annotationPanel').isVisible()) await page.locator('#annotationsButton').click();
  await page.locator('#annotationPanel').waitFor({ state: 'hidden' });
}

async function assertMinimumWindowLayout() {
  const measure = selectors => page.evaluate(selectors => {
    const viewport = { width: innerWidth, height: innerHeight };
    const nodes = selectors.map(selector => {
      const node = document.querySelector(selector);
      if (!node) return { selector, missing: true };
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        selector, rect: rect.toJSON(), visible: Boolean(rect.width && rect.height && style.display !== 'none' && style.visibility !== 'hidden'),
        hitTest: hit === node || node.contains(hit),
        withinViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
      };
    });
    return { viewport, nodes };
  }, selectors);
  const contained = layout => {
    for (const item of layout.nodes) {
      assert.ok(item.visible && item.withinViewport, `Minimum-window control must remain visible inside the viewport: ${JSON.stringify({ viewport: layout.viewport, ...item })}`);
    }
  };
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 620));
    await page.waitForFunction(() => innerWidth <= 980 && innerHeight <= 620);
    await showNotes();
    const panelLayout = await measure(['#annotationsButton', '#annotationPanel']);
    await page.screenshot({ path: path.join(output, `${label}-minimum-panel.png`) });
    contained(panelLayout);
    assert.ok(panelLayout.nodes[0].hitTest, 'The note-list button must remain usable in the minimum window');
    await page.locator('.annotation-item').first().locator('.annotation-edit').click();
    await page.locator('#annotationEditor').waitFor();
    const editorLayout = await measure(['#annotationEditor', '#annotationSave', '#annotationCancel']);
    await page.screenshot({ path: path.join(output, `${label}-minimum-editor.png`) });
    fs.writeFileSync(path.join(output, `${label}-minimum-layout.json`), JSON.stringify({ panelLayout, editorLayout }, null, 2));
    contained(editorLayout);
    assert.ok(editorLayout.nodes.slice(1).every(node => node.hitTest), 'Editor save/cancel buttons must remain usable in the minimum window');
    await page.locator('#annotationCancel').click();
    await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
  } finally {
    if (await page.locator('#annotationEditor').isVisible()) await page.locator('#annotationCancel').click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 960));
    await page.waitForFunction(() => innerWidth > 1200 && innerHeight > 700);
    await showNotes();
  }
}

async function assertLatestOpenWins() {
  // Delay only A's real IPC handler; B and all filesystem/storage work stay real.
  // A controlled gate makes the order deterministic without relying on PDF timing.
  await app.evaluate(({ ipcMain }, first) => {
    const original = ipcMain._invokeHandlers.get('reader:open-recent');
    if (typeof original !== 'function') throw new Error('Cannot locate the real open-recent handler');
    globalThis.readingSmokeOriginalOpenRecent = original;
    globalThis.readingSmokeDelayedOpenStarted = false;
    globalThis.readingSmokeDelayedOpenFinished = false;
    ipcMain.removeHandler('reader:open-recent');
    ipcMain.handle('reader:open-recent', async (event, file) => {
      const delayed = file === first;
      if (delayed) {
        globalThis.readingSmokeDelayedOpenStarted = true;
        await new Promise(resolve => { globalThis.readingSmokeReleaseDelayedOpen = resolve; });
      }
      try { return await original(event, file); }
      finally { if (delayed) globalThis.readingSmokeDelayedOpenFinished = true; }
    });
  }, first);
  try {
    await page.getByTitle(first, { exact: true }).click();
    await app.evaluate(async () => {
      const deadline = Date.now() + 10000;
      while (!globalThis.readingSmokeDelayedOpenStarted) {
        if (Date.now() >= deadline) throw new Error('The first PDF open was not received');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    });
    await open(second, 'SECOND DOCUMENT');
    await page.evaluate(() => {
      window.readingSmokeLateActivePaths = [];
      window.readingSmokeLateOpenObserver = new MutationObserver(() => {
        window.readingSmokeLateActivePaths.push(document.querySelector('.recent-row.active .recent-item')?.title || '');
      });
      window.readingSmokeLateOpenObserver.observe(document.getElementById('recentList'), { childList: true, subtree: true });
    });
    await app.evaluate(async () => {
      globalThis.readingSmokeReleaseDelayedOpen();
      const deadline = Date.now() + 10000;
      while (!globalThis.readingSmokeDelayedOpenFinished) {
        if (Date.now() >= deadline) throw new Error('The delayed real PDF read did not finish');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    });
    // Allow Electron's resolved IPC response and the renderer's promise continuation.
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.recent-row.active .recent-item').getAttribute('title'), second, 'A late earlier open must not replace the last-clicked PDF');
    await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').filter({ hasText: 'SECOND DOCUMENT PAGE 1' }).waitFor();
    assert.ok((await page.evaluate(() => window.readingSmokeLateActivePaths)).every(file => file !== first), 'An earlier response must never briefly switch the active reading path');
  } finally {
    await page.evaluate(() => { window.readingSmokeLateOpenObserver?.disconnect(); });
    await app.evaluate(({ ipcMain }) => {
      globalThis.readingSmokeReleaseDelayedOpen?.();
      ipcMain.removeHandler('reader:open-recent');
      ipcMain.handle('reader:open-recent', globalThis.readingSmokeOriginalOpenRecent);
      delete globalThis.readingSmokeOriginalOpenRecent;
      delete globalThis.readingSmokeReleaseDelayedOpen;
    });
  }
}

function papersUnchanged() {
  for (const [file, hash] of originalHashes) assert.equal(fileHash(file), hash, 'Reading priorities and annotations must never rewrite the source PDF');
}

(async () => {
  fs.writeFileSync(recentFile, JSON.stringify([first, second]), 'utf8');
  try {
    step = 'recent priority ordering';
    await launch();
    await page.waitForFunction(() => document.querySelectorAll('.recent-row').length === 2);
    await open(first, 'FIRST DOCUMENT');
    await page.waitForTimeout(30);
    await open(second, 'SECOND DOCUMENT');
    assert.deepEqual(await recentOrder(), [second, first]);
    const originalTimes = await timestamps();
    assert.ok(Object.values(originalTimes).every(value => Number.isFinite(value) && value > 0), 'Legacy string paths must migrate to real reading timestamps');
    await priorityAction(first, '优先级 +1', [first, second], 1);
    await priorityAction(first, '优先级 +1', [first, second], 2);
    await priorityAction(second, '优先级 +1', [first, second], 1);
    await priorityAction(first, '优先级清零', [second, first], 0);
    await priorityAction(second, '优先级清零', [second, first], 0);
    assert.deepEqual(await timestamps(), originalTimes, 'Priority changes must preserve reading times');
    checkpoint('priority increment, reset, priority-first sorting, reading-time tie break');
    await priorityAction(first, '优先级 +1', [first, second], 1);
    await close();

    step = 'priority restart persistence';
    await launch();
    await page.waitForFunction(() => document.querySelectorAll('.recent-row').length === 2);
    assert.deepEqual(await recentOrder(), [first, second]);
    assert.equal((await recentRecords()).find(item => item.path === first).priority, 1);
    assert.deepEqual(await timestamps(), originalTimes);
    checkpoint('priorities and reading times survive restart');

    step = 'out-of-order document opens';
    await assertLatestOpenWins();
    checkpoint('a late earlier PDF read cannot replace the last-clicked document');

    step = 'offline selection and annotation cancellation';
    await open(first, 'FIRST DOCUMENT');
    const source = await selectPage(2, 'FIRST DOCUMENT');
    await editLatest('写评论 / 笔记');
    await page.locator('#annotationComment').fill('This cancelled note must not be saved.');
    await page.locator('#annotationCancel').click();
    await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
    await notesCount(0);
    await hideNotes();
    checkpoint('offline drag creates a page-linked history item; cancel saves nothing');

    step = 'literal tags and comments';
    const literalTag = '<script>tag</script>';
    const comment = '<script>window.readingInjected = true</script>\nReview the method and its assumptions.';
    await editLatest('添加标签');
    await page.locator('#annotationTags').fill(`${literalTag}, methods`);
    await page.locator('#annotationComment').fill(comment);
    if (!editorCaptured) {
      await page.screenshot({ path: path.join(output, `${label}-annotation-editor.png`) });
      editorCaptured = true;
    }
    await page.locator('#annotationSave').click();
    await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
    await notesCount(1);
    const originalNote = page.locator('#annotationList .annotation-item').first();
    assert.ok(normalText(await originalNote.textContent()).includes(source));
    assert.ok(normalText(await originalNote.textContent()).includes(normalText(comment)));
    assert.equal(await originalNote.locator('.annotation-tag').filter({ hasText: literalTag }).count(), 1);
    assert.equal(await page.locator('#annotationList script').count(), 0, 'User annotations must render as text rather than executable HTML');
    assert.equal(await page.evaluate(() => window.readingInjected), undefined);
    await page.screenshot({ path: path.join(output, `${label}-annotation.png`) });
    checkpoint('tags, comments and source/page are visible; HTML-looking content stays literal');

    step = 'minimum-window annotation layout';
    await assertMinimumWindowLayout();
    checkpoint('note-list button, panel and editor controls fit the minimum 980x620 window');

    step = 'annotation editing and latest-first sorting';
    await originalNote.locator('.annotation-edit').click();
    await page.locator('#annotationEditor').waitFor();
    assert.equal(await page.locator('#annotationComment').inputValue(), comment);
    const editedComment = `${comment}\nEdited after rereading.`;
    await page.locator('#annotationComment').fill(editedComment);
    await page.locator('#annotationSave').click();
    await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
    await notesCount(1);
    assert.ok(normalText(await page.locator('.annotation-item').first().textContent()).includes(normalText(editedComment)));
    await hideNotes();
    const laterSource = await selectPage(3, 'FIRST DOCUMENT');
    await editLatest('写评论 / 笔记');
    await page.locator('#annotationComment').fill('A later note on page three.');
    await page.locator('#annotationSave').click();
    await page.locator('#annotationEditor').waitFor({ state: 'hidden' });
    await notesCount(2);
    assert.ok(normalText(await page.locator('.annotation-item').first().textContent()).includes(laterSource), 'Latest-added annotations must appear first');
    assert.ok(normalText(await page.locator('.annotation-item').nth(1).textContent()).includes(source));
    checkpoint('editing updates one note and latest-added annotations appear first');
    papersUnchanged();
    await close();

    step = 'annotation restart persistence and page jump';
    await launch();
    await page.waitForFunction(() => document.querySelectorAll('.recent-row').length === 2);
    await open(first, 'FIRST DOCUMENT');
    await notesCount(2);
    assert.ok(normalText(await page.locator('.annotation-item').nth(1).textContent()).includes(normalText(editedComment)));
    await page.locator('.annotation-item').nth(1).locator('.annotation-jump').click();
    await page.waitForFunction(() => document.getElementById('pageInput').value === '2');
    await page.locator('[data-page="2"] .pdf-page.rendered .textLayer span').filter({ hasText: 'FIRST DOCUMENT PAGE 2' }).waitFor();
    checkpoint('annotations survive restart and jump to their original page');

    step = 'same-name document isolation';
    await hideNotes();
    await open(second, 'SECOND DOCUMENT');
    await notesCount(0);
    await hideNotes();
    checkpoint('same filename with different PDF content has separate annotations');

    step = 'dropped document identity and annotation deletion';
    await page.evaluate(({ bytes }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], 'dropped-copy.pdf', { type: 'application/pdf' }));
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, { bytes: [...fs.readFileSync(first)] });
    await page.waitForFunction(() => document.getElementById('documentName').textContent === 'dropped-copy.pdf' && document.getElementById('pageTotal').textContent === '3');
    await notesCount(2);
    assert.ok(normalText(await page.locator('.annotation-item').nth(1).textContent()).includes(normalText(editedComment)), 'Dropped copies must recover notes from full PDF-content identity');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.annotation-item').first().locator('.annotation-delete').click();
    await notesCount(1);
    assert.ok(normalText(await page.locator('.annotation-item').first().textContent()).includes(source));
    checkpoint('dropped PDF copies recover notes; individual note deletion preserves the remaining note');
    await close();

    step = 'deletion persistence';
    await launch();
    await page.waitForFunction(() => document.querySelectorAll('.recent-row').length === 2);
    await open(first, 'FIRST DOCUMENT');
    await notesCount(1);
    assert.ok(normalText(await page.locator('.annotation-item').first().textContent()).includes(normalText(editedComment)));
    assert.equal(await app.evaluate(() => globalThis.readingSmokeTranslationCalls.length), 0);
    papersUnchanged();
    assert.deepEqual(errors, []);
    checkpoint('annotation deletion survives restart; PDFs unchanged; no renderer errors');
    const final = result(true);
    fs.writeFileSync(path.join(output, `${label}-result.json`), JSON.stringify(final, null, 2));
    console.log(JSON.stringify({ passed: true, checks: checks.length, report: path.join(output, `${label}-result.json`), rendererErrors: errors }));
  } catch (error) {
    fs.writeFileSync(path.join(output, `${label}-result.json`), JSON.stringify(result(false, error), null, 2));
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, `${label}-failure.png`), timeout: 3000 }).catch(() => {});
    throw error;
  } finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
