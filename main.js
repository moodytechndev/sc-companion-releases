const { app, BrowserWindow, ipcMain, globalShortcut, Notification, nativeImage, Tray, Menu, dialog, shell } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store();
let mainWindow;
let tray = null;

const CURRENT_VERSION = require('./package.json').version;
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let _lastToggle = 0;
function toggleWindow() {
  const now = Date.now();
  if (now - _lastToggle < 300) return;
  _lastToggle = now;
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.moveTop();
    mainWindow.focus();
  }
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('SC Companion — click to show/hide');
  tray.on('click', toggleWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide Overlay', click: toggleWindow },
    { type: 'separator' },
    { label: 'Quit SC Companion', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// ─── Game log watcher ─────────────────────────────────────────────────────────
function detectLogPath() {
  const candidates = [
    'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\game.log',
    'C:\\Program Files (x86)\\Roberts Space Industries\\StarCitizen\\LIVE\\game.log',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return '';
}

let logWatcher = null;
let logPos = 0;
let logWatchPath = '';
let lastKnownLocation = '';
let lastKioskFire = 0;

const LOCATION_MAP = {
  // Stanton — ARC-L rest stops
  'RR_ARC_L1': 'ARC-L1 Wide Forest',
  'RR_ARC_L2': 'ARC-L2 Lively Pathway',
  'RR_ARC_L3': 'ARC-L3 Modern Express',
  'RR_ARC_L4': 'ARC-L4 Faint Glen',
  'RR_ARC_L5': 'ARC-L5 Distant Dream',
  // Stanton — CRU-L rest stops
  'RR_CRU_L1': 'CRU-L1 Ambitious Dream',
  'RR_CRU_L2': 'CRU-L2 Ambitious Reserve',
  'RR_CRU_L3': 'CRU-L3 Stanton Gateway',
  'RR_CRU_L4': 'CRU-L4 Celestial Acres',
  'RR_CRU_L5': 'CRU-L5 Beautiful Glen',
  // Stanton — HUR-L rest stops
  'RR_HUR_L1': 'HUR-L1 Green Glade',
  'RR_HUR_L2': 'HUR-L2 Faithful Dream',
  'RR_HUR_L3': 'HUR-L3 Thundering Express',
  'RR_HUR_L4': 'HUR-L4 Melodic Fields',
  'RR_HUR_L5': 'HUR-L5 High Course',
  // Stanton — MIC-L rest stops
  'RR_MIC_L1': 'MIC-L1 Shallow Frontier',
  'RR_MIC_L2': 'MIC-L2 Long Forest',
  'RR_MIC_L3': 'MIC-L3 Endless Odyssey',
  'RR_MIC_L4': 'MIC-L4 Shallow Fields',
  'RR_MIC_L5': 'MIC-L5 Modern Icarus',
  // Stanton — orbit/surface stations
  'PT':        'Port Tressler',
  'LEVSKI':    'Levski',
  // Pyro — rest stops
  'RR_PYR_L1': 'Pyro Gateway',
  'RR_PYR_L2': 'Ruin Station',
  'RR_PYR_L3': 'Patch City',
  'RR_PYR_L4': 'Orbituary',
  'RR_PYR_L5': 'Checkmate',
};

function startLogWatcher(filePath) {
  if (logWatcher) { try { logWatcher.close(); } catch {} logWatcher = null; }
  logWatchPath = filePath || '';

  if (!logWatchPath || !fs.existsSync(logWatchPath)) {
    console.log('[LogWatcher] Not found or no path set:', logWatchPath);
    return;
  }

  try {
    logPos = fs.statSync(logWatchPath).size;
  } catch { logPos = 0; }

  try {
    logWatcher = fs.watch(logWatchPath, (event) => {
      if (event !== 'change') return;
      try {
        const stat = fs.statSync(logWatchPath);
        if (stat.size < logPos) logPos = 0;
        if (stat.size <= logPos) return;

        const len = stat.size - logPos;
        const buf = Buffer.alloc(len);
        const fd = fs.openSync(logWatchPath, 'r');
        fs.readSync(fd, buf, 0, len, logPos);
        fs.closeSync(fd);
        logPos = stat.size;

        const text = buf.toString('utf8');

        // Track current station location
        const locMatch = text.match(/requested inventory for Location\[(\w+)\]/);
        if (locMatch) {
          const code = locMatch[1];
          lastKnownLocation = LOCATION_MAP[code] || code.replace(/_/g, '-');
        }

        // Kiosk detection commented out — unreliable, revisit later
        // if (text.includes('populating refinery list flash')) {
        //   const now = Date.now();
        //   if (now - lastKioskFire > 30000) {
        //     lastKioskFire = now;
        //     if (mainWindow && !mainWindow.isDestroyed()) {
        //       mainWindow.webContents.send('log:refineryKioskDetected', lastKnownLocation);
        //       if (!mainWindow.isVisible()) { mainWindow.show(); mainWindow.focus(); }
        //     }
        //   }
        // }

        // Completion detection commented out — regex needs validation against live logs
        // const completionMatches = [...text.matchAll(/A Refinery Work Order has been Completed at ([^":\n]+?)[\s:"]+/g)];
        // for (const m of completionMatches) {
        //   const station = m[1].trim();
        //   if (mainWindow && !mainWindow.isDestroyed()) {
        //     mainWindow.webContents.send('log:refineryJobComplete', station);
        //     if (!mainWindow.isVisible()) { mainWindow.show(); mainWindow.focus(); }
        //   }
        // }
      } catch (e) {
        console.error('[LogWatcher] Read error:', e.message);
      }
    });

    logWatcher.on('error', (e) => {
      console.error('[LogWatcher] Watch error:', e.message);
      logWatcher = null;
    });

    console.log('[LogWatcher] Watching', logWatchPath, '@ byte', logPos);
  } catch (e) {
    console.error('[LogWatcher] Failed to start:', e.message);
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SC-Companion/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON response')); }
      });
    }).on('error', reject);
  });
}

function saveBounds() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    store.set('windowBounds', mainWindow.getBounds());
  }
}

function createWindow() {
  const savedBounds = store.get('windowBounds') || {};
  mainWindow = new BrowserWindow({
    width:  savedBounds.width  || 440,
    height: savedBounds.height || 620,
    x:      savedBounds.x,
    y:      savedBounds.y,
    minWidth: 380,
    minHeight: 400,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.on('moved',   saveBounds);
  mainWindow.on('resized', saveBounds);

  mainWindow.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    const behavior = store.get('closeBehavior', 'tray');
    if (behavior === 'quit') {
      app.isQuitting = true;
      app.quit();
    } else {
      mainWindow.hide();
    }
  });
}

const VK_TO_ACCEL = {
  '2D': 'Insert', '77': 'F8',  '78': 'F9',  '79': 'F10',
  '7A': 'F11',   '91': 'ScrollLock', '13': 'Pause', '24': 'Home', '23': 'End',
};

function registerShortcut(vkHex) {
  globalShortcut.unregisterAll();
  const accel = VK_TO_ACCEL[vkHex];
  if (accel) {
    try { globalShortcut.register(accel, toggleWindow); } catch {}
  }
}

app.whenReady().then(() => {
  createWindow();
  buildTray();

  const savedVK = store.get('hotkeyVK', '2D');
  registerShortcut(savedVK);

  ipcMain.handle('shortcut:get', () => store.get('hotkeyVK', '2D'));
  ipcMain.handle('shortcut:set', (_, vkHex) => {
    store.set('hotkeyVK', vkHex);
    registerShortcut(vkHex);
    return true;
  });

  const logPath = store.get('logPath') || detectLogPath();
  startLogWatcher(logPath);

  setTimeout(() => autoUpdater.checkForUpdates(), 5000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ─── IPC: Store ───────────────────────────────────────────────────────────────
ipcMain.handle('store:getJobs', () => store.get('jobs', []));
ipcMain.handle('store:setJobs', (_, jobs) => { store.set('jobs', jobs); });
ipcMain.handle('store:get', (_, key, def) => { const v = store.get(key); return v !== undefined ? v : (def !== undefined ? def : null); });
ipcMain.handle('store:set', (_, key, val) => { store.set(key, val); });

// ─── IPC: UEX Corp API ────────────────────────────────────────────────────────
ipcMain.handle('api:getCommodities', async () => {
  try {
    return await fetchJson('https://api.uexcorp.space/2.0/commodities');
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getCommodityPrices', async (_, { id, type }) => {
  try {
    return await fetchJson(
      `https://api.uexcorp.space/2.0/commodities_prices?id_commodity=${id}&type=${type || 'sell'}`
    );
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

// ─── IPC: Window ──────────────────────────────────────────────────────────────
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:close', () => {
  const behavior = store.get('closeBehavior', 'tray');
  if (behavior === 'quit') {
    app.isQuitting = true;
    app.quit();
  } else {
    mainWindow?.hide();
  }
});
ipcMain.handle('window:setOpacity', (_, opacity) => mainWindow?.setOpacity(opacity));
ipcMain.handle('window:setAlwaysOnTop', (_, v) => mainWindow?.setAlwaysOnTop(v));

// ─── IPC: Notifications ───────────────────────────────────────────────────────
ipcMain.handle('notify', (_, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show();
  }
});

// ─── IPC: Log watcher ─────────────────────────────────────────────────────────
ipcMain.handle('log:getPath', () => store.get('logPath') || detectLogPath() || '');
ipcMain.handle('log:setPath', (_, p) => {
  store.set('logPath', p);
  startLogWatcher(p);
});
ipcMain.handle('log:getStatus', () => ({
  watching: !!logWatcher,
  path: logWatchPath,
}));

// ─── Auto-updater ────────────────────────────────────────────────────────────
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('updater:available', { version: info.version });
});
autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('updater:progress', { percent: Math.round(progress.percent) });
});
autoUpdater.on('update-downloaded', () => {
  mainWindow?.webContents.send('updater:downloaded');
});
autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater]', err.message);
});

ipcMain.handle('app:getVersion', () => CURRENT_VERSION);
ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate());
ipcMain.handle('updater:install', () => { autoUpdater.quitAndInstall(); });
ipcMain.handle('shell:openExternal', (_, url) => { shell.openExternal(url); });

// ─── IPC: Data export / import ────────────────────────────────────────────────
const EXPORT_KEYS = ['jobs', 'craftInventory', 'craftingOwned', 'closeBehavior', 'hotkeyVK', 'logPath', 'language'];

const VALID_LANGS = new Set(['en', 'de', 'fr', 'es']);
const VALID_CLOSE = new Set(['tray', 'quit']);
const VK_RE = /^[0-9a-fA-F]{2}$/;

function validateImport(data) {
  if (data.jobs !== undefined && !Array.isArray(data.jobs)) return 'jobs must be an array';
  if (data.craftInventory !== undefined && !Array.isArray(data.craftInventory)) return 'craftInventory must be an array';
  if (data.craftingOwned !== undefined && (typeof data.craftingOwned !== 'object' || Array.isArray(data.craftingOwned))) return 'craftingOwned must be an object';
  if (data.closeBehavior !== undefined && !VALID_CLOSE.has(data.closeBehavior)) return 'closeBehavior must be "tray" or "quit"';
  if (data.hotkeyVK !== undefined && !VK_RE.test(data.hotkeyVK)) return 'hotkeyVK must be a 2-char hex string';
  if (data.logPath !== undefined && typeof data.logPath !== 'string') return 'logPath must be a string';
  if (data.language !== undefined && !VALID_LANGS.has(data.language)) return 'language must be en, de, fr, or es';
  return null;
}

ipcMain.handle('data:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export SC Companion Data',
    defaultPath: `sc-companion-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'SC Companion Backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  const data = {};
  for (const key of EXPORT_KEYS) {
    const val = store.get(key);
    if (val !== undefined) data[key] = val;
  }
  try {
    fs.writeFileSync(result.filePath, JSON.stringify({ version: 1, exported: new Date().toISOString(), data }, null, 2), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('data:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import SC Companion Data',
    filters: [{ name: 'SC Companion Backup', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'Invalid backup file format' };
    const importData = parsed.data || parsed;
    if (typeof importData !== 'object' || importData === null) return { ok: false, error: 'Invalid backup file format' };
    const validationError = validateImport(importData);
    if (validationError) return { ok: false, error: `Validation failed: ${validationError}` };
    for (const key of EXPORT_KEYS) {
      if (importData[key] !== undefined) store.set(key, importData[key]);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
