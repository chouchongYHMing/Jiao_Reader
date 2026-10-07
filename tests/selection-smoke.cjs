'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(process.env.JIAO_PLAYWRIGHT_MODULE || 'playwright');

const LINES = {
  first: 'Left one models preserve academic terms.',
  second: 'Left two results remain in the same column.',
  third: 'Left three confirms the reading order.',
  right: 'RIGHT COLUMN MUST STAY SEPARATE.',
  footer: 'FOOTER MUST NOT ENTER A SHORT SELECTION.'
};
const normalize = value => value.replace(/\s+/g, ' ').trim();

// The visual left-column lines are adjacent, but PDF operators deliberately put
// the footer and right column between them. This is a real PDF text-order case.
function makePdf() {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let number = 1; number <= 3; number++) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const text = (x, y, value, size = 11) => `BT /F1 ${size} Tf ${x} ${y} Td (${value}) Tj ET\n`;
    let content = text(55, 800, `PAGE ${number} - Selection regression`, 16);
    content += text(55, 760, LINES.first);
    content += text(55, 55, LINES.footer, 9);
    content += text(330, 760, LINES.right);
    content += text(55, 739, LINES.second);
    content += text(330, 739, 'RIGHT SECOND LINE ALSO STAYS SEPARATE.');
    content += text(55, 718, LINES.third);
    for (let line = 0; line < 22; line++) {
      content += text(55, 680 - line * 23, `Left continuation ${line + 1} studies local models.`);
      content += text(330, 680 - line * 23, `Right continuation ${line + 1} stays separate.`);
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

async function prepare(page, bytes) {
  const name = `selection-regression-${Date.now()}.pdf`;
  await page.keyboard.press('Escape');
  await page.evaluate(({ bytes, name }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, { bytes: [...bytes], name });
  // File.arrayBuffer is asynchronous. Wait for the new filename so an already
  // rendered prior fixture cannot accidentally satisfy the ready checks.
  await page.waitForFunction(name => document.getElementById('documentName').textContent === name, name);
  await page.waitForFunction(() => document.getElementById('pageTotal').textContent === '3' && !document.getElementById('pageInput').disabled);
  await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').filter({ hasText: LINES.first }).waitFor();
  await page.evaluate(() => {
    window.getSelection().removeAllRanges();
    document.getElementById('readerScroll').scrollTop = 0;
    window.selectionSmokeDragEvents = [];
  });
}

async function lineBox(page, text) {
  const span = page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').filter({ hasText: text }).first();
  const rect = await span.boundingBox();
  assert.ok(rect && rect.width > 30 && rect.height > 3, `Missing rendered line: ${text}`);
  return { ...rect, left: rect.x, right: rect.x + rect.width, centerY: rect.y + rect.height / 2, bottom: rect.y + rect.height };
}

async function snapshot(page, app) {
  const browser = await page.evaluate(() => {
    const selection = window.getSelection();
    const reader = document.getElementById('readerScroll');
    return {
      selection: selection?.toString() || '',
      source: document.getElementById('sourceText').textContent,
      scrollTop: reader.scrollTop,
      currentPage: document.getElementById('pageInput').value,
      windowY: window.scrollY,
      dragEvents: window.selectionSmokeDragEvents || [],
      dropVisible: !document.getElementById('dropOverlay').hidden
    };
  });
  return { ...browser, calls: await app.evaluate(() => globalThis.selectionSmokeCalls.slice()) };
}

async function drag(page, app, start, end, options = {}) {
  const before = await snapshot(page, app);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(end.x, end.y, { steps: 18 });
    // Longer than the selection debounce: pointer-down text must not translate.
    await page.waitForTimeout(450);
    const held = await snapshot(page, app);
    assert.equal(held.calls.length, before.calls.length, 'Translation must wait for pointer release');
    assert.equal(await page.locator('#translationBubble').isVisible(), false, 'Pointer-down must not open a translation bubble');
    if (options.held) options.held(held);
  } finally {
    await page.mouse.up();
  }
  await page.waitForTimeout(450);
  return { before, after: await snapshot(page, app) };
}

function assertLocalSelection(result, expected) {
  const actual = normalize(result.after.source);
  assert.equal(actual, normalize(expected), `A local drag should select exactly its visual lines; actual selection: ${JSON.stringify(result.after.selection)}`);
  assert.equal(result.after.currentPage, '1', 'A short drag must retain page 1');
  assert.ok(Math.abs(result.after.scrollTop - result.before.scrollTop) < 25, `A short drag must not scroll to another text region (${result.before.scrollTop} -> ${result.after.scrollTop})`);
  assert.equal(result.after.windowY, 0, 'Text selection must not scroll the application window');
  assert.ok(!result.after.source.includes('RIGHT') && !result.after.source.includes('FOOTER'), 'A left-column drag must not include the right column or footer');
}

(async () => {
  const testRoot = path.resolve(__dirname, '..');
  const appRoot = path.resolve(process.env.JIAO_APP_ROOT || testRoot);
  const label = process.env.JIAO_SELECTION_LABEL || 'selection';
  const output = path.join(testRoot, '.test-output');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, `${label}-user-data-`));
  const fixture = makePdf();
  fs.writeFileSync(path.join(output, 'selection-regression.pdf'), fixture);
  const packaged = process.env.JIAO_PACKAGED_EXECUTABLE;
  const app = await _electron.launch({
    executablePath: packaged || process.env.JIAO_ELECTRON_EXECUTABLE || require('electron'),
    args: [...(packaged ? [] : [appRoot]), `--user-data-dir=${userData}`],
    env: { ...process.env, JIAO_TEST_USER_DATA: userData },
    timeout: 30000
  });
  const results = [];
  const errors = [];
  const filter = process.env.JIAO_SELECTION_FILTER?.split(',').filter(Boolean);
  const reportPath = path.join(output, `${label}-report.json`);
  const saveProgress = () => fs.writeFileSync(reportPath, JSON.stringify({ appRoot, fixture: '3-page two-column PDF with interleaved footer/right-column operators', isolatedUserData: userData, rendererErrors: errors, results }, null, 2));
  try {
    assert.equal(path.resolve(await app.evaluate(({ app }) => app.getPath('userData'))).toLowerCase(), userData.toLowerCase(), 'Test must use an isolated profile');
    await app.evaluate(({ ipcMain }) => {
      const state = { connected: true, installation: 'installed', selectedModel: 'selection-test:latest', models: [{ name: 'selection-test:latest', size: 1000000 }] };
      for (const name of ['status', 'select-model', 'translate']) ipcMain.removeHandler(`reader:${name}`);
      ipcMain.handle('reader:status', () => state);
      ipcMain.handle('reader:select-model', (_, name) => { state.selectedModel = name; return state; });
      globalThis.selectionSmokeCalls = [];
      ipcMain.handle('reader:translate', (_, text) => { globalThis.selectionSmokeCalls.push(text); return '测试译文。'; });
    });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('crash', () => console.error(JSON.stringify({ phase: 'renderer-crashed' })));
    app.process().on('exit', (code, signal) => console.error(JSON.stringify({ phase: 'electron-exited', code, signal })));
    console.log(JSON.stringify({ phase: 'started', label, appRoot, userAgent: await page.evaluate(() => navigator.userAgent) }));
    await page.locator('#emptyOpenButton').waitFor();
    await page.locator('#refreshStatus').click();
    await page.waitForFunction(() => !document.getElementById('refreshStatus').disabled && document.querySelector('#modelStatus strong').textContent.includes('已就绪'));
    await page.evaluate(() => {
      document.addEventListener('dragstart', event => {
        queueMicrotask(() => window.selectionSmokeDragEvents.push({ defaultPrevented: event.defaultPrevented, type: event.target?.tagName || '' }));
      });
    });
    const run = async (name, action) => {
      if (filter && !filter.includes(name)) return;
      console.log(JSON.stringify({ phase: 'case', name }));
      try {
        await prepare(page, fixture);
        const geometry = await page.evaluate(() => {
          const spans = [...document.querySelectorAll('[data-page="1"] .pdf-page.rendered .textLayer span')];
          return {
            count: spans.length,
            blank: spans.filter(span => !span.textContent.trim()).length,
            columns: [...new Set(spans.map(span => span.dataset.selectionColumn || '(none)'))],
            sample: spans.slice(0, 12).map(span => {
              const rect = span.getBoundingClientRect();
              return { text: span.textContent, column: span.dataset.selectionColumn || '', x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            })
          };
        });
        console.log(JSON.stringify({ phase: 'geometry', name, ...geometry }));
        const details = await action(page);
        results.push({ name, passed: true, geometry, ...details });
      } catch (error) {
        await page.mouse.up().catch(() => {});
        if (page.isClosed()) throw error;
        const details = await snapshot(page, app);
        const { calls, ...browser } = details;
        results.push({ name, passed: false, error: error.message, ...browser, translationCallCount: calls.length, lastTranslatedText: calls.at(-1) });
        saveProgress();
        await page.screenshot({ path: path.join(output, `${label}-${name}.png`), timeout: 3000 }).catch(() => {});
      }
      saveProgress();
      const result = results.at(-1);
      console.log(JSON.stringify({ name, passed: result.passed, text: (result.text || result.source || '').slice(0, 160), error: result.error?.split('\n')[0] }));
    };
    for (const zoomed of [false, true]) {
      const suffix = zoomed ? '-zoomed' : '';
      const boxes = async () => {
        if (zoomed) {
          await page.locator('#zoomIn').click();
          await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').filter({ hasText: LINES.first }).waitFor();
        }
        return { one: await lineBox(page, LINES.first), two: await lineBox(page, LINES.second) };
      };
      await run(`line-end-whitespace${suffix}`, async () => {
        const { one } = await boxes();
        const result = await drag(page, app, { x: one.left + 0.5, y: one.centerY }, { x: one.right + 35, y: one.centerY });
        assertLocalSelection(result, LINES.first);
        return { text: result.after.source, scrollTop: result.after.scrollTop };
      });
      await run(`two-column-forward${suffix}`, async () => {
        const { one, two } = await boxes();
        const result = await drag(page, app, { x: one.left + 0.5, y: one.centerY }, { x: two.right + 0.5, y: two.centerY });
        assertLocalSelection(result, `${LINES.first} ${LINES.second}`);
        return { text: result.after.source, scrollTop: result.after.scrollTop };
      });
      await run(`two-column-backward${suffix}`, async () => {
        const { one, two } = await boxes();
        const result = await drag(page, app, { x: two.right + 0.5, y: two.centerY }, { x: one.left + 0.5, y: one.centerY });
        assertLocalSelection(result, `${LINES.first} ${LINES.second}`);
        return { text: result.after.source, scrollTop: result.after.scrollTop };
      });
      await run(`interline-whitespace${suffix}`, async () => {
        const { one, two } = await boxes();
        const result = await drag(page, app, { x: one.left + 0.5, y: one.centerY }, { x: two.right + 2, y: two.bottom + 4 });
        assertLocalSelection(result, `${LINES.first} ${LINES.second}`);
        return { text: result.after.source, scrollTop: result.after.scrollTop };
      });
      await run(`reader-side-boundary${suffix}`, async () => {
        const { one, two } = await boxes();
        const reader = await page.locator('#readerScroll').boundingBox();
        const result = await drag(page, app, { x: one.left + 0.5, y: one.centerY }, { x: reader.x + reader.width - 3, y: two.centerY });
        assertLocalSelection(result, `${LINES.first} ${LINES.second}`);
        return { text: result.after.source, scrollTop: result.after.scrollTop };
      });
    }
    await run('already-selected-text-drag', async () => {
      const one = await lineBox(page, LINES.first);
      await page.evaluate(text => {
        const span = [...document.querySelectorAll('[data-page="1"] .textLayer span')].find(node => node.textContent === text);
        const range = document.createRange();
        range.selectNodeContents(span);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }, LINES.first);
      await page.waitForTimeout(450);
      await page.keyboard.press('Escape');
      const before = await snapshot(page, app);
      assert.equal(normalize(before.selection), LINES.first, 'The native-drag test must begin with existing selected PDF text');
      await page.mouse.move(one.left + one.width * 0.4, one.centerY);
      await page.mouse.down();
      await page.mouse.move(one.left + one.width * 0.7, one.centerY + 18, { steps: 16 });
      await page.waitForTimeout(100);
      await page.mouse.up();
      const after = await snapshot(page, app);
      assert.ok(after.dragEvents.every(event => event.defaultPrevented), 'Dragging an existing selection must prevent native text drag');
      assert.ok(normalize(after.selection).length > 2, 'Dragging existing selected text must still produce a usable new range');
      assert.notEqual(normalize(after.selection), normalize(before.selection), 'The second gesture must change the range rather than silently keep the old selection');
      assert.equal(after.dropVisible, false, 'Text dragging must not show the PDF drop overlay');
      assert.equal(after.currentPage, before.currentPage, 'Text dragging must not jump pages');
      return { dragEvents: after.dragEvents, currentPage: after.currentPage };
    });
    assert.deepEqual(errors, [], 'Selection tests must not produce renderer errors');
    const report = { passed: results.every(item => item.passed), appRoot, packaged: !!packaged, fixture: '3-page two-column PDF with interleaved footer/right-column operators', isolatedUserData: userData, rendererErrors: errors, results };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, reportPath, rendererErrors: errors, results: results.map(({ name, passed }) => ({ name, passed })) }));
    if (!report.passed) process.exitCode = 1;
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
