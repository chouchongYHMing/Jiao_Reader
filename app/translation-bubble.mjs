// A selection owns the visible bubble. Updating a request never opens a closed bubble.
export class TranslationBubble {
  constructor(viewport, onCopy, onDismiss) {
    this.viewport = viewport;
    this.selectionText = '';
    this.result = '';
    this.element = document.createElement('section');
    this.element.id = 'translationBubble';
    this.element.className = 'translation-bubble';
    this.element.hidden = true;
    this.element.setAttribute('aria-label', '选文译文');

    const heading = document.createElement('div');
    heading.className = 'bubble-heading';
    this.label = document.createElement('strong');
    this.label.textContent = '译文';
    const close = document.createElement('button');
    close.id = 'bubbleClose';
    close.className = 'bubble-close';
    close.type = 'button';
    close.textContent = '×';
    close.title = '关闭（Esc）';
    close.setAttribute('aria-label', '关闭翻译气泡');
    close.addEventListener('click', onDismiss);
    heading.append(this.label, close);

    this.body = document.createElement('div');
    this.body.id = 'bubbleText';
    this.body.className = 'bubble-text';
    this.body.setAttribute('aria-live', 'polite');
    const footer = document.createElement('div');
    footer.className = 'bubble-footer';
    const hint = document.createElement('span');
    hint.textContent = '译文保留在右侧';
    this.copy = document.createElement('button');
    this.copy.id = 'bubbleCopy';
    this.copy.className = 'bubble-copy';
    this.copy.type = 'button';
    this.copy.textContent = '复制译文';
    this.copy.disabled = true;
    this.copy.addEventListener('click', () => { if (this.result) onCopy(this.result); });
    footer.append(hint, this.copy);
    this.element.append(heading, this.body, footer);
    document.body.append(this.element);
    this.resizeObserver = new ResizeObserver(onDismiss);
    this.resizeObserver.observe(viewport);
  }

  contains(node) { return this.element.contains(node); }

  hide() {
    this.element.hidden = true;
    this.selectionText = '';
    this.result = '';
  }

  open(anchor, text, message, state) {
    this.anchor = anchor;
    this.selectionText = text;
    this.element.hidden = false;
    this.update(text, message, state);
  }

  update(text, message, state) {
    if (this.element.hidden || this.selectionText !== text) return;
    this.element.dataset.state = state;
    this.label.textContent = state === 'loading' ? '正在翻译…' : state === 'error' ? '翻译提示' : '译文';
    this.body.textContent = message;
    this.body.setAttribute('aria-busy', String(state === 'loading'));
    this.result = state === 'success' ? message : '';
    this.copy.disabled = !this.result;
    this.body.scrollTop = 0;
    this.position();
  }

  position() {
    const viewport = this.viewport.getBoundingClientRect();
    const bounds = {
      left: Math.max(0, viewport.left) + 12,
      top: Math.max(0, viewport.top) + 12,
      right: Math.min(window.innerWidth, viewport.left + this.viewport.clientWidth) - 12,
      bottom: Math.min(window.innerHeight, viewport.top + this.viewport.clientHeight) - 12
    };
    const availableWidth = bounds.right - bounds.left;
    const availableHeight = bounds.bottom - bounds.top;
    if (availableWidth < 120 || availableHeight < 100) { this.hide(); return; }
    this.element.style.width = `${Math.min(420, availableWidth)}px`;
    this.element.style.maxHeight = `${Math.min(360, availableHeight)}px`;
    const above = Math.max(0, this.anchor.top - bounds.top - 10);
    const below = Math.max(0, bounds.bottom - this.anchor.bottom - 10);
    const naturalHeight = this.element.getBoundingClientRect().height;
    const placeAbove = above >= naturalHeight || (below < naturalHeight && above >= below);
    const room = placeAbove ? above : below;
    this.element.style.maxHeight = `${Math.min(360, availableHeight, Math.max(120, room))}px`;
    const rect = this.element.getBoundingClientRect();
    const top = placeAbove ? this.anchor.top - rect.height - 10 : this.anchor.bottom + 10;
    this.element.style.left = `${Math.max(bounds.left, Math.min(this.anchor.left, bounds.right - rect.width))}px`;
    this.element.style.top = `${Math.max(bounds.top, Math.min(top, bounds.bottom - rect.height))}px`;
  }
}
