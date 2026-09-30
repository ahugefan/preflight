const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Fixed data location so it is the same on every machine: %APPDATA%\Stream Startup Dashboard
app.setPath('userData', path.join(app.getPath('appData'), 'Stream Startup Dashboard'));

const ITEMS_FILE = path.join(app.getPath('userData'), 'items.json');
const DEFAULT_ITEMS_FILE = path.join(__dirname, 'items.default.json');

let mainWindow;
let cancelRequested = false;

function loadItems() {
  try {
    if (fs.existsSync(ITEMS_FILE)) {
      return JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Failed to read items.json, falling back to defaults:', err);
  }
  const defaults = JSON.parse(fs.readFileSync(DEFAULT_ITEMS_FILE, 'utf-8'));
  saveItems(defaults);
  return defaults;
}

function saveItems(items) {
  fs.writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 800,
    minWidth: 480,
    minHeight: 500,
    backgroundColor: '#15171c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- IPC: item CRUD ----------

ipcMain.handle('items:load', () => loadItems());

ipcMain.handle('items:save', (_evt, items) => {
  saveItems(items);
  return true;
});

ipcMain.handle('items:pickExe', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select application',
    properties: ['openFile'],
    filters: [{ name: 'Executables', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('items:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select working directory',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---------- Process verification helpers (Windows-only) ----------

function checkProcessByName(processName) {
  return new Promise((resolve) => {
    if (!processName) return resolve(false);
    const cmd = `tasklist /FI "IMAGENAME eq ${processName}" /FO CSV /NH`;
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
    });
  });
}

function checkProcessByCommandLineSubstring(substring, hostProcessName) {
  return new Promise((resolve) => {
    if (!substring) return resolve(false);
    // Cheap first pass: is there even a host process (e.g. node.exe) running at all?
    // Only pay for the expensive WMI command-line query if there's a candidate —
    // this is the common case early in a poll loop, before the app has opened.
    const host = hostProcessName || 'node.exe';
    checkProcessByName(host).then((hostRunning) => {
      if (!hostRunning) return resolve(false);
      const escaped = substring.replace(/'/g, "''");
      const psCmd = `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"Name='${host}'\\" | Where-Object { $_.CommandLine -ne $null -and $_.CommandLine -like '*${escaped}*' } | Select-Object -First 1 -ExpandProperty ProcessId"`;
      exec(psCmd, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
        if (err) return resolve(false);
        resolve(stdout.trim().length > 0);
      });
    });
  });
}

function basename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

// Users commonly paste paths copied via Windows' "Copy as path" (which wraps them in
// literal quote marks) or with trailing whitespace — both make a real file "not found".
function cleanPathValue(v) {
  if (!v) return '';
  let s = String(v).trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s;
}

function guessHostProcessName(command) {
  if (!command) return 'node.exe';
  const first = command.trim().split(/\s+/)[0];
  const base = basename(first);
  return base.toLowerCase().endsWith('.exe') ? base : `${base}.exe`;
}

// Single source of truth for "is this item's target currently running?" — used both
// as a pre-launch guard (so we never open a second copy) and inside the poll loop.
async function checkFound(item) {
  if (item.type === 'command') {
    const host = guessHostProcessName(item.command);
    return checkProcessByCommandLineSubstring(item.processMatch || item.command, host);
  }
  if (item.type === 'exe') {
    const procName = item.processName && item.processName.trim()
      ? cleanPathValue(item.processName)
      : basename(cleanPathValue(item.path));
    return checkProcessByName(procName);
  }
  return false; // URLs aren't deduped — reopening one just refocuses/reloads a tab, harmless
}

// Sleeps for `ms` but wakes early (and returns) the moment cancelRequested flips true,
// so a click on Cancel is never stuck waiting out a full poll interval.
function cancellableSleep(ms) {
  return new Promise((resolve) => {
    const step = 100;
    let waited = 0;
    const tick = () => {
      if (cancelRequested || waited >= ms) return resolve();
      waited += step;
      setTimeout(tick, step);
    };
    tick();
  });
}

async function verifyItem(item, timeoutMs, onTick) {
  if (item.type === 'url') return 'ready'; // no process to verify; opening it is the whole job
  const start = Date.now();
  const pollInterval = 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (cancelRequested) return 'cancelled';
    const found = await checkFound(item);
    if (cancelRequested) return 'cancelled';
    if (found) return 'ready';
    if (Date.now() - start > timeoutMs) return 'timeout';
    if (onTick) onTick(Date.now() - start);
    await cancellableSleep(pollInterval);
  }
}

function launchItem(item) {
  return new Promise((resolve, reject) => {
    try {
      if (item.type === 'exe') {
        const cleanPath = cleanPathValue(item.path);
        if (!cleanPath) return reject(new Error('No path configured'));
        const args = item.args ? cleanPathValue(item.args).split(' ').filter(Boolean) : [];
        const cleanCwd = cleanPathValue(item.cwd);
        const child = spawn(cleanPath, args, {
          cwd: cleanCwd || path.dirname(cleanPath),
          detached: true,
          stdio: 'ignore'
        });
        let settled = false;
        child.once('spawn', () => { settled = true; child.unref(); resolve(); });
        child.once('error', (err) => { if (!settled) { settled = true; reject(err); } });
      } else if (item.type === 'command') {
        const cleanCommand = cleanPathValue(item.command);
        if (!cleanCommand) return reject(new Error('No command configured'));
        const cleanCwd = cleanPathValue(item.cwd);
        const child = spawn(cleanCommand, {
          cwd: cleanCwd || undefined,
          detached: true,
          shell: true,
          stdio: 'ignore'
        });
        let settled = false;
        child.once('spawn', () => { settled = true; child.unref(); resolve(); });
        child.once('error', (err) => { if (!settled) { settled = true; reject(err); } });
      } else if (item.type === 'url') {
        const cleanUrl = cleanPathValue(item.url);
        if (!cleanUrl) return reject(new Error('No URL configured'));
        shell.openExternal(cleanUrl).then(resolve).catch(reject);
      } else {
        reject(new Error('Unknown item type'));
      }
    } catch (err) {
      reject(err);
    }
  });
}

function buildSequence(items) {
  const enabled = items.filter((i) => i.enabled);
  const firstGroup = enabled.filter((i) => i.mode === 'first');
  const middleGroup = enabled.filter((i) => i.mode === 'normal' || i.mode === 'wait');
  const lastGroup = enabled.filter((i) => i.mode === 'last');
  return [...firstGroup, ...middleGroup, ...lastGroup];
}

ipcMain.handle('launch:start', async (evt) => {
  cancelRequested = false;
  const items = loadItems();
  const sequence = buildSequence(items);
  const send = (channel, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  };

  const backgroundVerifications = [];

  const runVerification = async (item) => {
    send('launch:status', { id: item.id, state: 'verifying' });
    const result = await verifyItem(item, item.verifyTimeoutMs || 15000, (elapsed) => {
      send('launch:progress', { id: item.id, elapsedMs: elapsed });
    });
    if (result === 'ready') {
      send('launch:status', { id: item.id, state: 'ready' });
    } else if (result === 'timeout') {
      send('launch:status', { id: item.id, state: 'unconfirmed' });
    } else if (result === 'cancelled') {
      send('launch:status', { id: item.id, state: 'cancelled' });
    }
    return result;
  };

  for (const item of sequence) {
    if (cancelRequested) {
      send('launch:status', { id: item.id, state: 'cancelled' });
      continue;
    }

    const alreadyRunning = await checkFound(item);
    if (alreadyRunning) {
      // Don't open a second copy — it's already open, so this item is already satisfied,
      // regardless of whether it's set to first/normal/wait/last.
      send('launch:status', { id: item.id, state: 'already-open' });
      continue;
    }

    send('launch:status', { id: item.id, state: 'launching' });
    try {
      await launchItem(item);
    } catch (err) {
      send('launch:status', { id: item.id, state: 'failed', message: err.message });
      continue;
    }

    if (item.mode === 'wait') {
      // Blocking item: hold the whole sequence here until verified (or timed out).
      const result = await runVerification(item);
      if (result !== 'ready') {
        send('launch:blocked', { id: item.id, result });
      }
    } else {
      // Non-blocking: verify in the background, sequence moves on immediately.
      backgroundVerifications.push(runVerification(item));
    }
  }

  await Promise.all(backgroundVerifications);
  send('launch:done', {});
  return true;
});

ipcMain.handle('launch:cancel', () => {
  cancelRequested = true;
  return true;
});
