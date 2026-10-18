#!/usr/bin/env node
'use strict';
// Reads the mining records out of the player's Star Citizen install and prints/writes what the
// game says about every mineable element (instability, resistance, optimal charge window…) and every
// rock composition (which elements, in what share, which rarity tier):
//
//   node scripts/gamedata/extract-mining.js [path to the StarCitizen\LIVE folder] [--write]
//
// With --write it saves renderer/mining-data.js; without it, it only prints a report.

const fs = require('fs');
const path = require('path');
const { P4K } = require('./p4k');
const { DCB } = require('./dcb');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const install = args.find(a => !a.startsWith('--')) || ['E:/Program/StarCitizen/LIVE', 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE'].find(p => fs.existsSync(path.join(p, 'Data.p4k')));
if (!install) { console.error('Pass the StarCitizen\\LIVE folder as the first argument.'); process.exit(1); }

const p4k = new P4K(path.join(install, 'Data.p4k'));
const { entries } = p4k.listEntries();
const d = new DCB(p4k.extract(p4k.find(entries, 'Data\\Game2.dcb')));
const loc = new Map();
const iniPath = path.join(install, 'Data', 'Localization', 'english', 'global.ini');
for (const line of fs.readFileSync(iniPath, 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0) loc.set(line.slice(0, i).replace(/,P$/, '').toLowerCase(), line.slice(i + 1).trim());
}
const L = (k) => (k ? loc.get(String(k).replace(/^@/, '').toLowerCase()) || '' : '');
const byId = new Map(d.records.map(r => [r.id, r]));
const rec = (ref) => (ref && ref.ref ? byId.get(ref.ref) : null);
const short = (r) => (r ? r.file.replace(/^libs\/foundry\/records\//, '').replace(/\.xml$/, '') : '');
const round = (x, n = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : x);

// ── mineable elements: the physical properties of each ore ──────────────────────
const elements = {};
for (const r of d.records) {
  if (!/^libs\/foundry\/records\/mining\/mineableelements\//.test(r.file)) continue;
  const o = d.readInstance(r.struct, r.inst, 2);
  const rt = rec(o.resourceType);
  const nameKey = rt ? (d.readInstance(rt.struct, rt.inst, 2).displayName || '') : '';
  const id = path.basename(r.file, '.xml');
  elements[id] = {
    id, name: L(nameKey) || id.replace(/_raw$/, '').replace(/^\w/, c => c.toUpperCase()),
    instability: round(o.elementInstability, 1), resistance: round(o.elementResistance),
    optimalWindowMid: round(o.elementOptimalWindowMidpoint), optimalWindowRandom: round(o.elementOptimalWindowMidpointRandomness),
    optimalWindowThinness: round(o.elementOptimalWindowThinness), explosionMultiplier: round(o.elementExplosionMultiplier, 1),
    clusterFactor: round(o.elementClusterFactor),
  };
}

// ── rock compositions: which elements make up a rock ────────────────────────────
const compositions = [];
for (const r of d.records) {
  const m = r.file.match(/^libs\/foundry\/records\/mining\/rockcompositionpresets\/(asteroidshipmining|surfaceshipmining|[a-z]+)\/(.+)\.xml$/);
  if (!m || d.structs[r.struct].name !== 'MineableComposition') continue;
  const o = d.readInstance(r.struct, r.inst, 3);
  const parts = (o.compositionArray || []).map(p => {
    const el = rec(p.mineableElement);
    return { element: el ? path.basename(el.file, '.xml') : '?', min: round(p.minPercentage, 1), max: round(p.maxPercentage, 1), probability: round(p.probability), qualityScale: round(p.qualityScale) };
  });
  const tier = (m[2].match(/^(common|uncommon|rare|epic|legendary)/) || [])[1] || '';
  compositions.push({ id: m[2], where: m[1], tier, deposit: L(o.depositName), minDistinct: o.minimumDistinctElements, parts });
}

console.log(`elements: ${Object.keys(elements).length}, compositions: ${compositions.length}`);
console.log('\nELEMENT                 instab  resist  window(mid±rand, thin)   explosion  cluster');
for (const e of Object.values(elements).sort((a, b) => b.instability - a.instability)) {
  console.log(`${e.name.padEnd(22)} ${String(e.instability).padStart(6)}  ${String(e.resistance).padStart(6)}  ${String(e.optimalWindowMid).padStart(4)}±${String(e.optimalWindowRandom).padEnd(5)} ${String(e.optimalWindowThinness).padEnd(5)}      ${String(e.explosionMultiplier).padStart(7)}  ${e.clusterFactor}`);
}
console.log('\nCOMPOSITIONS (tier · where · deposit · elements min–max%)');
for (const c of compositions.sort((a, b) => a.where.localeCompare(b.where) || a.id.localeCompare(b.id))) {
  if (/template/.test(c.id)) continue;
  console.log(`${(c.tier || '-').padEnd(10)} ${c.where.padEnd(16)} ${(c.deposit || c.id).padEnd(26)} ` +
    c.parts.map(p => `${(elements[p.element] || { name: p.element }).name} ${p.min}-${p.max}%`).join(', '));
}

// ── one row per ore, keyed by lower-case base name ("quantainium"), for the app ─────────────
// Keyed by the ore's display name without "(Raw)/(Ore)/(Pure)", lower-case — the game's ids are not
// consistent ("sileron_ore" for Stileron, "aluminium_ore" for Aluminum). Ship-mining elements win
// over the hand-mining (FPS) and ground-vehicle variants of the same name.
const SPECIAL = { heph: 'hephaestanite' };
const oreKey = (e) => { const k = e.name.replace(/\s*\((raw|ore|pure)\)\s*$/i, '').trim().toLowerCase(); return SPECIAL[k] || k; };
const rank = (e) => (/minableelement_fps/.test(e.id) ? 4 : /groundvehicle/.test(e.id) ? 3 : /_raw$/.test(e.id) ? 0 : /_ore$/.test(e.id) ? 1 : /_pure$/.test(e.id) ? 5 : 2);
const ores = {};
const keyOfId = {};
for (const e of Object.values(elements).sort((x, y) => rank(x) - rank(y))) {
  const k = oreKey(e);
  keyOfId[e.id] = k;
  if (ores[k] || /placeholder|^test/i.test(e.name) || /template|testelement/.test(e.id)) continue;
  ores[k] = { instability: e.instability, resistance: e.resistance, window: [e.optimalWindowMid, e.optimalWindowRandom, e.optimalWindowThinness], explosion: e.explosionMultiplier, cluster: e.clusterFactor };
}
// the rarity tier of an ore = the tier of the rocks whose main element it is
for (const c of compositions) {
  if (/template/.test(c.id) || !c.tier || !c.parts.length) continue;
  const k = keyOfId[c.parts[0].element];
  if (ores[k] && !ores[k].tier) ores[k].tier = c.tier;
}

if (write) {
  const info = (() => { try { return JSON.parse(fs.readFileSync(path.join(install, 'build_manifest.id'), 'utf8')).Data; } catch { return {}; } })();
  const lines = Object.entries(ores).sort().map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v));
  const out = `// Generated by scripts/gamedata/extract-mining.js from the Star Citizen install — do not edit by hand.
// Per ore, as the game stores it: instability, resistance (0–1), the optimal charge window
// [midpoint, per-rock randomness, thinness], explosion multiplier, cluster factor, and the rarity tier.
const MINING_DATA_INFO = ${JSON.stringify({ game: info.Version || '', branch: info.Branch || '' })};
const MINING_ORES = {
${lines.join(',\n')}
};
`;
  fs.writeFileSync(path.join(ROOT, 'renderer', 'mining-data.js'), out);
  console.log(`\nwrote renderer/mining-data.js (${Object.keys(ores).length} ores)`);
}
