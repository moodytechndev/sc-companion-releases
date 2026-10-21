#!/usr/bin/env node
// Pre-release sanity check:  npm run check
//
// 1. Every shipped JS file parses.
// 2. Nothing in the renderer calls a function that isn't defined anywhere.
// 3. The mining data lines up: every ore in Ore Locations has a scanner signature and ore properties.
//
// (2) exists because a bulk edit once deleted a block of helper functions and the
// app still launched and "mostly worked" — the missing calls only threw when the
// feature was used. Catching that needs nothing fancier than comparing the names
// being called with the names being declared.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// CHECK_ROOT lets the check be pointed at another copy of the project (used to test the check itself).
const ROOT = process.env.CHECK_ROOT ? path.resolve(process.env.CHECK_ROOT) : path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failed = false;
const fail = msg => { console.error('✗ ' + msg); failed = true; };

// ── 1. syntax ────────────────────────────────────────────────────────────────
const html = read('renderer/index.html');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const sources = {
  'main.js': read('main.js'),
  'preload.js': read('preload.js'),
  'refinery-ocr.js': read('refinery-ocr.js'),
  'contract-log.js': read('contract-log.js'),
  'scmdb.js': read('scmdb.js'),
  'rsi-hangar.js': read('rsi-hangar.js'),
  'sctrade-prices.js': read('sctrade-prices.js'),
  'renderer/i18n.js': read('renderer/i18n.js'),
  'renderer/help-content.js': read('renderer/help-content.js'),
  'renderer/help-translations.js': read('renderer/help-translations.js'),
  'renderer/item-catalog.js': read('renderer/item-catalog.js'),
  'renderer/mining-data.js': read('renderer/mining-data.js'),
  'renderer/mining-gear.js': read('renderer/mining-gear.js'),
  'renderer/special-blueprints.js': read('renderer/special-blueprints.js'),
  'renderer/index.html (inline script)': inline.join('\n;\n'),
};
for (const [name, src] of Object.entries(sources)) {
  try { new vm.Script(src, { filename: name }); console.log('✓ parses  ' + name); }
  catch (e) { fail(`${name}: ${e.message}`); }
}

// ── 2. undefined call targets ────────────────────────────────────────────────
// Split source into real code vs. strings/comments so words in prose or data
// ("Terminus (Pyro VI)") aren't mistaken for calls. Template literals keep only
// their ${...} expressions; inline handlers (onclick="fn(…)") are read separately.
function codeOnly(src) {
  let out = '';
  const modes = [];            // what to return to when a template literal ends
  const depth = [];            // brace depth inside each active ${ ... }
  let mode = 'code';           // 'code' | 'tpl' | 'expr'
  let lastSig = '';            // last significant char in code — decides if "/" starts a regex

  const BS = String.fromCharCode(92); // a backslash
  const skipString = (i, q) => { i++; while (i < src.length && src[i] !== q) { if (src[i] === BS) i++; i++; } return i; };
  const skipRegex = (i) => {
    i++;
    let inClass = false;
    while (i < src.length) {
      const ch = src[i];
      if (ch === BS) { i += 2; continue; }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) break;
      i++;
    }
    return i;
  };
  const regexAllowed = () => lastSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSig) || /(return|typeof|case|in|of)$/.test(out.slice(-8).trim());

  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === 'tpl') {
      if (c === BS) { i++; continue; }
      if (c === '`') { mode = modes.pop(); continue; }
      if (c === '$' && n === '{') { modes.push('tpl'); mode = 'expr'; depth.push(1); out += ' ( '; i++; }
      continue;
    }
    // code or expr
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === "'" || c === '"') { i = skipString(i, c); out += '""'; lastSig = '"'; continue; }
    if (c === '/' && regexAllowed()) { i = skipRegex(i); out += '/r/'; lastSig = ')'; continue; }
    if (c === '`') { modes.push(mode); mode = 'tpl'; out += '""'; lastSig = '"'; continue; }
    if (mode === 'expr') {
      if (c === '{') depth[depth.length - 1]++;
      else if (c === '}') {
        depth[depth.length - 1]--;
        if (depth[depth.length - 1] === 0) { depth.pop(); mode = modes.pop(); out += ' ) '; continue; }
      }
    }
    out += c;
    if (!/\s/.test(c)) lastSig = c;
  }
  return out;
}

const scriptSrc = inline.join('\n');
const code = codeOnly(scriptSrc) + '\n' + codeOnly(sources['renderer/i18n.js']) + '\n' + codeOnly(sources['renderer/help-content.js']) + '\n' + codeOnly(sources['renderer/help-translations.js']);

const declared = new Set();
const grab = (re, fn) => { for (const m of code.matchAll(re)) fn(m); };
grab(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g, m => declared.add(m[1]));
grab(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, m => declared.add(m[1]));
grab(/\b(?:const|let|var)\s*\{([^}]*)\}/g, m => m[1].split(',').forEach(x => declared.add(x.split(':').pop().split('=')[0].trim())));
grab(/\b(?:const|let|var)\s*\[([^\]]*)\]/g, m => m[1].split(',').forEach(x => declared.add(x.trim())));
grab(/\(([^()]*)\)\s*=>/g, m => m[1].split(',').forEach(x => declared.add(x.trim().replace(/^\.\.\./, '').split('=')[0].trim())));
grab(/\b([A-Za-z_$][\w$]*)\s*=>/g, m => declared.add(m[1]));
grab(/function\s*[\w$]*\s*\(([^)]*)\)/g, m => m[1].split(',').forEach(x => declared.add(x.trim().replace(/^\.\.\./, '').split('=')[0].trim())));
grab(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g, m => declared.add(m[1]));
grab(/\bfor\s*\(\s*(?:const|let|var)\s*(?:\[([^\]]*)\]|([A-Za-z_$][\w$]*))/g, m => (m[1] || m[2] || '').split(',').forEach(x => declared.add(x.trim())));

const GLOBALS = new Set(`if for while switch catch function return typeof await async new delete void else do
  parseInt parseFloat isNaN isFinite Number String Boolean Array Object Math JSON Date Set Map WeakMap Promise Error RegExp
  Symbol Intl URL URLSearchParams Blob File FileReader Event CustomEvent MouseEvent KeyboardEvent Image Option Notification
  fetch setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame alert confirm prompt
  encodeURIComponent decodeURIComponent encodeURI decodeURI structuredClone queueMicrotask atob btoa
  require module exports console document window navigator location localStorage sessionStorage getComputedStyle
  api super this var rgb rgba hsl calc translateX translateY translate scale rotate url`.split(/\s+/));

const undefinedCalls = new Map();
const note = (name, where) => { if (!declared.has(name) && !GLOBALS.has(name) && !undefinedCalls.has(name)) undefinedCalls.set(name, where); };
for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) note(m[1], 'script');
// inline handlers live in the HTML text and inside template literals
for (const m of (html + '\n' + scriptSrc).matchAll(/\bon(?:click|change|input|toggle|mouseover|mouseout|keydown|keyup|submit)\s*=\s*"([^"]*)"/g)) {
  const body = m[1].replace(/\$\{[^}]*\}/g, '0');                 // template placeholders
  for (const c of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) note(c[1], `inline handler: ${m[1].slice(0, 60)}`);
}

if (undefinedCalls.size) {
  fail(`${undefinedCalls.size} call(s) to functions that are not defined:`);
  for (const [n, w] of undefinedCalls) console.error(`    ${n.padEnd(30)} ${w}`);
} else {
  console.log(`✓ no undefined call targets (${declared.size} declarations checked)`);
}

// ── 3. mining data consistency ───────────────────────────────────────────────
// Picking an ore in Ore Locations filters the Scanner Reference by name, so an ore without a
// signature row silently shows nothing there (Copper did). The three tables are kept by hand or
// generated separately, so compare them.
{
  const grabBlock = (startRe, endStr) => {
    const m = startRe.exec(scriptSrc);
    if (!m) return null;
    const at = m.index + m[0].length;
    return scriptSrc.slice(at, scriptSrc.indexOf(endStr, at));
  };
  try {
    const oreBody = grabBlock(/const ORE_DATA = \{/, '\n};');
    const sigBody = grabBlock(/const SIGNATURE_DATA = \[/, '\n];');
    const oreNames = [...oreBody.matchAll(/^  '?"?([A-Z][A-Za-z ]+?)'?"?:\s*\[/gm)].map(m => m[1]);
    const sigNames = new Set([...sigBody.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]));
    const props = new vm.Script(read('renderer/mining-data.js') + ';MINING_ORES').runInNewContext({});
    if (!oreNames.length || !sigNames.size) throw new Error('could not read ORE_DATA / SIGNATURE_DATA');
    const noSig = oreNames.filter(n => !sigNames.has(n));
    const noProps = oreNames.filter(n => !props[n.toLowerCase()]);
    if (noSig.length) fail(`ores in Ore Locations with no scanner signature (they vanish from the Scanner Reference): ${noSig.join(', ')}`);
    if (noProps.length) fail(`ores in Ore Locations with no game properties in mining-data.js: ${noProps.join(', ')}`);
    // a signature of 3,000 is hand-mined rock, 4,000 ground-vehicle rock, anything else ship rock: the ore must be minable that way
    const wrong = [];
    for (const m of sigBody.matchAll(/name:\s*'([^']+)',\s*sig:\s*(\d+)/g)) {
      const method = Number(m[2]) === 3000 ? 'hand' : Number(m[2]) === 4000 ? 'vehicle' : 'ship';
      const p = props[m[1].toLowerCase()];
      if (p && p.methods && !p.methods.includes(method)) wrong.push(`${m[1]} (${m[2]} is ${method} rock, the game lists ${p.methods.join('/')})`);
    }
    if (wrong.length) fail('scanner signatures that disagree with how the ore is mined: ' + wrong.join(', '));
    if (!noSig.length && !noProps.length && !wrong.length) console.log(`✓ mining data lines up (${oreNames.length} ores, ${sigNames.size} signatures, mining methods)`);
  } catch (e) { fail('mining data check could not run: ' + e.message); }
}

// ── 4. packaged files ─────────────────────────────────────────────────────────
// package.json lists the files electron-builder ships. A module main.js requires that is not on the
// list is missing from the installed app, which then fails at start-up (the source tree still works).
{
  const listed = (JSON.parse(read('package.json')).build || {}).files || [];
  const missing = [];
  for (const f of ['main.js', 'preload.js']) {
    for (const m of read(f).matchAll(/require\('\.\/([\w.-]+)'\)/g)) {
      if (m[1].endsWith('.json')) continue;                 // package.json always ships
      const file = m[1].endsWith('.js') ? m[1] : m[1] + '.js';
      if (!listed.includes(file)) missing.push(`${file} (required by ${f})`);
    }
  }
  if (missing.length) fail('required by the app but not in package.json build.files: ' + missing.join(', '));
  else console.log('✓ every module the app requires is in the packaged file list');
}

console.log(failed ? '\nCHECK FAILED' : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
