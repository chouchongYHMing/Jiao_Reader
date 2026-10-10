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
  constructor(reader, onNote = () => {}) {
    this.reader = reader;
    this.notes = [];
    this.onNote = onNote;
    this.focus = null;
    this.focusSerial = 0;
  }

  setNotes(notes) {
    this.notes = notes || [];
    for (const record of this.reader.records.values()) this.render(record);
  }

  clearFocus() {
    ++this.focusSerial;
    this.focus = null;
    for (const record of this.reader.records.values()) record.body.querySelector('.pdf-history-layer')?.remove();
  }

  async revealSelection(selection) {
    this.clearFocus();
    const serial = this.focusSerial;
    const version = this.reader.version;
    const record = await this.reader.revealPage(Number(selection.page));
    if (!record || serial !== this.focusSerial || version !== this.reader.version) return false;
    const rects = selection.rects?.length ? selection.rects : quotationRects(selection, record);
    if (!rects.length) return false;
    this.focus = { ...selection, rects };
    this.render(record);
    this.reader.scrollToSelection(record, rects[0]);
    return true;
  }

  rectangle(className, rect) {
    const node = document.createElement('span');
    node.className = className;
    node.style.left = `${rect.x * 100}%`;
    node.style.top = `${rect.y * 100}%`;
    node.style.width = `${rect.width * 100}%`;
    node.style.height = `${rect.height * 100}%`;
    return node;
  }

  render(record) {
    record.body.querySelector('.pdf-annotation-layer')?.remove();
    record.body.querySelector('.pdf-note-markers')?.remove();
    record.body.querySelector('.pdf-history-layer')?.remove();
    if (!record.layer || !record.body.classList.contains('rendered')) return;
    const notes = this.notes.filter(note => Number(note.page) === record.number);
    const layer = document.createElement('div');
    layer.className = 'pdf-annotation-layer';
    layer.setAttribute('aria-hidden', 'true');
    const markers = document.createElement('div');
    markers.className = 'pdf-note-markers';
    for (const note of notes) {
      const rects = note.rects?.length ? note.rects : quotationRects(note, record);
      for (const rect of rects) {
        const highlight = this.rectangle('pdf-annotation-highlight', rect);
        highlight.dataset.annotationId = note.id;
        applyColor(highlight, noteColor(note));
        layer.append(highlight);
      }
      if (rects.length && note.comment?.trim()) {
        const end = rects.at(-1);
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'pdf-note-marker';
        marker.dataset.annotationId = note.id;
        marker.setAttribute('aria-label', `查看第 ${note.page} 页的评论`);
        marker.setAttribute('aria-haspopup', 'dialog');
        marker.title = note.comment.slice(0, 160);
        applyColor(marker, noteColor(note));
        marker.style.left = `${Math.max(0, Math.min(end.x + end.width, 1 - 24 / record.viewport.width)) * 100}%`;
        marker.style.top = `${Math.max(0, Math.min(end.y + end.height, 1 - 20 / record.viewport.height)) * 100}%`;
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 20 20');
        icon.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(icon.namespaceURI, 'path');
        path.setAttribute('d', 'M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8L3 18V5a1.5 1.5 0 0 1 1-1.5ZM6 7.5h8M6 10.5h6');
        icon.append(path);
        marker.append(icon);
        marker.addEventListener('click', event => { event.stopPropagation(); this.onNote(note, marker); });
        markers.append(marker);
      }
    }
    if (layer.childElementCount) record.body.append(layer);
    if (markers.childElementCount) record.body.append(markers);
    if (Number(this.focus?.page) === record.number) {
      const historyLayer = document.createElement('div');
      historyLayer.className = 'pdf-history-layer';
      historyLayer.setAttribute('aria-hidden', 'true');
      for (const rect of this.focus.rects) {
        const highlight = this.rectangle('pdf-history-highlight', rect);
        highlight.dataset.selectionId = this.focus.id;
        historyLayer.append(highlight);
      }
      record.body.append(historyLayer);
    }
  }
}
