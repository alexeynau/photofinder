const selectDirectoryButtons = {
  source: document.querySelector("button[data-action='pick-source']"),
  target: document.querySelector("button[data-action='pick-target']"),
};

const dirInputs = {
  source: document.getElementById('sourceDir'),
  target: document.getElementById('targetDir'),
};

const controlForm = document.getElementById('controlForm');
const modeBadge = document.getElementById('runMode');
const statusMessage = document.getElementById('statusMessage');
const statusDetails = document.getElementById('statusDetails');
const statusIcon = document.getElementById('statusIcon');
const processedList = document.getElementById('processedList');
const missingList = document.getElementById('missingList');
const openTargetBtn = document.getElementById('openTargetBtn');
const messageEditor = document.getElementById('messageEditor');
const hiddenMessageInput = document.getElementById('message');
const parserToggle = document.getElementById('useSmartParser');

const modeLabels = {
  copy: 'Копирование',
  move: 'Перемещение',
  simulate: 'Тестовый прогон',
};

const parserLabels = {
  smart: 'умный парсер',
  simple: 'глупый парсер',
};

let lastResult = null;
let highlightTimer = null;
let highlightRequestId = 0;
let applyingHighlight = false;

const setStatus = ({ icon, message, details }) => {
  statusIcon.textContent = icon;
  statusMessage.textContent = message;
  statusDetails.textContent = details ?? '';
};

const clearLists = () => {
  processedList.innerHTML = '';
  missingList.innerHTML = '';
};

const renderList = (element, items, emptyPlaceholder) => {
  element.innerHTML = '';

  if (!items || items.length === 0) {
    const placeholder = document.createElement('li');
    placeholder.textContent = emptyPlaceholder;
    placeholder.classList.add('result-list--empty');
    element.appendChild(placeholder);
    return;
  }

  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    element.appendChild(li);
  });
};

const escapeHtml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getPlainText = () => {
  if (!messageEditor) {
    return '';
  }

  return messageEditor.textContent.replace(/\r/g, '');
};

const setEditorHtml = (html) => {
  applyingHighlight = true;
  if (messageEditor) {
    messageEditor.innerHTML = html;
  }
  applyingHighlight = false;
};

const getCaretOffset = (root) => {
  if (!root) {
    return null;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return null;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node === range.startContainer) {
      return offset + range.startOffset;
    }
    offset += node.textContent.length;
  }

  return offset;
};

const setCaretOffset = (root, targetOffset) => {
  if (!root) {
    return;
  }

  const clampedOffset = Math.max(0, Math.min(targetOffset, getPlainText().length));

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let targetNode = null;
  let targetNodeOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLength = node.textContent.length;
    if (currentOffset + nodeLength >= clampedOffset) {
      targetNode = node;
      targetNodeOffset = clampedOffset - currentOffset;
      break;
    }
    currentOffset += nodeLength;
  }

  const range = document.createRange();
  if (!targetNode) {
    range.setStart(root, root.childNodes.length);
  } else {
    range.setStart(targetNode, Math.min(targetNodeOffset, targetNode.textContent.length));
  }
  range.collapse(true);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};

const buildHighlightedHtml = (text, matches) => {
  if (!text) {
    return '';
  }

  const sortedMatches = Array.isArray(matches)
    ? [...matches].sort((a, b) => a.start - b.start)
    : [];

  let cursor = 0;
  let buffer = '';

  for (const match of sortedMatches) {
    if (
      typeof match.start !== 'number' ||
      typeof match.end !== 'number' ||
      match.start < cursor
    ) {
      continue;
    }

    const safeStart = Math.max(0, Math.min(match.start, text.length));
    const safeEnd = Math.max(safeStart, Math.min(match.end, text.length));

    buffer += escapeHtml(text.slice(cursor, safeStart));
    const segment = escapeHtml(text.slice(safeStart, safeEnd));
    buffer += `<span class="text-highlight">${segment}</span>`;
    cursor = safeEnd;
  }

  buffer += escapeHtml(text.slice(cursor));

  return buffer.replace(/\n/g, '<br>');
};

const performHighlightUpdate = async () => {
  if (!messageEditor) {
    return;
  }

  const plainText = getPlainText();
  hiddenMessageInput.value = plainText;

  const caretOffset = getCaretOffset(messageEditor);
  const parserMode = parserToggle?.checked ? 'smart' : 'simple';
  const requestId = ++highlightRequestId;

  try {
    const response = await window.electronAPI.parsePreview({
      message: plainText,
      parserMode,
    });

    if (requestId !== highlightRequestId) {
      return;
    }

    const html = buildHighlightedHtml(plainText, response.matches);
    setEditorHtml(html);
    if (caretOffset !== null) {
      setCaretOffset(messageEditor, caretOffset);
    }
  } catch (error) {
    console.error('Highlight update failed:', error);
  }
};

const scheduleHighlightUpdate = () => {
  if (highlightTimer) {
    clearTimeout(highlightTimer);
  }
  highlightTimer = setTimeout(performHighlightUpdate, 100);
};

const handleDirectorySelect = async (type) => {
  const selectedPath = await window.electronAPI.selectDirectory();
  if (!selectedPath) {
    return;
  }

  dirInputs[type].value = selectedPath;

  if (type === 'source') {
    await applySuggestedTarget(selectedPath);
  } else if (type === 'target') {
    dirInputs.target.dataset.manual = 'true';
  }
};

const applySuggestedTarget = async (sourcePath) => {
  if (!dirInputs.target || !sourcePath) {
    return;
  }
  if (dirInputs.target.dataset.manual === 'true') {
    return;
  }
  const suggestion = await window.electronAPI.suggestTargetDir(sourcePath);
  if (suggestion) {
    dirInputs.target.value = suggestion;
    dirInputs.target.dataset.manual = 'false';
  }
};

selectDirectoryButtons.source?.addEventListener('click', () =>
  handleDirectorySelect('source')
);

selectDirectoryButtons.target?.addEventListener('click', () =>
  handleDirectorySelect('target')
);

openTargetBtn?.addEventListener('click', async () => {
  const targetPath =
    (lastResult && lastResult.resolvedTargetDir) || dirInputs.target.value;
  if (!targetPath) {
    return;
  }
  await window.electronAPI.openExternal(targetPath);
});

const updateHiddenMessage = () => {
  hiddenMessageInput.value = getPlainText();
};

messageEditor?.addEventListener('input', () => {
  if (applyingHighlight) {
    return;
  }
  updateHiddenMessage();
  scheduleHighlightUpdate();
});

messageEditor?.addEventListener('paste', (event) => {
  event.preventDefault();
  const text = (event.clipboardData || window.clipboardData).getData('text');
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  selection.deleteFromDocument();
  const range = selection.getRangeAt(0);
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  scheduleHighlightUpdate();
});

parserToggle?.addEventListener('change', () => {
  scheduleHighlightUpdate();
});

window.addEventListener('resize', () => {
  scheduleHighlightUpdate();
});

controlForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  updateHiddenMessage();

  const formData = new FormData(controlForm);
  const parserMode = parserToggle?.checked ? 'smart' : 'simple';
  const submission = {
    sourceDir: formData.get('sourceDir') ?? '',
    targetDir: formData.get('targetDir') ?? '',
    message: formData.get('message') ?? '',
    mode: formData.get('mode') ?? 'copy',
    parserMode,
  };

  clearLists();
  const modeLabel = modeLabels[submission.mode] ?? submission.mode;
  const parserLabel = parserLabels[parserMode] ?? parserMode;
  modeBadge.textContent = `${modeLabel} • ${parserLabel}`;
  openTargetBtn.disabled = true;

  setStatus({
    icon: '⏳',
    message: 'Выполняется обработка…',
    details: 'Парсинг номеров и подготовка списка файлов',
  });

  const response = await window.electronAPI.processRequest(submission);
  lastResult = response.ok ? response : null;

  if (!response.ok) {
    setStatus({
      icon: '⚠️',
      message: 'Ошибка',
      details: response.error ?? 'Неизвестная ошибка',
    });
    renderList(processedList, [], 'Список пуст.');
    renderList(missingList, [], 'Список пуст.');
    return;
  }

  renderList(processedList, response.processed, 'Ничего не найдено.');
  renderList(missingList, response.missing, 'Все номера обработаны.');

  const hasMissing = Array.isArray(response.missing) && response.missing.length > 0;
  const hasProcessed =
    Array.isArray(response.processed) && response.processed.length > 0;

  setStatus({
    icon: hasMissing ? '⚠️' : '✅',
    message: hasMissing
      ? 'Готово (есть отсутствующие файлы)'
      : 'Готово',
    details: response.details ?? '',
  });

  if (submission.mode !== 'simulate' && hasProcessed) {
    openTargetBtn.disabled = false;
  }
});

controlForm?.addEventListener('reset', () => {
  modeBadge.textContent = '';
  clearLists();
  renderList(processedList, [], 'Список пуст.');
  renderList(missingList, [], 'Список пуст.');
  setStatus({
    icon: '⏳',
    message: 'Готов к запуску.',
    details: '',
  });
  openTargetBtn.disabled = true;

  if (dirInputs.target) {
    dirInputs.target.value = '';
    dirInputs.target.dataset.manual = 'false';
  }

  if (messageEditor) {
    setEditorHtml('');
  }
  hiddenMessageInput.value = '';
  scheduleHighlightUpdate();
});

// Initialize empty state
lastResult = null;
renderList(processedList, [], 'Список пуст.');
renderList(missingList, [], 'Список пуст.');
modeBadge.textContent = '';
setStatus({
  icon: '⏳',
  message: 'Готов к запуску.',
  details: '',
});

if (dirInputs.target) {
  dirInputs.target.dataset.manual = 'false';
}

scheduleHighlightUpdate();
