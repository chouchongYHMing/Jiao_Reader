import { applyColor, colorForTag, normalizeColor, noteColor } from './annotation-colors.mjs';

const COMMENT_LENGTH = 6000;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(id, className, text) {
  const node = element('button', className, text);
  node.id = id;
  node.type = 'button';
  return node;
}

function rectOf(anchor) {
  if (!anchor || (anchor.nodeType && !anchor.isConnected)) return null;
  const rect = typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : anchor;
  const left = Number(rect.left ?? rect.x);
  const top = Number(rect.top ?? rect.y);
  const right = Number(rect.right ?? left + Number(rect.width || 0));
  const bottom = Number(rect.bottom ?? top + Number(rect.height || 0));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function snapshot(note) {
  return {
    id: note.id, page: note.page, source: note.source,
    tags: [...(note.tags || [])],
    color: normalizeColor(note.color ?? noteColor(note)),
    tagColors: Object.fromEntries((note.tags || []).map(tag => [tag, colorForTag(note, tag)])),
    ...(Array.isArray(note.rects) ? { rects: note.rects.map(rect => ({ ...rect })) } : {})
  };
}

// This non-modal card owns only the comment of one excerpt. Closing never saves.
export class AnnotationCard {
  constructor({ container = document.body, onSaved = () => {}, onEditTags = () => {}, resolveAnchor, onToast = () => {} } = {}) {
    this.container = container;
    this.onSaved = onSaved;
    this.onEditTags = onEditTags;
    this.resolveAnchor = resolveAnchor;
    this.onToast = onToast;
    this.documentId = '';
    this.documentName = '';
    this.notes = [];
    this.note = null;
    this.generation = 0;
    this.session = 0;
    this.editing = false;
    this.saving = false;
    this.build();
    this.outside = event => {
      if (this.element.hidden || this.element.contains(event.target) || event.target.closest?.('.pdf-note-marker')) return;
      this.close();
    };
    this.keydown = event => {
      if (this.element.hidden || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close(true);
    };
    this.scrolled = event => {
      if (!this.element.hidden && !this.element.contains(event.target)) this.position();
    };
    this.resized = () => { if (!this.element.hidden) this.position(); };
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.keydown, true);
    document.addEventListener('scroll', this.scrolled, true);
    window.addEventListener('resize', this.resized);
    this.resizeObserver = new ResizeObserver(this.resized);
    this.resizeObserver.observe(this.element);
  }

  build() {
    this.element = element('section', 'annotation-card');
    this.element.id = 'annotationCard';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'false');
    this.element.setAttribute('aria-labelledby', 'annotationCardHeading');
    const heading = element('div', 'annotation-card-heading');
    this.title = element('strong', '', '选文评论');
    this.title.id = 'annotationCardHeading';
    this.closeButton = button('annotationCardClose', 'annotation-card-close', '×');
    this.closeButton.title = '关闭（Esc）';
    this.closeButton.setAttribute('aria-label', '关闭选文评论');
    this.closeButton.addEventListener('click', () => this.close(true));
    heading.append(this.title, this.closeButton);
    this.body = element('div', 'annotation-card-body');
    this.context = element('p', 'annotation-card-context');
    this.context.id = 'annotationCardPage';
    this.quote = element('blockquote', 'annotation-card-quote');
    this.quote.id = 'annotationCardSource';
    this.tags = element('div', 'annotation-card-tags');
    this.tags.id = 'annotationCardTags';
    this.comment = element('p', 'annotation-card-comment');
    this.comment.id = 'annotationCardComment';
    this.editor = element('div', 'annotation-card-editor');
    this.editor.hidden = true;
    const label = element('label', 'annotation-card-label', '这一段的评论 / 笔记');
    label.htmlFor = 'annotationCardDraft';
    this.draft = element('textarea', 'annotation-card-draft');
    this.draft.id = 'annotationCardDraft';
    this.draft.rows = 5;
    this.draft.maxLength = COMMENT_LENGTH;
    this.draft.placeholder = '记下理解、疑问或后续想法…';
    this.draft.setAttribute('aria-describedby', 'annotationCardHint');
    const hint = element('p', 'annotation-card-hint', '最多 6000 字。评论仅属于这一段选文。');
    hint.id = 'annotationCardHint';
    this.editor.append(label, this.draft, hint);
    this.error = element('p', 'annotation-card-error');
    this.error.id = 'annotationCardError';
    this.error.hidden = true;
    this.error.setAttribute('role', 'alert');
    this.body.append(this.context, this.quote, this.tags, this.comment, this.editor, this.error);
    const footer = element('div', 'annotation-card-footer');
    this.readActions = element('div', 'annotation-card-actions');
    this.editButton = button('annotationCardEdit', 'annotation-card-primary', '编辑评论');
    this.editButton.addEventListener('click', () => this.startEdit());
    this.editTagsButton = button('annotationCardEditTags', 'annotation-card-secondary', '编辑标签');
    this.editTagsButton.addEventListener('click', () => {
      if (this.saving || !this.note) return;
      const note = this.note;
      this.close();
      this.onEditTags(note);
    });
    this.readActions.append(this.editButton, this.editTagsButton);
    this.editActions = element('div', 'annotation-card-actions');
    this.editActions.hidden = true;
    this.cancelButton = button('annotationCardCancel', 'annotation-card-secondary', '取消');
    this.cancelButton.addEventListener('click', () => this.cancelEdit());
    this.saveButton = button('annotationCardSave', 'annotation-card-primary', '保存评论');
    this.saveButton.addEventListener('click', () => { void this.save(); });
    this.editActions.append(this.cancelButton, this.saveButton);
    footer.append(this.readActions, this.editActions);
    this.element.append(heading, this.body, footer);
    this.container.append(this.element);
  }

  contains(node) { return this.element.contains(node); }

  setDocument(documentId = '', name = '') {
    ++this.generation;
    this.close();
    this.documentId = documentId;
    this.documentName = name;
    this.notes = [];
  }

  setNotes(notes) {
    this.notes = Array.isArray(notes) ? notes.slice() : [];
    if (!this.note) return;
    const current = this.notes.find(note => note.id === this.note.id);
    if (!current || !current.comment?.trim()) { this.close(); return; }
    this.note = current;
    this.render();
    this.position();
  }

  open(note, anchor) {
    if (!this.documentId || !note?.id) return;
    this.close();
    this.note = this.notes.find(item => item.id === note.id) || note;
    this.anchor = anchor;
    this.element.dataset.annotationId = this.note.id;
    this.setError('');
    this.render();
    this.element.hidden = false;
    this.body.scrollTop = 0;
    if (this.position()) this.editButton.focus({ preventScroll: true });
  }

  close(restoreFocus = false) {
    ++this.session;
    const wasOpen = !this.element.hidden;
    const target = this.anchorElement;
    this.element.hidden = true;
    this.note = null;
    this.anchor = null;
    this.anchorElement = null;
    this.editing = false;
    this.setSaving(false);
    this.draft.value = '';
    this.setError('');
    if (wasOpen && restoreFocus && target?.isConnected && target.getClientRects().length) target.focus?.({ preventScroll: true });
  }

  render() {
    if (!this.note) return;
    applyColor(this.element, noteColor(this.note));
    this.context.textContent = `第 ${this.note.page} 页${this.documentName ? ` · ${this.documentName}` : ''}`;
    this.context.title = this.documentName;
    this.quote.textContent = this.note.source;
    this.tags.replaceChildren();
    for (const tag of this.note.tags || []) {
      const chip = element('span', 'annotation-card-tag', tag);
      chip.dataset.tag = tag;
      applyColor(chip, colorForTag(this.note, tag));
      this.tags.append(chip);
    }
    this.tags.hidden = !this.note.tags?.length;
    this.comment.textContent = this.note.comment || '尚未填写评论。';
    this.comment.hidden = this.editing;
    this.editor.hidden = !this.editing;
    this.readActions.hidden = this.editing;
    this.editActions.hidden = !this.editing;
    this.title.textContent = this.editing ? '编辑这一段评论' : '选文评论';
  }

  currentAnchor() {
    const anchor = this.resolveAnchor ? this.resolveAnchor(this.note.id) : this.anchorElement || this.anchor;
    if (anchor?.nodeType) this.anchorElement = anchor;
    const rect = rectOf(anchor);
    if (rect) this.anchor = rect;
    return rect;
  }

  position() {
    if (this.element.hidden || !this.note) return false;
    const anchor = this.currentAnchor();
    const viewport = this.anchorElement?.closest?.('.reader-scroll') || document.getElementById('readerScroll');
    const visible = viewport?.getBoundingClientRect();
    const bounds = {
      left: Math.max(0, visible?.left ?? 0), top: Math.max(0, visible?.top ?? 0),
      right: Math.min(window.innerWidth, visible ? visible.left + viewport.clientWidth : window.innerWidth),
      bottom: Math.min(window.innerHeight, visible?.bottom ?? window.innerHeight)
    };
    if (!anchor || anchor.right <= bounds.left || anchor.left >= bounds.right || anchor.bottom <= bounds.top || anchor.top >= bounds.bottom) { this.close(); return false; }
    const edge = 9;
    const availableWidth = bounds.right - bounds.left - edge * 2;
    const availableHeight = bounds.bottom - bounds.top - edge * 2;
    if (availableWidth < 180 || availableHeight < 160) { this.close(); return false; }
    this.element.style.width = `${Math.min(350, availableWidth)}px`;
    this.element.style.maxHeight = `${Math.min(440, availableHeight)}px`;
    const size = this.element.getBoundingClientRect();
    const below = anchor.bottom + 8;
    const preferredTop = below + size.height <= bounds.bottom - edge ? below : anchor.top - size.height - 8;
    this.element.style.left = `${Math.max(bounds.left + edge, Math.min(anchor.right - size.width, bounds.right - size.width - edge))}px`;
    this.element.style.top = `${Math.max(bounds.top + edge, Math.min(preferredTop, bounds.bottom - size.height - edge))}px`;
    return true;
  }

  startEdit() {
    if (!this.note || this.saving) return;
    this.editing = true;
    this.draft.value = this.note.comment || '';
    this.setError('');
    this.render();
    if (this.position()) {
      const field = this.editor.getBoundingClientRect();
      const body = this.body.getBoundingClientRect();
      if (field.bottom > body.bottom || field.top < body.top) this.body.scrollTop += field.top - body.top;
      this.draft.focus({ preventScroll: true });
    }
  }

  cancelEdit() {
    if (this.saving || !this.note) return;
    this.editing = false;
    this.draft.value = '';
    this.setError('');
    this.render();
    if (this.position()) this.editButton.focus({ preventScroll: true });
  }

  setError(message) {
    this.error.textContent = message;
    this.error.hidden = !message;
  }

  setSaving(saving) {
    this.saving = saving;
    this.draft.disabled = saving;
    this.saveButton.disabled = saving;
    this.cancelButton.disabled = saving;
    this.editButton.disabled = saving;
    this.editTagsButton.disabled = saving;
    this.saveButton.textContent = saving ? '正在保存…' : '保存评论';
    this.element.setAttribute('aria-busy', String(saving));
  }

  validDocument(documentId, generation) {
    return this.documentId === documentId && this.generation === generation;
  }

  validSession(documentId, generation, session) {
    return this.validDocument(documentId, generation) && this.session === session && this.note && !this.element.hidden;
  }

  async save() {
    if (!this.documentId || !this.note || !this.editing || this.saving) return;
    const comment = this.draft.value.trim();
    if (comment.length > COMMENT_LENGTH) { this.setError('评论最多 6000 字。'); this.draft.focus(); return; }
    if (!comment && !this.note.tags?.length) {
      this.setError('无标签笔记的评论不能为空。要删除这条笔记，请在“标签与笔记”列表中删除。');
      this.draft.focus();
      return;
    }
    const documentId = this.documentId;
    const generation = this.generation;
    const session = this.session;
    const payload = { ...snapshot(this.note), comment };
    this.setError('');
    this.setSaving(true);
    let savedNote;
    try {
      savedNote = await window.jiao.saveAnnotation(documentId, payload);
      if (!this.validDocument(documentId, generation)) return;
      const notes = await window.jiao.annotations(documentId);
      if (!this.validDocument(documentId, generation)) return;
      if (this.validSession(documentId, generation, session)) {
        this.setSaving(false);
        this.editing = false;
        this.draft.value = '';
      }
      // A submitted save remains committed after closing or opening another card.
      this.onSaved(notes);
      if (this.validSession(documentId, generation, session)) {
        this.setNotes(notes);
        if (!this.element.hidden) this.editButton.focus({ preventScroll: true });
      }
      if (this.validDocument(documentId, generation)) this.onToast('这一段的评论已保存。');
    } catch (error) {
      if (!this.validDocument(documentId, generation)) return;
      const sameSession = this.validSession(documentId, generation, session);
      if (sameSession) this.setSaving(false);
      if (savedNote) {
        if (sameSession) this.note = savedNote;
        this.notes = [...this.notes.filter(note => note.id !== savedNote.id), savedNote];
        this.onSaved(this.notes.slice());
        if (this.validSession(documentId, generation, session)) this.setError(`评论已保存，但列表刷新失败。可重试：${error?.message || '读取失败'}`);
        else if (this.validDocument(documentId, generation)) this.onToast('评论已保存，但列表刷新失败。');
      } else if (sameSession) this.setError(error?.message || '保存失败，请重试。');
      else this.onToast(`评论保存失败：${error?.message || '请重试'}`);
      if (this.validSession(documentId, generation, session)) this.position();
    }
  }

  destroy() {
    ++this.generation;
    this.close();
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.keydown, true);
    document.removeEventListener('scroll', this.scrolled, true);
    window.removeEventListener('resize', this.resized);
    this.resizeObserver.disconnect();
    this.element.remove();
  }
}
