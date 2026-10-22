const { app, BrowserWindow, ipcMain, globalShortcut, Notification, nativeImage, Tray, Menu, dialog, shell, desktopCapturer, screen, session } = require('electron');
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

// Contracts accepted / ended and blueprints awarded, read from the same log (see contract-log.js).
const { ContractTracker } = require('./contract-log');
const contractTracker = new ContractTracker(store);
// What each contract pays, needs and can award (SCMDB, scmdb.net — see scmdb.js)
const { Scmdb } = require('./scmdb');
let scmdb = null;
const getScmdb = () => scmdb || (scmdb = new Scmdb(app.getPath('userData')));
const sendToWindow = (channel, payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); };

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
  contractTracker.carry = '';

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

        // Contract activity (a failure here must never stop the location tracking below)
        try {
          const res = contractTracker.ingestLive(text);
          if (res.changed) sendToWindow('contracts:updated', null);
          if (res.blueprints.length) sendToWindow('contracts:blueprints', res.blueprints);
        } catch (e) { console.error('[Contracts] parse error:', e.message); }

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
    const req = https.get(url, { headers: { 'User-Agent': 'SC-Companion/1.0', 'Accept': 'application/json' } }, (res) => {
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

// While the Erkul view has the overlay widened, the temporary size must not be
// persisted as the user's real window size.
let preErkulBounds = null;

function saveBounds() {
  if (preErkulBounds) return;
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
      webviewTag: true, // only used for the locked-down Erkul view; see will-attach-webview below
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

// ─── Erkul embed lockdown ─────────────────────────────────────────────────────
// The renderer hosts erkul.games in a <webview>. That guest is untrusted web
// content: no preload, no Node, sandboxed, pinned to erkul.games, no permission
// grants, and anything that tries to open elsewhere goes to the system browser.
const ERKUL_PARTITION = 'persist:erkul';
const ERKUL_HOSTS = new Set(['erkul.games', 'www.erkul.games']);
function isErkulUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && ERKUL_HOSTS.has(p.hostname);
  } catch { return false; }
}

app.on('web-contents-created', (_, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!isErkulUrl(params.src) || params.partition !== ERKUL_PARTITION) event.preventDefault();
  });
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
      if (isErkulUrl(url)) return;
      e.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    });
  }
});

app.whenReady().then(() => {
  session.fromPartition(ERKUL_PARTITION).setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
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

  // the contracts open right now were accepted before the app started: read the current log once so they are listed
  try {
    if (logPath && fs.existsSync(logPath)) {
      const r = contractTracker.importLogs(logPath, { currentOnly: true });
      setTimeout(() => {
        sendToWindow('contracts:updated', null);
        if (r.blueprints.length) sendToWindow('contracts:blueprints', r.blueprints);
      }, 3000);
    }
  } catch (e) { console.error('[Contracts] startup read failed:', e.message); }

  // keep the contract data current once it has been downloaded (the first download waits until the
  // Contracts view is opened); one tiny request unless SCMDB has a newer version
  setTimeout(async () => {
    try {
      if (!getScmdb().status().ok) return;
      const r = await getScmdb().refresh(false);
      if (r.changed) sendToWindow('scmdb:updated', null);
    } catch { /* the stored data stays */ }
  }, 20000);

  const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
  setTimeout(() => autoUpdater.checkForUpdates(), 5000);
  setInterval(() => {
    if (!_updateAvailable) autoUpdater.checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { app.isQuitting = true; });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (_ocrWorker) { _ocrWorker.terminate().catch(() => {}); }
});

// ─── IPC: Store ───────────────────────────────────────────────────────────────
ipcMain.handle('store:getJobs', () => store.get('jobs', []));
ipcMain.handle('store:setJobs', (_, jobs) => { store.set('jobs', jobs); });
ipcMain.handle('store:get', (_, key, def) => { const v = store.get(key); return v !== undefined ? v : (def !== undefined ? def : null); });
ipcMain.handle('store:set', (_, key, val) => { store.set(key, val); });

// ─── Price source: UEX Corp (default) or SC Trade Tools ───────────────────────────
// The renderer asks the same handlers either way; with priceSource = 'sctrader' they
// answer from SC Trade Tools' community feed, shaped like UEX rows (see sctrade-prices.js).
const sctrade = require('./sctrade-prices');
let sctFeed = null;
let uexLists = null;     // UEX commodity + terminal lists, used to resolve SC Trade Tools names
let sctRows = null;      // { key, rows } — the feed as UEX-shaped rows

const usingSctrade = () => store.get('priceSource') === 'sctrader';

async function getUexLists() {
  if (uexLists && Date.now() - uexLists.at < 60 * 60 * 1000) return uexLists;
  const [c, t] = await Promise.all([
    fetchJson('https://api.uexcorp.space/2.0/commodities'),
    fetchJson('https://api.uexcorp.space/2.0/terminals?type=commodity'),
  ]);
  uexLists = {
    at: Date.now(),
    commodities: (c.data || []).filter(x => x.is_available && x.is_visible && !x.is_buggy),
    terminals: (t.data || []).filter(x => x.is_available),
  };
  return uexLists;
}

async function getSctradeRows() {
  if (!sctFeed) {
    sctFeed = new sctrade.SctFeed({ cachePath: path.join(app.getPath('userData'), 'sctrade-feed.json'), version: CURRENT_VERSION });
  }
  await sctFeed.ensureFresh();                 // at most hourly (the server caches 60 min); stale data beats none
  const lists = await getUexLists();
  const key = `${sctFeed.fetchedAt}:${sctFeed.latest.size}:${lists.at}`;
  if (!sctRows || sctRows.key !== key) {
    sctRows = { key, rows: sctrade.entriesToRows(sctFeed.entries(), sctrade.buildResolvers(lists.commodities, lists.terminals)) };
  }
  return sctRows.rows;
}

ipcMain.handle('prices:sourceInfo', () => {
  const info = sctFeed ? sctFeed.info() : { fetchedAt: 0, entries: 0 };
  return { source: usingSctrade() ? 'sctrader' : 'uex', ...info };
});

// ─── IPC: UEX Corp API ────────────────────────────────────────────────────────
ipcMain.handle('api:getCommodities', async () => {
  try {
    return await fetchJson('https://api.uexcorp.space/2.0/commodities');
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getVehicles', async () => {
  try {
    return await fetchJson('https://api.uexcorp.space/2.0/vehicles');
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

// ─── IPC: ship stock loadouts (Star Citizen Wiki API) ─────────────────────────
// UEX's vehicle slug/uuid match the Wiki API's, so a ship picked from UEX can be
// looked up directly. Only the swappable component types a player can actually
// craft are kept, flattened into a small slot list (the raw payload is ~200 KB).
const SHIP_SLOT_KINDS = {
  Shield: 'shield', Cooler: 'cooler', PowerPlant: 'power', QuantumDrive: 'quantum',
  Radar: 'radar', WeaponGun: 'weapon', WeaponMining: 'mining', SalvageHead: 'salvage',
};
const SLOT_GENERIC_NAME = /^hardpoint[_ ]?(class[_ ]?\d+|weapon|gun|mining|salvage)?$/i;

function prettyPortName(name) {
  const raw = String(name || '').replace(/^hardpoint[_ ]?/i, '').replace(/[_]+/g, ' ').trim();
  // "weapon gun class1 right wing" -> "right wing": the weapon/gun/class tokens just echo the slot kind and size.
  const t = raw.replace(/^((weapon|gun)\s+)+/i, '').replace(/class\s?\d+\s*/i, '').trim() || raw;
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Slot';
}

function extractShipSlots(vehicle) {
  const slots = [];
  const walk = (ports, parent, parentKey) => {
    for (const p of ports || []) {
      const key = parentKey ? `${parentKey}/${p.name}` : p.name;
      const kind = SHIP_SLOT_KINDS[p.type];
      const item = p.equipped_item;
      if (kind && p.editable && item) {
        const useParent = parent && SLOT_GENERIC_NAME.test(p.name);
        slots.push({
          key,
          kind,
          label: prettyPortName(useParent ? parent.name : p.name),
          size: p.sizes?.max ?? item.size ?? null,
          sizeMin: p.sizes?.min ?? null,
          stock: {
            name: item.name,
            size: item.size ?? null,
            grade: typeof item.grade === 'string' ? item.grade : null,
            maker: item.manufacturer?.name && item.manufacturer.name !== 'Unknown' ? item.manufacturer.name : '',
          },
        });
      }
      walk(p.ports, p, key);
    }
  };
  walk(vehicle.ports, null, '');
  return slots;
}

// The ship's paint port lists which paints fit it via required_tags
// (e.g. ["Paint_Avenger"]); every paint item carries the same tag.
function extractPaintTag(vehicle) {
  const port = (vehicle.ports || []).find(p => p.name === 'hardpoint_paint' || p.category_label === 'Paints');
  const tag = port?.required_tags?.[0];
  return typeof tag === 'string' && /^[A-Za-z0-9_]+$/.test(tag) ? tag : '';
}

ipcMain.handle('api:getShipLiveries', async (_, tag) => {
  try {
    if (typeof tag !== 'string' || !/^[A-Za-z0-9_]+$/.test(tag)) return { status: 'error', error: 'Invalid livery tag' };
    const out = [];
    for (let page = 1; page <= 6; page++) {
      const res = await fetchJson(
        `https://api.star-citizen.wiki/api/v2/items?filter%5Btype%5D=Paints&filter%5Btags%5D=${encodeURIComponent(tag)}&page%5Bsize%5D=100&page%5Bnumber%5D=${page}`);
      for (const it of res.data || []) {
        const img = (it.images || [])[0];
        const image = img?.thumbnail_url || img?.original_url || '';
        const desc = typeof it.description === 'string' ? it.description : (it.description?.en_EN || '');
        out.push({
          uuid: it.uuid,
          name: it.name,
          source: Array.isArray(it.event_source) ? it.event_source.join(', ') : '',
          image: /^https:\/\//i.test(image) ? image : '',
          description: String(desc).slice(0, 600),
        });
      }
      if (page >= (res.meta?.last_page || 1)) break;
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { status: 'ok', liveries: out };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getShipLoadout', async (_, slug) => {
  try {
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/i.test(slug)) return { status: 'error', error: 'Invalid ship id' };
    const res = await fetchJson(`https://api.star-citizen.wiki/api/v2/vehicles/${encodeURIComponent(slug)}`);
    const vehicle = res.data || res;
    return { status: 'ok', slots: extractShipSlots(vehicle), paintTag: extractPaintTag(vehicle) };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getCommodityPrices', async (_, { id, type }) => {
  try {
    if (usingSctrade()) {
      const dir = type === 'buy' ? 'price_buy' : 'price_sell';
      const rows = await getSctradeRows();
      return { status: 'ok', data: rows.filter(r => String(r.id_commodity) === String(id) && r[dir] > 0) };
    }
    return await fetchJson(
      `https://api.uexcorp.space/2.0/commodities_prices?id_commodity=${id}&type=${type || 'sell'}`
    );
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getTerminals', async () => {
  try {
    const res = await fetchJson('https://api.uexcorp.space/2.0/terminals?type=commodity');   // every system (Stanton, Pyro, Nyx)
    return { status: 'ok', data: res.data || [] };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getTerminalPrices', async (_, { id_terminal }) => {
  try {
    if (usingSctrade()) {
      const rows = await getSctradeRows();
      return { status: 'ok', data: rows.filter(r => String(r.id_terminal) === String(id_terminal)) };
    }
    return await fetchJson(
      `https://api.uexcorp.space/2.0/commodities_prices?id_terminal=${id_terminal}`
    );
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});

ipcMain.handle('api:getBulkPrices', async () => {
  try {
    if (usingSctrade()) return { status: 'ok', rows: await getSctradeRows() };
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
    if (usingSctrade()) {
      const want = new Set((ids || []).map(String));
      return { status: 'ok', rows: (await getSctradeRows()).filter(r => want.has(String(r.id_commodity))) };
    }
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

// Erkul's calculator refuses to render below ~1000px wide (it redirects to its
// Component Finder), so the Erkul view widens the overlay and restores the
// previous size when the user leaves it.
ipcMain.handle('window:expandForEmbed', (_, width) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  if (!preErkulBounds) preErkulBounds = mainWindow.getBounds();
  const b = mainWindow.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const w = Math.min(Math.max(Number(width) || 0, b.width), area.width);
  const x = Math.min(Math.max(b.x, area.x), area.x + area.width - w);
  mainWindow.setBounds({ x, y: b.y, width: w, height: b.height });
  return { ok: true, width: w };
});

ipcMain.handle('window:restoreFromEmbed', () => {
  if (!mainWindow || mainWindow.isDestroyed() || !preErkulBounds) return { ok: false };
  mainWindow.setBounds(preErkulBounds);
  preErkulBounds = null;
  return { ok: true };
});
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
ipcMain.handle('contracts:get', () => contractTracker.snapshot());
ipcMain.handle('contracts:import', () => {
  const p = store.get('logPath') || detectLogPath();
  if (!p || !fs.existsSync(p)) return { ok: false, error: 'No Game.log found. Set its location in Settings first.' };
  try { return { ok: true, ...contractTracker.importLogs(p) }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('contracts:clear', () => { contractTracker.clear(); return true; });
// Your RSI hangar, read with a login you do yourself (see rsi-hangar.js)
const rsiHangar = require('./rsi-hangar');
ipcMain.handle('rsi:status', async () => ({ connected: await rsiHangar.isConnected() }));
ipcMain.handle('rsi:connect', async () => { await rsiHangar.connect(mainWindow); return { connected: await rsiHangar.isConnected() }; });
ipcMain.handle('rsi:disconnect', async () => { await rsiHangar.disconnect(); return { connected: false }; });
ipcMain.handle('rsi:import', async () => {
  try {
    const raw = await rsiHangar.readPledges();
    const { ships, otherKinds } = rsiHangar.extractShips(raw.pledges);
    return { ok: true, pages: raw.pages, pledgeCount: raw.pledges.length, ships, otherKinds };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('scmdb:get', () => ({ status: getScmdb().status(), data: getScmdb().snapshot() }));
ipcMain.handle('scmdb:refresh', async (_, force) => {
  const r = await getScmdb().refresh(!!force);
  return { result: r, status: getScmdb().status(), data: r.changed || force ? getScmdb().snapshot() : null };
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

// The text parsing and the region-by-region reading of the refinery screen live in
// refinery-ocr.js (it is also what the tests drive).
const refineryOcr = require('./refinery-ocr');

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

// Grabs the screen (or just the game window) and returns the image — no OCR here,
// so a burst of grabs can run back-to-back and the slow reading happens afterwards.
async function grabFrame() {
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

  if (!source.thumbnail || source.thumbnail.isEmpty()) throw new Error('Captured image was empty');
  return { capturedWindow, image: source.thumbnail };
}

// True when two frames are visually the same screen (the user didn't scroll between
// them) — compared on a tiny downscale so glow/cursor animation doesn't count.
function framesAlike(a, b) {
  // A scrolled list changes only a small part of the frame (the table is ~5% of it), so the
  // test counts pixels that changed clearly rather than averaging the whole picture — an
  // average would call a scrolled frame "the same" and drop the rows it brings in.
  const small = (img) => img.resize({ width: 192, height: 108, quality: 'good' }).toBitmap();
  const pa = small(a), pb = small(b);
  if (pa.length !== pb.length) return false;
  let changed = 0;
  for (let i = 0; i < pa.length; i += 4) {
    if (Math.abs(pa[i] - pb[i]) > 48 || Math.abs(pa[i + 1] - pb[i + 1]) > 48 || Math.abs(pa[i + 2] - pb[i + 2]) > 48) changed++;
  }
  return changed < 25;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// What has been read so far from one or more screenshots of the refinery terminal. The quick capture
// builds one and finishes it at once; a scroll capture keeps one between the user's presses of
// Capture, so a long materials list is taken a screenful at a time.
function newCaptureSession() {
  return { method: null, duration: null, location: null, cost: null, processing: null, capturedWindow: true,
    materials: [], rawTexts: [], shots: 0, best: null };
}

// Kept in memory so "Report a Bug" can offer to attach what was on screen and what was read from
// it — set before the slow part, so even a crash while reading leaves something to attach.
function rememberCapture(image) {
  try {
    const first = encodeShot(image, 3840);
    bugLastCapture = { at: Date.now(), jpeg: first, thumb: thumbDataUrl(nativeImage.createFromBuffer(first)),
      text: 'Capture started; reading did not finish.', summary: null };
  } catch { bugLastCapture = null; }
}

// Reads one screenshot into a session and returns how many materials it added. A row already
// seen in an earlier shot (same ore, and at least two of its three numbers the same) is the same
// row, so a screenful that overlaps the last one, or the same screen taken twice, counts once.
// Method, station and duration don't change while a list scrolls, so what the first shot found
// isn't read again.
async function readIntoSession(session, image) {
  const worker = await getOcrWorker();
  const frame = await refineryOcr.readFrame(image, worker, { known: { method: session.method, location: session.location, duration: session.duration } });
  const before = session.materials.length;
  let score;
  if (frame.kind === 'processing') {
    session.processing = refineryOcr.mergeWorkOrders(session.processing, frame);
    score = frame.workOrders.reduce((k, w) => k + w.rows.length, 0) * 4;
  } else {
    if (!session.method && frame.method) session.method = frame.method;
    if (!session.duration && frame.duration) session.duration = frame.duration;
    if (!session.location && frame.location) session.location = frame.location;
    if (session.cost == null && frame.cost != null) session.cost = frame.cost;
    refineryOcr.mergeRows(session.materials, frame.materials);
    // the shot that yielded the most is the most useful one to show in a report
    score = frame.materials.length * 4 + (frame.method ? 1 : 0) + (frame.location ? 1 : 0) + (frame.duration ? 1 : 0);
  }
  session.rawTexts.push(frame.rawText);
  session.shots++;
  if (!session.best || score > session.best.score) session.best = { score, image };
  return session.materials.length - before;
}

// Wraps up a session: the report attachment, the debug file, and the result the renderer gets.
function finishSession(session) {
  const { processing, rawTexts } = session;
  try {
    const best = encodeShot(session.best ? session.best.image : null, 3840);
    const summary = processing
      ? { kind: 'processing', location: processing.location, workOrders: processing.workOrders.map(w => ({ index: w.index, remainingSeconds: w.remainingSeconds, rows: w.rows.map(r => `${r.name} q${r.quality}/y${r.yield}`) })) }
      : { method: session.method, duration: session.duration, location: session.location, cost: session.cost, materials: session.materials.map(m => `${m.name} ${m.quality}/${m.yield}`) };
    bugLastCapture = { at: Date.now(), jpeg: best, thumb: thumbDataUrl(nativeImage.createFromBuffer(best)), summary,
      text: `Parsed: ${JSON.stringify(summary)}\n\n` + rawTexts.map((t, i) => `── Shot ${i + 1}/${rawTexts.length} ──\n${t}`).join('\n\n') };
  } catch { /* attaching is a convenience */ }

  // Written every capture so the user can just open the file and paste its
  // contents back to us, instead of fishing text out of the DevTools console.
  const debugPath = path.join(app.getPath('userData'), 'refinery-ocr-debug.txt');
  try {
    fs.writeFileSync(debugPath, rawTexts.map((t, i) => `── Shot ${i + 1}/${rawTexts.length} ──\n${t}`).join('\n\n'), 'utf8');
  } catch { /* debug file is a convenience, never block the capture on it */ }

  if (processing && processing.workOrders.length) {
    return { status: 'ok', kind: 'processing', capturedWindow: session.capturedWindow, location: processing.location,
      workOrders: processing.workOrders, rawTexts, debugPath };
  }
  return { status: 'ok', kind: 'setup', capturedWindow: session.capturedWindow, method: session.method, duration: session.duration,
    location: session.location, cost: session.cost,
    materials: session.materials.map(({ name, quality, yield: y }) => ({ name, quality, yield: y })), rawTexts, debugPath };
}

const NOT_RUNNING = { status: 'error', error: 'Star Citizen doesn\'t appear to be running.' };

// Quick capture: four shots in quick succession (they back each other up on a misread digit),
// all grabbed first so the gap stays short, then each distinct one is read.
const BURST_SHOTS = 4;
const BURST_INTERVAL_MS = 600;
ipcMain.handle('refinery:captureAndParse', async () => {
  try {
    if (!(await isGameRunning())) return NOT_RUNNING;
    const session = newCaptureSession();
    const progress = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('refinery:captureProgress', info);
    };
    const frames = [];
    for (let i = 0; i < BURST_SHOTS; i++) {
      const grabbed = await grabFrame();
      session.capturedWindow = grabbed.capturedWindow;
      frames.push(grabbed.image);
      progress({ phase: 'capture', current: i + 1, total: BURST_SHOTS });
      if (i < BURST_SHOTS - 1) await delay(BURST_INTERVAL_MS);
    }
    rememberCapture(frames[0]);
    const distinct = frames.filter((img, i) => !frames.slice(0, i).some(prev => framesAlike(prev, img)));
    for (let i = 0; i < distinct.length; i++) {
      progress({ phase: 'reading', current: i + 1, total: distinct.length, found: session.materials.length });
      await readIntoSession(session, distinct[i]);
    }
    return finishSession(session);
  } catch (e) {
    if (bugLastCapture) bugLastCapture.text = `Capture failed while reading: ${e.message}`;
    return { status: 'error', error: e.message };
  }
});

// Scroll capture, for a materials list longer than the terminal: the user presses Capture, scrolls
// the list down in the game, presses Capture again, and so on, then Finish. One session lives
// between the presses; rows seen in more than one shot are kept once.
let scrollSession = null;
ipcMain.handle('refinery:scrollShot', async (_, opts) => {
  try {
    if (!(await isGameRunning())) return NOT_RUNNING;
    if (!scrollSession || (opts && opts.first)) scrollSession = newCaptureSession();
    const session = scrollSession;
    const grabbed = await grabFrame();
    session.capturedWindow = grabbed.capturedWindow;
    if (session.shots === 0) rememberCapture(grabbed.image);
    const added = await readIntoSession(session, grabbed.image);
    return { status: 'ok', shots: session.shots, rows: session.materials.length, added };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});
ipcMain.handle('refinery:scrollFinish', async () => {
  const session = scrollSession;
  scrollSession = null;
  if (!session || !session.shots) return { status: 'error', error: 'Nothing has been captured yet.' };
  try { return finishSession(session); } catch (e) { return { status: 'error', error: e.message }; }
});
ipcMain.handle('refinery:scrollCancel', () => { scrollSession = null; });

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
// The main window's close handler hides to tray instead of closing (unless
// app.isQuitting), which would cancel the quit that quitAndInstall relies on and
// leave the old version running with the installer waiting on it.
ipcMain.handle('updater:install', () => {
  app.isQuitting = true;
  autoUpdater.quitAndInstall();
});
ipcMain.handle('shell:openExternal', (_, url) => { shell.openExternal(url); });

// ─── IPC: Bug report ──────────────────────────────────────────────────────────
// Who to @mention on every report — set either or both (empty = no ping).
// Discord: User Settings → Advanced → Developer Mode on, then right-click yourself (or the
// role in Server Settings → Roles) → Copy ID. They are numeric IDs, not secrets, but note
// this file is in a public repo. A role only pings if it is mentionable (or the webhook is
// allowed to mention it).
const BUG_PING_USER_ID = '';
const BUG_PING_ROLE_ID = '637593821659529227';
const BUG_WEBHOOK = 'https://discord.com/api/webhooks/1549166537305362532/ygN4GsizQ21ibHHCnCn1wahjgQvgFJ9aZ5ctZj8N9IhChRZSNMLNIEshbDPPyWZEDaVK';
// ── Attachments ──────────────────────────────────────────────────────────────
// Three things can ride along with a report, and only when the user ticks/adds them in
// the Report a Bug form (which previews each one first):
//   • the screen they were on just before opening Settings (the form lives in Settings,
//     so a shot taken at send time would only ever show Settings)
//   • the last refinery capture — the frame it read plus the text it read from it
//   • images they pick themselves
const MAX_ATTACH_BYTES = 2.5 * 1024 * 1024;   // per image, after re-encoding
const MAX_ATTACH_TOTAL = 8 * 1024 * 1024;     // Discord's default upload limit is ~10 MB per message
const MAX_ATTACH_FILES = 6;
const JPEG_DATA_PREFIX = 'data:image/jpeg;base64,';

let bugViewShot = null;      // { image: nativeImage, tab, at } — kept in memory only
let bugLastCapture = null;   // { at, jpeg, thumb, text, summary }

// maxWidth: window snapshots are plenty at 2560; a refinery capture keeps up to 3840 so a 4K
// player's report still carries the detail the reader had to work with.
function encodeShot(img, maxWidth = 2560) {
  let im = img;
  if (im.getSize().width > maxWidth) im = im.resize({ width: maxWidth, quality: 'best' });
  for (const q of [88, 72, 55]) {
    const buf = im.toJPEG(q);
    if (buf.length <= MAX_ATTACH_BYTES) return buf;
  }
  return im.resize({ width: 1600, quality: 'good' }).toJPEG(60);
}
const jpegDataUrl = (buf) => JPEG_DATA_PREFIX + buf.toString('base64');
const thumbDataUrl = (img) => jpegDataUrl(img.resize({ width: 360, quality: 'good' }).toJPEG(75));

// Accepts only a JPEG data URL (everything the form attaches was re-encoded to JPEG by
// this app); returns the bytes, or null if it isn't a readable image.
function readJpegDataUrl(s) {
  if (typeof s !== 'string' || !s.startsWith(JPEG_DATA_PREFIX) || s.length > MAX_ATTACH_BYTES * 1.4) return null;
  const buf = Buffer.from(s.slice(JPEG_DATA_PREFIX.length), 'base64');
  try { return nativeImage.createFromBuffer(buf).isEmpty() ? null : buf; } catch { return null; }
}
const safeAttachName = (n, fallback) => {
  const base = String(n || '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
  return (base || fallback) + '.jpg';
};

// Remember the screen the user was on; called by the renderer just before it switches to Settings.
ipcMain.handle('bug:snapshotWindow', async (_, tab) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const image = await mainWindow.webContents.capturePage();
    if (image.isEmpty()) return false;
    bugViewShot = { image, tab: String(tab || '').slice(0, 30), at: Date.now() };
    return true;
  } catch { return false; }
});

// What the form can offer to attach right now, with small previews.
ipcMain.handle('bug:getAttachables', () => {
  const age = (t) => Math.max(0, Math.round((Date.now() - t) / 1000));
  return {
    view: bugViewShot ? { tab: bugViewShot.tab, ageSec: age(bugViewShot.at), thumb: thumbDataUrl(bugViewShot.image) } : null,
    capture: bugLastCapture ? { ageSec: age(bugLastCapture.at), thumb: bugLastCapture.thumb, summary: bugLastCapture.summary } : null,
  };
});

// Opens a file picker and hands the raw bytes back; the renderer decodes it (Chromium reads
// png/jpg/webp/bmp/gif, nativeImage doesn't) and returns a re-encoded JPEG at send time.
ipcMain.handle('bug:pickImage', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Attach an image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const file = r.filePaths[0];
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' }[ext];
  if (!mime) return { error: 'Pick a PNG, JPG, WebP, BMP or GIF image.' };
  if (fs.statSync(file).size > 25 * 1024 * 1024) return { error: 'That file is larger than 25 MB.' };
  return { name: path.basename(file), dataUrl: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` };
});

// "Capture the game screen now" — a one-off grab of the game window (the overlay isn't
// in it), for when the refinery screen should be in the report but no capture ran, or
// the capture couldn't start. Falls back to the whole display if the game window can't
// be found, and says so, so the preview makes clear what is being attached.
ipcMain.handle('bug:grabGame', async () => {
  try {
    const { capturedWindow, image } = await grabFrame();
    const jpeg = encodeShot(image);
    return { ok: true, capturedWindow, name: 'game-screen.jpg', dataUrl: jpegDataUrl(jpeg), thumb: thumbDataUrl(image) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function buildMultipart(json, files) {
  const boundary = '----scc' + require('crypto').randomBytes(12).toString('hex');
  const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${json}\r\n`)];
  files.forEach((f, i) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[${i}]"; filename="${f.name}"\r\nContent-Type: ${f.mime}\r\n\r\n`));
    parts.push(f.data, Buffer.from('\r\n'));
  });
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

ipcMain.handle('bug:report', async (_, { description, includeView, includeCapture, images } = {}) => {
  const files = [];
  if (includeView && bugViewShot) files.push({ name: 'app-window.jpg', mime: 'image/jpeg', data: encodeShot(bugViewShot.image) });
  if (includeCapture && bugLastCapture) {
    files.push({ name: 'refinery-frame.jpg', mime: 'image/jpeg', data: bugLastCapture.jpeg });
    files.push({ name: 'refinery-ocr.txt', mime: 'text/plain', data: Buffer.from(bugLastCapture.text, 'utf8') });
  }
  (Array.isArray(images) ? images.slice(0, 3) : []).forEach((im, i) => {
    const data = readJpegDataUrl(im && im.dataUrl);
    if (data) files.push({ name: safeAttachName(im.name, `image-${i + 1}`), mime: 'image/jpeg', data });
  });
  files.splice(MAX_ATTACH_FILES);
  let total = files.reduce((n, f) => n + f.data.length, 0);
  while (files.length && total > MAX_ATTACH_TOTAL) total -= files.pop().data.length;

  // the picture shown inline in the Discord message: the refinery screen if there is one
  const firstImage = files.find(f => f.name === 'refinery-frame.jpg') || files.find(f => f.name === 'game-screen.jpg')
    || files.find(f => f.mime === 'image/jpeg');
  const fields = [
    { name: 'Version', value: CURRENT_VERSION, inline: true },
    { name: 'Platform', value: `${process.platform} ${process.getSystemVersion?.() || ''}`.trim(), inline: true },
  ];
  if (files.length) fields.push({ name: 'Attachments', value: files.map(f => f.name).join(', ').slice(0, 1000) });
  // A webhook only pings through `content` (embeds never do). allowed_mentions is always
  // sent so that nothing in a user's report text can mention anyone — only the IDs
  // above, and only when they are set.
  const idOk = (v) => /^\d{15,25}$/.test(v);
  const pingUser = idOk(BUG_PING_USER_ID) ? BUG_PING_USER_ID : null;
  const pingRole = idOk(BUG_PING_ROLE_ID) ? BUG_PING_ROLE_ID : null;
  const mentions = [pingRole && `<@&${pingRole}>`, pingUser && `<@${pingUser}>`].filter(Boolean).join(' ');
  const payload = JSON.stringify({
    ...(mentions ? { content: `${mentions} 🐛 New bug report — v${CURRENT_VERSION}` } : {}),
    allowed_mentions: { parse: [], users: pingUser ? [pingUser] : [], roles: pingRole ? [pingRole] : [] },
    embeds: [{
      title: '🐛 Bug Report',
      description: String(description || '').slice(0, 1500),
      color: 0xE8AC3C,
      fields,
      ...(firstImage ? { image: { url: `attachment://${firstImage.name}` } } : {}),
      timestamp: new Date().toISOString()
    }]
  });
  const out = files.length ? buildMultipart(payload, files) : { body: Buffer.from(payload), contentType: 'application/json' };

  return new Promise((resolve, reject) => {
    const url = new URL(BUG_WEBHOOK);
    const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': out.contentType, 'Content-Length': out.body.length } }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', reject);
    req.write(out.body);
    req.end();
  });
});

// ─── IPC: Data export / import ────────────────────────────────────────────────
const EXPORT_KEYS = ['jobs', 'jobHistory', 'homeBase', 'craftInventory', 'craftAssets', 'craftShips', 'craftingOwned', 'miningLoadout', 'factionStanding', 'contractLog', 'closeBehavior', 'hotkeyVK', 'logPath', 'language'];

const VALID_LANGS = new Set(['en', 'de', 'fr', 'es', 'pl', 'pt', 'ru', 'ja']);
const VALID_CLOSE = new Set(['tray', 'quit']);
const VK_RE = /^[0-9a-fA-F]{2}$/;

function validateImport(data) {
  if (data.jobs !== undefined && !Array.isArray(data.jobs)) return 'jobs must be an array';
  if (data.jobHistory !== undefined && !Array.isArray(data.jobHistory)) return 'jobHistory must be an array';
  if (data.craftInventory !== undefined && !Array.isArray(data.craftInventory)) return 'craftInventory must be an array';
  if (data.craftAssets !== undefined && !Array.isArray(data.craftAssets)) return 'craftAssets must be an array';
  if (data.craftShips !== undefined && !Array.isArray(data.craftShips)) return 'craftShips must be an array';
  if (data.craftingOwned !== undefined && (typeof data.craftingOwned !== 'object' || Array.isArray(data.craftingOwned))) return 'craftingOwned must be an object';
  if (data.miningLoadout !== undefined && (typeof data.miningLoadout !== 'object' || data.miningLoadout === null || Array.isArray(data.miningLoadout))) return 'miningLoadout must be an object';
  if (data.factionStanding !== undefined && (typeof data.factionStanding !== 'object' || data.factionStanding === null || Array.isArray(data.factionStanding))) return 'factionStanding must be an object';
  if (data.contractLog !== undefined && (typeof data.contractLog !== 'object' || data.contractLog === null || Array.isArray(data.contractLog))) return 'contractLog must be an object';
  if (data.closeBehavior !== undefined && !VALID_CLOSE.has(data.closeBehavior)) return 'closeBehavior must be "tray" or "quit"';
  if (data.hotkeyVK !== undefined && !VK_RE.test(data.hotkeyVK)) return 'hotkeyVK must be a 2-char hex string';
  if (data.logPath !== undefined && (typeof data.logPath !== 'string' || data.logPath.length > 500 || /[\x00-\x1f]/.test(data.logPath))) return 'logPath must be a plain file path string';
  if (data.language !== undefined && !VALID_LANGS.has(data.language)) return 'language must be one of en, de, fr, es, pl, pt, ru, ja';
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
