import { PdfReader } from './pdf-reader.mjs';
import { TranslationBubble } from './translation-bubble.mjs';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'openButton', 'emptyOpenButton', 'documentName', 'pageInput', 'pageTotal', 'previousPage', 'nextPage',
  'pageReadout', 'zoomOut', 'zoomIn', 'zoomValue', 'fitButton', 'readerScroll', 'emptyState', 'pdfStage',
  'pages', 'toast', 'recentList', 'recentCount', 'clearRecent', 'modelStatus', 'refreshStatus', 'modelSelect', 'modelHint',
  'startOllama', 'modelGuide', 'modelCommand', 'copyCommand', 'sourceText', 'selectionLength',
  'translationText', 'copyButton', 'retryTranslation', 'ollamaLink', 'historyList', 'historyCount', 'dropOverlay'
].map(id => [id, $(id)]));

let fileName = '';
let filePath = '';
let recentBusy = false;
let openSerial = 0;
let translationSerial = 0;
let statusSerial = 0;
let selectedText = '';
let translation = '';
let translationState = 'idle';
let selectedModel = '';
let modelReady = false;
let translating = false;
let translationInFlight = false;
let pendingTranslation = '';
let modelChecking = false;
let selectionTimer;
let selectingPdf = false;
let toastTimer;
let recent = [];
const history = [];
const bubble = new TranslationBubble(ui.readerScroll, text => copyText(text, '译文已复制'), dismissBubble);

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
  pendingTranslation = '';
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
    button.append(icon, name);
    button.addEventListener('click', async () => {
      try {
        const result = await window.jiao.openRecent(item.path);
        recent = result.recent;
        await openPdf(result.name, result.data, result.path);
      } catch (error) { showToast(`打开失败：${error.message}`); }
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

async function choosePdf() {
  try {
    const result = await window.jiao.open();
    if (!result) return;
    recent = result.recent;
    await openPdf(result.name, result.data, result.path);
  } catch (error) { showToast(`打开失败：${error.message}`); }
}

async function openDroppedPdf(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size > 200 * 1024 * 1024) {
    showToast('请拖入不超过 200 MB 的 PDF 文件。');
    return;
  }
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder('ascii').decode(data.subarray(0, 5)) !== '%PDF-') throw new Error('文件不是有效的 PDF。');
    await openPdf(file.name, data);
  } catch (error) { showToast(`打开失败：${error.message}`); }
}

async function openPdf(name, bytes, path = '') {
  const serial = ++openSerial;
  resetTranslation();
  fileName = name;
  filePath = path;
  ui.documentName.textContent = name;
  ui.documentName.title = name;
  ui.emptyState.hidden = true;
  ui.pdfStage.hidden = false;
  renderRecent();
  showToast(`正在打开 ${name}`);
  try {
    if (await reader.open(bytes) && serial === openSerial) showToast(`${name} · ${reader.totalPages} 页`);
  } catch (error) {
    if (serial !== openSerial) return;
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
  bubble.open(anchor, text, text === selectedText ? ui.translationText.textContent : '正在准备翻译…', text === selectedText ? translationState : 'loading');
  if (text === selectedText) return;
  runTranslation(text);
}

async function runTranslation(text) {
  const serial = ++translationSerial;
  pendingTranslation = '';
  selectedText = text;
  translation = '';
  ui.copyButton.disabled = true;
  setText(ui.sourceText, text);
  ui.selectionLength.textContent = `${text.length} / 3000 字`;
  translating = false;
  if (text.length > 3000 || !modelReady || modelChecking) {
    showTranslation(text.length > 3000 ? '选中文本过长，请分段翻译。' : modelChecking ? '正在检查或切换模型，请稍后点击“重新翻译”。' : '请先连接 Ollama 并选择一个已安装的模型，然后点击“重新翻译”。', 'error');
    updateTranslationButton();
    return;
  }
  if (translationInFlight) {
    pendingTranslation = text;
    translating = true;
    showTranslation('等待当前请求完成后翻译新的选文…', 'loading');
    updateTranslationButton();
    return;
  }
  pendingTranslation = '';
  translationInFlight = true;
  translating = true;
  updateTranslationButton();
  const model = selectedModel;
  showTranslation(`正在使用 ${model} 翻译…`, 'loading');
  try {
    const result = await window.jiao.translate(text);
    if (serial !== translationSerial) return;
    translation = result;
    showTranslation(result, 'success');
    ui.copyButton.disabled = false;
    history.unshift({ source: text, result, model });
    if (history.length > 20) history.pop();
    renderHistory();
  } catch (error) {
    if (serial === translationSerial) showTranslation(`翻译失败：${error.message}`, 'error');
  } finally {
    translationInFlight = false;
    if (serial === translationSerial) { translating = false; updateTranslationButton(); }
    if (pendingTranslation) {
      const next = pendingTranslation;
      pendingTranslation = '';
      runTranslation(next);
    } else updateTranslationButton();
  }
}

function renderHistory() {
  ui.historyCount.textContent = String(history.length);
  ui.historyList.replaceChildren();
  for (const item of history) {
    const button = document.createElement('button');
    button.className = 'history-item';
    button.type = 'button';
    button.title = item.model;
    const source = document.createElement('strong');
    source.textContent = item.source;
    const result = document.createElement('span');
    result.textContent = item.result;
    button.append(source, result);
    button.addEventListener('click', () => {
      dismissBubble();
      translationSerial++;
      pendingTranslation = '';
      translating = false;
      selectedText = item.source;
      translation = item.result;
      setText(ui.sourceText, item.source);
      showTranslation(item.result, 'success');
      ui.selectionLength.textContent = `${item.source.length} / 3000 字`;
      ui.copyButton.disabled = false;
      updateTranslationButton();
    });
    ui.historyList.append(button);
  }
}

function applyModelStatus(status) {
  const models = status.models || [];
  const usable = models.filter(model => model.available !== false);
  const nextModel = status.selectedModel || '';
  if (nextModel !== selectedModel) {
    dismissBubble();
    translationSerial++;
    pendingTranslation = '';
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
ui.previousPage.addEventListener('click', () => { dismissBubble(); reader.goToPage(reader.currentPage - 1); });
ui.nextPage.addEventListener('click', () => { dismissBubble(); reader.goToPage(reader.currentPage + 1); });
function setReaderScale(scale) { dismissBubble(); reader.setScale(scale); }
ui.zoomOut.addEventListener('click', () => setReaderScale(reader.scale - 0.1));
ui.zoomIn.addEventListener('click', () => setReaderScale(reader.scale + 0.1));
ui.fitButton.addEventListener('click', () => { dismissBubble(); reader.fitWidth(); });
function commitPage() { dismissBubble(); reader.goToPage(ui.pageInput.value); ui.pageInput.value = String(reader.currentPage || 0); }
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
});
document.addEventListener('pointerup', () => {
  if (!selectingPdf) return;
  selectingPdf = false;
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(handleSelection, 80);
});
document.addEventListener('pointercancel', () => { selectingPdf = false; dismissBubble(); });
ui.readerScroll.addEventListener('scroll', dismissBubble, { passive: true });
window.addEventListener('blur', () => { selectingPdf = false; dismissBubble(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') dismissBubble();
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
