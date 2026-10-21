#!/usr/bin/env node
'use strict';
// Compares the scanner signature table in the app (SIGNATURE_DATA in renderer/index.html) with the
// radar signatures the game gives each mineable rock type, and reports what differs:
//
//   node scripts/gamedata/extract-signatures.js [path to the StarCitizen\LIVE folder]
//
// It only reports; it changes nothing. Re-run after a patch and edit SIGNATURE_DATA by hand for
// anything listed (an ore with a new or changed signature, or an ore the table doesn't have).

const fs = require('fs');
const path = require('path');
const { P4K } = require('./p4k');
const { DCB } = require('./dcb');

const ROOT = path.resolve(__dirname, '..', '..');
const install = process.argv.slice(2).find(a => !a.startsWith('--')) || ['E:/Program/StarCitizen/LIVE', 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE'].find(p => fs.existsSync(path.join(p, 'Data.p4k')));
if (!install) { console.error('Pass the StarCitizen\\LIVE folder as the first argument.'); process.exit(1); }

// what the app has
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const block = html.slice(html.indexOf('const SIGNATURE_DATA = ['));
const table = [...block.slice(0, block.indexOf('\n];')).matchAll(/name:\s*'([^']+)',\s*sig:\s*(\d+)/g)].map(m => [m[1], Number(m[2])]);

// what the game has: one record per rock type, named like mineablerock_asteroidcommon_copper
const p4k = new P4K(path.join(install, 'Data.p4k'));
const { entries } = p4k.listEntries();
const d = new DCB(p4k.extract(p4k.find(entries, 'Data\\Game2.dcb')));
const NULLP = 4294967295;
const deep = (x, dep = 6) => {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(v => deep(v, dep));
  if ((x.ptr || x.weak) && !x._type) { const p = x.ptr || x.weak; return p[0] === NULLP || dep <= 0 ? null : deep(d.resolve(x, 3), dep - 1); }
  if ('ref' in x && 'inst' in x) return null;
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deep(v, dep)]));
};
const game = new Map();                                   // ore -> Set of signatures
for (const r of d.records) {
  const m = r.file.match(/entities\/mineable\/mineablerock_(?:asteroid|surface|fps|groundvehicle)[a-z]*?_?([a-z]+?)(?:_(?:small|large|pure_small|rcd_large|rcd_small))?\.xml$/);
  if (!m || /template|test|placeholder|pearls|flowstone|blocker/.test(r.file)) continue;
  const o = d.readInstance(r.struct, r.inst, 1);
  const c = (o.Components || []).find(x => x && x.ptr && d.structs[x.ptr[0]] && d.structs[x.ptr[0]].name === 'SSCSignatureSystemParams');
  if (!c) continue;
  const p = deep(d.resolve(c, 4));
  const sig = p && p.radarProperties && p.radarProperties.baseSignatureParams && p.radarProperties.baseSignatureParams.signatures;
  if (!sig || !sig[4]) continue;
  const name = m[1].replace(/^./, ch => ch.toUpperCase()).replace('Aluminium', 'Aluminum');
  if (!game.has(name)) game.set(name, new Set());
  game.get(name).add(sig[4]);
}

let problems = 0;
const say = (s) => { problems++; console.log('  ' + s); };
const inApp = new Map();
for (const [n, s] of table) { if (!inApp.has(n)) inApp.set(n, new Set()); inApp.get(n).add(s); }
console.log(`app table: ${table.length} rows, ${inApp.size} ores; game: ${game.size} ores with a rock signature`);
for (const [n, sigs] of game) {
  if (!inApp.has(n)) { say(`MISSING from the app: ${n} = ${[...sigs].join(' / ')}`); continue; }
  for (const s of sigs) if (!inApp.get(n).has(s)) say(`DIFFERENT: ${n} — game ${s}, app ${[...inApp.get(n)].join(' / ')}`);
}
for (const n of inApp.keys()) if (!game.has(n)) say(`in the app but no rock record in the game: ${n}`);
console.log(problems ? `${problems} difference(s)` : 'the app\'s signature table matches the game');
