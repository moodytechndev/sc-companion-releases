#!/usr/bin/env node
'use strict';
// Translation tables for SC Companion.
//
//   node scripts/translations.js export
//       Writes translations/ui-strings.csv and translations/hover-hints.csv — one row per
//       string, one column per language the app has — ready to hand to translators.
//
//   node scripts/translations.js import [ui-strings.csv] [hover-hints.csv] [guide-strings.csv]
//       Reads those files back (a translator adds a column headed with the language code,
//       e.g. "it") and merges every column into renderer/i18n.js. A language whose column
//       is unchanged is left exactly as it is. Prints the dropdown line to add for a new language.
//
// guide-strings.csv holds the user guide (renderer/help-content.js); its translations live in
// renderer/help-translations.js.
//
// The CSV files are UTF-8 with a byte-order mark so Excel opens them correctly; Google Sheets
// reads them as is.

const fs = require('fs');
const path = require('path');

// OneDrive can hold a file for a moment: retry. If a spreadsheet still has it open (Excel locks
// CSVs), write the same data beside it as "<name>.new.csv" and say so, instead of failing.
function writeSafe(file, data) {
  for (let i = 0; ; i++) {
    try { return fs.writeFileSync(file, data); }
    catch (e) {
      if (!/^(EBUSY|EPERM|EACCES)$/.test(e.code)) throw e;
      if (i >= 6) {
        const alt = file.replace(/(\.[^.\\/]+)$/, '.new$1');
        fs.writeFileSync(alt, data);
        console.log(`warning: ${path.basename(file)} is open in another program — wrote ${path.basename(alt)} instead`);
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
}

const ROOT = path.resolve(__dirname, '..');
const I18N = path.join(ROOT, 'renderer', 'i18n.js');
const INDEX = path.join(ROOT, 'renderer', 'index.html');
const OUT = path.join(ROOT, 'translations');
const UI_CSV = path.join(OUT, 'ui-strings.csv');
const HINT_CSV = path.join(OUT, 'hover-hints.csv');
const GUIDE_CSV = path.join(OUT, 'guide-strings.csv');
const HELP_CONTENT = path.join(ROOT, 'renderer', 'help-content.js');
const HELP_TR = path.join(ROOT, 'renderer', 'help-translations.js');

// ── load the current tables ────────────────────────────────────────────────────
function load() {
  const src = fs.readFileSync(I18N, 'utf8');
  const sb = {};
  new Function('sb', src + '\nsb.T = TRANSLATIONS; sb.H = HINT_TRANSLATIONS;')(sb);
  return { src, T: sb.T, H: sb.H };
}

// every hover hint the app can show, as written in index.html (English)
function appHints() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const a = html.indexOf('const HINTS_BY_CALL = {');
  const b = html.indexOf('let hoverHintsOn');
  const ctx = {};
  new Function('ctx', html.slice(a, b) + '\nctx.all = [...Object.values(HINTS_BY_CALL), ...Object.values(HINTS_BY_ID), ...HINTS_BY_ID_PREFIX.map(x => x[1]), ...HINTS_BY_SELECTOR.map(x => x[1])];')(ctx);
  const set = new Set(ctx.all.filter(Boolean));
  for (const m of html.matchAll(/\b(?:title|data-tip)="([^"$<>]{4,})"/g)) {
    set.add(m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
  }
  return [...set].sort((x, y) => x.localeCompare(y));
}

// ── CSV ────────────────────────────────────────────────────────────────────────
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (rows) => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

// ── export ─────────────────────────────────────────────────────────────────────
const LANG_ORDER = ['en', 'de', 'fr', 'es', 'pl', 'pt', 'ru', 'ja'];
const LANG_NAMES = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', pl: 'Polski', pt: 'Português', ru: 'Русский', ja: '日本語' };
const AREAS = {
  tab: 'Tab names', refinery: 'Refinery tab', mining: 'Mining tab', prices: 'Prices tab', craft: 'Hangar tab',
  update: 'Update banner', settings: 'Settings', status: 'Status bar', modal: 'Dialogs', job: 'Refinery job cards', toast: 'Pop-up messages',
};
const NOTES = {
  'update.available': '{0} is replaced by the version number — keep it',
  'job.started': '{0} is replaced by a time — keep it',
  'job.complete.toastAt': '{0} is replaced by a station name — keep it',
  'status.activeJobs_one': '{n} is the number of jobs. Singular form (1 job)',
  'status.activeJobs_other': '{n} is the number of jobs. Plural / default form',
  'status.activeJobs_few': 'ONLY for languages with a "few" plural (Polish, Russian…, 2–4). Leave blank otherwise',
  'status.activeJobs_many': 'ONLY for languages with a "many" plural (Polish, Russian…, 5+). Leave blank otherwise',
  'settings.logPath.desc': '"Sell" is the in-game button name — keep it',
  'craft.mostSCU': 'SCU is the in-game cargo unit — keep it',
};

function doExport() {
  const { T, H } = load();
  const langs = LANG_ORDER.filter(l => T[l]).concat(Object.keys(T).filter(l => !LANG_ORDER.includes(l)));
  fs.mkdirSync(OUT, { recursive: true });

  const keys = Object.keys(T.en);
  // plural forms for languages that need more than one/other
  for (const extra of ['status.activeJobs_few', 'status.activeJobs_many']) if (!keys.includes(extra)) keys.push(extra);
  const header = ['key', 'where it appears', 'English', ...langs.filter(l => l !== 'en').map(l => l), 'note'];
  const uiRows = [header, ['', '', '', ...langs.filter(l => l !== 'en').map(l => LANG_NAMES[l] || ''), '(language name — for reference)']];
  for (const k of keys) {
    uiRows.push([
      k, AREAS[k.split('.')[0]] || '', T.en[k] || (k.endsWith('_few') || k.endsWith('_many') ? T.en['status.activeJobs_other'] : ''),
      ...langs.filter(l => l !== 'en').map(l => (T[l] && T[l][k]) || ''),
      NOTES[k] || '',
    ]);
  }
  writeSafe(UI_CSV, toCsv(uiRows));

  const hints = appHints();
  const prefix = Object.keys(H.de || {}).filter(k => k.endsWith(': '));
  const hRows = [['English', ...langs.filter(l => l !== 'en'), 'note'],
    ['', ...langs.filter(l => l !== 'en').map(l => LANG_NAMES[l] || ''), '(language name — for reference)']];
  for (const h of hints) {
    hRows.push([h, ...langs.filter(l => l !== 'en').map(l => (H[l] && H[l][h]) || ''), '']);
  }
  for (const p of prefix) {
    hRows.push([p, ...langs.filter(l => l !== 'en').map(l => (H[l] && H[l][p]) || ''),
      'A label shown before a live value (e.g. "Best sell: " + a station name). Keep the trailing space/colon style.']);
  }
  writeSafe(HINT_CSV, toCsv(hRows));
  console.log(`wrote ${path.relative(ROOT, UI_CSV)} (${keys.length} strings) and ${path.relative(ROOT, HINT_CSV)} (${hints.length + prefix.length} hints)`);
}

// ── import ─────────────────────────────────────────────────────────────────────
const q = (s) => JSON.stringify(s);
const RESERVED = new Set(['key', 'where it appears', 'english', 'note', 'notes', 'context', 'placeholders']);

function langColumns(header) {
  return header.map((h, i) => ({ code: h.trim().toLowerCase(), i })).filter(c => c.code && !RESERVED.has(c.code) && /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(c.code));
}

function replaceOrInsertBlock(src, sectionStart, sectionEnd, lang, body) {
  const a = src.indexOf(sectionStart);
  const b = src.indexOf(sectionEnd, a);
  if (a < 0 || b < 0) throw new Error('i18n.js markers not found: ' + sectionStart);
  const section = src.slice(a, b);
  const open = section.indexOf(`\n  ${lang}: {`);
  if (open >= 0) {
    const close = section.indexOf('\n  },', open);
    if (close < 0) throw new Error('block end not found for ' + lang);
    return src.slice(0, a) + section.slice(0, open) + '\n' + body.replace(/\n$/, '') + section.slice(close + '\n  },'.length) + src.slice(b);
  }
  return src.slice(0, a) + section + '\n' + body + src.slice(b);
}

function doImport(uiPath, hintPath) {
  let { src, T, H } = load();
  const crlf = src.includes('\r\n');
  if (crlf) src = src.replace(/\r\n/g, '\n');
  const added = new Set();
  const changes = [];

  if (fs.existsSync(uiPath)) {
    const rows = parseCsv(fs.readFileSync(uiPath, 'utf8'));
    const header = rows[0];
    const keyCol = header.findIndex(h => h.trim().toLowerCase() === 'key');
    if (keyCol < 0) throw new Error('ui-strings.csv has no "key" column');
    const PH = /\{[0-9n]\}/g;
    for (const { code, i } of langColumns(header)) {
      const next = {};
      for (const r of rows.slice(1)) {
        const k = (r[keyCol] || '').trim();
        const v = (r[i] || '').trim();
        if (!k || !v) continue;
        const en = T.en[k] || T.en['status.activeJobs_other'];
        const a = (en.match(PH) || []).sort().join(), b = (v.match(PH) || []).sort().join();
        if (a !== b) console.log(`warning: ${code} "${k}" — placeholders differ from English (${a || 'none'} vs ${b || 'none'})`);
        next[k] = v;
      }
      const cur = T[code] || {};
      const same = Object.keys(next).every(k => cur[k] === next[k]);          // keys only the app still has are not churned
      if (same || !Object.keys(next).length) continue;
      const body = `  ${code}: {\n${Object.entries(next).map(([k, v]) => `    ${q(k)}: ${q(v)},`).join('\n')}\n  },\n`;
      src = replaceOrInsertBlock(src, 'const TRANSLATIONS = {', "};\n\nlet currentLang", code, body);
      if (!T[code]) added.add(code);
      changes.push(`ui: ${code} (${Object.keys(next).length} strings)`);
    }
  }

  if (fs.existsSync(hintPath)) {
    const rows = parseCsv(fs.readFileSync(hintPath, 'utf8'));
    const header = rows[0];
    const enCol = header.findIndex(h => h.trim().toLowerCase() === 'english');
    if (enCol < 0) throw new Error('hover-hints.csv has no "English" column');
    for (const { code, i } of langColumns(header)) {
      const next = {};
      for (const r of rows.slice(1)) {
        const k = r[enCol];
        const v = (r[i] || '').trim();
        if (!k || !v) continue;
        next[k] = k.endsWith(' ') && !v.endsWith(' ') ? v + ' ' : v;     // prefixes end in a space
      }
      const cur = H[code] || {};
      const same = Object.keys(next).every(k => cur[k] === next[k]);          // keys only the app still has are not churned
      if (same || !Object.keys(next).length) continue;
      const body = `  ${code}: {\n${Object.entries(next).map(([k, v]) => `    ${q(k)}: ${q(v)},`).join('\n')}\n  },\n`;
      src = replaceOrInsertBlock(src, 'const HINT_TRANSLATIONS = {', "};\n\n// Looks up a hint's translation", code, body);
      if (!T[code]) added.add(code);
      changes.push(`hints: ${code} (${Object.keys(next).length} hints)`);
    }
  }

  if (!changes.length) { console.log('nothing changed'); return; }
  writeSafe(I18N, crlf ? src.replace(/\n/g, '\r\n') : src);
  console.log('updated renderer/i18n.js:\n  ' + changes.join('\n  '));
  for (const code of added) {
    console.log(`\nNew language "${code}": add this line to the <select id="language-select"> in renderer/index.html:\n  <option value="${code}">${LANG_NAMES[code] || code}</option>`);
  }
}


// ── user guide ─────────────────────────────────────────────────────────────────
const GUIDE_UI = {
  'ui.search': 'Placeholder of the guide search box',
  'ui.expand': 'Button: expand all sections',
  'ui.collapse': 'Button: collapse all sections',
  'ui.empty': 'Shown when a guide search finds nothing',
  'ui.howto': 'Sub-heading above step-by-step instructions',
  'ui.tips': 'Sub-heading above tips',
  'ui.note': 'One-line note at the top of the guide in non-English languages (screenshots are English)',
};
function guideEnglish() {
  const sb = {};
  new Function('sb', fs.readFileSync(HELP_CONTENT, 'utf8') + '\nsb.S = HELP_SECTIONS; sb.H = HELP_SHOTS;')(sb);
  const out = new Map();
  const add = (k, v) => { if (v != null && v !== '') out.set(k, v); };
  for (const s of sb.S) {
    add(`sec.${s.id}.title`, s.title);
    (s.intro || []).forEach((t, i) => add(`sec.${s.id}.intro.${i}`, t));
    (s.howto || []).forEach((t, i) => add(`sec.${s.id}.howto.${i}`, t));
    (s.tips || []).forEach((t, i) => add(`sec.${s.id}.tips.${i}`, t));
    (s.faq || []).forEach(([q, a], i) => { add(`sec.${s.id}.faq.${i}.q`, q); add(`sec.${s.id}.faq.${i}.a`, a); });
  }
  for (const [id, h] of Object.entries(sb.H)) {
    add(`shot.${id}.title`, h.title); add(`shot.${id}.caption`, h.caption);
    h.points.forEach((p, i) => add(`shot.${id}.point.${i}`, p.text));
  }
  return out;
}
function loadGuideTr() {
  if (!fs.existsSync(HELP_TR)) return {};
  const sb = {};
  new Function('sb', fs.readFileSync(HELP_TR, 'utf8') + '\nsb.T = HELP_TRANSLATIONS;')(sb);
  return sb.T || {};
}
function writeGuideTr(map) {
  const body = Object.entries(map).map(([l, m]) =>
    `  ${l}: {\n${Object.entries(m).map(([k, v]) => `    ${q(k)}: ${q(v)},`).join('\n')}\n  },`).join('\n');
  writeSafe(HELP_TR, `// Translations of the user guide (help-content.js). A flat key → text table per language:
//   sec.<id>.title | intro.N | howto.N | tips.N | faq.N.q / faq.N.a
//   shot.<id>.title | caption | point.N          ui.* = the guide's own chrome
// Anything missing falls back to the English in help-content.js. Edit via
// translations/guide-strings.csv and \`node scripts/translations.js import\`.
const HELP_TRANSLATIONS = {
${body}
};
`);
}
function exportGuide() {
  const en = guideEnglish();
  const tr = loadGuideTr();
  const langs = LANG_ORDER.filter(l => l !== 'en' && tr[l]).concat(Object.keys(tr).filter(l => !LANG_ORDER.includes(l)));
  const rows = [['key', 'where it appears', 'English', ...langs, 'note']];
  const row = (k, e, where, note) => rows.push([k, where, e, ...langs.map(l => (tr[l] && tr[l][k]) || ''), note || '']);
  for (const [k, d] of Object.entries(GUIDE_UI)) row(k, k === 'ui.search' ? 'Search the user guide…' : k === 'ui.expand' ? 'Expand all' : k === 'ui.collapse' ? 'Collapse' :
    k === 'ui.empty' ? 'Nothing in the guide matches that.' : k === 'ui.howto' ? 'How to' : k === 'ui.tips' ? 'Good to know' :
    'The screenshots show the English interface; the numbers match the list below.', 'Guide chrome', d);
  for (const [k, e] of en) {
    const where = k.startsWith('sec.') ? 'Section: ' + k.split('.')[1] : 'Screenshot: ' + k.split('.')[1];
    row(k, e, where, e.includes('**') ? 'Keep each **…** pair — it makes the words between bold' : '');
  }
  writeSafe(GUIDE_CSV, toCsv(rows));
  console.log(`wrote ${path.relative(ROOT, GUIDE_CSV)} (${rows.length - 1} strings)`);
}
function importGuide(guidePath) {
  if (!fs.existsSync(guidePath)) return [];
  const rows = parseCsv(fs.readFileSync(guidePath, 'utf8'));
  const header = rows[0];
  const keyCol = header.findIndex(h => h.trim().toLowerCase() === 'key');
  const enCol = header.findIndex(h => h.trim().toLowerCase() === 'english');
  if (keyCol < 0) throw new Error('guide-strings.csv has no "key" column');
  const tr = loadGuideTr();
  const changes = [];
  for (const { code, i } of langColumns(header)) {
    const cur = tr[code] || {};
    const next = { ...cur };
    let n = 0;
    for (const r of rows.slice(1)) {
      const k = (r[keyCol] || '').trim();
      const v = (r[i] || '').trim();
      if (!k || !v || next[k] === v) continue;
      const en = enCol >= 0 ? r[enCol] || '' : '';
      if ((en.match(/\*\*/g) || []).length !== (v.match(/\*\*/g) || []).length) console.log(`warning: ${code} "${k}" — ** pairs differ from English`);
      next[k] = v; n++;
    }
    if (n) { tr[code] = next; changes.push(`guide: ${code} (${n} strings changed)`); }
  }
  if (changes.length) writeGuideTr(tr);
  return changes;
}

const [cmd, a1, a2, a3] = process.argv.slice(2);
if (cmd === 'export') { doExport(); exportGuide(); }
else if (cmd === 'import') {
  doImport(a1 || UI_CSV, a2 || HINT_CSV);
  const g = importGuide(a3 || GUIDE_CSV);
  if (g.length) console.log(['updated renderer/help-translations.js:', ...g.map(x => '  ' + x)].join('\n'));
}
else console.log('usage: node scripts/translations.js export | import [ui-strings.csv] [hover-hints.csv] [guide-strings.csv]');
