import { PdfReader } from './pdf-reader.mjs';
import { TranslationBubble } from './translation-bubble.mjs';
import { ContextMenu } from './context-menu.mjs';
import { AnnotationPanel } from './annotations.mjs';
import { AnnotationCard } from './annotation-card.mjs';
import { PdfHighlights, capturePageRects } from './pdf-highlights.mjs';
import { applyColor, colorForTag } from './annotation-colors.mjs';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'openButton', 'emptyOpenButton', 'documentName', 'pageInput', 'pageTotal', 'previousPage', 'nextPage',
  'pageReadout', 'zoomOut', 'zoomIn', 'zoomValue', 'fitButton', 'readerScroll', 'emptyState', 'pdfStage',
  'pages', 'toast', 'recentList', 'recentCount', 'clearRecent', 'modelStatus', 'refreshStatus', 'modelSelect', 'modelHint',
  'startOllama', 'modelGuide', 'modelCommand', 'copyCommand', 'sourceText', 'selectionLength',
  'translationText', 'copyButton', 'retryTranslation', 'ollamaLink', 'historyList', 'historyCount', 'dropOverlay', 'annotationsButton'
].map(id => [id, $(id)]));

let fileName = '';
let filePath = '';
let documentId = '';
let currentSelection = null;
let selectionGesture = 0;
let revealSerial = 0;
let recentBusy = false;
let openSerial = 0;
let openRequestSerial = 0;
let translationSerial = 0;
let statusSerial = 0;
let selectedText = '';
let translation = '';
let translationState = 'idle';
let selectedModel = '';
let modelReady = false;
let translating = false;
let translationInFlight = false;
let pendingTranslation = null;
let modelChecking = false;
let selectionTimer;
let selectingPdf = false;
let toastTimer;
let recent = [];
const history = [];
const bubble = new TranslationBubble(ui.readerScroll, text => copyText(text, '译文已复制'), dismissBubble);
const contextMenu = new ContextMenu();
let highlights;
let card;
const annotations = new AnnotationPanel({
  button: ui.annotationsButton,
  container: document.body,
  onNavigate: note => { dismissBubble(); card.close(); void revealSelection(note); },
  onToast: showToast,
  onChange: notes => { highlights?.setNotes(notes); card?.setNotes(notes); renderHistory(); }
});

const reader = new PdfReader(ui.readerScroll, ui.pages, state => {
  ui.pageInput.disabled = !state.ready;
  ui.pageInput.max = String(state.total);
  if (document.activeElement !== ui.pageInput) ui.pageInput.value = String(state.current || 0);
  ui.pageTotal.textContent = String(state.total);
  ui.pageReadout.textContent = state.total ? `第 ${state.current} 页 / 共 ${state.total} 页` : '尚未打开 PDF';
  ui.previousPage.disabled = !state.ready || state.current <= 1;
  ui.nextPage.disabled = !state.ready || state.current >= state.total;
  ui.zoomOut.disabled = !state.ready || state.scale <= 0.6;
  ui.zoomIn.disabled = !state.ready || state.scale >= 2.6;
  ui.fitButton.disabled = !state.ready;
  ui.zoomValue.textContent = `${Math.round(state.scale * 100)}%`;
  ui.annotationsButton.disabled = !state.ready || !documentId;
}, record => highlights?.render(record));
highlights = new PdfHighlights(reader, (note, anchor) => {
  dismissBubble();
  annotations.close(false);
  card.open(note, anchor);
});
card = new AnnotationCard({
  onSaved: notes => annotations.replaceNotes(notes),
  onEditTags: note => annotations.editSelection({ ...note, annotationId: note.id }, 'tags'),
  resolveAnchor: id => ui.pages.querySelector(`.pdf-note-marker[data-annotation-id="${id}"]`),
  onToast: showToast
});

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('visible'), 6500);
}

function setText(element, value, placeholder = false) {
  element.textContent = value;
  element.classList.toggle('placeholder', placeholder);
}

function showTranslation(message, state = 'idle') {
  translationState = state;
  setText(ui.translationText, message, state === 'idle' || state === 'loading');
  bubble.update(selectedText, message, state);
}

function dismissBubble() {
  clearTimeout(selectionTimer);
  bubble.hide();
}

function updateTranslationButton() {
  ui.retryTranslation.disabled = !selectedText || selectedText.length > 3000 || !modelReady || translating || translationInFlight || modelChecking;
  ui.retryTranslation.textContent = translating ? '翻译中…' : '重新翻译';
}

function resetTranslation() {
  dismissBubble();
  translationSerial++;
  pendingTranslation = null;
  selectedText = '';
  translation = '';
  translating = false;
  setText(ui.sourceText, '在 PDF 中划选文字，原文会显示在这里。', true);
  showTranslation('选中文字后自动翻译。公式、变量和引用编号会尽量保留。');
  ui.copyButton.disabled = true;
  ui.selectionLength.textContent = '0 / 3000 字';
  updateTranslationButton();
}

function renderRecent() {
  ui.recentCount.textContent = String(recent.length);
  ui.clearRecent.disabled = recentBusy || !recent.length;
  ui.recentList.replaceChildren();
  if (!recent.length) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '通过“打开 PDF”打开的文献会显示在这里。';
    ui.recentList.append(hint);
  }
  for (const item of recent) {
    const row = document.createElement('div');
    row.className = `recent-row${item.path === filePath ? ' active' : ''}`;
    const button = document.createElement('button');
    button.className = 'recent-item';
    button.type = 'button';
    button.title = item.path;
    const icon = document.createElement('span');
    icon.className = 'recent-icon';
    icon.textContent = 'PDF';
    const name = document.createElement('span');
    name.textContent = item.name;
    name.className = 'recent-name';
    button.append(icon, name);
    if (item.priority > 0) {
      const priority = document.createElement('span');
      priority.className = 'recent-priority';
      priority.textContent = `↑${item.priority}`;
      priority.title = `优先级 ${item.priority}`;
      priority.setAttribute('aria-label', `优先级 ${item.priority}`);
      button.append(priority);
    }
    row.dataset.priority = String(item.priority || 0);
    row.addEventListener('contextmenu', event => {
      dismissBubble();
      contextMenu.open(event, [
        { label: '优先级 +1', disabled: recentBusy, action: () => changePriority(item.path, 'increment') },
        { label: '优先级清零', disabled: recentBusy, action: () => changePriority(item.path, 'reset') }
      ]);
    });
    button.addEventListener('click', async () => {
      const request = ++openRequestSerial;
      try {
        const result = await window.jiao.openRecent(item.path);
        if (request !== openRequestSerial) return;
        recent = result.recent;
        await openPdf(result.name, result.data, result.path);
      } catch (error) { if (request === openRequestSerial) showToast(`打开失败：${error.message}`); }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'recent-remove';
    remove.textContent = '×';
    remove.title = `移除 ${item.name} 的阅读记录，保留 PDF 文件`;
    remove.setAttribute('aria-label', `移除阅读记录：${item.name}`);
    remove.disabled = recentBusy;
    remove.addEventListener('click', () => changeRecent('removeRecent', item.path));
    row.append(button, remove);
    ui.recentList.append(row);
  }
}

async function changeRecent(action, path) {
  if (recentBusy) return;
  recentBusy = true;
  renderRecent();
  try {
    recent = await window.jiao[action](path);
    showToast(action === 'clearRecent' ? '最近阅读已清空，PDF 文件已保留。' : '已移除阅读记录，PDF 文件已保留。');
  } catch (error) { showToast(`移除记录失败：${error.message}`); }
  finally { recentBusy = false; renderRecent(); }
}

async function changePriority(path, action) {
  if (recentBusy) return;
  recentBusy = true;
  renderRecent();
  try {
    recent = await window.jiao.setRecentPriority(path, action);
    showToast(action === 'reset' ? '优先级已清零。' : '优先级已增加。');
  } catch (error) { showToast(`设置优先级失败：${error.message}`); }
  finally { recentBusy = false; renderRecent(); }
}

async function choosePdf() {
  const request = ++openRequestSerial;
  try {
    const result = await window.jiao.open();
    if (!result || request !== openRequestSerial) return;
    recent = result.recent;
    await openPdf(result.name, result.data, result.path);
  } catch (error) { if (request === openRequestSerial) showToast(`打开失败：${error.message}`); }
}

async function openDroppedPdf(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size > 200 * 1024 * 1024) {
    showToast('请拖入不超过 200 MB 的 PDF 文件。');
    return;
  }
  const request = ++openRequestSerial;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (request !== openRequestSerial) return;
    if (new TextDecoder('ascii').decode(data.subarray(0, 5)) !== '%PDF-') throw new Error('文件不是有效的 PDF。');
    await openPdf(file.name, data);
  } catch (error) { if (request === openRequestSerial) showToast(`打开失败：${error.message}`); }
}

async function openPdf(name, bytes, path = '') {
  const serial = ++openSerial;
  ++revealSerial;
  resetTranslation();
  contextMenu.close();
  card.setDocument('', '');
  highlights.clearFocus();
  currentSelection = null;
  history.length = 0;
  documentId = '';
  annotations.setDocument('', '');
  renderHistory();
  fileName = name;
  filePath = path;
  ui.documentName.textContent = name;
  ui.documentName.title = name;
  ui.emptyState.hidden = true;
  ui.pdfStage.hidden = true;
  reader.ready = false;
  reader.notify();
  renderRecent();
  showToast(`正在打开 ${name}`);
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    if (serial !== openSerial) return;
    documentId = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    const openedId = documentId;
    card.setDocument(openedId, name);
    await annotations.setDocument(documentId, name);
    if (serial !== openSerial) return;
    try {
      const saved = await window.jiao.selectionHistory(openedId);
      if (serial !== openSerial) return;
      history.push(...saved.map(item => ({ ...item, documentId: openedId, status: item.result ? 'success' : 'selected', storageState: 'saved' })));
      renderHistory();
    } catch (error) {
      if (serial !== openSerial) return;
      showToast(`划选历史读取失败：${error.message}`);
    }
    ui.annotationsButton.disabled = true;
    ui.pdfStage.hidden = false;
    if (await reader.open(bytes) && serial === openSerial) showToast(`${name} · ${reader.totalPages} 页`);
  } catch (error) {
    if (serial !== openSerial) return;
    documentId = '';
    card.setDocument('', '');
    history.length = 0;
    currentSelection = null;
    annotations.setDocument('', '');
    renderHistory();
    ui.emptyState.hidden = false;
    ui.pdfStage.hidden = true;
    showToast(`PDF 打开失败：${error.message}`);
  }
}

function selectionInPdf(selection) {
  return [selection.anchorNode, selection.focusNode].every(node => {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest?.('.textLayer');
  });
}

function handleSelection() {
  if (selectingPdf) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selectionInPdf(selection)) return;
  const text = selection.toString().trim();
  if (!text || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const viewport = ui.readerScroll.getBoundingClientRect();
  const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0 &&
    rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right);
  if (!rects.length) return;
  const backwards = range.startContainer === selection.focusNode && range.startOffset === selection.focusOffset;
  const rect = backwards ? rects[0] : rects.at(-1);
  const anchor = { left: Math.max(rect.left, viewport.left), top: Math.max(rect.top, viewport.top), bottom: Math.min(rect.bottom, viewport.bottom) };
  const anchorElement = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
  const page = Number(anchorElement?.closest('[data-page]')?.dataset.page) || reader.currentPage;
  const body = anchorElement?.closest('.page-shell')?.querySelector('.pdf-page');
  const item = captureSelection(text, page, capturePageRects(range, body));
  bubble.open(anchor, text, text === selectedText ? ui.translationText.textContent : '正在准备翻译…', text === selectedText ? translationState : 'loading');
  if (text === selectedText) {
    if (translation && item) { item.result = translation; item.model = selectedModel; item.status = 'success'; void persistSelection(item); renderHistory(); }
    return;
  }
  runTranslation(text, item);
}

function captureSelection(text, page, rects = []) {
  if (!documentId || !page) return null;
  if (currentSelection?.gesture === selectionGesture && currentSelection.source === text && currentSelection.page === page && currentSelection.documentId === documentId) {
    if (rects.length) currentSelection.rects = rects;
    return currentSelection;
  }
  if (currentSelection && ['loading', 'waiting'].includes(currentSelection.status)) currentSelection.status = 'skipped';
  const item = { id: crypto.randomUUID(), gesture: selectionGesture, documentId, page, source: text, rects, result: '', model: '', status: 'selected', storageState: 'saving' };
  history.unshift(item);
  if (history.length > 100) history.pop();
  currentSelection = item;
  renderHistory();
  void persistSelection(item);
  return item;
}

async function persistSelection(item) {
  const serial = item.saveSerial = (item.saveSerial || 0) + 1;
  const payload = { id: item.id, page: item.page, source: item.source, rects: item.rects || [], result: item.result, model: item.model };
  item.storageState = 'saving';
  try {
    const saved = await window.jiao.saveSelection(item.documentId, payload);
    if (serial !== item.saveSerial) return;
    item.createdAt = saved.createdAt;
    item.updatedAt = saved.updatedAt;
    item.storageState = 'saved';
  } catch (error) {
    if (serial !== item.saveSerial) return;
    item.storageState = 'failed';
    if (item.documentId === documentId && history.includes(item)) showToast(`划选历史保存失败：${error.message}`);
  }
  if (item.documentId === documentId && history.includes(item)) renderHistory();
}

async function revealSelection(item) {
  const openedId = documentId;
  const serial = openSerial;
  const request = ++revealSerial;
  const revealed = await highlights.revealSelection(item);
  if (!revealed && request === revealSerial && openedId === documentId && serial === openSerial) showToast('已跳转到原页，但无法定位这条记录的文字范围。');
}

function restoreSelection(item) {
  if (item.documentId !== documentId) return;
  dismissBubble();
  card.close();
  contextMenu.close();
  annotations.close(false);
  translationSerial++;
  pendingTranslation = null;
  skipUnfinishedHistory();
  translating = false;
  selectedText = item.source;
  currentSelection = item;
  translation = item.result;
  setText(ui.sourceText, item.source);
  showTranslation(item.result || '选文已恢复，可添加标注或重新翻译。', item.result ? 'success' : 'idle');
  ui.selectionLength.textContent = `${item.source.length} / 3000 字`;
  ui.copyButton.disabled = !item.result;
  updateTranslationButton();
  renderHistory();
  void revealSelection(item);
}

async function runTranslation(text, item = currentSelection) {
  const serial = ++translationSerial;
  pendingTranslation = null;
  selectedText = text;
  translation = '';
  ui.copyButton.disabled = true;
  setText(ui.sourceText, text);
  ui.selectionLength.textContent = `${text.length} / 3000 字`;
  translating = false;
  if (text.length > 3000 || !modelReady || modelChecking) {
    if (item) { item.status = 'selected'; renderHistory(); }
    showTranslation(text.length > 3000 ? '选中文本过长，请分段翻译。' : modelChecking ? '正在检查或切换模型，请稍后点击“重新翻译”。' : '请先连接 Ollama 并选择一个已安装的模型，然后点击“重新翻译”。', 'error');
    updateTranslationButton();
    return;
  }
  if (translationInFlight) {
    pendingTranslation = { text, item };
    if (item) { item.status = 'waiting'; renderHistory(); }
    translating = true;
    showTranslation('等待当前请求完成后翻译新的选文…', 'loading');
    updateTranslationButton();
    return;
  }
  pendingTranslation = null;
  translationInFlight = true;
  translating = true;
  updateTranslationButton();
  const model = selectedModel;
  if (item) { item.status = 'loading'; renderHistory(); }
  showTranslation(`正在使用 ${model} 翻译…`, 'loading');
  try {
    const result = await window.jiao.translate(text);
    if (serial !== translationSerial) return;
    translation = result;
    showTranslation(result, 'success');
    ui.copyButton.disabled = false;
    if (item?.documentId === documentId) { item.result = result; item.model = model; item.status = 'success'; void persistSelection(item); }
    renderHistory();
  } catch (error) {
    if (serial === translationSerial) {
      if (item) { item.status = 'failed'; renderHistory(); }
      showTranslation(`翻译失败：${error.message}`, 'error');
    }
  } finally {
    translationInFlight = false;
    if (serial === translationSerial) { translating = false; updateTranslationButton(); }
    if (pendingTranslation) {
      const next = pendingTranslation;
      pendingTranslation = null;
      runTranslation(next.text, next.item);
    } else updateTranslationButton();
  }
}

function renderHistory() {
  ui.historyCount.textContent = String(history.length);
  ui.historyList.replaceChildren();
  if (!history.length) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '划选记录按文献保存在本机。点击返回原选区，右键添加标签或笔记。';
    ui.historyList.append(hint);
  }
  for (const item of history) {
    const button = document.createElement('button');
    button.className = `history-item${currentSelection?.id === item.id ? ' active' : ''}`;
    button.type = 'button';
    button.dataset.selectionId = String(item.id);
    button.dataset.page = String(item.page);
    button.title = `第 ${item.page} 页 · 点击返回原选区 · 右键添加标签或笔记${item.model ? ` · ${item.model}` : ''}`;
    const source = document.createElement('strong');
    source.textContent = item.source;
    const result = document.createElement('span');
    result.textContent = item.result || `第 ${item.page} 页 · ${item.status === 'loading' ? '翻译中…' : item.status === 'waiting' ? '等待翻译…' : item.status === 'failed' ? '翻译失败，可重试或标注' : '右键添加标签或笔记'}`;
    button.append(source, result);
    const location = document.createElement('span');
    location.className = 'history-location';
    location.textContent = `第 ${item.page} 页 · 返回原选区 · ${item.storageState === 'saved' ? '已保存' : item.storageState === 'failed' ? '仅暂存，保存失败' : '保存中…'}`;
    button.append(location);
    const note = annotations.getAnnotation(item.page, item.source, item.rects);
    if (note) {
      const mark = document.createElement('span');
      mark.className = 'history-note-mark';
      for (const tag of note.tags) {
        const chip = document.createElement('span');
        chip.className = 'annotation-tag';
        chip.textContent = `#${tag}`;
        applyColor(chip, colorForTag(note, tag));
        mark.append(chip);
      }
      if (note.comment) {
        const comment = document.createElement('span');
        comment.className = 'history-comment-mark';
        comment.textContent = '有笔记';
        mark.append(comment);
      }
      button.append(mark);
    }
    button.addEventListener('contextmenu', event => showSelectionMenu(event, item));
    button.addEventListener('click', () => restoreSelection(item));
    ui.historyList.append(button);
  }
}

function skipUnfinishedHistory() {
  for (const item of history) {
    if (['loading', 'waiting'].includes(item.status)) item.status = 'skipped';
  }
}

function showSelectionMenu(event, item = currentSelection) {
  if (!item || item.documentId !== documentId) return;
  dismissBubble();
  card.close();
  contextMenu.open(event, [
    { label: '添加标签', action: () => annotations.editSelection(item, 'tags') },
    { label: '写评论 / 笔记', action: () => annotations.editSelection(item, 'comment') }
  ]);
}

ui.historyList.parentElement.addEventListener('contextmenu', event => showSelectionMenu(event));

function applyModelStatus(status) {
  const models = status.models || [];
  const usable = models.filter(model => model.available !== false);
  const nextModel = status.selectedModel || '';
  if (nextModel !== selectedModel) {
    dismissBubble();
    translationSerial++;
    pendingTranslation = null;
    skipUnfinishedHistory();
    renderHistory();
    translating = false;
    translation = '';
    ui.copyButton.disabled = true;
    if (selectedText) showTranslation('模型已切换，点击“重新翻译”使用当前模型。');
  }
  selectedModel = nextModel;
  modelReady = status.connected && usable.some(model => model.name === selectedModel);
  const placeholder = new Option(status.connected ? '请选择已安装的模型' : '连接 Ollama 后选择模型', '');
  placeholder.disabled = true;
  ui.modelSelect.replaceChildren(placeholder);
  for (const model of models) {
    const size = model.size ? ` · ${(model.size / 1024 ** 3).toFixed(1)} GB` : '';
    const option = new Option(`${model.name}${size}${model.available === false ? '（不可用于翻译）' : ''}`, model.name);
    option.disabled = model.available === false;
    option.title = model.reason || model.name;
    ui.modelSelect.add(option);
  }
  ui.modelSelect.value = selectedModel;
  ui.modelSelect.disabled = !status.connected || !usable.length;
  ui.modelStatus.className = `model-status ${modelReady ? 'ready' : 'warning'}`;
  let title;
  let detail;
  if (!status.connected) {
    title = status.installation === 'installed' ? 'Ollama 已安装，服务未运行' : status.installation === 'not-found' ? '未检测到 Ollama' : '无法确认 Ollama 状态';
    detail = status.installation === 'installed' ? '点击“启动 Ollama”后继续' : '安装或启动 Ollama 后重新检查';
  } else {
    title = modelReady ? '本地翻译已就绪' : usable.length ? 'Ollama 已连接，请选择模型' : 'Ollama 已连接，暂无可用模型';
    detail = modelReady ? selectedModel : `${models.length} 个已安装模型 · ${usable.length} 个可用于翻译`;
  }
  ui.modelStatus.querySelector('strong').textContent = title;
  ui.modelStatus.querySelector('small').textContent = detail;
  ui.modelStatus.title = status.error || detail;
  ui.startOllama.hidden = status.connected || status.installation !== 'installed';
  ui.ollamaLink.hidden = status.connected || status.installation === 'installed';
  ui.modelGuide.hidden = modelReady;
  ui.modelHint.textContent = status.connected && models.some(model => model.available === false)
    ? '只列出本机已有模型。嵌入模型及云端模型不可选。'
    : '只选择本机已有模型；首次翻译时会加载到内存。';
  updateTranslationButton();
}

async function checkModel(action = 'status', name) {
  dismissBubble();
  const serial = ++statusSerial;
  modelChecking = true;
  updateTranslationButton();
  ui.refreshStatus.disabled = ui.modelSelect.disabled = ui.startOllama.disabled = true;
  ui.modelStatus.querySelector('strong').textContent = action === 'startOllama' ? '正在启动 Ollama…' : '正在检查本地模型…';
  try {
    const status = await window.jiao[action](name);
    if (serial === statusSerial) applyModelStatus(status);
  } catch (error) {
    if (serial !== statusSerial) return;
    showToast(error.message);
    try {
      const recovered = await window.jiao.status();
      if (serial === statusSerial) applyModelStatus(recovered);
    }
    catch { ui.modelStatus.querySelector('strong').textContent = '状态检查失败，请重试'; }
  } finally {
    if (serial === statusSerial) {
      modelChecking = false;
      ui.refreshStatus.disabled = ui.startOllama.disabled = false;
      updateTranslationButton();
    }
  }
}

ui.openButton.addEventListener('click', choosePdf);
ui.emptyOpenButton.addEventListener('click', choosePdf);
ui.clearRecent.addEventListener('click', () => changeRecent('clearRecent'));
ui.previousPage.addEventListener('click', () => { dismissBubble(); card.close(); reader.goToPage(reader.currentPage - 1); });
ui.nextPage.addEventListener('click', () => { dismissBubble(); card.close(); reader.goToPage(reader.currentPage + 1); });
function setReaderScale(scale) { dismissBubble(); card.close(); reader.setScale(scale); }
ui.zoomOut.addEventListener('click', () => setReaderScale(reader.scale - 0.1));
ui.zoomIn.addEventListener('click', () => setReaderScale(reader.scale + 0.1));
ui.fitButton.addEventListener('click', () => { dismissBubble(); card.close(); reader.fitWidth(); });
function commitPage() { dismissBubble(); card.close(); reader.goToPage(ui.pageInput.value); ui.pageInput.value = String(reader.currentPage || 0); }
ui.pageInput.addEventListener('change', commitPage);
ui.pageInput.addEventListener('keydown', event => { if (event.key === 'Enter') { commitPage(); ui.pageInput.blur(); } });
ui.refreshStatus.addEventListener('click', () => checkModel());
ui.startOllama.addEventListener('click', () => checkModel('startOllama'));
ui.modelSelect.addEventListener('change', () => { if (ui.modelSelect.value) checkModel('selectModel', ui.modelSelect.value); });
ui.ollamaLink.addEventListener('click', () => window.jiao.ollamaSite());
ui.retryTranslation.addEventListener('click', () => runTranslation(selectedText));
async function copyText(text, success) {
  try { await navigator.clipboard.writeText(text); showToast(success); }
  catch { showToast('复制失败，请手动选择文字。'); }
}
ui.copyButton.addEventListener('click', () => copyText(translation, '译文已复制'));
ui.copyCommand.addEventListener('click', () => copyText(ui.modelCommand.textContent, 'Ollama 命令已复制，请在终端中运行'));
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  if (!selectingPdf) selectionTimer = setTimeout(handleSelection, 500);
});
document.addEventListener('pointerdown', event => {
  if (bubble.contains(event.target)) { clearTimeout(selectionTimer); return; }
  dismissBubble();
  selectingPdf = event.button === 0 && Boolean(event.target.closest?.('.textLayer'));
  if (selectingPdf) { selectionGesture++; highlights.clearFocus(); }
});
document.addEventListener('pointerup', () => {
  if (!selectingPdf) return;
  selectingPdf = false;
  clearTimeout(selectionTimer);
  // Let native mouse-up finish before placing a bubble over the PDF.
  selectionTimer = setTimeout(handleSelection, 80);
});
document.addEventListener('pointercancel', () => { selectingPdf = false; dismissBubble(); });
// An edge scroll after pointer release must not discard the pending selection.
ui.readerScroll.addEventListener('scroll', () => bubble.hide(), { passive: true });
window.addEventListener('blur', () => { selectingPdf = false; dismissBubble(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { dismissBubble(); card.close(); highlights.clearFocus(); }
  if (event.target.closest?.('dialog[open], input, textarea, [contenteditable="true"]')) return;
  if (event.ctrlKey && event.key.toLowerCase() === 'o') { event.preventDefault(); dismissBubble(); choosePdf(); }
  if (event.ctrlKey && (event.key === '+' || event.key === '=')) { event.preventDefault(); setReaderScale(reader.scale + 0.1); }
  if (event.ctrlKey && event.key === '-') { event.preventDefault(); setReaderScale(reader.scale - 0.1); }
});
document.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  ui.dropOverlay.hidden = false;
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) ui.dropOverlay.hidden = true; });
document.addEventListener('drop', event => {
  event.preventDefault();
  ui.dropOverlay.hidden = true;
  if (event.dataTransfer.files.length) openDroppedPdf(event.dataTransfer.files[0]);
});
window.jiao.recent().then(items => { recent = items; renderRecent(); }).catch(() => {});
checkModel();
reader.notify();
updateTranslationButton();
