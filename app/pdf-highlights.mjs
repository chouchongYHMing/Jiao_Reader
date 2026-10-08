import { applyColor, noteColor } from './annotation-colors.mjs';

const clamp = value => Math.min(1, Math.max(0, value));

// Measure selected glyphs, rather than whole span boxes (which can include
// unselected text at a line boundary). Coordinates survive zoom and restart.
export function capturePageRects(range, body, layer = body?.querySelector('.textLayer')) {
  if (!range || !body || !layer) return [];
  const page = body.getBoundingClientRect();
  if (!page.width || !page.height) return [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const result = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.length || !range.intersectsNode(node)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
      part.setStart(range.startContainer, range.startOffset);
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
      part.setEnd(range.endContainer, range.endOffset);
    }
    if (part.collapsed) continue;
    for (const rect of part.getClientRects()) {
      const left = Math.max(page.left, rect.left);
      const top = Math.max(page.top, rect.top);
      const right = Math.min(page.right, rect.right);
      const bottom = Math.min(page.bottom, rect.bottom);
      if (right <= left || bottom <= top) continue;
      const x = clamp((left - page.left) / page.width);
      const y = clamp((top - page.top) / page.height);
      const width = Math.min(1 - x, (right - left) / page.width);
      const height = Math.min(1 - y, (bottom - top) / page.height);
      if (width > 0 && height > 0) result.push({ x, y, width, height });
    }
  }
  const merged = [];
  for (const rect of result.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const previous = merged.at(-1);
    if (previous && Math.abs(rect.y - previous.y) < 0.002 &&
        Math.abs(rect.height - previous.height) < 0.002 &&
        rect.x >= previous.x && rect.x <= previous.x + previous.width + 0.003) {
      previous.width = Math.max(previous.width, rect.x + rect.width - previous.x);
    } else merged.push({ ...rect });
  }
  return merged.slice(0, 2000);
}

// Old notes have only a quotation. Highlight it only when the text layer has
// one unambiguous match; new notes retain their original glyph coordinates.
function quotationRects(note, record) {
  const text = [];
  const positions = [];
  const walker = document.createTreeWalker(record.layer, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    for (let offset = 0; offset < node.length; offset++) {
      const char = node.data[offset];
      if (/\s|\u00ad/u.test(char)) continue;
      text.push(char);
      positions.push({ node, offset });
    }
  }
  const haystack = text.join('');
  const needle = String(note.source || '').replace(/[\s\u00ad]/gu, '');
  if (!needle) return [];
  const start = haystack.indexOf(needle);
  if (start < 0 || haystack.indexOf(needle, start + 1) >= 0) return [];
  const first = positions[start];
  const last = positions[start + needle.length - 1];
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return capturePageRects(range, record.body, record.layer);
}

export class PdfHighlights {
  constructor(reader) {
    this.reader = reader;
    this.notes = [];
  }

  setNotes(notes) {
    this.notes = notes || [];
    for (const record of this.reader.records.values()) this.render(record);
  }

  render(record) {
    record.body.querySelector('.pdf-annotation-layer')?.remove();
    if (!record.layer || !record.body.classList.contains('rendered')) return;
    const notes = this.notes.filter(note => Number(note.page) === record.number);
    if (!notes.length) return;
    const layer = document.createElement('div');
    layer.className = 'pdf-annotation-layer';
    layer.setAttribute('aria-hidden', 'true');
    for (const note of notes) {
      const rects = note.rects?.length ? note.rects : quotationRects(note, record);
      for (const rect of rects) {
        const highlight = document.createElement('span');
        highlight.className = 'pdf-annotation-highlight';
        highlight.dataset.annotationId = note.id;
        applyColor(highlight, noteColor(note));
        highlight.style.left = `${rect.x * 100}%`;
        highlight.style.top = `${rect.y * 100}%`;
        highlight.style.width = `${rect.width * 100}%`;
        highlight.style.height = `${rect.height * 100}%`;
        layer.append(highlight);
      }
    }
    if (layer.childElementCount) record.body.append(layer);
  }
}
