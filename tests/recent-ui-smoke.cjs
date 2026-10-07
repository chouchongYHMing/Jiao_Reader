'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require(process.env.JIAO_PLAYWRIGHT_MODULE || 'playwright');

function makePdf(marker) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let number = 1; number <= 2; number++) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const content = `BT /F1 16 Tf 55 770 Td (${marker} PAGE ${number}) Tj ET\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count 2 >>`;
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
const output = path.join(root, '.test-output');
const packaged = process.env.JIAO_PACKAGED_EXECUTABLE;
const label = packaged ? 'packaged-recent' : 'recent';
fs.mkdirSync(output, { recursive: true });
const fixtureDirectory = fs.mkdtempSync(path.join(output, `${label}-fixtures-`));
const profile = path.join(fixtureDirectory, 'user-data');
fs.mkdirSync(profile, { recursive: true });
const first = path.join(fixtureDirectory, 'first', 'same-name.pdf');
const second = path.join(fixtureDirectory, 'second', 'same-name.pdf');
for (const [file, marker] of [[first, 'FIRST DOCUMENT'], [second, 'SECOND DOCUMENT']]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, makePdf(marker));
}
const recentFile = path.join(profile, 'recent.json');
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalHashes = new Map([first, second].map(file => [file, hashFile(file)]));
const persisted = () => JSON.parse(fs.readFileSync(recentFile, 'utf8'));
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const rendererErrors = [];
let runningApp;

async function launch() {
  runningApp = await _electron.launch({
    executablePath: packaged || process.env.JIAO_ELECTRON_EXECUTABLE || require('electron'),
    args: [...(packaged ? [] : [appRoot]), `--user-data-dir=${profile}`],
    timeout: 30000
  });
  const actualProfile = await runningApp.evaluate(({ app }) => app.getPath('userData'));
  assert.ok(samePath(actualProfile, profile), 'Electron --user-data-dir must isolate app.getPath(userData) before testing real recent IPC');
  const page = await runningApp.firstWindow();
  page.on('pageerror', error => rendererErrors.push(error.message));
  await page.locator('#emptyOpenButton').waitFor();
  return page;
}

async function close() {
  if (!runningApp) return;
  await runningApp.close();
  runningApp = null;
}

async function waitRecentCount(page, count) {
  await page.waitForFunction(count => document.getElementById('recentCount').textContent === String(count), count);
  assert.equal(await page.locator('.recent-row').count(), count);
}

async function openRecent(page, file, marker) {
  await page.getByTitle(file, { exact: true }).click();
  await page.waitForFunction(() => document.getElementById('pageTotal').textContent === '2' && !document.getElementById('pageInput').disabled);
  await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').filter({ hasText: `${marker} PAGE 1` }).waitFor();
  assert.equal(await page.locator('.recent-row.active').count(), 1, 'Same-name PDFs must have exactly one active path');
  assert.equal(await page.locator('.recent-row.active .recent-item').getAttribute('title'), file);
  await page.locator('#pageInput').fill('2');
  await page.locator('#pageInput').press('Enter');
  await page.locator('[data-page="2"] .pdf-page.rendered .textLayer span').filter({ hasText: `${marker} PAGE 2` }).waitFor();
}

async function readerSnapshot(page) {
  return page.evaluate(() => ({
    name: document.getElementById('documentName').textContent,
    total: document.getElementById('pageTotal').textContent,
    current: document.getElementById('pageInput').value,
    zoom: document.getElementById('zoomValue').textContent,
    scrollTop: document.getElementById('readerScroll').scrollTop,
    pageText: document.querySelector('[data-page="2"] .textLayer')?.textContent,
    stageVisible: !document.getElementById('pdfStage').hidden,
    emptyVisible: !document.getElementById('emptyState').hidden
  }));
}

function assertPapersUnchanged() {
  for (const [file, original] of originalHashes) assert.equal(hashFile(file), original, 'Removing history must preserve every original PDF byte');
}

(async () => {
  fs.writeFileSync(recentFile, JSON.stringify([first, second]), 'utf8');
  try {
    let page = await launch();
    if (process.argv.includes('--probe-profile')) {
      console.log(JSON.stringify({ passed: true, isolatedUserData: true, profile }));
      return;
    }
    await waitRecentCount(page, 2);
    await openRecent(page, first, 'FIRST DOCUMENT');
    await openRecent(page, second, 'SECOND DOCUMENT');
    const beforeRemove = await readerSnapshot(page);
    await page.getByTitle(first, { exact: true }).locator('..').locator('.recent-remove').click();
    await waitRecentCount(page, 1);
    assert.deepEqual(persisted(), [second]);
    assert.deepEqual(await readerSnapshot(page), beforeRemove, 'Removing another record must preserve the document, page and zoom');
    assertPapersUnchanged();
    await page.screenshot({ path: path.join(output, `${label}-remove-one.png`) });
    await close();

    page = await launch();
    await waitRecentCount(page, 1);
    assert.equal(await page.getByTitle(first, { exact: true }).count(), 0, 'Removed record must not return after restart');
    await openRecent(page, second, 'SECOND DOCUMENT');
    const beforeActiveRemove = await readerSnapshot(page);
    await page.locator('.recent-row.active .recent-remove').click();
    await waitRecentCount(page, 0);
    assert.deepEqual(persisted(), []);
    assert.deepEqual(await readerSnapshot(page), beforeActiveRemove, 'Removing the current reading record must leave the current PDF open');
    assert.equal(await page.locator('#clearRecent').isDisabled(), true);
    assertPapersUnchanged();
    await page.screenshot({ path: path.join(output, `${label}-remove-current.png`) });
    await close();

    page = await launch();
    await waitRecentCount(page, 0);
    assert.deepEqual(persisted(), []);
    await close();

    // Seed a fresh isolated history to exercise the distinct clear-all UI action.
    fs.writeFileSync(recentFile, JSON.stringify([first, second]), 'utf8');
    page = await launch();
    await waitRecentCount(page, 2);
    await openRecent(page, second, 'SECOND DOCUMENT');
    const beforeClear = await readerSnapshot(page);
    await page.locator('#clearRecent').click();
    await waitRecentCount(page, 0);
    assert.deepEqual(persisted(), []);
    assert.deepEqual(await readerSnapshot(page), beforeClear, 'Clearing all history must leave the current PDF, page and zoom open');
    assert.equal(await page.locator('#clearRecent').isDisabled(), true);
    assertPapersUnchanged();
    await page.screenshot({ path: path.join(output, `${label}-clear.png`) });
    await close();

    page = await launch();
    await waitRecentCount(page, 0);
    assert.deepEqual(persisted(), []);
    assertPapersUnchanged();
    assert.deepEqual(rendererErrors, []);
    const result = { passed: true, isolatedUserData: true, sameNamePathHighlight: true, removeOne: true, removeCurrent: true, clearAll: true, restartPersistence: true, currentPdfPreserved: true, pdfFilesUnchanged: true, rendererErrors };
    fs.writeFileSync(path.join(output, `${label}-result.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
