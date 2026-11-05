'use strict';
// Reads your pledges (your hangar on the RSI website) with a login you do yourself.
//
// The app never sees your password: "Connect" opens RSI's own login page in a window (its captcha and
// two-factor prompts work as on the website) and the session stays in that window's own storage, apart
// from the rest of the app. "Import" then opens your pledge pages in a hidden window with the same
// session and reads what is on them. "Disconnect" wipes that storage. Nothing is sent anywhere.

const { BrowserWindow, session } = require('electron');

const PARTITION = 'persist:rsi';
const ORIGIN = 'https://robertsspaceindustries.com';
const PLEDGES_URL = ORIGIN + '/en/account/pledges';
const CONNECT_URL = ORIGIN + '/en/connect?jumpto=' + encodeURIComponent('/account/pledges');

const sess = () => session.fromPartition(PARTITION);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// the window's own web preferences: a plain, sandboxed web page with nothing of the app in it
const webPreferences = () => ({ partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false });

function lockDown(win) {
  // links that want a new window (social log-in, captcha) open inside the same locked-down window kind
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https:/i.test(url)) return { action: 'deny' };
    return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: webPreferences() } };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!/^https:/i.test(url)) e.preventDefault(); });
}

// True when the stored session is logged in: the pledges page loads instead of the "restricted area" page.
async function isConnected() {
  let win = null;
  try {
    win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: webPreferences() });
    lockDown(win);
    await win.loadURL(PLEDGES_URL);
    const url = win.webContents.getURL();
    const state = await win.webContents.executeJavaScript(`({
      restricted: /restricted area|must be authenticated/i.test(document.body.innerText || ''),
      title: document.title,
    })`);
    return !/\/connect/.test(url) && !state.restricted;
  } catch { return false; }
  finally { if (win && !win.isDestroyed()) win.destroy(); }
}

let connectWin = null;
// Opens the login window and closes it by itself the moment the login is done (RSI sends you on to your account
// pages). Resolves when the window is gone: { opened: true, loggedIn: true } if it closed because you got in,
// { opened: true } if you closed it yourself.
function connect(parent) {
  if (connectWin && !connectWin.isDestroyed()) { connectWin.focus(); return new Promise(r => connectWin.once('closed', () => r({ opened: true }))); }
  return new Promise((resolve) => {
    const win = connectWin = new BrowserWindow({
      width: 1000, height: 820, title: 'Connect your RSI account — SC Companion', parent: parent || undefined, modal: false,
      autoHideMenuBar: true, webPreferences: webPreferences(),
    });
    lockDown(win);
    let loggedIn = false, checking = false;
    const timer = setInterval(() => check(), 2000);
    win.on('closed', () => { clearInterval(timer); connectWin = null; resolve(loggedIn ? { opened: true, loggedIn: true } : { opened: true }); });

    // On one of your account pages with no login form and no "restricted area" notice you are logged in.
    async function check() {
      if (loggedIn || checking || win.isDestroyed()) return;
      checking = true;
      try {
        if (!onAccountPage(win.webContents.getURL())) return;
        const state = await win.webContents.executeJavaScript(`({
          restricted: /restricted area|must be authenticated/i.test(document.body.innerText || ''),
          loginForm: !!document.querySelector('input[type=password]'),
        })`);
        if (!state.restricted && !state.loginForm && !win.isDestroyed()) { loggedIn = true; win.destroy(); }
      } catch { /* the page is still loading: the next check looks again */ }
      finally { checking = false; }
    }
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-finish-load']) win.webContents.on(ev, () => setTimeout(check, 800));

    win.loadURL(CONNECT_URL).catch(() => { /* the window shows its own error page */ });
  });
}
const onAccountPage = (url) => /^https:\/\/robertsspaceindustries\.com\/(?:[a-z]{2}\/)?account(?:\/|$|\?)/i.test(url);

async function disconnect() {
  if (connectWin && !connectWin.isDestroyed()) connectWin.destroy();
  await sess().clearStorageData();
  await sess().clearCache();
  return true;
}

// Loads one page in a hidden window with the stored session and runs `script` in it.
async function readPage(url, script, { waitMs = 2500, timeoutMs = 45000 } = {}) {
  const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: webPreferences() });
  lockDown(win);
  try {
    await Promise.race([win.loadURL(url), sleep(timeoutMs).then(() => { throw new Error('The RSI page took too long to load'); })]);
    await sleep(waitMs);                                // the lists are filled in by the page's own scripts
    return await win.webContents.executeJavaScript(script);
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

// Runs in the pledges page: fetches every page of the list (the page's own session is used, one request at
// a time, a short pause between them) and returns each pledge's id, name, value, items and whether it can be gifted.
// The list is plain server-rendered HTML, so it is read with the page's own DOM parser.
const READ_ALL_PLEDGES = String.raw`(async () => {
  const text = (el) => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  const parsePage = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pages = [...doc.querySelectorAll('a[href*="pledges?page="]')].map(a => Number((a.getAttribute('href').match(/page=(\d+)/) || [])[1]) || 0);
    const pledges = [...doc.querySelectorAll('.list-items > li')].map(li => {
      const v = (c) => (li.querySelector(c) || {}).value || '';
      const item = (it) => ({ title: text(it.querySelector('.title')), kind: text(it.querySelector('.kind')), maker: text(it.querySelector('.liner')) });
      return {
        id: v('.js-pledge-id'), name: v('.js-pledge-name'), value: v('.js-pledge-value'), currency: v('.js-pledge-currency'),
        availability: text(li.querySelector('.availability')), created: text(li.querySelector('.date-col')).replace(/^Created:\s*/, ''),
        gift: !!li.querySelector('.js-gift'), reclaimable: !li.querySelector('.js-pledge-not-buybackable') || li.querySelector('.js-pledge-not-buybackable').value !== '1',
        items: [...li.querySelectorAll('.items .item')].map(item),
      };
    }).filter(p => p.id);
    return { pages: Math.max(1, ...pages), pledges };
  };
  const all = [];
  let pages = 1;
  for (let page = 1; page <= pages && page <= 80; page++) {
    const r = await fetch('/en/account/pledges?page=' + page, { credentials: 'include' });
    if (!r.ok) throw new Error('RSI answered ' + r.status + ' for page ' + page);
    const got = parsePage(await r.text());
    if (page === 1) pages = got.pages;
    all.push(...got.pledges);
    if (window.__rsiProgress) window.__rsiProgress(page, pages);
    await new Promise(res => setTimeout(res, 450));
  }
  return { pages, pledges: all };
})()`;

// Opens the pledges page in a hidden window and reads the whole list. Throws when the session is not logged in.
async function readPledges() {
  const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: webPreferences() });
  lockDown(win);
  try {
    await Promise.race([win.loadURL(PLEDGES_URL), sleep(45000).then(() => { throw new Error('The RSI page took too long to load'); })]);
    const url = win.webContents.getURL();
    const restricted = await win.webContents.executeJavaScript(`/restricted area|must be authenticated/i.test(document.body.innerText || '')`);
    if (/\/connect/.test(url) || restricted) throw new Error('Not connected to RSI. Connect your account in Settings first.');
    return await Promise.race([win.webContents.executeJavaScript(READ_ALL_PLEDGES), sleep(180000).then(() => { throw new Error('Reading the hangar took too long'); })]);
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

// ── Pledges -> ships ──────────────────────────────────────────────────────────
// A pledge lists what it contains: Ship, Skin (paint), Insurance ("Lifetime Insurance", "6 Month Insurance"),
// Component, Hangar decoration... Each Ship item becomes one ship. A pledge's insurance and paints belong to
// its ship(s); a package with several ships and several insurance items pairs them in order.
const insuranceLabel = (title) => {
  const t = String(title || '');
  if (/lifetime/i.test(t)) return 'LTI';
  const m = t.match(/(\d+)\s*month/i);
  return m ? m[1] + ' months' : t.replace(/\s*insurance\s*/i, '').trim() || 'Insured';
};
// A paint is named for the ship family it fits: "Starlite - Mojave Paint", "Sabre - Ashcloud Paint", "100 Series - ...".
// It fits a ship when that family name starts the ship's name ("Sabre" -> "Sabre Firebird") or sits in it.
const familyKey = (s) => String(s || '').toLowerCase().replace(/\bseries\b/g, '').replace(/[^a-z0-9]/g, '');
function skinFamily(title) {
  const t = String(title || '');
  return /\s-\s/.test(t) ? t.split(/\s-\s/)[0] : t.replace(/\b(paint|livery|skin)\b/ig, '');
}
function skinFits(skinTitle, shipTitle) {
  const fam = familyKey(skinFamily(skinTitle)), ship = familyKey(shipTitle);
  if (fam.length < 2 || ship.length < 2) return false;
  return ship.startsWith(fam) || fam.startsWith(ship) || (fam.length >= 5 && ship.includes(fam));
}

function extractShips(pledges) {
  const ships = [];
  let otherKinds = {};
  const looseSkins = [];   // paints bought on their own: a pledge with a paint and no ship
  for (const p of pledges || []) {
    const shipItems = (p.items || []).filter(i => i.kind === 'Ship');
    const insurance = (p.items || []).filter(i => i.kind === 'Insurance');
    const allPaints = (p.items || []).filter(i => i.kind === 'Skin').map(i => i.title);
    if (!shipItems.length) allPaints.forEach(t => looseSkins.push(t));
    const hangar = (p.items || []).filter(i => !i.kind && /hangar/i.test(i.title)).map(i => i.title);
    for (const i of p.items || []) if (i.kind && !['Ship', 'Insurance', 'Skin'].includes(i.kind)) otherKinds[i.kind] = (otherKinds[i.kind] || 0) + 1;
    shipItems.forEach((it, n) => {
      // in a package with several ships, each paint goes to the ship it is named for (all of them if none fits)
      const fitting = allPaints.filter(t => skinFits(t, it.title));
      const paints = shipItems.length > 1 && allPaints.some(t => shipItems.some(s => skinFits(t, s.title))) ? fitting : allPaints.slice();
      const ins = insurance.length === shipItems.length ? insurance[n] : insurance[0];
      const maker = (it.maker || '').replace(/\s*\([A-Z0-9]+\)\s*$/, '').trim();
      const code = ((it.maker || '').match(/\(([A-Z0-9]+)\)\s*$/) || [])[1] || '';
      ships.push({
        key: `${p.id}:${n}`, pledgeId: p.id, pledgeName: p.name, title: it.title, maker, makerCode: code,
        insurance: ins ? insuranceLabel(ins.title) : '', insuranceTitle: ins ? ins.title : '',
        paints, hangar, gift: !!p.gift, created: p.created, value: p.value,
      });
    });
  }
  // paints bought separately join the ships of their family; ones with no ship in the hangar are reported
  const unmatchedPaints = [];
  for (const title of looseSkins) {
    const hits = ships.filter(sh => skinFits(title, sh.title));
    if (!hits.length) { unmatchedPaints.push(title); continue; }
    hits.forEach(sh => { if (!sh.paints.includes(title)) sh.paints.push(title); });
  }
  return { ships, otherKinds, unmatchedPaints };
}

module.exports = { isConnected, connect, disconnect, readPage, readPledges, extractShips, skinFits, insuranceLabel, PLEDGES_URL, PARTITION, sess };
