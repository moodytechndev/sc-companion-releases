const { app, BrowserWindow, ipcMain, globalShortcut, Notification, nativeImage, Tray, Menu, dialog, shell, desktopCapturer, screen } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const Store = require('electron-store');
const { createWorker } = require('tesseract.js');

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

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SC-Companion/1.0' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume(); // drain so the socket can be reused
        reject(new Error(`Request failed with status ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
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

  const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
  setTimeout(() => autoUpdater.checkForUpdates(), 5000);
  setInterval(() => {
    if (!_updateAvailable) autoUpdater.checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (_ocrWorker) { _ocrWorker.terminate().catch(() => {}); }
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

ipcMain.handle('api:getTerminals', async () => {
  try {
    const res = await fetchJson('https://api.uexcorp.space/2.0/terminals?id_star_system=68');
    return { status: 'ok', data: res.data || [] };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getTerminalPrices', async (_, { id_terminal }) => {
  try {
    return await fetchJson(
      `https://api.uexcorp.space/2.0/commodities_prices?id_terminal=${id_terminal}`
    );
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getBulkPrices', async () => {
  try {
    // Try a single unfiltered call first — returns all buy+sell records
    const all = await fetchJson('https://api.uexcorp.space/2.0/commodities_prices');
    const rows = all.data || [];
    if (rows.length > 0) {
      return { status: 'ok', rows };
    }
    // Fallback: two typed calls
    const [sell, buy] = await Promise.all([
      fetchJson('https://api.uexcorp.space/2.0/commodities_prices?type=sell'),
      fetchJson('https://api.uexcorp.space/2.0/commodities_prices?type=buy'),
    ]);
    return { status: 'ok', rows: [...(sell.data || []), ...(buy.data || [])] };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getCommodityPricesBatch', async (_, { ids }) => {
  try {
    const results = await Promise.all(
      ids.map(id => fetchJson(`https://api.uexcorp.space/2.0/commodities_prices?id_commodity=${id}`))
    );
    const rows = results.flatMap(r => r.data || []);
    return { status: 'ok', rows };
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
ipcMain.handle('window:setResizable', (_, v) => {
  if (!mainWindow) return;
  mainWindow.setResizable(v);
  if (!v) {
    const [w, h] = mainWindow.getSize();
    mainWindow.setMinimumSize(w, h);
    mainWindow.setMaximumSize(w, h);
  } else {
    mainWindow.setMinimumSize(380, 400);
    mainWindow.setMaximumSize(0, 0);
  }
});

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

// ─── IPC: Refinery job screen capture (OCR) ────────────────────────────────────
// No reliable log-based signal exists for job start (SC doesn't emit it), so this
// is a manual, user-triggered alternative: grab the screen, OCR it, and best-effort
// parse out job fields. The renderer always treats this as a pre-fill, never a
// silent auto-submit — the user reviews/edits the Add Job form before starting it.
let _ocrWorker = null;
async function getOcrWorker() {
  if (!_ocrWorker) {
    _ocrWorker = await createWorker('eng');
  }
  return _ocrWorker;
}

// Parsing rules, tuned against real refinery-terminal screenshots (setup screen,
// after a processing method is chosen — that's the state that actually shows a
// duration and cost; the pre-selection state shows "--" for both).
//
// Two lessons from those screenshots drive the approach here:
// 1. The station's left-hand "Material Specializations" sidebar lists ~6 ore
//    names totally unrelated to the active job (it's the station's general yield
//    bonus table). A blind whole-screen search for known ore names picks those up
//    as false positives. So material extraction is anchored on the "MATERIALS
//    SELECTED" label, which only appears in the job panel, never the sidebar.
// 2. Refinery jobs aren't limited to mined ore — one real job had "Construction
//    Pieces" (ship salvage) as the material. A closed ore whitelist misses that
//    entirely, so matching now covers a broader material list, and duration uses
//    the in-game "32m 0s" letter-suffixed format, not HH:MM:SS.
const REFINERY_METHODS = [
  'Cormack Method', 'Dinyx Solventation', 'Electrostarolysis', 'Ferron Exchange',
  'Gaskin Process', 'Kazen Winnowing', 'Pyrometric Chromalysis',
  'Thermonatic Deposition', 'XCR Reaction',
];
const KNOWN_MATERIALS = [
  'Agricium', 'Aluminum', 'Beryl', 'Bexalite', 'Borase', 'Carbon', 'Chlorine',
  'Copper', 'Corundum', 'Diamond', 'Fluorine', 'Gold', 'Hadanite', 'Hephaestanite',
  'Hydrogen', 'Ice', 'Inertite', 'Iron', 'Laranite', 'Quantainium', 'Quartz',
  'Silicon', 'Stileron', 'Taranite', 'Tin', 'Titanium', 'Tungsten',
  'Construction Pieces', 'Construction Rubble', 'Construction Salvage',
  'Construction Materials', 'Scrap', 'Waste',
  'Recycled Material Composite', 'Inert Materials',
];

// Method names are safe to substring-match across the whole screen — unlike ore
// names, they don't also appear in the sidebar.
function extractMethod(lowerText) {
  for (const m of REFINERY_METHODS) {
    if (lowerText.includes(m.toLowerCase())) return m;
  }
  return null;
}

// Column headers/labels are two or three words wide (e.g. "MATERIALS SELECTED"),
// and a column narrower than the label can make Tesseract wrap it onto its own
// line — the literal character between the words then becomes a newline instead
// of a space, which an exact-substring search (`indexOf('materials selected')`)
// would silently fail to find. Every multi-word anchor below matches on flexible
// whitespace (`\s+`, which matches newlines too) instead, for that reason.
function findLabel(lowerText, pattern, fromIndex = 0) {
  const m = lowerText.slice(fromIndex).match(pattern);
  if (!m) return null;
  const start = fromIndex + m.index;
  return { start, end: start + m[0].length };
}

// In-game format is "32m 0s" / "1h 5m 30s" (letters, not colons). This used to
// anchor on the "PROCESSING TIME" label, but real captures show that label is
// almost never OCR'd intact ("iis TIME", "EROGESSING JHE") even when the actual
// duration digits right next to it come through fine — so this searches the
// whole text for an h+m(+s) or m+s cluster instead of requiring the label.
// Requiring two adjacent units (not just a lone "12m") is what keeps this from
// matching an unrelated stray number elsewhere on screen.
function extractDuration(text) {
  let m = text.match(/(\d{1,3})\s*h[^a-zA-Z0-9]{0,6}(\d{1,2})\s*m(?:[^a-zA-Z0-9]{0,6}(\d{1,2})\s*s)?\b/i);
  if (m) return { h: parseInt(m[1], 10), m: parseInt(m[2], 10), s: m[3] ? parseInt(m[3], 10) : 0 };
  m = text.match(/(\d{1,3})\s*m[^a-zA-Z0-9]{0,6}(\d{1,2})\s*s\b/i);
  if (m) return { h: 0, m: parseInt(m[1], 10), s: parseInt(m[2], 10) };
  return null;
}

// The "MATERIALS SELECTED / QUALITY / QTY / YIELD / REFINE" column headers sit on
// the same visual row as (and sometimes the same OCR line as) "MATERIALS SELECTED"
// itself, so anchoring there and taking "whatever comes next" risks grabbing the
// header remainder instead of the actual material row. "REFINE" is the last header
// column — anchor past *that* instead, so the search always starts at the data row.
function materialRowStart(lowerText, fromIdx) {
  const refine = findLabel(lowerText, /refine/, fromIdx);
  return refine ? refine.end : fromIdx;
}

// Anchored on "MATERIALS SELECTED" (unique to the job panel) rather than a blind
// scan, to avoid the sidebar false-positive problem. Handles a materials list
// longer than one screen the same way a single row is handled: each line in the
// block is tried independently, so a frame that only shows rows 3-5 (because the
// user scrolled the in-game list before this shot) still contributes those rows —
// see the burst-capture loop below, which merges rows found across several shots.
// A real material row's line isn't just the name — OCR glues on neighboring UI
// noise ("bie ae CONSTRUCTIONPI", "oil ADDED. TT  TRUCTION PIECES"), and the name
// itself can be clipped at either end (missing "CONS" prefix, or missing "ECES"
// suffix). Whole-line containment breaks on the first, and exact-name containment
// breaks on the second — so this checks whether any long contiguous chunk of the
// known name (spaces stripped from both sides) shows up anywhere in the line.
function fuzzyChunkIncludes(lineCompact, nameCompact) {
  if (lineCompact.includes(nameCompact)) return true;
  const minLen = Math.max(6, Math.floor(nameCompact.length * 0.6));
  for (let len = nameCompact.length; len >= minLen; len--) {
    for (let start = 0; start + len <= nameCompact.length; start++) {
      if (lineCompact.includes(nameCompact.slice(start, start + len))) return true;
    }
  }
  return false;
}

function extractMaterialRows(text, lowerText) {
  const label = findLabel(lowerText, /materials\s+selected/);
  if (!label) return [];
  const from = materialRowStart(lowerText, label.start);
  const totalCost = findLabel(lowerText, /total\s+cost/, from);
  const to = totalCost ? totalCost.start : from + 500; // generous cap for a long scrolled list
  const lines = text.slice(from, to).split('\n').map(s => s.trim()).filter(Boolean);

  const rows = [];
  for (const line of lines) {
    const nums = line.match(/\d+(?:\.\d+)?/g) || [];
    if (nums.length < 3) continue; // not a data row — [QUALITY, QTY, YIELD] per row
    const lineCompact = line.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (lineCompact.length < 3) continue;
    const match = KNOWN_MATERIALS.find(name => fuzzyChunkIncludes(lineCompact, name.toLowerCase().replace(/[^a-z]/g, '')));
    if (!match) continue;
    const tail = nums.slice(-3); // last 3 numbers on the line = quality, qty, yield
    rows.push({ name: match, quality: tail[0], yield: tail[2] });
  }
  return rows;
}

// Real capture confirms the station name sits on the SAME OCR line as the anchor
// ("1 AMBITIOUS DREAM STATION REFINEMENT CENTER"), immediately before "STATION" —
// and that "CENTER" itself is frequently clipped ("REFINEMENT C"), so the anchor
// only requires "refinement". Pulling single/double-letter OCR noise tokens
// ("|", "V7", "1", "§") off that line via a letters-only word filter is what
// isolates the real name — grabbing the whole line (or two) as one blob, as this
// used to, pulls in unrelated UI fragments from earlier on the same line.
function extractNameWords(segment) {
  const words = segment.match(/[a-zA-Z]{3,}/g) || [];
  while (words.length && /^(station|refinement|center)$/i.test(words[words.length - 1])) {
    words.pop();
  }
  return words;
}

// Returned as raw cleaned text, not matched against a location list: the renderer
// owns the definitive station list (the Add Job modal's own dropdown), so it does
// the fuzzy-matching itself rather than main.js duplicating that list.
//
// No same-line-above fallback: an icon frequently overlaps the station name
// entirely (OCR reads it as a single "©" glyph), and when that happens the
// previous line is just unrelated UI text — a real capture proved this by
// returning "pad aie proses TEREST" from two lines up. Returning nothing here
// is safer than returning confident-looking garbage.
function extractLocation(text, lowerText) {
  const label = findLabel(lowerText, /refinement(\s+center)?/);
  if (!label) return null;
  const lineStart = text.lastIndexOf('\n', label.start - 1) + 1;
  const words = extractNameWords(text.slice(lineStart, label.start));
  const candidate = words.slice(-4).join(' ');
  return candidate.length >= 3 ? candidate : null;
}

function parseRefineryOcrText(text) {
  const lowerText = text.toLowerCase();
  return {
    method: extractMethod(lowerText),
    duration: extractDuration(text),
    materials: extractMaterialRows(text, lowerText),
    location: extractLocation(text, lowerText),
    rawText: text,
  };
}

// Live client process name — RSI's launcher is a separate process we don't care about.
const GAME_PROCESS_NAME = 'StarCitizen.exe';

async function isGameRunning() {
  try {
    const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${GAME_PROCESS_NAME}" /FO CSV /NH`);
    return stdout.toLowerCase().includes(GAME_PROCESS_NAME.toLowerCase());
  } catch {
    return false; // tasklist failing shouldn't crash the capture flow — just assume not running
  }
}
ipcMain.handle('game:isRunning', () => isGameRunning());

// Prefer capturing just the game's own window — keeps other monitors/apps out of the
// screenshot (privacy + less OCR noise) and out of any raw text we keep around for
// debugging. Exclusive-fullscreen games sometimes aren't enumerable as a window by
// the OS compositor, so this can come back empty; the caller falls back to full-screen.
async function getGameWindowSource(thumbnailSize) {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize });
  return sources.find(s => s.name.toLowerCase().includes('star citizen')) || null;
}

async function captureOneFrame() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const scale = primaryDisplay.scaleFactor || 1;
  const thumbnailSize = { width: Math.round(width * scale), height: Math.round(height * scale) };

  let source = await getGameWindowSource(thumbnailSize);
  let capturedWindow = true;
  if (!source) {
    // Fallback: game window wasn't enumerable (likely exclusive fullscreen) —
    // capture the whole primary display instead.
    capturedWindow = false;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    if (!sources.length) throw new Error('No screen source available to capture');
    source = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0];
  }

  const dataUrl = source.thumbnail.toDataURL();
  if (!dataUrl || source.thumbnail.isEmpty()) throw new Error('Captured image was empty');

  const worker = await getOcrWorker();
  const { data } = await worker.recognize(dataUrl);
  return { capturedWindow, ...parseRefineryOcrText(data.text || '') };
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Takes several shots a couple seconds apart instead of one, so a materials list
// longer than the screen can be captured by scrolling between shots. Method and
// duration don't change mid-scroll, so the first frame that finds them wins;
// materials are unioned across all frames, deduped by name (first sighting's
// quality/yield kept — scrolling back over an already-seen row shouldn't matter).
const BURST_SHOTS = 4;
const BURST_INTERVAL_MS = 2000;

ipcMain.handle('refinery:captureAndParse', async () => {
  try {
    const running = await isGameRunning();
    if (!running) {
      return { status: 'error', error: 'Star Citizen doesn\'t appear to be running.' };
    }

    let method = null;
    let duration = null;
    let location = null;
    let capturedWindow = true;
    const materialsByName = new Map();
    const rawTexts = []; // kept so the renderer can log/inspect actual OCR output when extraction misses

    for (let i = 0; i < BURST_SHOTS; i++) {
      const frame = await captureOneFrame();
      capturedWindow = frame.capturedWindow;
      if (!method && frame.method) method = frame.method;
      if (!duration && frame.duration) duration = frame.duration;
      if (!location && frame.location) location = frame.location;
      for (const row of frame.materials) {
        if (!materialsByName.has(row.name)) materialsByName.set(row.name, row);
      }
      rawTexts.push(frame.rawText);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('refinery:captureProgress', { current: i + 1, total: BURST_SHOTS });
      }
      if (i < BURST_SHOTS - 1) await delay(BURST_INTERVAL_MS);
    }

    // Written every capture so the user can just open the file and paste its
    // contents back to us, instead of fishing text out of the DevTools console.
    const debugPath = path.join(app.getPath('userData'), 'refinery-ocr-debug.txt');
    try {
      const debugContents = rawTexts
        .map((t, i) => `── Shot ${i + 1}/${rawTexts.length} ──\n${t}`)
        .join('\n\n');
      fs.writeFileSync(debugPath, debugContents, 'utf8');
    } catch { /* debug file is a convenience, never block the capture on it */ }

    return { status: 'ok', capturedWindow, method, duration, location, materials: [...materialsByName.values()], rawTexts, debugPath };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

// ─── Auto-updater ────────────────────────────────────────────────────────────
let _updateAvailable = false;

autoUpdater.on('update-available', (info) => {
  _updateAvailable = true;
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
  mainWindow?.webContents.send('updater:error', { message: err.message });
});

ipcMain.handle('app:getVersion', () => CURRENT_VERSION);
ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate());
ipcMain.handle('updater:install', () => { autoUpdater.quitAndInstall(); });
ipcMain.handle('shell:openExternal', (_, url) => { shell.openExternal(url); });

// ─── IPC: Bug report ──────────────────────────────────────────────────────────
const BUG_WEBHOOK = 'https://discord.com/api/webhooks/1549166537305362532/ygN4GsizQ21ibHHCnCn1wahjgQvgFJ9aZ5ctZj8N9IhChRZSNMLNIEshbDPPyWZEDaVK';
ipcMain.handle('bug:report', async (_, { description }) => {
  const payload = JSON.stringify({
    embeds: [{
      title: '🐛 Bug Report',
      description: String(description || '').slice(0, 1500),
      color: 0xE8AC3C,
      fields: [
        { name: 'Version', value: CURRENT_VERSION, inline: true },
        { name: 'Platform', value: `${process.platform} ${process.getSystemVersion?.() || ''}`.trim(), inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
  return new Promise((resolve, reject) => {
    const url = new URL(BUG_WEBHOOK);
    const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
});

// ─── IPC: Data export / import ────────────────────────────────────────────────
const EXPORT_KEYS = ['jobs', 'craftInventory', 'craftAssets', 'craftingOwned', 'closeBehavior', 'hotkeyVK', 'logPath', 'language'];

const VALID_LANGS = new Set(['en', 'de', 'fr', 'es']);
const VALID_CLOSE = new Set(['tray', 'quit']);
const VK_RE = /^[0-9a-fA-F]{2}$/;

function validateImport(data) {
  if (data.jobs !== undefined && !Array.isArray(data.jobs)) return 'jobs must be an array';
  if (data.craftInventory !== undefined && !Array.isArray(data.craftInventory)) return 'craftInventory must be an array';
  if (data.craftAssets !== undefined && !Array.isArray(data.craftAssets)) return 'craftAssets must be an array';
  if (data.craftingOwned !== undefined && (typeof data.craftingOwned !== 'object' || Array.isArray(data.craftingOwned))) return 'craftingOwned must be an object';
  if (data.closeBehavior !== undefined && !VALID_CLOSE.has(data.closeBehavior)) return 'closeBehavior must be "tray" or "quit"';
  if (data.hotkeyVK !== undefined && !VK_RE.test(data.hotkeyVK)) return 'hotkeyVK must be a 2-char hex string';
  if (data.logPath !== undefined && (typeof data.logPath !== 'string' || data.logPath.length > 500 || /[\x00-\x1f]/.test(data.logPath))) return 'logPath must be a plain file path string';
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
