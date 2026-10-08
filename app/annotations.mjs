import { ANNOTATION_COLORS, applyColor, colorForTag, normalizeColor, noteColor } from './annotation-colors.mjs';

const TAG_LIMIT = 20;
const TAG_LENGTH = 50;
const COMMENT_LENGTH = 6000;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function action(className, text, label) {
  const button = element('button', className, text);
  button.type = 'button';
  if (label) button.setAttribute('aria-label', label);
  return button;
}

function timestamp(note) {
  const value = note.updatedAt || note.createdAt;
  const numeric = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function noteTime(note) {
  const value = timestamp(note);
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function parseTags(value) {
  return [...new Set(value.split(/[,，\n]/u).map(tag => tag.trim()).filter(Boolean))];
}

function canFocus(node) {
  return Boolean(node?.isConnected && !node.disabled && node.getClientRects().length);
}

// Each editor and asynchronous request keeps the document it belongs to.
export class AnnotationPanel {
  constructor({ button, container = document.body, onNavigate = () => {}, onToast = () => {}, onChange = () => {} }) {
    this.button = button;
    this.container = container;
    this.onNavigate = onNavigate;
    this.onToast = onToast;
    this.onChange = onChange;
    this.documentId = '';
    this.documentName = '';
    this.notes = [];
    this.filterTag = '';
    this.editorTagColors = new Map();
    this.editorColor = 'amber';
    this.generation = 0;
    this.editorSession = 0;
    this.loading = false;
    this.deleting = false;
    this.error = '';
    this.buildPanel();
    this.buildEditor();
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-controls', 'annotationPanel');
    this.button.setAttribute('aria-expanded', 'false');
    this.buttonClick = () => this.toggle();
    this.button.addEventListener('click', this.buttonClick);
    this.outsidePointer = event => {
      if (!this.panel.hidden && !this.panel.contains(event.target) && !this.button.contains(event.target)) this.close(false);
    };
    this.keydown = event => {
      if (event.key !== 'Escape') return;
      if (this.dialog.open) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!this.saving) this.cancelEditor();
      } else if (!this.panel.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
      }
    };
    this.reposition = () => { if (!this.panel.hidden) this.position(); };
    document.addEventListener('pointerdown', this.outsidePointer, true);
    document.addEventListener('keydown', this.keydown, true);
    window.addEventListener('resize', this.reposition);
    this.updateButton();
  }

  buildPanel() {
    this.panel = element('section', 'annotation-panel');
    this.panel.id = 'annotationPanel';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-labelledby', 'annotationPanelHeading');
    const heading = element('div', 'annotation-panel-heading');
    const titles = element('div', 'annotation-panel-titles');
    this.panelHeading = element('strong', '', '标签与笔记');
    this.panelHeading.id = 'annotationPanelHeading';
    this.panelDocument = element('span', 'annotation-document-name');
    titles.append(this.panelHeading, this.panelDocument);
    this.panelClose = action('annotation-close', '×', '关闭标签与笔记列表');
    this.panelClose.title = '关闭（Esc）';
    this.panelClose.addEventListener('click', () => this.close());
    heading.append(titles, this.panelClose);
    this.list = element('div', 'annotation-list');
    this.list.id = 'annotationList';
    this.list.setAttribute('aria-live', 'polite');
    this.summary = element('div', 'annotation-tag-summary');
    this.summary.id = 'annotationTagSummary';
    this.summary.setAttribute('aria-label', '按标签筛选笔记');
    const hint = element('p', 'annotation-panel-hint', '同一标签汇总相关选文，每段评论独立保存。');
    this.panel.append(heading, this.summary, this.list, hint);
    this.container.append(this.panel);
  }

  buildEditor() {
    this.dialog = element('dialog', 'annotation-editor');
    this.dialog.id = 'annotationEditor';
    this.dialog.setAttribute('aria-labelledby', 'annotationEditorHeading');
    this.dialog.setAttribute('aria-describedby', 'annotationEditorContext');
    const form = element('form', 'annotation-form');
    form.noValidate = true;
    const heading = element('div', 'annotation-editor-heading');
    this.editorHeading = element('strong', '', '添加标签与笔记');
    this.editorHeading.id = 'annotationEditorHeading';
    this.editorClose = action('annotation-close', '×', '取消编辑');
    this.editorClose.title = '取消（Esc）';
    this.editorClose.addEventListener('click', () => this.cancelEditor());
    heading.append(this.editorHeading, this.editorClose);
    this.context = element('div', 'annotation-editor-context');
    this.context.id = 'annotationEditorContext';
    this.quote = element('blockquote', 'annotation-editor-quote');
    this.quote.id = 'annotationQuote';
    const fields = element('div', 'annotation-fields');
    const tagLabel = element('label', 'annotation-label', '标签');
    tagLabel.htmlFor = 'annotationTags';
    this.tags = element('input', 'annotation-input');
    this.tags.id = 'annotationTags';
    this.tags.type = 'text';
    this.tags.placeholder = '例如：研究方法，待复现';
    this.tags.autocomplete = 'off';
    this.tags.setAttribute('aria-describedby', 'annotationTagHint');
    const tagHint = element('p', 'annotation-field-hint', `用逗号分隔，最多 ${TAG_LIMIT} 个标签，每个 ${TAG_LENGTH} 字。`);
    tagHint.id = 'annotationTagHint';
    this.tags.addEventListener('input', () => this.renderEditorColors());
    this.tagColors = element('div', 'annotation-tag-color-list');
    this.tagColors.id = 'annotationTagColors';
    this.tagColors.setAttribute('aria-label', '每个标签的荧光笔颜色');
    this.noteColors = element('div', 'annotation-note-color');
    this.noteColors.id = 'annotationNoteColor';
    const colorHint = element('p', 'annotation-field-hint annotation-color-hint', '同一文献中的同名标签共用颜色；每段评论独立。首个标签的颜色用于该段高亮。');
    const commentLabel = element('label', 'annotation-label', '评论 / 笔记 / 注释');
    commentLabel.htmlFor = 'annotationComment';
    this.comment = element('textarea', 'annotation-input annotation-comment');
    this.comment.id = 'annotationComment';
    this.comment.rows = 5;
    this.comment.maxLength = COMMENT_LENGTH;
    this.comment.placeholder = '记下理解、疑问或后续想法…';
    this.comment.setAttribute('aria-describedby', 'annotationCommentHint');
    const commentHint = element('p', 'annotation-field-hint', `仅保存在本机，最多 ${COMMENT_LENGTH} 字。`);
    commentHint.id = 'annotationCommentHint';
    fields.append(tagLabel, this.tags, tagHint, this.tagColors, this.noteColors, colorHint, commentLabel, this.comment, commentHint);
    this.editorError = element('p', 'annotation-error');
    this.editorError.id = 'annotationError';
    this.editorError.setAttribute('role', 'alert');
    this.editorError.hidden = true;
    const footer = element('div', 'annotation-editor-footer');
    this.cancelButton = action('annotation-secondary', '取消');
    this.cancelButton.id = 'annotationCancel';
    this.cancelButton.addEventListener('click', () => this.cancelEditor());
    this.saveButton = action('annotation-primary', '保存');
    this.saveButton.id = 'annotationSave';
    this.saveButton.type = 'submit';
    footer.append(this.cancelButton, this.saveButton);
    const body = element('div', 'annotation-editor-body');
    body.append(this.context, this.quote, fields, this.editorError);
    form.append(heading, body, footer);
    form.addEventListener('submit', event => { event.preventDefault(); void this.save(); });
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); if (!this.saving) this.cancelEditor(); });
    this.dialog.append(form);
    this.container.append(this.dialog);
  }

  updateButton() {
    this.button.disabled = !this.documentId || this.loading;
    this.button.textContent = `标签与笔记${this.notes.length ? ` ${this.notes.length}` : ''}`;
    this.button.title = this.loading ? '正在读取本篇文献的标签与笔记' : '查看本篇文献的标签与笔记';
    this.button.setAttribute('aria-label', `标签与笔记，${this.notes.length} 条`);
    this.button.setAttribute('aria-busy', String(this.loading));
  }

  replaceNotes(notes) {
    this.notes = (Array.isArray(notes) ? notes : []).slice().sort((a, b) => timestamp(b) - timestamp(a));
    this.updateButton();
    this.render();
    this.onChange(this.notes.slice());
  }

  async setDocument(documentId = '', name = '') {
    const generation = ++this.generation;
    this.close(false);
    this.cancelEditor(false, true);
    this.documentId = documentId;
    this.documentName = name;
    this.filterTag = '';
    this.error = '';
    this.deleting = false;
    this.loading = Boolean(documentId);
    this.replaceNotes([]);
    if (!documentId) { this.loadPromise = null; return; }
    this.loadPromise = (async () => {
      try {
        const notes = await window.jiao.annotations(documentId);
        if (this.generation !== generation || this.documentId !== documentId) return;
        this.loading = false;
        this.replaceNotes(notes);
      } catch (error) {
        if (this.generation !== generation || this.documentId !== documentId) return;
        this.loading = false;
        this.error = error?.message || '无法读取笔记，请重试。';
        this.updateButton();
        this.render();
        this.onToast('读取笔记失败，可打开列表重试。');
      }
    })();
    await this.loadPromise;
  }

  getAnnotation(page, source) {
    return this.notes.find(note => Number(note.page) === Number(page) && note.source === String(source).trim()) || null;
  }

  toggle() {
    if (!this.documentId || this.loading) return;
    if (!this.panel.hidden) { this.close(); return; }
    this.render();
    this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.position();
    this.panelClose.focus({ preventScroll: true });
  }

  async openTag(tag) {
    const generation = this.generation;
    const documentId = this.documentId;
    if (this.loadPromise) await this.loadPromise;
    if (!documentId || this.documentId !== documentId || this.generation !== generation || this.dialog.open) return;
    this.filterTag = String(tag || '').trim();
    this.render();
    this.list.scrollTop = 0;
    this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.position();
    const selected = [...this.summary.children].find(button => button.dataset.tag === this.filterTag);
    (selected || this.panelClose).focus({ preventScroll: true });
  }

  selectTag(tag) {
    this.filterTag = tag;
    this.render();
    this.list.scrollTop = 0;
    const selected = [...this.summary.children].find(button => button.dataset.tag === this.filterTag);
    selected?.focus({ preventScroll: true });
  }

  renderSummary() {
    const groups = new Map();
    for (const note of this.notes) {
      for (const tag of note.tags || []) {
        const group = groups.get(tag);
        if (group) group.count++;
        else groups.set(tag, { count: 1, color: colorForTag(note, tag) });
      }
    }
    if (this.filterTag && !groups.has(this.filterTag)) this.filterTag = '';
    this.summary.replaceChildren();
    const all = action('annotation-tag-filter annotation-tag-all', `全部 ${this.notes.length}`, '查看全部笔记');
    all.dataset.tag = '';
    all.dataset.count = String(this.notes.length);
    all.setAttribute('aria-pressed', String(!this.filterTag));
    all.addEventListener('click', () => this.selectTag(''));
    this.summary.append(all);
    for (const [tag, group] of groups) {
      const button = action('annotation-tag-filter', `${tag} ${group.count}`, `${tag}，${group.count} 段选文`);
      button.dataset.tag = tag;
      button.dataset.count = String(group.count);
      button.title = `${tag} · ${group.count} 段选文，评论各自保留`;
      button.setAttribute('aria-pressed', String(this.filterTag === tag));
      applyColor(button, group.color);
      button.addEventListener('click', () => this.selectTag(tag));
      this.summary.append(button);
    }
  }

  close(restoreFocus = true) {
    const wasOpen = !this.panel.hidden;
    this.panel.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (wasOpen && restoreFocus && this.button.isConnected && !this.button.disabled) this.button.focus({ preventScroll: true });
  }

  position() {
    const anchor = this.button.getBoundingClientRect();
    const edge = 12;
    const width = Math.max(0, Math.min(460, window.innerWidth - edge * 2));
    this.panel.style.width = `${width}px`;
    this.panel.style.maxHeight = `${Math.max(0, window.innerHeight - edge * 2)}px`;
    const height = this.panel.getBoundingClientRect().height;
    const below = anchor.bottom + 8;
    const top = below + height <= window.innerHeight - edge ? below : Math.max(edge, anchor.top - height - 8);
    this.panel.style.left = `${Math.max(edge, Math.min(anchor.left, window.innerWidth - width - edge))}px`;
    this.panel.style.top = `${Math.max(edge, Math.min(top, window.innerHeight - height - edge))}px`;
  }

  render() {
    this.panelDocument.textContent = this.documentName;
    this.panelDocument.title = this.documentName;
    this.renderSummary();
    const visibleNotes = this.filterTag ? this.notes.filter(note => note.tags?.includes(this.filterTag)) : this.notes;
    this.panelHeading.textContent = this.filterTag ? `标签与笔记 · ${visibleNotes.length} / ${this.notes.length}` : `标签与笔记 · ${this.notes.length}`;
    this.list.replaceChildren();
    if (this.error) {
      const error = element('div', 'annotation-list-error');
      const message = element('p', '', this.error);
      const retry = action('annotation-secondary', '重新读取');
      retry.addEventListener('click', () => {
        const documentId = this.documentId;
        const name = this.documentName;
        void this.setDocument(documentId, name).then(() => {
          if (this.documentId === documentId && !this.loading) this.toggle();
        });
      });
      error.append(message, retry);
      this.list.append(error);
    }
    if (!visibleNotes.length && !this.error) {
      this.list.append(element('p', 'annotation-empty', '本篇文献还没有笔记。划选文字后，在“本次阅读”记录上右键添加。'));
    }
    for (const note of visibleNotes) {
      const item = element('article', 'annotation-item');
      item.dataset.annotationId = note.id;
      applyColor(item, noteColor(note));
      const heading = element('div', 'annotation-item-heading');
      const jump = action('annotation-jump', `第 ${note.page} 页`, `跳转到第 ${note.page} 页`);
      jump.addEventListener('click', () => { this.close(false); this.onNavigate(Number(note.page)); });
      const time = element('time', 'annotation-time', noteTime(note));
      const rawTime = timestamp(note);
      if (rawTime) time.dateTime = new Date(rawTime).toISOString();
      heading.append(jump, time);
      const quote = element('blockquote', 'annotation-quote', note.source);
      quote.title = note.source;
      const tags = element('div', 'annotation-tags');
      for (const tag of note.tags || []) {
        const chip = action('annotation-tag', tag, `查看标签 ${tag} 的相关笔记`);
        chip.dataset.tag = tag;
        applyColor(chip, colorForTag(note, tag));
        chip.addEventListener('click', () => this.selectTag(tag));
        tags.append(chip);
      }
      const comment = element('p', 'annotation-note', note.comment || '');
      comment.hidden = !note.comment;
      const actions = element('div', 'annotation-item-actions');
      const edit = action('annotation-edit', '编辑', `编辑第 ${note.page} 页的笔记`);
      edit.addEventListener('click', () => { void this.editSelection({ page: note.page, source: note.source, annotationId: note.id }); });
      const remove = action('annotation-delete', '删除', `删除第 ${note.page} 页的笔记`);
      remove.disabled = this.deleting;
      remove.addEventListener('click', () => { void this.remove(note); });
      actions.append(edit, remove);
      item.append(heading, quote, tags, comment, actions);
      this.list.append(item);
    }
    this.reposition();
  }

  async editSelection({ page, source, annotationId, rects } = {}, focus = 'tags') {
    if (this.deleting) { this.onToast('正在删除笔记，请稍后编辑。'); return; }
    const generation = this.generation;
    const documentId = this.documentId;
    if (this.loadPromise) await this.loadPromise;
    if (!documentId || this.documentId !== documentId || this.generation !== generation) return;
    source = String(source || '').trim();
    page = Number(page);
    if (!source || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000) { this.onToast('请先划选本篇文献中的文字。'); return; }
    if (source.length > 12000) { this.onToast('选文超过 12000 字，请缩小范围后添加笔记。'); return; }
    const existing = (annotationId && this.notes.find(note => note.id === annotationId)) || this.getAnnotation(page, source);
    this.cancelEditor(false, true);
    this.editorReturnFocus = document.activeElement;
    this.close(false);
    const savedRects = existing?.rects ?? rects;
    this.editor = { documentId, generation, page, source, id: existing?.id,
      rects: Array.isArray(savedRects) ? savedRects.map(rect => ({ ...rect })) : savedRects };
    this.editorHeading.textContent = existing ? '编辑标签与笔记' : '添加标签与笔记';
    this.context.textContent = `${this.documentName} · 第 ${page} 页`;
    this.quote.textContent = source;
    this.tags.value = (existing?.tags || []).join('，');
    this.comment.value = existing?.comment || '';
    this.editorColor = normalizeColor(existing?.color);
    this.editorTagColors = new Map((existing?.tags || []).map(tag => [tag, colorForTag(existing, tag)]));
    this.renderEditorColors();
    this.setEditorError('');
    this.setSaving(false);
    this.dialog.showModal();
    (focus === 'comment' ? this.comment : this.tags).focus({ preventScroll: true });
  }

  setEditorError(message) {
    this.editorError.textContent = message;
    this.editorError.hidden = !message;
  }

  colorChoices(selected, label, onSelect) {
    const palette = element('div', 'annotation-color-palette');
    palette.setAttribute('role', 'radiogroup');
    palette.setAttribute('aria-label', label);
    for (const color of ANNOTATION_COLORS) {
      const button = action('annotation-color-choice', '', `${label}：${color.label}`);
      applyColor(button, color.id);
      button.title = color.label;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(selected === color.id));
      button.setAttribute('aria-pressed', String(selected === color.id));
      button.tabIndex = selected === color.id ? 0 : -1;
      button.disabled = this.saving;
      const swatch = element('span', 'annotation-color-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      const name = element('span', 'annotation-color-name', color.label);
      button.append(swatch, name);
      button.addEventListener('click', () => {
        if (this.saving) return;
        onSelect(color.id);
        for (const choice of palette.children) {
          const checked = choice.dataset.color === color.id;
          choice.setAttribute('aria-pressed', String(checked));
          choice.setAttribute('aria-checked', String(checked));
          choice.tabIndex = checked ? 0 : -1;
        }
      });
      button.addEventListener('keydown', event => {
        if (this.saving || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const choices = [...palette.children];
        const index = choices.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
          : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
        choices[next].focus({ preventScroll: true });
        choices[next].click();
      });
      palette.append(button);
    }
    return palette;
  }

  renderEditorColors() {
    const tags = parseTags(this.tags.value).slice(0, TAG_LIMIT);
    this.tagColors.replaceChildren();
    this.tagColors.hidden = !tags.length;
    this.noteColors.replaceChildren();
    this.noteColors.hidden = Boolean(tags.length);
    for (const tag of tags) {
      if (!this.editorTagColors.has(tag)) {
        const related = this.notes.find(note => note.tags?.includes(tag));
        this.editorTagColors.set(tag, related ? colorForTag(related, tag) : this.editorColor);
      }
      const row = element('div', 'annotation-tag-color-row');
      row.dataset.tag = tag;
      const name = element('span', 'annotation-tag-color-name', tag);
      applyColor(name, this.editorTagColors.get(tag));
      row.append(name, this.colorChoices(this.editorTagColors.get(tag), `标签 ${tag} 的颜色`, color => {
        this.editorTagColors.set(tag, color);
        applyColor(name, color);
      }));
      this.tagColors.append(row);
    }
    if (!tags.length) {
      const label = element('span', 'annotation-label', '无标签笔记的高亮颜色');
      this.noteColors.append(label, this.colorChoices(this.editorColor, '笔记高亮颜色', color => { this.editorColor = color; }));
    }
  }

  setSaving(saving) {
    this.saving = saving;
    this.saveButton.disabled = saving;
    this.cancelButton.disabled = saving;
    this.editorClose.disabled = saving;
    this.tags.disabled = saving;
    this.comment.disabled = saving;
    for (const button of this.dialog.querySelectorAll('.annotation-color-choice')) button.disabled = saving;
    this.saveButton.textContent = saving ? '正在保存…' : '保存';
    this.dialog.setAttribute('aria-busy', String(saving));
  }

  async save() {
    if (this.saving || !this.editor || !this.dialog.open) return;
    const editor = this.editor;
    const session = this.editorSession;
    const tags = parseTags(this.tags.value);
    const comment = this.comment.value.trim();
    if (tags.length > TAG_LIMIT) { this.setEditorError(`最多添加 ${TAG_LIMIT} 个标签。`); this.tags.focus(); return; }
    if (tags.some(tag => tag.length > TAG_LENGTH)) { this.setEditorError(`每个标签最多 ${TAG_LENGTH} 字。`); this.tags.focus(); return; }
    if (comment.length > COMMENT_LENGTH) { this.setEditorError(`笔记最多 ${COMMENT_LENGTH} 字。`); this.comment.focus(); return; }
    if (!tags.length && !comment) { this.setEditorError('请至少填写一个标签或一段笔记。'); this.tags.focus(); return; }
    this.setEditorError('');
    this.renderEditorColors();
    const tagColors = Object.fromEntries(tags.map(tag => [tag, this.editorTagColors.get(tag) || this.editorColor]));
    const color = tags.length ? tagColors[tags[0]] : this.editorColor;
    this.setSaving(true);
    let savedNote;
    try {
      savedNote = await window.jiao.saveAnnotation(editor.documentId, {
        ...(editor.id ? { id: editor.id } : {}), page: editor.page, source: editor.source, tags, comment, color, tagColors,
        ...(editor.rects !== undefined ? { rects: editor.rects } : {})
      });
      if (this.documentId !== editor.documentId || this.generation !== editor.generation || this.editorSession !== session) return;
      editor.id = savedNote.id;
      const notes = await window.jiao.annotations(editor.documentId);
      if (this.documentId !== editor.documentId || this.generation !== editor.generation || this.editorSession !== session) return;
      this.error = '';
      this.replaceNotes(notes);
      this.setSaving(false);
      this.cancelEditor();
      this.onToast('标签与笔记已保存到本机。');
    } catch (error) {
      if (this.documentId !== editor.documentId || this.generation !== editor.generation || this.editorSession !== session) return;
      this.setSaving(false);
      if (savedNote) {
        const merged = [...this.notes.filter(note => note.id !== savedNote.id), savedNote].map(note => {
          const updatedColors = Object.fromEntries((note.tags || []).map(tag => [tag,
            Object.hasOwn(tagColors, tag) ? tagColors[tag] : colorForTag(note, tag)]));
          return { ...note, tagColors: updatedColors, color: note.tags?.length ? updatedColors[note.tags[0]] : note.color };
        });
        this.replaceNotes(merged);
        this.setEditorError(`笔记已保存，但完整列表刷新失败。可重试保存：${error?.message || '读取失败'}`);
      } else this.setEditorError(error?.message || '保存失败，请重试。');
    }
  }

  cancelEditor(restoreFocus = true, force = false) {
    if (this.saving && !force) return;
    ++this.editorSession;
    const wasOpen = this.dialog.open;
    if (wasOpen) this.dialog.close();
    this.editor = null;
    this.setSaving(false);
    if (wasOpen && restoreFocus) {
      const target = canFocus(this.editorReturnFocus) ? this.editorReturnFocus : this.button;
      if (canFocus(target)) target.focus({ preventScroll: true });
    }
    this.editorReturnFocus = null;
  }

  async remove(note) {
    if (this.deleting || !this.documentId) return;
    const generation = this.generation;
    const documentId = this.documentId;
    this.deleting = true;
    this.render();
    try {
      const notes = await window.jiao.removeAnnotation(documentId, note.id);
      if (this.generation !== generation || this.documentId !== documentId) return;
      this.deleting = false;
      this.replaceNotes(notes);
      this.onToast('笔记已删除。');
    } catch (error) {
      if (this.generation !== generation || this.documentId !== documentId) return;
      this.deleting = false;
      this.render();
      this.onToast(error?.message || '删除笔记失败，请重试。');
    }
  }

  destroy() {
    ++this.generation;
    this.close(false);
    this.cancelEditor(false, true);
    this.button.removeEventListener('click', this.buttonClick);
    document.removeEventListener('pointerdown', this.outsidePointer, true);
    document.removeEventListener('keydown', this.keydown, true);
    window.removeEventListener('resize', this.reposition);
    this.panel.remove();
    this.dialog.remove();
  }
}
