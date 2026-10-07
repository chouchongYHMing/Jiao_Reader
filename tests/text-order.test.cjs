'use strict';

const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modulePromise = import(pathToFileURL(path.join(__dirname, '../app/text-order.mjs')).href);
const previousDocument = globalThis.document;

// Only DOM moves and measured text boxes are mocked. The expected reading order
// comes from the visible fixture, independently of the implementation's cuts.
function container(children = []) {
  const result = {
    children: [],
    append(...nodes) {
      for (const node of nodes) {
        if (node.isFragment) {
          this.append(...node.children.slice());
          continue;
        }
        if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
        node.parent = this;
        this.children.push(node);
      }
    }
  };
  result.append(...children);
  return result;
}

globalThis.document = { createDocumentFragment: () => ({ ...container(), isFragment: true }) };
after(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

function span(text, left, top, width = 130, height = 12) {
  return {
    tagName: 'SPAN', textContent: text, dataset: {},
    getBoundingClientRect: () => ({ left, right: left + width, top, bottom: top + height, width, height })
  };
}

function layer(nodes, marker = null) {
  return { ...container(nodes), querySelector: () => marker };
}

function labels(textLayer) { return textLayer.children.map(node => node.textContent); }

test('PDF.js space and zero-area spans do not disable visible reading order recovery', async () => {
  const first = span('Body first', 50, 50);
  const space = span(' ', 180, 50, 40);
  const footer = span('Footer', 50, 740);
  const empty = span('', 0, 0, 0, 0);
  const second = span('Body second', 50, 66);
  const textLayer = layer([first, space, footer, empty, second]);
  await order(textLayer);
  assert.deepEqual(labels(textLayer), ['Body first', ' ', 'Body second', 'Footer', '']);
});

async function order(textLayer, options = {}) {
  const { orderTextLayer } = await modulePromise;
  orderTextLayer(textLayer, { items: options.items || [{ dir: 'ltr' }] }, { rotation: options.rotation || 0 });
}

test('clear two-column text reads down the left column before the right column', async () => {
  const left1 = span('Left paragraph 1', 50, 50);
  const left2 = span('Left paragraph 2', 50, 66);
  const right1 = span('Right paragraph 1', 230, 50);
  const right2 = span('Right paragraph 2', 230, 66);
  const textLayer = layer([left1, right1, left2, right2]);
  await order(textLayer);
  assert.deepEqual(labels(textLayer), ['Left paragraph 1', 'Left paragraph 2', 'Right paragraph 1', 'Right paragraph 2']);
  assert.ok(left1.dataset.selectionColumn, 'Clear column boundaries should be available for gap selection');
  assert.equal(left1.dataset.selectionColumn, left2.dataset.selectionColumn);
  assert.equal(right1.dataset.selectionColumn, right2.dataset.selectionColumn);
  assert.notEqual(left1.dataset.selectionColumn, right1.dataset.selectionColumn);
});

test('narrow two-column gutters preserve an already correct original reading order', async () => {
  const textLayer = layer([
    span('Left 1', 50, 50), span('Left 2', 50, 66),
    span('Right 1', 192, 50), span('Right 2', 192, 66)
  ]);
  const originalNodes = textLayer.children.slice();
  await order(textLayer);
  assert.deepEqual(labels(textLayer), ['Left 1', 'Left 2', 'Right 1', 'Right 2']);
  assert.deepEqual(textLayer.children, originalNodes, 'An uncertain layout must not be interleaved by line');
});

test('uncertain narrow gutters do not invent a reading order for table-like content', async () => {
  const textLayer = layer([
    span('Cell B1', 192, 50), span('Cell B2', 192, 66),
    span('Cell A1', 50, 50), span('Cell A2', 50, 66)
  ]);
  const original = labels(textLayer);
  await order(textLayer);
  assert.deepEqual(labels(textLayer), original);
});

test('a footer emitted first in the PDF content is read after the visible body', async () => {
  const textLayer = layer([
    span('Page footer', 50, 600), span('Body second line', 50, 66), span('Body first line', 50, 50)
  ]);
  await order(textLayer);
  assert.deepEqual(labels(textLayer), ['Body first line', 'Body second line', 'Page footer']);
});

test('full-width heading and footer stay outside the two-column body', async () => {
  const textLayer = layer([
    span('Page footer', 50, 600, 310), span('Right 2', 230, 120),
    span('Title', 50, 20, 310), span('Left 2', 50, 120),
    span('Right 1', 230, 104), span('Left 1', 50, 104)
  ]);
  await order(textLayer);
  assert.deepEqual(labels(textLayer), ['Title', 'Left 1', 'Left 2', 'Right 1', 'Right 2', 'Page footer']);
});

test('line breaks travel with their text when the visible order is recovered', async () => {
  const textLayer = layer([
    span('Second line', 50, 66), { tagName: 'BR', textContent: '\n' },
    span('First line', 50, 50), { tagName: 'BR', textContent: '\n' }
  ]);
  await order(textLayer);
  assert.deepEqual(labels(textLayer), ['First line', '\n', 'Second line', '\n']);
});

for (const [name, options, marker] of [
  ['RTL text', { items: [{ dir: 'rtl' }] }, null],
  ['rotated page', { rotation: 90 }, null],
  ['tagged text structure', {}, { className: 'markedContent' }],
  ['image text elements', {}, { role: 'img' }]
]) {
  test(`${name} retains its original structure`, async () => {
    const textLayer = layer([span('Original first', 50, 66), span('Original second', 50, 50)], marker);
    const originalNodes = textLayer.children.slice();
    await order(textLayer, options);
    assert.deepEqual(textLayer.children, originalNodes);
    assert.deepEqual(labels(textLayer), ['Original first', 'Original second']);
  });
}
