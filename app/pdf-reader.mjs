import * as pdfjs from './pdfjs/pdf.mjs';
import { PdfSelection } from './pdf-selection.mjs';
import { orderTextLayer } from './text-order.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.mjs', import.meta.url).href;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.6;

// Keep the scroll container and page shells stable while replacing rendered surfaces.
export class PdfReader {
  constructor(container, pages, onChange) {
    this.container = container;
    this.pages = pages;
    this.onChange = onChange;
    this.scale = 1.15;
    this.currentPage = 0;
    this.records = new Map();
    this.version = 0;
    this.ready = false;
    this.scrollFrame = 0;
    this.selection = new PdfSelection(container, () => this.scheduleViewportUpdate());
    container.addEventListener('scroll', () => this.scheduleViewportUpdate(), { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.scheduleViewportUpdate());
    this.resizeObserver.observe(container);
  }

  get totalPages() { return this.document?.numPages || 0; }

  notify() {
    this.onChange({ current: this.currentPage, total: this.totalPages, scale: this.scale, ready: this.ready });
  }

  disposeDocument() {
    this.selection.cancel();
    window.getSelection()?.removeAllRanges();
    this.observer?.disconnect();
    for (const record of this.records.values()) this.releaseSurface(record);
    this.records.clear();
    this.pages.replaceChildren();
    // LoadingTask.destroy also destroys its document/worker if loading completed.
    const previous = this.loadingTask;
    this.loadingTask = null;
    this.document = null;
    if (previous) previous.destroy().catch(() => {});
  }

  async open(bytes) {
    const version = ++this.version;
    this.ready = false;
    this.currentPage = 0;
    this.disposeDocument();
    this.container.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    this.notify();
    const loadingTask = pdfjs.getDocument({
      data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      cMapUrl: new URL('./pdfjs/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./pdfjs/standard_fonts/', import.meta.url).href,
      isEvalSupported: false
    });
    this.loadingTask = loadingTask;
    try {
      const pdfDocument = await loadingTask.promise;
      if (version !== this.version) return false;
      this.document = pdfDocument;
      this.currentPage = 1;
      this.observer = new IntersectionObserver(entries => {
        if (version !== this.version) return;
        for (const entry of entries) {
          const record = this.records.get(Number(entry.target.dataset.page));
          if (entry.isIntersecting && record?.shell === entry.target) this.render(record);
        }
      }, { root: this.container, rootMargin: '600px 0px', threshold: 0 });
      this.notify();
      for (let number = 1; number <= pdfDocument.numPages; number++) {
        const page = await pdfDocument.getPage(number);
        if (version !== this.version) return false;
        const shell = document.createElement('article');
        shell.className = 'page-shell';
        shell.dataset.page = String(number);
        shell.setAttribute('aria-label', `第 ${number} 页`);
        const body = document.createElement('div');
        body.className = 'pdf-page';
        const loading = document.createElement('div');
        loading.className = 'page-loading';
        loading.textContent = `正在加载第 ${number} 页`;
        body.append(loading);
        const badge = document.createElement('div');
        badge.className = 'page-badge';
        badge.textContent = `第 ${number} 页`;
        shell.append(body, badge);
        const record = { number, page, shell, body, loading, version, renderedScale: 0, pending: null };
        this.records.set(number, record);
        this.resizePage(record);
        this.pages.append(shell);
        this.observer.observe(shell);
      }
      this.ready = true;
      this.updateViewport();
      return true;
    } catch (error) {
      if (version !== this.version) return false;
      this.disposeDocument();
      this.currentPage = 0;
      this.notify();
      throw error;
    }
  }

  resizePage(record) {
    record.viewport = record.page.getViewport({ scale: this.scale });
    const { width, height, userUnit } = record.viewport;
    record.body.style.width = `${width}px`;
    record.body.style.height = `${height}px`;
    record.body.style.setProperty('--scale-factor', this.scale);
    record.body.style.setProperty('--user-unit', userUnit || 1);
    // The previous canvas remains visible as a scaled preview until its replacement is ready.
    if (record.canvas) {
      record.canvas.style.width = `${width}px`;
      record.canvas.style.height = `${height}px`;
    }
  }

  isCurrent(record) {
    return record.version === this.version && this.records.get(record.number) === record;
  }

  cancelPending(record) {
    const pending = record.pending;
    if (!pending) return;
    record.pending = null;
    pending.cancelled = true;
    pending.renderTask?.cancel();
    pending.textTask?.cancel();
    pending.canvas.remove();
    pending.layer.remove();
  }

  releaseSurface(record) {
    this.cancelPending(record);
    record.textTask?.cancel();
    if (record.canvas) { record.canvas.remove(); record.canvas.width = 0; }
    this.selection.detach(record.layer);
    record.layer?.remove();
    record.canvas = record.layer = record.textTask = null;
    record.renderedScale = 0;
    record.body.classList.remove('rendered');
  }

  async render(record) {
    if (!this.isCurrent(record) || record.pending || record.renderedScale === this.scale) return;
    const scale = this.scale;
    const viewport = record.viewport;
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    const pixelRatio = Math.min(window.devicePixelRatio || 1, Math.sqrt(12000000 / (viewport.width * viewport.height)));
    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.style.visibility = 'hidden';
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    layer.style.visibility = 'hidden';
    const pending = { canvas, layer, cancelled: false };
    record.pending = pending;
    record.loading.textContent = `正在加载第 ${record.number} 页`;
    record.body.append(canvas, layer);
    const valid = () => !pending.cancelled && this.isCurrent(record) && record.pending === pending && scale === this.scale;
    try {
      pending.renderTask = record.page.render({
        canvasContext: canvas.getContext('2d'), viewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
      });
      await pending.renderTask.promise;
      if (!valid()) return;
      const content = await record.page.getTextContent({ includeMarkedContent: true });
      if (!valid()) return;
      pending.textTask = new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport });
      await pending.textTask.render();
      if (!valid()) return;
      orderTextLayer(layer, content, viewport);
      this.selection.attach(layer);
      record.textTask?.cancel();
      if (record.canvas) { record.canvas.remove(); record.canvas.width = 0; }
      this.selection.detach(record.layer);
      record.layer?.remove();
      record.canvas = canvas;
      record.layer = layer;
      record.textTask = pending.textTask;
      canvas.style.visibility = layer.style.visibility = '';
      record.renderedScale = scale;
      record.body.classList.add('rendered');
      pending.committed = true;
    } catch (error) {
      if (valid()) record.loading.textContent = `第 ${record.number} 页加载失败：${error.message}`;
    } finally {
      if (!pending.committed) { canvas.remove(); layer.remove(); }
      if (record.pending === pending) record.pending = null;
    }
  }

  pageTop(record) {
    return record.body.getBoundingClientRect().top - this.container.getBoundingClientRect().top + this.container.scrollTop;
  }

  setScale(value) {
    if (!this.ready) return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
    if (scale === this.scale) return;
    this.updateCurrentPage();
    const anchor = this.records.get(this.currentPage);
    const anchorY = Math.min(120, this.container.clientHeight * 0.25);
    const fraction = (this.container.scrollTop + anchorY - this.pageTop(anchor)) / anchor.viewport.height;
    const previousWidth = this.container.scrollWidth;
    const horizontalFraction = (this.container.scrollLeft + this.container.clientWidth / 2) / previousWidth;
    this.scale = scale;
    this.selection.cancel();
    window.getSelection()?.removeAllRanges();
    for (const record of this.records.values()) {
      this.cancelPending(record);
      record.textTask?.cancel();
      this.selection.detach(record.layer);
      record.layer?.remove();
      record.layer = record.textTask = null;
      record.renderedScale = 0;
      this.resizePage(record);
    }
    // Never scroll ancestors: the application chrome stays fixed, including at high zoom.
    this.container.scrollTo({
      top: this.pageTop(anchor) + fraction * anchor.viewport.height - anchorY,
      left: horizontalFraction * this.container.scrollWidth - this.container.clientWidth / 2,
      behavior: 'instant'
    });
    this.updateViewport();
  }

  fitWidth() {
    if (!this.ready) return;
    const record = this.records.get(this.currentPage);
    const stage = getComputedStyle(this.pages.parentElement);
    const padding = parseFloat(stage.paddingLeft) + parseFloat(stage.paddingRight);
    this.setScale((this.container.clientWidth - padding - 2) / (record.viewport.width / this.scale));
  }

  goToPage(value) {
    if (!this.ready) return;
    const number = Math.min(this.totalPages, Math.max(1, Math.trunc(Number(value)) || 1));
    const record = this.records.get(number);
    this.container.scrollTo({ top: Math.max(0, this.pageTop(record) - 16), behavior: 'instant' });
    this.updateViewport();
  }

  updateCurrentPage() {
    if (!this.records.size) return;
    const frame = this.container.getBoundingClientRect();
    const anchorY = frame.top + Math.min(120, this.container.clientHeight * 0.25);
    let best = null;
    let largestVisible = -1;
    const last = this.records.get(this.totalPages);
    const atBottom = this.container.scrollHeight > this.container.clientHeight + 1
      && this.container.scrollTop + this.container.clientHeight >= this.container.scrollHeight - 2;
    if (atBottom && last && last.body.getBoundingClientRect().top < frame.bottom) best = last;
    for (const record of this.records.values()) {
      if (atBottom && best === last) break;
      const rect = record.body.getBoundingClientRect();
      if (rect.top <= anchorY && rect.bottom > anchorY) { best = record; break; }
      const visible = Math.max(0, Math.min(rect.bottom, frame.bottom) - Math.max(rect.top, frame.top));
      if (visible > largestVisible) { best = record; largestVisible = visible; }
    }
    if (best) this.currentPage = best.number;
    for (const record of this.records.values()) record.shell.classList.toggle('is-current', record.number === this.currentPage);
  }

  updateViewport() {
    this.updateCurrentPage();
    const frame = this.container.getBoundingClientRect();
    const margin = 600;
    for (const record of this.records.values()) {
      const rect = record.body.getBoundingClientRect();
      if (rect.bottom >= frame.top - margin && rect.top <= frame.bottom + margin) this.render(record);
      else if (!this.selection.protects(record.layer) &&
        (rect.bottom < frame.top - 3 * frame.height || rect.top > frame.bottom + 3 * frame.height)) this.releaseSurface(record);
    }
    this.notify();
  }

  scheduleViewportUpdate() {
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => { this.scrollFrame = 0; this.updateViewport(); });
  }
}
