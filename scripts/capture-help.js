#!/usr/bin/env node
// Regenerates the user-guide screenshots in renderer/help/.
//
//   node scripts/capture-help.js            # every shot
//   node scripts/capture-help.js overview hangar-ships   # just these
//
// It launches the real app on a throw-away profile (your own data is never touched),
// loads demo data, drives each view described in renderer/help-content.js, outlines
// the elements listed in `points` with their number, and saves the screenshot.
// Needs a network connection (prices, blueprints and ship data are live).
// Re-run it whenever the UI changes enough to make an image out of date.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const { HELP_SHOTS } = require(path.join(ROOT, 'renderer', 'help-content.js'));
const OUT = path.join(ROOT, 'renderer', 'help');
const PORT = 9400 + Math.floor(Math.random() * 400);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const wanted = process.argv.slice(2);
const shotIds = Object.keys(HELP_SHOTS).filter(id => !wanted.length || wanted.includes(id));
if (!shotIds.length) { console.error('No matching shots.'); process.exit(1); }

// ── demo data ────────────────────────────────────────────────────────────────
function demoData() {
  const now = Date.now();
  const H = 3600 * 1000;
  return {
    language: 'en',
    hoverHints: 'on',
    refineryCaptureMode: 'auto',
    jobs: [
      { id: 'demo1', ores: ['Quantainium', 'Gold'], qualities: ['850', '700'], yields: ['120', '80'], method: 'Dinyx Solventation',
        location: 'ARC-L1 Wide Forest', startTime: now - 0.6 * H, durationSeconds: Math.round(3.4 * 3600), notes: '' },
      { id: 'demo2', ores: ['Titanium'], qualities: ['874'], yields: ['150'], method: 'Cormack Method',
        location: 'CRU-L1 Ambitious Dream', startTime: now - 5 * H, durationSeconds: 2 * 3600, notes: 'Collect on the way back' },
    ],
    craftInventory: [
      { name: 'Iron', quality: '852', qty: '1', unit: '1', location: 'Lorville' },
      { name: 'Iron', quality: '852', qty: '1', unit: '1', location: 'Lorville' },
      { name: 'Iron', quality: '640', qty: '0.6', unit: '1', location: 'Area 18' },
      { name: 'Titanium', quality: '874', qty: '1', unit: '1', location: 'Lorville' },
      { name: 'Riccite', quality: '686', qty: '0.45', unit: '1', location: 'Lorville' },
      { name: 'Quantainium', quality: '912', qty: '0.3', unit: '1', location: 'Lorville' },
      { name: 'Gold', quality: '700', qty: '0.5', unit: '4', location: 'In Transit', inTransit: true },
    ],
    craftShips: [
      { uid: 'demo-titan', vid: 0, name: 'Aegis Avenger Titan', nickname: 'Hauler', slug: 'aegs-avenger-titan',
        company: 'Aegis Dynamics', scu: 8, crew: '1', roles: ['Cargo', 'Exploration'], location: 'Lorville', notes: 'Daily cargo runs', installed: {} },
      { uid: 'demo-cutlass', vid: 0, name: 'Drake Cutlass Black', slug: 'drak-cutlass-black',
        company: 'Drake Interplanetary', scu: 46, crew: '1-2', roles: ['Cargo', 'Military'], location: 'Area 18', installed: {} },
    ],
    craftAssets: [
      { uid: 'demo-shield', name: 'Abrade Shield Mk1', type: 'Ship component — Shield', size: 1, location: 'Lorville',
        crafted: { parts: [{ name: 'Iron', quality: 852 }, { name: 'Gold', quality: 700 }], stats: [{ stat: 'Max. Shield Strength', value: '+7.6%' }] } },
      { uid: 'demo-helmet', name: 'Woodland Flight Helmet', type: 'Armor', location: 'Lorville', notes: 'Spare' },
      { uid: 'demo-rifle', name: 'P6-LR Sniper Rifle', type: 'Weapon', location: 'Area 18' },
    ],
  };
}

// ── page-side helpers (stringified into the app) ─────────────────────────────
const ANNOTATE = `(points) => {
  const old = document.getElementById('__help_layer'); if (old) old.remove();
  const layer = document.createElement('div');
  layer.id = '__help_layer';
  layer.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647';
  document.body.appendChild(layer);
  const vw = window.innerWidth, vh = window.innerHeight, D = 20;
  const placed = [], missing = [];
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  points.forEach((p, i) => {
    let list = [];
    try { list = [...document.querySelectorAll(p.sel)]; } catch (e) {}
    list = list.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const el = p.contains ? list.find(e => (e.textContent || '').includes(p.contains)) : list[p.nth || 0];
    if (!el) { missing.push((i + 1) + ': ' + p.sel + (p.contains ? ' [' + p.contains + ']' : '')); return; }
    const r = el.getBoundingClientRect();
    // Intersect with the viewport AND every overflow-clipping ancestor (a modal's
    // scroll area, a scrolled list) so a pointer can't float over empty space.
    let L = Math.max(r.left, 1), T = Math.max(r.top, 1), R = Math.min(r.right, vw - 1), B = Math.min(r.bottom, vh - 1);
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflow + ' ' + cs.overflowX + ' ' + cs.overflowY)) {
        const ar = a.getBoundingClientRect();
        L = Math.max(L, ar.left); T = Math.max(T, ar.top); R = Math.min(R, ar.right); B = Math.min(B, ar.bottom);
      }
    }
    const left = L, top = T, right = R, bottom = B;
    // A long scrolling list is only partly visible by design; what must never happen
    // is an element that is (almost) entirely hidden below a scroll fold.
    if (right - left < Math.min(r.width, 24) || bottom - top < Math.min(r.height, 24)) {
      missing.push((i + 1) + ': ' + p.sel + (p.contains ? ' [' + p.contains + ']' : '') + ' (off-screen or clipped)'); return;
    }
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:' + (left - 2) + 'px;top:' + (top - 2) + 'px;width:' + (right - left + 4) + 'px;height:' + (bottom - top + 4) +
      'px;border:2px solid #ffb020;border-radius:5px;box-shadow:0 0 0 1px rgba(0,0,0,.7),0 0 8px rgba(255,176,32,.55)';
    layer.appendChild(box);
    const cands = {
      tl: [left - D / 2 - 2, top - D / 2 - 2], tr: [right - D / 2 + 2, top - D / 2 - 2],
      bl: [left - D / 2 - 2, bottom - D / 2 + 2], br: [right - D / 2 + 2, bottom - D / 2 + 2],
    };
    let pos = null;
    for (const k of [p.at || 'tl', 'tl', 'tr', 'bl', 'br']) {
      const x = clamp(cands[k][0], 2, vw - D - 2), y = clamp(cands[k][1], 2, vh - D - 2);
      if (!placed.some(q => Math.abs(q[0] - x) < D + 1 && Math.abs(q[1] - y) < D + 1)) { pos = [x, y]; break; }
    }
    if (!pos) {
      pos = [clamp(cands.tl[0], 2, vw - D - 2), clamp(cands.tl[1], 2, vh - D - 2)];
      let guard = 0;
      while (placed.some(q => Math.abs(q[0] - pos[0]) < D + 1 && Math.abs(q[1] - pos[1]) < D + 1) && guard++ < 20) pos[1] += D + 2;
    }
    placed.push(pos);
    const b = document.createElement('div');
    b.textContent = String(i + 1);
    b.style.cssText = 'position:absolute;left:' + pos[0] + 'px;top:' + pos[1] + 'px;width:' + D + 'px;height:' + D +
      'px;border-radius:50%;background:#ffb020;color:#111;font:800 12px/' + D + 'px "Segoe UI",Arial,sans-serif;text-align:center;box-shadow:0 0 0 1.5px #111,0 1px 4px rgba(0,0,0,.6)';
    layer.appendChild(b);
  });
  return missing;
}`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-help-'));
  fs.mkdirSync(OUT, { recursive: true });
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const proc = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], { stdio: 'ignore' });
  const cleanup = () => { try { proc.kill(); } catch {} };
  process.on('exit', cleanup);

  let page;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
    } catch {}
  }
  if (!page) { console.error('Could not attach to the app.'); cleanup(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => {
    const my = ++id; pending.set(my, res);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
  const ev = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) {
      const d = m.result.exceptionDetails;
      throw new Error(d.exception?.description || d.text);
    }
    return m.result?.result?.value;
  };
  const waitFor = async (expr, tries = 90, label = expr) => {
    for (let i = 0; i < tries; i++) { if (await ev(expr)) return true; await sleep(1000); }
    console.warn('   (timed out waiting for ' + label + ')');
    return false;
  };

  console.log('Seeding demo data…');
  await sleep(1500);
  const demo = demoData();
  await ev(`(async () => { const d = ${JSON.stringify(demo)};
    await api.setJobs(d.jobs);
    for (const k of ['craftInventory','craftShips','craftAssets','language','hoverHints','refineryCaptureMode']) await api.setStore(k, d[k]);
  })()`);
  await ev('location.reload()');
  await sleep(3000);

  console.log('Loading live data (blueprints, prices, ship loadouts)…');
  await ev("switchTab('crafting')");
  await waitFor('allBlueprints.length > 0', 120, 'blueprints');
  await waitFor('commodities.length > 0', 60, 'commodities');
  await waitFor("craftShips.length > 0 && craftShips.every(s => s.stockAssets && Object.keys(s.stockAssets).length > 0)", 90, 'ship stock parts');
  // own a handful of blueprints, and fit the crafted shield on the Titan
  await ev(`(async () => {
    const names = ['10-Series Greatsword Cannon', '9-Series Longsword Cannon', "5CA 'Akura'"];
    names.forEach(n => { const b = allBlueprints.find(x => x.name === n); if (b) ownedBlueprints[b.blueprint_id] = true; });
    await api.setStore('craftingOwned', ownedBlueprints);
    const ship = craftShips[0];
    const slot = ship.slots.find(s => s.kind === 'shield');
    if (slot) { ship.installed[slot.key] = 'demo-shield'; await api.setStore('craftShips', craftShips); }
    renderOwned && renderOwned();
  })()`);
  await sleep(500);

  const failures = [];
  for (const sid of shotIds) {
    const shot = HELP_SHOTS[sid];
    process.stdout.write(`• ${sid} … `);
    try {
      await send('Emulation.setDeviceMetricsOverride', { width: shot.viewport.w, height: shot.viewport.h, deviceScaleFactor: 2, mobile: false });
      await sleep(250);
      await ev(`(async () => { ${shot.setup} })()`);
      await sleep(shot.wait || 900);
      await sleep(250);
      const missing = await ev(`(${ANNOTATE})(${JSON.stringify(shot.points.map(p => ({ sel: p.sel, contains: p.contains, nth: p.nth, at: p.at })))})`);
      const shotRes = await send('Page.captureScreenshot', { format: 'webp', quality: 90, fromSurface: true });
      if (!shotRes.result?.data) throw new Error('screenshot failed');
      fs.writeFileSync(path.join(OUT, shot.file), Buffer.from(shotRes.result.data, 'base64'));
      await ev("(() => { const l = document.getElementById('__help_layer'); if (l) l.remove(); })()");
      if (shot.after) await ev(`(async () => { ${shot.after} })()`);
      const kb = Math.round(fs.statSync(path.join(OUT, shot.file)).size / 1024);
      if (missing.length) { console.log(`saved (${kb} KB) — MISSING pointers:`); missing.forEach(m => console.log('     ✗ ' + m)); failures.push(sid); }
      else console.log(`ok (${kb} KB, ${shot.points.length} pointers)`);
    } catch (e) {
      console.log('FAILED — ' + e.message.split('\n')[0]);
      failures.push(sid);
      try { await ev("(() => { const l = document.getElementById('__help_layer'); if (l) l.remove(); })()"); } catch {}
    }
  }

  await send('Emulation.clearDeviceMetricsOverride');
  cleanup();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  console.log(failures.length ? `\nDone with ${failures.length} problem shot(s): ${failures.join(', ')}` : '\nAll shots captured.');
  process.exit(failures.length ? 2 : 0);
})();
