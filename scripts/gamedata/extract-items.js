#!/usr/bin/env node
'use strict';
// Builds renderer/item-catalog.js — the list of items the Add Asset dialog can suggest — from
// the player's own Star Citizen install:
//
//   node scripts/gamedata/extract-items.js [path to the StarCitizen\LIVE folder]
//
// It reads Data\Game2.dcb (the game's record database) out of Data.p4k, walks every item
// entity, and turns each into a short row: in-game name, the asset type the app files it
// under, size/grade for ship components, manufacturer and the item's class name. Names come from
// the game's own English localisation file. Nothing in the game folder is modified.
// Re-run it after a patch to refresh the catalog.

const fs = require('fs');
const path = require('path');
const { P4K } = require('./p4k');
const { DCB } = require('./dcb');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'renderer', 'item-catalog.js');
const GUESSES = ['E:/Program/StarCitizen/LIVE', 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE', 'D:/Roberts Space Industries/StarCitizen/LIVE'];
const install = process.argv[2] || GUESSES.find(p => fs.existsSync(path.join(p, 'Data.p4k')));
if (!install || !fs.existsSync(path.join(install, 'Data.p4k'))) {
  console.error('Pass the StarCitizen\\LIVE folder (the one containing Data.p4k) as the first argument.');
  process.exit(1);
}

// ── read the database ──────────────────────────────────────────────────────────
const t0 = Date.now();
const p4k = new P4K(path.join(install, 'Data.p4k'));
const { entries } = p4k.listEntries();
const dcbEntry = p4k.find(entries, 'Data\\Game2.dcb') || p4k.find(entries, 'Data\\Game.dcb');
if (!dcbEntry) throw new Error('no Game2.dcb / Game.dcb in Data.p4k');
const d = new DCB(p4k.extract(dcbEntry));
let build = {};
try { build = JSON.parse(fs.readFileSync(path.join(install, 'launcherData.json'), 'utf8')); } catch { /* optional */ }
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(install, 'build_manifest.id'), 'utf8'));
  build = manifest.Data || build;
} catch { /* optional */ }
console.log(`opened ${path.join(install, 'Data.p4k')} (${entries.length} entries), ${d.records.length} records, ${Date.now() - t0} ms`);

// ── English names ──────────────────────────────────────────────────────────────
const loc = new Map();
let iniText;
const looseIni = path.join(install, 'Data', 'Localization', 'english', 'global.ini');
if (fs.existsSync(looseIni)) iniText = fs.readFileSync(looseIni, 'utf8');
else { const e = p4k.find(entries, 'Data\\Localization\\english\\global.ini'); iniText = e ? p4k.extract(e).toString('utf8') : ''; }
for (const line of iniText.split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0) loc.set(line.slice(0, i).replace(/,P$/, '').toLowerCase(), line.slice(i + 1).trim());
}
const L = (k) => (k ? loc.get(String(k).replace(/^@/, '').toLowerCase()) || '' : '');

const recById = new Map(d.records.map(r => [r.id, r]));
const mfrCache = new Map();
function manufacturer(ref) {
  if (!ref || !ref.ref) return '';
  if (mfrCache.has(ref.ref)) return mfrCache.get(ref.ref);
  const r = recById.get(ref.ref);
  let name = '';
  if (r) {
    const o = d.readInstance(r.struct, r.inst, 2);
    name = L(o.Localization && o.Localization.Name) || '';
  }
  mfrCache.set(ref.ref, name);
  return name;
}

// ── what goes in the catalog ───────────────────────────────────────────────────
// game item Type → [asset type used by the app, short label shown in the list, has a size?]
const SHIP = (label, app) => [`Ship component — ${app}`, label, true];
const MAP = {
  Shield: SHIP('Shield', 'Shield'), Cooler: SHIP('Cooler', 'Cooler'), PowerPlant: SHIP('Power plant', 'Power Plant'),
  QuantumDrive: SHIP('Quantum drive', 'Quantum Drive'), Radar: SHIP('Radar', 'Radar'),
  WeaponGun: SHIP('Ship weapon', 'Weapon'), WeaponMining: SHIP('Mining laser', 'Mining Laser'),
  TractorBeam: SHIP('Tractor beam', 'Tractor Beam'), TowingBeam: SHIP('Towing beam', 'Tractor Beam'),
  SalvageHead: SHIP('Salvage head', 'Salvage Head'),
  MissileLauncher: ['Other', 'Missile rack', true], Missile: ['Other', 'Missile', true],
  MiningModifier: ['Other', 'Mining module', false],
  WeaponPersonal: ['Weapon', 'FPS weapon', false],
  Char_Armor_Helmet: ['Armor', 'Helmet', false], Char_Armor_Torso: ['Armor', 'Armor — core', false],
  Char_Armor_Arms: ['Armor', 'Armor — arms', false], Char_Armor_Legs: ['Armor', 'Armor — legs', false],
  Char_Armor_Undersuit: ['Armor', 'Undersuit', false], Char_Armor_Backpack: ['Armor', 'Backpack', false],
  Gadget: ['Other', 'Gadget', false], FPS_Consumable: ['Other', 'Consumable', false],
  Food: ['Other', 'Food', false], Drink: ['Other', 'Drink', false],
};
const CLOTHING = /^Char_Clothing_/;

function classify(def) {
  const t = def.Type || '';
  if (t === 'WeaponAttachment') return def.SubType === 'Magazine' ? ['Ammo', 'Magazine', false] : ['Other', 'Weapon attachment', false];
  if (t === 'WeaponPersonal' && /Grenade|Gadget/.test(def.SubType || '')) return ['Other', 'Gadget', false];
  if (MAP[t]) return MAP[t];
  if (CLOTHING.test(t)) return ['Other', 'Clothing', false];
  return null;
}
const JUNK_CLASS = /(_template|_test\b|_test_|_dummy|_fake|_debug|placeholder|_npc_only|_ai_)/i;
const CLASS_PREFIX = { Mil: 'Military', Civ: 'Civilian', Ind: 'Industrial', Cmp: 'Competition', Sth: 'Stealth' };

const entStruct = d.structs.findIndex(s => s.name === 'EntityClassDefinition');
const rows = new Map();
let scanned = 0;
for (const r of d.records) {
  if (r.struct !== entStruct || !/\/entities\/scitem\//i.test(r.file)) continue;
  scanned++;
  const o = d.readInstance(r.struct, r.inst, 1);
  const comp = (o.Components || []).find(c => c.ptr && c.ptr[0] < d.structs.length && d.structs[c.ptr[0]].name === 'SAttachableComponentParams');
  if (!comp) continue;
  const def = (d.resolve(comp, 3) || {}).AttachDef;
  if (!def || !def.Localization) continue;
  const kind = classify(def);
  if (!kind) continue;
  const className = r.name.replace(/^EntityClassDefinition\./, '');
  const name = L(def.Localization.Name).replace(/<\/?[A-Za-z0-9]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!name || /placeholder|<=|^\s*$/i.test(name) || JUNK_CLASS.test(className)) continue;
  const [app, label, sized] = kind;
  const m = name.match(/^(Mil|Civ|Ind|Cmp|Sth)\/(\d)\/([A-D])\s+/);
  const size = sized && Number.isFinite(def.Size) ? def.Size : null;
  const grade = sized && Number.isFinite(def.Grade) && def.Grade > 0 ? def.Grade : null;
  const row = [name, app, label, size, grade, m ? CLASS_PREFIX[m[1]] : '', manufacturer(def.Manufacturer), className];
  // the same thing under several class names (skins, ship-specific copies): keep the shortest
  const key = [name, app, label, size, grade, row[6]].join('|');
  const had = rows.get(key);
  if (!had || className.length < had[7].length) rows.set(key, row);
}
const catalog = [...rows.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[7].localeCompare(b[7]));
console.log(`scanned ${scanned} item records → ${catalog.length} catalog rows (${Date.now() - t0} ms)`);
const byLabel = {};
catalog.forEach(r => { byLabel[r[2]] = (byLabel[r[2]] || 0) + 1; });
console.log(Object.entries(byLabel).sort((a, b) => b[1] - a[1]).map(e => e.join(': ')).join(' · '));

const info = { game: build.Version || '', branch: build.Branch || '', built: build.BuildDateStamp || '', items: catalog.length };
const text = `// Generated by scripts/gamedata/extract-items.js from the Star Citizen install — do not edit by hand.
// Re-run it after a game patch. Rows: [name, asset type, label, size, grade, class, manufacturer, className]
const ITEM_CATALOG_INFO = ${JSON.stringify(info)};
const ITEM_CATALOG = [
${catalog.map(r => '  ' + JSON.stringify(r)).join(',\n')}
];
`;
fs.writeFileSync(OUT, text);
console.log(`wrote ${path.relative(ROOT, OUT)} (${Math.round(text.length / 1024)} KB) for game ${info.game} (${info.branch})`);
