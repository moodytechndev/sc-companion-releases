const { app, BrowserWindow, ipcMain, globalShortcut, Notification, nativeImage, Tray, Menu } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');

const store = new Store();
let mainWindow;
let tray = null;

let _lastToggle = 0;
function toggleWindow() {
  const now = Date.now();
  if (now - _lastToggle < 300) return; // debounce: both globalShortcut + KeyHook may fire
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
const DEFAULT_LOG_PATH = 'E:\\Program\\StarCitizen\\LIVE\\game.log';
let logWatcher = null;
let logPos = 0;
let logWatchPath = '';
let lastKnownLocation = '';
let lastKioskFire = 0;

const LOCATION_MAP = {
  'RR_CRU_L1': 'CRU-L1 Ambitious Dream',
  'RR_CRU_L5': 'CRU-L5 Beautiful Glen',
  'RR_ARC_L1': 'ARC-L1 Wide Forest',
  'RR_ARC_L2': 'ARC-L2 Lively Pathway',
  'RR_HUR_L1': 'HUR-L1 Green Glade',
  'RR_HUR_L2': 'HUR-L2 Faithful Dream',
  'RR_MIC_L1': 'MIC-L1 Shallow Frontier',
  'RR_MIC_L5': 'MIC-L5 Modern Icarus',
  'PT':        'Port Tressler',
  'RR_PYR_L1': 'Pyro Gateway',
  'RR_PYR_L2': 'Ruin Station',
  'RR_PYR_L4': 'Orbituary',
  'RR_PYR_L5': 'Checkmate',
};

function startLogWatcher(filePath) {
  if (logWatcher) { try { logWatcher.close(); } catch {} logWatcher = null; }
  logWatchPath = filePath || DEFAULT_LOG_PATH;

  if (!fs.existsSync(logWatchPath)) {
    console.log('[LogWatcher] Not found:', logWatchPath);
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
        if (stat.size < logPos) logPos = 0; // log rotated/restarted
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

        // Fires when refinery kiosk UI opens (debounced to 30s)
        if (text.includes('populating refinery list flash')) {
          const now = Date.now();
          if (now - lastKioskFire > 30000) {
            lastKioskFire = now;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('log:refineryKioskDetected', lastKnownLocation);
              if (!mainWindow.isVisible()) {
                mainWindow.show();
                mainWindow.focus();
              }
            }
          }
        }

        // "A Refinery Work Order has been Completed at <Station>: "
        const completionMatches = [...text.matchAll(/A Refinery Work Order has been Completed at ([^":\n]+?)[\s:"]+/g)];
        for (const m of completionMatches) {
          const station = m[1].trim();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('log:refineryJobComplete', station);
            if (!mainWindow.isVisible()) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        }
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 620,
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

// ── Hotkey: globalShortcut (non-SC focus) + elevated scheduled task (SC focus) ──
const { exec }  = require('child_process');
const net       = require('net');

const HOOK_TASK = 'SCCompanionHook';
const HOOK_CFG  = path.join(os.tmpdir(), 'sc-companion-hook.cfg');

const VK_TO_ACCEL = {
  '2D': 'Insert', '77': 'F8',  '78': 'F9',  '79': 'F10',
  '7A': 'F11',   '91': 'ScrollLock', '13': 'Pause', '24': 'Home', '23': 'End',
};

// TCP server — KeyHook.exe (elevated) connects here and sends "TOGGLE\n".
// TCP is not subject to UIPI; works across privilege levels on localhost.
let _hookServer = null;
let _hookPort   = 0;

function startHookServer() {
  return new Promise((resolve) => {
    if (_hookServer) { _hookServer.close(); _hookServer = null; }
    _hookServer = net.createServer((socket) => {
      socket.on('data', (d) => { if (d.toString().includes('TOGGLE')) toggleWindow(); });
      socket.on('error', () => {});
    });
    _hookServer.on('error', () => resolve(0));
    _hookServer.listen(0, '127.0.0.1', () => {
      _hookPort = _hookServer.address().port;
      console.log('[KeyHook] TCP server on port', _hookPort);
      resolve(_hookPort);
    });
  });
}

let _hookRestartTimer = null;

async function startKeyHook(vkHex) {
  // 1. globalShortcut — works when SC does NOT have focus
  globalShortcut.unregisterAll();
  const accel = VK_TO_ACCEL[vkHex];
  if (accel) try { globalShortcut.register(accel, toggleWindow); } catch {}

  // 2. Start TCP server and write config so KeyHook.exe knows VK + port
  const port = await startHookServer();
  try { fs.writeFileSync(HOOK_CFG, `${vkHex}\n${port}\n`, 'utf8'); } catch {}

  // 3. Kill any running instance, then fire the elevated scheduled task.
  //    If the task doesn't exist yet, create it first (one-time admin prompt).
  const exePath = path.join(__dirname, 'KeyHook.exe').replace('app.asar', 'app.asar.unpacked');

  exec(`schtasks /end /tn "${HOOK_TASK}"`, () => {
    setTimeout(() => {
      exec(`schtasks /run /tn "${HOOK_TASK}"`, (runErr) => {
        if (!runErr) {
          console.log('[KeyHook] Elevated task started');
          return;
        }
        // Task not installed — create it now (requires admin → UAC prompt once)
        console.log('[KeyHook] Task missing, creating via elevated PowerShell…');
        const bat = path.join(os.tmpdir(), 'sc-hook-setup.bat');
        try {
          fs.writeFileSync(bat,
            `@echo off\r\nschtasks /create /tn "SCCompanionHook" /tr "${exePath}" /sc onlogon /rl highest /f\r\n`);
        } catch {}
        exec(`powershell -WindowStyle Hidden -Command "Start-Process cmd -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '/c ${bat}'"`,
          (psErr) => {
            if (!psErr) setTimeout(() => exec(`schtasks /run /tn "${HOOK_TASK}"`, () => {}), 1000);
          });
      });
    }, 500); // let /end finish before /run
  });

  // 4. Keep-alive: schtasks /run every 30s; mutex in KeyHook.exe prevents duplicates
  if (_hookRestartTimer) clearInterval(_hookRestartTimer);
  _hookRestartTimer = setInterval(() => {
    if (!app.isQuitting) exec(`schtasks /run /tn "${HOOK_TASK}"`, () => {});
  }, 30000);

  console.log('[KeyHook] Armed: accel=' + (accel || 'none') + ' VK=0x' + vkHex + ' port=' + port);
}

function stopKeyHook() {
  if (_hookRestartTimer) { clearInterval(_hookRestartTimer); _hookRestartTimer = null; }
  globalShortcut.unregisterAll();
  exec(`schtasks /end /tn "${HOOK_TASK}"`, () => {});
  if (_hookServer) { _hookServer.close(); _hookServer = null; }
}

app.whenReady().then(() => {
  createWindow();

  buildTray();

  const savedVK = store.get('hotkeyVK', '2D');
  startKeyHook(savedVK);

  ipcMain.handle('shortcut:get', () => store.get('hotkeyVK', '2D'));
  ipcMain.handle('shortcut:set', (_, vkHex) => {
    store.set('hotkeyVK', vkHex);
    startKeyHook(vkHex);
    return true;
  });

  app.on('will-quit', () => stopKeyHook());

  startLogWatcher(store.get('logPath', DEFAULT_LOG_PATH));
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
ipcMain.handle('log:getPath', () => store.get('logPath', DEFAULT_LOG_PATH));
ipcMain.handle('log:setPath', (_, p) => {
  store.set('logPath', p);
  startLogWatcher(p);
});
ipcMain.handle('log:getStatus', () => ({
  watching: !!logWatcher,
  path: logWatchPath,
}));
