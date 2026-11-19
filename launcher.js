'use strict';
// The launcher bubble: a small round button with the app's logo that sits on the screen while the overlay is
// hidden. Clicking it brings the overlay back, like the chat button on a website, so nobody has to remember the
// hotkey or reach the tray. It can be dragged anywhere (it snaps to the nearest side of the screen and remembers
// the spot), shows how many refinery jobs are ready, and has a right-click menu to open the app or hide the button.
//
// Like the overlay itself it never takes keyboard focus from the game, and it is only there while the overlay
// is hidden. It can only be clicked while the game is showing a mouse cursor (mobiGlas, menus, kiosks); the
// hotkey still works everywhere.

const { app, BrowserWindow, screen, Menu, ipcMain } = require('electron');
const path = require('path');

const SIZE = 64;             // the window; the bubble itself is 52 px inside it, with room for the glow and the badge
const BUBBLE = 52;
const MARGIN = 6;            // gap kept to the edge of the screen
const BADGE_EVERY_MS = 20000;

// A solid window cut to a circle, for Compatibility mode where the window cannot be see-through
function circleShape() {
  const rects = [], r = BUBBLE / 2, c = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    const dy = y + 0.5 - c;
    if (Math.abs(dy) >= r) continue;
    const half = Math.sqrt(r * r - dy * dy);
    rects.push({ x: Math.round(c - half), y, width: Math.max(1, Math.round(2 * half)), height: 1 });
  }
  return rects;
}

function create(ctx) {
  const { store } = ctx;
  let win = null, enabled = store.get('launcherEnabled', false) === true;
  let drag = null, badgeTimer = null, lastClick = 0;

  const mainWin = () => { const w = ctx.getMainWindow(); return w && !w.isDestroyed() ? w : null; };
  const overlayHidden = () => { const w = mainWin(); return !!w && (!w.isVisible() || w.isMinimized()); };
  const wanted = () => enabled && !app.isQuitting && overlayHidden();

  // jobs whose timer has run out and that have not been collected yet
  function readyJobs() {
    try {
      const now = Date.now();
      return (store.get('jobs', []) || []).filter(j => j && j.durationSeconds > 0 && (now - (Number(j.startTime) || now)) / 1000 >= j.durationSeconds).length;
    } catch { return 0; }
  }
  function pushBadge() {
    if (win && !win.isDestroyed()) win.webContents.send('launcher:badge', readyJobs());
  }

  // where it sits: the saved spot if it is still on a screen, otherwise the right edge of the main screen
  function startPosition() {
    const saved = store.get('launcherPos');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const d = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: SIZE, height: SIZE });
      const a = d.workArea;
      if (saved.x >= a.x - SIZE / 2 && saved.x <= a.x + a.width - SIZE / 2 && saved.y >= a.y - SIZE / 2 && saved.y <= a.y + a.height - SIZE / 2) return clampTo(a, saved.x, saved.y);
    }
    const a = screen.getPrimaryDisplay().workArea;
    return { x: a.x + a.width - SIZE - MARGIN, y: a.y + Math.round(a.height * 0.4) };
  }
  const clampTo = (a, x, y) => ({
    x: Math.min(Math.max(x, a.x), a.x + a.width - SIZE),
    y: Math.min(Math.max(y, a.y), a.y + a.height - SIZE),
  });

  // after a drag: stick to the nearest left or right edge of the screen the bubble was dropped on
  function snap() {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const a = screen.getDisplayNearestPoint({ x: b.x + SIZE / 2, y: b.y + SIZE / 2 }).workArea;
    const left = (b.x + SIZE / 2) < a.x + a.width / 2;
    const p = clampTo(a, left ? a.x + MARGIN : a.x + a.width - SIZE - MARGIN, b.y);
    win.setBounds({ x: p.x, y: p.y, width: SIZE, height: SIZE });
    store.set('launcherPos', p);
  }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    const p = startPosition();
    win = new BrowserWindow({
      width: SIZE, height: SIZE, x: p.x, y: p.y,
      frame: false, transparent: !ctx.obsMode, ...(ctx.obsMode ? { backgroundColor: '#080c14' } : {}),
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, focusable: false, show: false, hasShadow: false, alwaysOnTop: true,
      title: 'SC Companion launcher',
      webPreferences: { preload: path.join(__dirname, 'launcher-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    if (ctx.obsMode) { try { win.setShape(circleShape()); } catch { /* a square button is still usable */ } }
    win.loadFile(path.join(__dirname, 'renderer', 'launcher.html'), { query: { opaque: ctx.obsMode ? '1' : '0' } });
    win.webContents.on('did-finish-load', pushBadge);
    win.on('closed', () => { win = null; });
    return win;
  }

  // show or hide to match the overlay: shown only while the overlay is hidden
  function sync() {
    if (wanted()) {
      const w = ensureWindow();
      if (!w.isVisible()) w.showInactive();
      w.setAlwaysOnTop(true, 'screen-saver');
      w.moveTop();
      pushBadge();
      if (!badgeTimer) badgeTimer = setInterval(pushBadge, BADGE_EVERY_MS);
    } else {
      if (win && !win.isDestroyed() && win.isVisible()) win.hide();
      if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; }
    }
  }

  function setEnabled(v) {
    enabled = v === true;
    store.set('launcherEnabled', enabled);
    if (!enabled && win && !win.isDestroyed()) { win.destroy(); win = null; }
    sync();
    if (ctx.onChanged) ctx.onChanged(enabled);
    return enabled;
  }

  function open() {
    const now = Date.now();
    if (now - lastClick < 300) return;
    lastClick = now;
    ctx.showWindow();
    sync();
  }

  // ── the bubble's page talks to us here; anything not from that page is ignored ──
  const mine = (e) => win && !win.isDestroyed() && e.sender === win.webContents;
  ipcMain.on('launcher:down', (e) => {
    if (!mine(e)) return;
    const c = screen.getCursorScreenPoint(), b = win.getBounds();
    drag = { cx: c.x, cy: c.y, wx: b.x, wy: b.y, moved: false };
  });
  ipcMain.on('launcher:move', (e) => {
    if (!mine(e) || !drag) return;
    const c = screen.getCursorScreenPoint();
    const dx = c.x - drag.cx, dy = c.y - drag.cy;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;       // a click, not a drag
    drag.moved = true;
    win.setBounds({ x: drag.wx + dx, y: drag.wy + dy, width: SIZE, height: SIZE });
  });
  ipcMain.on('launcher:up', (e) => {
    if (!mine(e) || !drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) snap(); else open();
  });
  ipcMain.on('launcher:menu', (e) => {
    if (!mine(e)) return;
    drag = null;
    Menu.buildFromTemplate([
      { label: 'Open SC Companion', click: open },
      { label: 'Hide this button', click: () => setEnabled(false) },
    ]).popup({ window: win });
  });
  ipcMain.handle('launcher:get', () => enabled);
  ipcMain.handle('launcher:set', (_, v) => setEnabled(v === true));

  // a screen was unplugged or changed size: keep the bubble where it can be reached
  const reclamp = () => { if (win && !win.isDestroyed()) snap(); };
  app.whenReady().then(() => { screen.on('display-removed', reclamp); screen.on('display-metrics-changed', reclamp); });

  return {
    sync, setEnabled, isEnabled: () => enabled,
    destroy() { if (badgeTimer) clearInterval(badgeTimer); badgeTimer = null; if (win && !win.isDestroyed()) win.destroy(); win = null; },
  };
}

module.exports = { create, circleShape };
