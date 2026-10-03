'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require(process.env.JIAO_PLAYWRIGHT_MODULE || 'playwright');

function makePdf(count) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let number = 1; number <= count; number++) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const width = number === 5 ? 842 : 595;
    const height = number === 5 ? 595 : number === 7 ? 1100 : 842;
    let content = `BT /F1 18 Tf 55 ${height - 60} Td (PAGE ${number} - Academic reading) Tj ET\n`;
    for (let line = 0; line < 23; line++) {
      content += `BT /F1 11 Tf 55 ${height - 100 - line * 17} Td (The model translates academic papers on the local computer.) Tj ET\n`;
    }
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`;
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
  return [...Buffer.from(pdf)];
}

async function dropPdf(page, count, name = `sample-${count}.pdf`) {
  await page.evaluate(({ bytes, name }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, { bytes: makePdf(count), name });
  await page.waitForFunction(total => {
    return document.getElementById('pageTotal').textContent === String(total) && !document.getElementById('pageInput').disabled;
  }, count);
}

async function setStatus(app, page, state) {
  await app.evaluate(({ ipcMain }, state) => { globalThis.readerTestState = state; }, state);
  await page.locator('#refreshStatus').click();
  await page.waitForFunction(() => !document.getElementById('refreshStatus').disabled);
}

async function reselectLastRange(page) {
  await page.evaluate(() => {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(window.readerSmokeRange.cloneRange());
  });
}

async function selectBodyText(page, start = 0, end) {
  return page.evaluate(({ start, end }) => {
    const span = [...document.querySelectorAll('[data-page="1"] .textLayer span')].find(node => node.textContent.startsWith('The model'));
    const range = document.createRange();
    range.setStart(span.firstChild, start);
    range.setEnd(span.firstChild, end ?? span.textContent.length);
    window.readerSmokeRange = range.cloneRange();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString().trim();
  }, { start, end });
}

async function assertBubbleContained(page) {
  const bounds = await page.evaluate(() => {
    const bubble = document.getElementById('translationBubble').getBoundingClientRect();
    const reader = document.getElementById('readerScroll').getBoundingClientRect();
    return { bubble: bubble.toJSON(), reader: reader.toJSON(), viewport: { width: innerWidth, height: innerHeight } };
  });
  assert.ok(bounds.bubble.width > 100 && bounds.bubble.height > 30, 'Translation bubble must be visible');
  assert.ok(bounds.bubble.left >= bounds.reader.left - 1 && bounds.bubble.right <= bounds.reader.right + 1, 'Bubble must stay inside the reader horizontally');
  assert.ok(bounds.bubble.top >= bounds.reader.top - 1 && bounds.bubble.bottom <= Math.min(bounds.reader.bottom, bounds.viewport.height) + 1, 'Bubble must stay inside the reader vertically');
}

async function waitForTranslationCalls(app, count) {
  await app.evaluate(async (_, expected) => {
    const deadline = Date.now() + 10000;
    while (globalThis.readerTestCalls.length < expected) {
      if (Date.now() >= deadline) throw new Error(`Expected ${expected} translation calls; got ${globalThis.readerTestCalls.length}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }, count);
}

async function resolveTranslation(app, result) {
  await app.evaluate((_, result) => {
    const request = globalThis.readerTestPending.shift();
    if (!request) throw new Error('No pending translation to resolve');
    request.resolve(result);
  }, result);
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, '.test-output');
  fs.mkdirSync(output, { recursive: true });
  const packaged = process.env.JIAO_PACKAGED_EXECUTABLE;
  const app = await _electron.launch({
    executablePath: packaged || process.env.JIAO_ELECTRON_EXECUTABLE || require('electron'),
    args: packaged ? [] : [root],
    timeout: 30000
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#emptyOpenButton').waitFor();
    await page.waitForFunction(() => {
      const image = document.getElementById('readingIllustration');
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(await page.getByText('读懂每一篇论文', { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(output, packaged ? 'packaged-empty.png' : 'empty.png') });
    const live = process.env.JIAO_LIVE_OLLAMA === '1';
    if (!live) {
      await app.evaluate(({ ipcMain }) => {
        for (const name of ['status', 'select-model', 'translate']) ipcMain.removeHandler(`reader:${name}`);
        ipcMain.handle('reader:status', () => globalThis.readerTestState);
        ipcMain.handle('reader:select-model', (_, name) => {
          globalThis.readerTestState.selectedModel = name;
          return globalThis.readerTestState;
        });
        globalThis.readerTestCalls = [];
        globalThis.readerTestPending = [];
        globalThis.readerTestDelay = false;
        ipcMain.handle('reader:translate', (_, text) => {
          globalThis.readerTestCalls.push(text);
          if (globalThis.readerTestDelay) return new Promise(resolve => globalThis.readerTestPending.push({ text, resolve }));
          return `${globalThis.readerTestState.selectedModel}：这是一段本地学术翻译。`;
        });
      });
      await setStatus(app, page, { connected: false, installation: 'not-found', models: [], selectedModel: '' });
      assert.match(await page.locator('#modelStatus strong').textContent(), /未检测到/);
      assert.equal(await page.locator('#ollamaLink').isVisible(), true);
      assert.equal(await page.locator('#startOllama').isVisible(), false);
      await setStatus(app, page, { connected: false, installation: 'installed', models: [], selectedModel: '' });
      assert.equal(await page.locator('#startOllama').isVisible(), true);
      await setStatus(app, page, { connected: true, installation: 'installed', models: [], selectedModel: '' });
      assert.equal(await page.locator('#modelSelect').isDisabled(), true);
      await setStatus(app, page, {
        connected: true, installation: 'installed', selectedModel: '',
        models: [{ name: 'small-local:latest', size: 1000000 }, { name: 'other-local:latest' }, { name: 'embedding:latest', available: false, reason: 'Embedding only' }]
      });
      assert.equal(await page.locator('#modelSelect option[value="embedding:latest"]').isDisabled(), true);
      await page.locator('#modelSelect').selectOption('small-local:latest');
      await page.waitForFunction(() => document.querySelector('#modelStatus strong').textContent.includes('已就绪'));
      await page.locator('#modelSelect').selectOption('other-local:latest');
      await page.waitForFunction(() => document.querySelector('#modelStatus small').textContent === 'other-local:latest');
      await page.locator('#refreshStatus').click();
      await page.waitForFunction(() => !document.getElementById('refreshStatus').disabled);
      assert.equal(await page.locator('#modelSelect').inputValue(), 'other-local:latest');
    } else {
      await page.waitForFunction(() => document.querySelector('#modelStatus strong').textContent.includes('已就绪'), null, { timeout: 30000 });
    }

    await dropPdf(page, 12);
    await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').first().waitFor();
    const layout = await page.evaluate(() => {
      const container = document.getElementById('readerScroll');
      return { height: container.clientHeight, scrollHeight: container.scrollHeight, window: window.innerHeight };
    });
    assert.ok(layout.height < layout.window, 'Reader must fit inside the window');
    assert.ok(layout.scrollHeight > layout.height * 5, 'PDF must have a real scroll range');
    await page.locator('#readerScroll').hover();
    await page.mouse.wheel(0, 1200);
    await page.waitForFunction(() => document.getElementById('readerScroll').scrollTop > 200);
    await page.waitForFunction(() => Number(document.getElementById('pageInput').value) >= 2);
    await page.mouse.wheel(0, -1200);
    await page.waitForFunction(() => document.getElementById('readerScroll').scrollTop < 100);

    await page.locator('#pageInput').fill('7');
    await page.locator('#pageInput').press('Enter');
    await page.waitForFunction(() => document.getElementById('pageReadout').textContent === '第 7 页 / 共 12 页');
    await page.locator('#zoomIn').click({ clickCount: 3 });
    await page.locator('#zoomOut').click({ clickCount: 2 });
    await page.evaluate(() => {
      for (let index = 0; index < 16; index++) document.getElementById(index % 2 ? 'zoomOut' : 'zoomIn').click();
    });
    await page.waitForFunction(() => {
      const body = document.querySelector('[data-page="7"] .pdf-page');
      const canvases = body.querySelectorAll('canvas');
      return body.classList.contains('rendered') && canvases.length === 1 && body.querySelector('.textLayer')?.style.visibility !== 'hidden';
    });
    assert.equal(await page.locator('#pageInput').inputValue(), '7', 'Rapid zoom must retain the current page');
    const chrome = await page.evaluate(() => ({ windowY: window.scrollY, top: document.querySelector('.topbar').getBoundingClientRect().top }));
    assert.equal(chrome.windowY, 0);
    assert.equal(chrome.top, 0, 'Zoom must never move the toolbar out of the window');
    await page.locator('#fitButton').click();
    assert.equal(await page.locator('#pageInput').inputValue(), '7');
    await page.locator('#nextPage').click();
    assert.equal(await page.locator('#pageInput').inputValue(), '8');
    await page.locator('#previousPage').click();
    assert.equal(await page.locator('#pageInput').inputValue(), '7');

    await page.evaluate(() => { for (let index = 0; index < 25; index++) document.getElementById('zoomOut').click(); });
    assert.equal(await page.locator('#zoomValue').textContent(), '60%');
    await page.locator('#pageInput').fill('999');
    await page.locator('#pageInput').press('Enter');
    assert.equal(await page.locator('#pageInput').inputValue(), '12');
    assert.equal(await page.locator('#nextPage').isDisabled(), true);
    await page.locator('#pageInput').fill('0');
    await page.locator('#pageInput').press('Enter');
    assert.equal(await page.locator('#pageInput').inputValue(), '1');

    await page.locator('#zoomIn').click();
    await dropPdf(page, 3, 'replacement.pdf');
    await page.locator('[data-page="1"] .pdf-page.rendered .textLayer span').first().waitFor();
    assert.equal(await page.locator('.page-shell').count(), 3);
    // Hold a genuine PDF text drag beyond the debounce interval: the app must wait for release.
    const textLine = page.locator('[data-page="1"] .textLayer span').filter({ hasText: 'The model translates' }).first();
    const lineBounds = await textLine.boundingBox();
    assert.ok(lineBounds && lineBounds.width > 50);
    await page.mouse.move(lineBounds.x + 1, lineBounds.y + lineBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(lineBounds.x + lineBounds.width - 1, lineBounds.y + lineBounds.height / 2, { steps: 12 });
    await page.waitForFunction(() => window.getSelection().toString().trim().length > 15);
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#translationBubble').isVisible(), false, 'Dragging must not open a partial translation');
    if (!live) assert.equal(await app.evaluate(() => globalThis.readerTestCalls.length), 0, 'Dragging must not submit incomplete text');
    await page.evaluate(() => { window.readerSmokeRange = window.getSelection().getRangeAt(0).cloneRange(); });
    await page.mouse.up();
    await page.waitForFunction(() => !document.getElementById('copyButton').disabled, null, { timeout: live ? 190000 : 10000 });
    const translation = await page.locator('#translationText').textContent();
    assert.ok(translation.length > 3);
    assert.equal(await page.locator('#historyCount').textContent(), '1');
    await page.locator('#translationBubble[data-state="success"]').waitFor();
    assert.equal(await page.locator('#bubbleText').textContent(), translation, 'Bubble and sidebar must show the same result');
    await assertBubbleContained(page);
    // Capture the app's clipboard write without replacing the user's system clipboard.
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.readerSmokeCopied = text; } });
    });
    await page.locator('#bubbleCopy').click();
    assert.equal(await page.evaluate(() => window.readerSmokeCopied), translation);
    assert.equal(await page.locator('#translationBubble').isVisible(), true, 'Copy must not dismiss the bubble');
    await page.screenshot({ path: path.join(output, packaged ? 'packaged-reader.png' : 'reader.png') });

    await page.locator('#bubbleClose').click();
    assert.equal(await page.locator('#translationBubble').isVisible(), false);
    await reselectLastRange(page);
    await page.locator('#translationBubble[data-state="success"]').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#translationBubble').isVisible(), false);
    await reselectLastRange(page);
    await page.locator('#translationBubble[data-state="success"]').waitFor();
    await page.locator('#documentName').click();
    assert.equal(await page.locator('#translationBubble').isVisible(), false, 'Outside click must dismiss');
    await reselectLastRange(page);
    await page.locator('#translationBubble[data-state="success"]').waitFor();
    await page.evaluate(() => { document.getElementById('readerScroll').scrollTop += 90; });
    await page.locator('#translationBubble').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#translationText').textContent(), translation, 'Dismissing must preserve the sidebar result');
    if (!live) assert.equal(await app.evaluate(() => globalThis.readerTestCalls.length), 1, 'Reselecting unchanged text must reuse its translation');

    if (!live) {
      await page.evaluate(() => { document.getElementById('readerScroll').scrollTop = 0; });
      await page.waitForTimeout(100);
      await app.evaluate(() => { globalThis.readerTestDelay = true; });
      await selectBodyText(page, 0, 35);
      await page.locator('#translationBubble[data-state="loading"]').waitFor();
      await waitForTranslationCalls(app, 2);
      assert.equal(await page.locator('#bubbleCopy').isDisabled(), true);
      await page.locator('#bubbleClose').click();
      await resolveTranslation(app, '关闭气泡后完成的翻译。');
      await page.waitForFunction(() => document.getElementById('translationText').textContent === '关闭气泡后完成的翻译。');
      assert.equal(await page.locator('#translationBubble').isVisible(), false, 'A late result must not reopen a dismissed bubble');
      await reselectLastRange(page);
      await page.locator('#translationBubble[data-state="success"]').waitFor();
      assert.equal(await page.locator('#bubbleText').textContent(), '关闭气泡后完成的翻译。');

      await selectBodyText(page, 4, 42);
      await waitForTranslationCalls(app, 3);
      const latestText = await selectBodyText(page, 10, 50);
      await page.waitForFunction(text => document.getElementById('sourceText').textContent === text, latestText);
      await resolveTranslation(app, '这条旧结果不应覆盖新选文。');
      await waitForTranslationCalls(app, 4);
      assert.notEqual(await page.locator('#bubbleText').textContent(), '这条旧结果不应覆盖新选文。');
      const longTranslation = '新的选文翻译，保留公式与学术术语。'.repeat(140);
      await resolveTranslation(app, longTranslation);
      await page.locator('#translationBubble[data-state="success"]').waitFor();
      assert.equal(await page.locator('#bubbleText').textContent(), longTranslation);
      assert.equal(await page.locator('#sourceText').textContent(), latestText);
      await assertBubbleContained(page);
      const overflow = await page.locator('#bubbleText').evaluate(node => ({ height: node.clientHeight, content: node.scrollHeight, overflow: getComputedStyle(node).overflowY }));
      assert.ok(overflow.content > overflow.height, 'Long translations must have their own scroll range');
      assert.match(overflow.overflow, /auto|scroll/);
      const lastCalls = await app.evaluate(() => globalThis.readerTestCalls.slice(-2));
      assert.equal(lastCalls[1], latestText);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, wheel: 'up/down', rapidZoom: 'page retained', navigation: '1..12', modelStates: live ? 'live Ollama' : 'not-found/stopped/empty/selection', bubble: live ? 'drag/copy/dismiss/reselect' : 'drag/copy/dismiss/reselect/late-result/latest-request/long-text', illustration: 'loaded', translation, rendererErrors: errors }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
