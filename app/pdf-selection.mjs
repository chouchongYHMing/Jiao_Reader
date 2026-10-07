/*
 * Selection boundary handling adapted from Mozilla PDF.js 6.3.289
 * web/text_layer_builder.js, Copyright 2012 Mozilla Foundation, Apache-2.0.
 * See app/pdfjs/LICENSE and docs/PDF_SELECTION.md for sources and adaptations.
 */
export class PdfSelection {
  constructor(container, onEnd) {
    this.container = container;
    this.onEnd = onEnd;
    this.layers = new Map();
    this.dragging = false;
    this.pointerId = null;
    this.lastRange = null;
    this.lastSelection = null;
    this.previousRange = null;
    this.anchor = null;
    this.point = null;
    this.column = '';
    this.manual = false;
    this.lastScroll = { top: container.scrollTop, left: container.scrollLeft };
    this.outside = false;
    const version = /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
    this.modernChromium = Number(version) >= 148;
    document.addEventListener('pointerdown', event => this.start(event), true);
    document.addEventListener('pointermove', event => this.move(event), true);
    document.addEventListener('pointerup', event => this.finish(event), true);
    document.addEventListener('pointercancel', () => this.cancel(), true);
    document.addEventListener('selectionchange', () => this.update());
    window.addEventListener('blur', () => this.cancel());
    container.addEventListener('scroll', () => {
      if (this.dragging && this.outside) this.restoreScroll();
      else this.lastScroll = { top: container.scrollTop, left: container.scrollLeft };
    }, { passive: true });
    container.addEventListener('dragstart', event => {
      if (event.target.closest?.('.textLayer')) event.preventDefault();
    });
  }

  attach(layer) {
    const end = document.createElement('div');
    end.className = 'endOfContent';
    end.setAttribute('aria-hidden', 'true');
    layer.append(end);
    this.layers.set(layer, end);
  }

  detach(layer) {
    if (!layer) return;
    if (this.lastRange && this.lastRange.intersectsNode(layer)) this.cancel();
    this.layers.delete(layer);
  }

  reset() {
    for (const [layer, end] of this.layers) {
      layer.classList.remove('selecting');
      layer.append(end);
      end.style.width = end.style.height = end.style.userSelect = '';
    }
    this.previousRange = null;
  }

  start(event) {
    if (event.button !== 0) return;
    const layer = event.target.closest?.('.textLayer');
    if (!this.layers.has(layer)) return;
    this.dragging = true;
    this.pointerId = event.pointerId;
    this.outside = false;
    this.lastRange = this.lastSelection = this.previousRange = null;
    this.anchor = null;
    this.point = { x: event.clientX, y: event.clientY };
    this.column = event.target.closest('span')?.dataset.selectionColumn || '';
    this.manual = false;
    this.lastScroll = { top: this.container.scrollTop, left: this.container.scrollLeft };
    // Starting in a margin must not anchor a new selection to the whole page.
    if (!event.target.closest('span')?.textContent.trim()) {
      event.preventDefault();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      const caret = this.nearestCaret(layer, this.point, '');
      if (caret && caret.gapY <= caret.rect.height && caret.gapX <= Math.max(20, caret.rect.height * 2)) {
        this.anchor = { node: caret.node, offset: caret.offset };
        this.column = caret.column;
        this.manual = true;
        selection.collapse(caret.node, caret.offset);
        layer.classList.add('selecting');
      }
      return;
    }
    if (!event.shiftKey) window.getSelection()?.removeAllRanges();
    layer.classList.add('selecting');
  }

  move(event) {
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    const rect = this.container.getBoundingClientRect();
    this.outside = event.clientX < rect.left || event.clientX >= rect.left + this.container.clientWidth ||
      event.clientY < rect.top || event.clientY >= rect.top + this.container.clientHeight;
    this.point = this.outside ? null : { x: event.clientX, y: event.clientY };
    if (this.outside) {
      // Cancel native autoscroll into another pane; preserve the last PDF endpoint.
      event.preventDefault();
      this.restore();
      this.restoreScroll();
    } else {
      this.correctGap(window.getSelection());
    }
  }

  restoreScroll() {
    if (this.container.scrollTop !== this.lastScroll.top) this.container.scrollTop = this.lastScroll.top;
    if (this.container.scrollLeft !== this.lastScroll.left) this.container.scrollLeft = this.lastScroll.left;
  }

  correctGap(selection) {
    if (!this.anchor?.node.isConnected || !this.point || !selection) return false;
    const hit = document.elementFromPoint(this.point.x, this.point.y);
    let layer = hit?.closest('.textLayer');
    if (!this.layers.has(layer)) {
      // The stage's side padding is outside the paper, but still beside this text row.
      layer = Array.from(this.layers.keys()).find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return this.point.y >= rect.top && this.point.y <= rect.bottom;
      });
      if (!layer) return this.restore();
    }
    const hitSpan = hit?.closest('span');
    if (!this.manual && hitSpan?.textContent.trim() && (!this.column || hitSpan.dataset.selectionColumn === this.column)) return false;
    const caret = this.nearestCaret(layer, this.point, this.column);
    if (!caret) return false;
    const { node, offset } = caret;
    if (selection.anchorNode === this.anchor.node && selection.anchorOffset === this.anchor.offset &&
        selection.focusNode === node && selection.focusOffset === offset) return false;
    // Keep paragraph gestures in their starting column, including when crossing a gutter.
    selection.setBaseAndExtent(this.anchor.node, this.anchor.offset, node, offset);
    return true;
  }

  nearestCaret(layer, point, column) {
    const all = Array.from(layer.querySelectorAll('span')).filter(span =>
      span.textContent.trim() && span.firstChild?.nodeType === Node.TEXT_NODE);
    const inColumn = column ? all.filter(span => span.dataset.selectionColumn === column) : all;
    const candidates = inColumn.length ? inColumn : all;
    let nearest, nearestRect, score = Infinity;
    for (const span of candidates) {
      const rect = span.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const distance = Math.abs(point.y - (rect.top + rect.bottom) / 2) * 8 +
        Math.max(rect.left - point.x, 0, point.x - rect.right);
      if (distance < score) { nearest = span; nearestRect = rect; score = distance; }
    }
    if (!nearest) return null;
    const node = nearest.firstChild;
    let offset = point.x <= nearestRect.left ? 0 : node.length;
    if (point.x > nearestRect.left && point.x < nearestRect.right) {
      const y = (nearestRect.top + nearestRect.bottom) / 2;
      const caret = document.caretPositionFromPoint?.(point.x, y);
      const range = caret ? null : document.caretRangeFromPoint?.(point.x, y);
      const caretNode = caret?.offsetNode || range?.startContainer;
      if (caretNode === node) offset = caret?.offset ?? range.startOffset;
    }
    return { node, offset, column: nearest.dataset.selectionColumn || '', rect: nearestRect,
      gapX: Math.max(nearestRect.left - point.x, 0, point.x - nearestRect.right),
      gapY: Math.max(nearestRect.top - point.y, 0, point.y - nearestRect.bottom) };
  }

  valid(selection) {
    const layerFor = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('.textLayer');
    return this.layers.has(layerFor(selection.anchorNode)) && this.layers.has(layerFor(selection.focusNode));
  }

  restore() {
    const saved = this.lastSelection;
    if (!saved || !saved.anchor.isConnected || !saved.focus.isConnected) return false;
    const selection = window.getSelection();
    if (selection.anchorNode === saved.anchor && selection.anchorOffset === saved.anchorOffset &&
        selection.focusNode === saved.focus && selection.focusOffset === saved.focusOffset) return false;
    selection.setBaseAndExtent(saved.anchor, saved.anchorOffset, saved.focus, saved.focusOffset);
    return true;
  }

  update() {
    const selection = window.getSelection();
    if (this.dragging && !this.anchor && selection?.rangeCount && this.valid(selection)) {
      this.anchor = { node: selection.anchorNode, offset: selection.anchorOffset };
    }
    if (this.dragging && !this.outside && this.correctGap(selection)) return;
    if (!selection?.rangeCount || selection.isCollapsed) {
      if (!this.dragging) this.reset();
      return;
    }
    if (this.dragging && (this.outside || !this.valid(selection))) {
      this.restore();
      return;
    }
    if (!this.valid(selection)) return;
    const range = selection.getRangeAt(0);
    if (this.dragging) {
      this.lastRange = range.cloneRange();
      this.lastSelection = { anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
        focus: selection.focusNode, focusOffset: selection.focusOffset };
    }
    for (const [layer, end] of this.layers) {
      const active = range.intersectsNode(layer);
      layer.classList.toggle('selecting', this.dragging && active);
      if (!active && end.parentNode !== layer) layer.append(end);
    }
    // Chromium 148+ fixed the empty-space behavior; don't move its DOM boundaries.
    if (this.modernChromium || !this.dragging) return;
    const modifyStart = this.previousRange &&
      (range.compareBoundaryPoints(Range.END_TO_END, this.previousRange) === 0 ||
       range.compareBoundaryPoints(Range.START_TO_END, this.previousRange) === 0);
    let anchor = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentElement;
    if (!modifyStart && range.endOffset === 0) {
      while (anchor && !anchor.previousSibling) anchor = anchor.parentElement;
      anchor = anchor?.previousSibling;
    }
    const layer = anchor?.parentElement?.closest('.textLayer');
    const end = this.layers.get(layer);
    if (end && anchor !== end) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      end.style.userSelect = 'text';
      anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
    }
    this.previousRange = range.cloneRange();
  }

  finish(event) {
    if (!this.dragging || event.pointerId !== this.pointerId) return;
    if (this.outside) this.restore();
    else this.correctGap(window.getSelection());
    this.dragging = false;
    this.pointerId = null;
    this.outside = false;
    this.anchor = this.point = null;
    this.manual = false;
    this.reset();
    this.onEnd();
  }

  cancel() {
    const wasDragging = this.dragging;
    this.dragging = false;
    this.pointerId = null;
    this.lastRange = this.lastSelection = null;
    this.anchor = this.point = null;
    this.manual = false;
    this.outside = false;
    this.reset();
    if (wasDragging) this.onEnd();
  }

  protects(layer) {
    if (this.dragging) return true;
    const selection = window.getSelection();
    return Boolean(layer && selection?.rangeCount && !selection.isCollapsed && this.valid(selection) &&
      selection.getRangeAt(0).intersectsNode(layer));
  }
}
