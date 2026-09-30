let items = [];
let editingId = null;
let running = false;

const listEl = document.getElementById('itemList');
const emptyHint = document.getElementById('emptyHint');
const startBtn = document.getElementById('startBtn');
const cancelBtn = document.getElementById('cancelBtn');
const runSummary = document.getElementById('runSummary');
const runSummaryFill = document.getElementById('runSummaryFill');
const runSummaryText = document.getElementById('runSummaryText');

const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const fName = document.getElementById('fName');
const fType = document.getElementById('fType');
const fPath = document.getElementById('fPath');
const fArgs = document.getElementById('fArgs');
const fProcessName = document.getElementById('fProcessName');
const fCommand = document.getElementById('fCommand');
const fCwd = document.getElementById('fCwd');
const fProcessMatch = document.getElementById('fProcessMatch');
const fUrl = document.getElementById('fUrl');
const fMode = document.getElementById('fMode');
const fTimeout = document.getElementById('fTimeout');
const fieldsExe = document.getElementById('fieldsExe');
const fieldsCommand = document.getElementById('fieldsCommand');
const fieldsUrl = document.getElementById('fieldsUrl');
const deleteItemBtn = document.getElementById('deleteItemBtn');

const MODE_LABEL = { first: 'First', normal: '', wait: 'Wait until open', last: 'Last' };
const STATUS_LABEL = {
  idle: 'PENDING', launching: 'LAUNCHING', verifying: 'VERIFYING',
  ready: 'READY', failed: 'FAILED', unconfirmed: 'UNCONFIRMED', cancelled: 'SKIPPED',
  'already-open': 'ALREADY OPEN'
};

function typeSummary(item) {
  if (item.type === 'exe') return item.path ? item.path : 'No path set';
  if (item.type === 'command') return item.command ? item.command : 'No command set';
  if (item.type === 'url') return item.url ? item.url : 'No URL set';
  return '';
}

function render() {
  listEl.innerHTML = '';
  emptyHint.hidden = items.length > 0;

  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'item-row' + (item.enabled ? '' : ' disabled');
    row.dataset.id = item.id;

    const reorder = document.createElement('div');
    reorder.className = 'reorder';
    const upBtn = document.createElement('button');
    upBtn.textContent = '▲';
    upBtn.disabled = idx === 0;
    upBtn.onclick = () => moveItem(idx, -1);
    const downBtn = document.createElement('button');
    downBtn.textContent = '▼';
    downBtn.disabled = idx === items.length - 1;
    downBtn.onclick = () => moveItem(idx, 1);
    reorder.append(upBtn, downBtn);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'item-checkbox';
    checkbox.checked = item.enabled;
    checkbox.onchange = () => { item.enabled = checkbox.checked; persist(); render(); };

    const main = document.createElement('div');
    main.className = 'item-main';
    main.onclick = () => openEditModal(item.id);
    const nameEl = document.createElement('div');
    nameEl.className = 'item-name';
    nameEl.textContent = item.name;
    const metaEl = document.createElement('div');
    metaEl.className = 'item-meta';
    metaEl.textContent = typeSummary(item);
    main.append(nameEl, metaEl);

    row.append(reorder, checkbox, main);

    if (MODE_LABEL[item.mode]) {
      const badge = document.createElement('span');
      badge.className = 'mode-badge ' + item.mode;
      badge.textContent = MODE_LABEL[item.mode];
      row.append(badge);
    }

    const pill = document.createElement('span');
    pill.className = 'status-pill';
    pill.id = 'status-' + item.id;
    pill.textContent = STATUS_LABEL.idle;
    row.append(pill);

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.textContent = '✎';
    editBtn.onclick = () => openEditModal(item.id);
    row.append(editBtn);

    listEl.append(row);
  });
}

function moveItem(idx, dir) {
  const target = idx + dir;
  if (target < 0 || target >= items.length) return;
  [items[idx], items[target]] = [items[target], items[idx]];
  persist();
  render();
}

function persist() {
  window.dash.saveItems(items);
}

// ---------- Modal ----------

function resetModalFields() {
  fName.value = '';
  fType.value = 'exe';
  fPath.value = '';
  fArgs.value = '';
  fProcessName.value = '';
  fCommand.value = '';
  fCwd.value = '';
  fProcessMatch.value = '';
  fUrl.value = '';
  fMode.value = 'normal';
  fTimeout.value = 15;
  updateTypeFields();
}

function updateTypeFields() {
  fieldsExe.hidden = fType.value !== 'exe';
  fieldsCommand.hidden = fType.value !== 'command';
  fieldsUrl.hidden = fType.value !== 'url';
}
fType.onchange = updateTypeFields;

function openAddModal() {
  editingId = null;
  modalTitle.textContent = 'Add item';
  deleteItemBtn.hidden = true;
  resetModalFields();
  modalBackdrop.hidden = false;
}

function openEditModal(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  editingId = id;
  modalTitle.textContent = 'Edit item';
  deleteItemBtn.hidden = false;
  fName.value = item.name || '';
  fType.value = item.type || 'exe';
  fPath.value = item.path || '';
  fArgs.value = item.args || '';
  fProcessName.value = item.processName || '';
  fCommand.value = item.command || '';
  fCwd.value = item.cwd || '';
  fProcessMatch.value = item.processMatch || '';
  fUrl.value = item.url || '';
  fMode.value = item.mode || 'normal';
  fTimeout.value = Math.round((item.verifyTimeoutMs || 15000) / 1000);
  updateTypeFields();
  modalBackdrop.hidden = false;
}

function closeModal() {
  modalBackdrop.hidden = true;
}

document.getElementById('addItemBtn').onclick = openAddModal;
document.getElementById('cancelModalBtn').onclick = closeModal;
modalBackdrop.onclick = (e) => { if (e.target === modalBackdrop) closeModal(); };

document.getElementById('browseExeBtn').onclick = async () => {
  const p = await window.dash.pickExe();
  if (p) fPath.value = p;
};
document.getElementById('browseCwdBtn').onclick = async () => {
  const p = await window.dash.pickFolder();
  if (p) fCwd.value = p;
};

function cleanPathValue(v) {
  if (!v) return '';
  let s = String(v).trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s;
}

document.getElementById('saveItemBtn').onclick = () => {
  const name = fName.value.trim();
  if (!name) { fName.focus(); return; }

  const base = {
    id: editingId || 'item-' + Date.now(),
    name,
    type: fType.value,
    mode: fMode.value,
    verifyTimeoutMs: (parseInt(fTimeout.value, 10) || 15) * 1000,
    enabled: editingId ? items.find((i) => i.id === editingId).enabled : true
  };

  if (base.type === 'exe') {
    base.path = cleanPathValue(fPath.value);
    base.args = cleanPathValue(fArgs.value);
    base.processName = cleanPathValue(fProcessName.value);
    base.cwd = '';
  } else if (base.type === 'command') {
    base.command = cleanPathValue(fCommand.value);
    base.cwd = cleanPathValue(fCwd.value);
    base.processMatch = cleanPathValue(fProcessMatch.value);
  } else if (base.type === 'url') {
    base.url = cleanPathValue(fUrl.value);
  }

  if (editingId) {
    const idx = items.findIndex((i) => i.id === editingId);
    items[idx] = base;
  } else {
    items.push(base);
  }

  persist();
  render();
  closeModal();
};

deleteItemBtn.onclick = () => {
  if (!editingId) return;
  items = items.filter((i) => i.id !== editingId);
  persist();
  render();
  closeModal();
};

// ---------- Launch sequence ----------

function setStatus(id, state, message) {
  const pill = document.getElementById('status-' + id);
  if (!pill) return;
  pill.className = 'status-pill ' + state;
  pill.textContent = STATUS_LABEL[state] || state.toUpperCase();
  pill.title = message || (state === 'failed' ? 'It reported an error but no details were given.' : '');
}

function setRunningUI(isRunning) {
  running = isRunning;
  startBtn.disabled = isRunning;
  startBtn.textContent = isRunning ? 'Running…' : 'Start stream';
  runSummary.hidden = !isRunning;
  if (isRunning) {
    runSummaryFill.style.width = '4%';
    runSummaryText.textContent = 'Launching…';
  }
}

startBtn.onclick = async () => {
  const enabledCount = items.filter((i) => i.enabled).length;
  if (enabledCount === 0) return;
  items.forEach((i) => setStatus(i.id, 'idle'));
  setRunningUI(true);
  await window.dash.startLaunch();
};

let cancelFallbackTimer = null;

cancelBtn.onclick = async () => {
  runSummaryText.textContent = 'Cancelling…';
  cancelBtn.disabled = true;
  window.dash.cancelLaunch(); // don't await — reset the UI on our own clock, not the backend's
  // Safety net: if the backend doesn't confirm within 2.5s (slow process checks,
  // a stuck launch, etc.), force the UI back to idle anyway so Cancel never feels stuck.
  clearTimeout(cancelFallbackTimer);
  cancelFallbackTimer = setTimeout(() => {
    items.forEach((item) => {
      const pill = document.getElementById('status-' + item.id);
      if (pill && (pill.classList.contains('launching') || pill.classList.contains('verifying') || pill.className === 'status-pill')) {
        setStatus(item.id, 'cancelled');
      }
    });
    setRunningUI(false);
    cancelBtn.disabled = false;
    runSummary.hidden = true;
  }, 2500);
};

let completedCount = 0;
window.dash.onStatus(({ id, state, message }) => {
  setStatus(id, state, message);
  if (['ready', 'failed', 'unconfirmed', 'cancelled', 'already-open'].includes(state)) {
    completedCount += 1;
    const enabledCount = items.filter((i) => i.enabled).length;
    const pct = Math.min(100, Math.round((completedCount / enabledCount) * 100));
    runSummaryFill.style.width = pct + '%';
  }
});

window.dash.onBlocked(({ id, result }) => {
  const item = items.find((i) => i.id === id);
  const label = item ? item.name : id;
  runSummaryText.textContent = result === 'cancelled'
    ? `Cancelled while waiting on "${label}".`
    : `"${label}" didn't confirm in time — continuing anyway.`;
});

window.dash.onDone(() => {
  clearTimeout(cancelFallbackTimer);
  setRunningUI(false);
  cancelBtn.disabled = false;
  completedCount = 0;
  if (!runSummary.hidden) runSummaryText.textContent = 'Done';
  setTimeout(() => { runSummary.hidden = true; }, 4000);
});

// ---------- Init ----------

(async () => {
  items = await window.dash.loadItems();
  render();
})();
