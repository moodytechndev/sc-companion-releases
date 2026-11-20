#!/usr/bin/env node
'use strict';
// Reads the ship mining lasers and mining modules out of the player's Star Citizen install and
// writes renderer/mining-gear.js, which the Mining tab's Loadout planner uses:
//
//   node scripts/gamedata/extract-mining-gear.js [path to the StarCitizen\LIVE folder]
//
// Per laser: size, manufacturer, module slots, and its modifiers as the game stores them (percent,
// e.g. resistance -30 = rock resistance reduced by 30%). Per module: active/passive, charges and
// duration, its laser-power multiplier and the same modifiers. Test and template items are left out.
// Re-run after a patch.

const fs = require('fs');
const path = require('path');
const { P4K } = require('./p4k');
const { DCB } = require('./dcb');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'renderer', 'mining-gear.js');
const install = process.argv.slice(2).find(a => !a.startsWith('--')) || ['E:/Program/StarCitizen/LIVE', 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE'].find(p => fs.existsSync(path.join(p, 'Data.p4k')));
if (!install) { console.error('Pass the StarCitizen\\LIVE folder as the first argument.'); process.exit(1); }

const p4k = new P4K(path.join(install, 'Data.p4k'));
const { entries } = p4k.listEntries();
const d = new DCB(p4k.extract(p4k.find(entries, 'Data\\Game2.dcb')));
const loc = new Map();
for (const line of p4k.englishIni(entries, install).split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0) loc.set(line.slice(0, i).replace(/,P$/, '').toLowerCase(), line.slice(i + 1).trim());
}
const L = (k) => (k ? loc.get(String(k).replace(/^@/, '').toLowerCase()) || '' : '');
const byId = new Map(d.records.map(r => [r.id, r]));
const NULLP = 4294967295;
const R = (x, dep = 4) => (x && (x.ptr || x.weak) && (x.ptr || x.weak)[0] !== NULLP ? d.resolve(x, dep) : null);
const num = (m) => { const v = R(m, 2) || m; return v && typeof v.value === 'number' ? Math.round(v.value * 100) / 100 : 0; };
const round2 = (x) => Math.round(x * 100) / 100;

const entStruct = d.structs.findIndex(s => s.name === 'EntityClassDefinition');
const comp = (o, name) => (o.Components || []).find(c => c && c.ptr && d.structs[c.ptr[0]] && d.structs[c.ptr[0]].name === name);

function modifiersOf(m) {
  // the same seven values for a laser and for a module's ItemMiningModifierParams
  m = m || {};
  return {
    instability: num(m.laserInstability), window: num(m.optimalChargeWindowSizeModifier), resistance: num(m.resistanceModifier),
    windowRate: num(m.optimalChargeWindowRateModifier), shatter: num(m.shatterdamageModifier), cluster: num(m.clusterFactorModifier),
    overcharge: num(m.catastrophicChargeWindowRateModifier),
  };
}
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0));

const lasers = [], modules = [];
for (const r of d.records) {
  if (r.struct !== entStruct || !/\/entities\/scitem\/ships\//i.test(r.file)) continue;
  const className = r.name.replace(/^EntityClassDefinition\./, '');
  if (!/^Mining_(Laser|Modules)_/i.test(className) || /test|template|placeholder/i.test(className)) continue;
  const o = d.readInstance(r.struct, r.inst, 1);
  const att = comp(o, 'SAttachableComponentParams');
  const def = att && (d.resolve(att, 3) || {}).AttachDef;
  if (!def) continue;
  const name = L(def.Localization && def.Localization.Name);
  if (!name || /placeholder/i.test(name)) continue;
  const mfrRec = def.Manufacturer && def.Manufacturer.ref ? byId.get(def.Manufacturer.ref) : null;
  const mfr = mfrRec ? L((d.readInstance(mfrRec.struct, mfrRec.inst, 2).Localization || {}).Name) : '';

  if (/^Mining_Laser_/i.test(className)) {
    const ml = comp(o, 'SEntityComponentMiningLaserParams');
    if (!ml) continue;
    const mp = d.resolve(ml, 5);
    const mods = modifiersOf(R(mp.miningLaserModifiers, 3) || mp.miningLaserModifiers);
    const filter = num(mp.filterParams && mp.filterParams.filterModifier);
    // the beam's two fire actions: the mining beam and the extraction (tractor) beam
    const wc = comp(o, 'SCItemWeaponComponentParams');
    let beam = 0, extraction = 0;
    for (const f of (wc && d.resolve(wc, 3).fireActions) || []) {
      const fa = R(f, 3) || f;
      const tag = (fa.mannequinTag && fa.mannequinTag.tag) || '';
      const dmg = R(fa.damagePerSecond, 2) || fa.damagePerSecond;
      const dps = dmg && dmg.DamageEnergy;
      if (tag === 'laser') beam = dps || 0; else if (tag === 'tractor') extraction = dps || 0;
    }
    const pc = comp(o, 'SItemPortContainerComponentParams');
    const slots = pc ? (d.resolve(pc, 3).Ports || []).filter(p => (p.Types || []).some(t => t.Type === 'MiningModifier')).length : 0;
    // a laser made for one ship (the Golem's) says so in the tags it needs; the ordinary mounting tag does not count
    const needs = String(def.RequiredTags || '').split(/\s+/).filter(t => t && !/^miningMount$/i.test(t))[0] || '';
    lasers.push({
      id: className, name: name.replace(/ Mining Laser$/i, '') + (/MPUV/i.test(className) ? ' (MPUV)' : ''), mfr, size: def.Size, slots,
      ...mods, inert: filter, beam: round2(beam), ...(needs ? { needs } : {}),
    });
  } else {
    const mm = comp(o, 'EntityComponentAttachableModifierParams');
    if (!mm) continue;
    const m = d.resolve(mm, 4);
    let power = 1, extraction = 1, lifetime = 0, mods = {}, inert = 0;
    for (const raw of m.modifiers || []) {
      const x = R(raw, 6);
      if (!x) continue;
      const life = R(x.modifierLifetime, 2);
      if (life && life.lifetime) lifetime = life.lifetime;
      if (x._type === 'ItemWeaponModifiersParams') {
        const dm = x.weaponModifier && x.weaponModifier.weaponStats ? x.weaponModifier.weaponStats.damageMultiplier : 1;
        if (x.fireActionIndex === 0) power = round2(dm); else if (x.fireActionIndex === 1) extraction = round2(dm);
      } else if (x._type === 'ItemMiningModifierParams') {
        mods = modifiersOf(R(x.MiningLaserModifier, 3) || x.MiningLaserModifier);
      } else if (x._type === 'MiningFilterItemModifierParams') {
        const fp = R(x.filterParams, 3) || x.filterParams;
        inert = num(fp && fp.filterModifier);
      }
    }
    const active = /_Active_/i.test(className);
    modules.push({ id: className, name: name.replace(/ Module$/i, ''), kind: active ? 'active' : 'passive', charges: active ? (m.charges || 0) : 0, seconds: active ? lifetime : 0, power, ...(extraction !== 1 ? { extraction } : {}), ...mods, inert });
  }
}

// ── gadgets ────────────────────────────────────────────────────────────────────────────────────────────────
// Mining gadgets are stuck onto a rock and change it: the same kinds of modifiers a module has, applied to the rock.
const gadgets = [];
for (const r of d.records) {
  if (r.struct !== entStruct) continue;
  const className = r.name.replace(/^EntityClassDefinition\./, '');
  if (!/^Mining_Gadget_/i.test(className) || /test|template|placeholder/i.test(className)) continue;
  const o = d.readInstance(r.struct, r.inst, 1);
  const att = comp(o, 'SAttachableComponentParams');
  const def = att && (d.resolve(att, 3) || {}).AttachDef;
  const mm = comp(o, 'EntityComponentAttachableModifierParams');
  if (!def || !mm) continue;
  const name = L(def.Localization && def.Localization.Name);
  if (!name || /placeholder/i.test(name)) continue;
  const mfrRec = def.Manufacturer && def.Manufacturer.ref ? byId.get(def.Manufacturer.ref) : null;
  const mfr = mfrRec ? L((d.readInstance(mfrRec.struct, mfrRec.inst, 2).Localization || {}).Name) : '';
  let mods = null;
  for (const raw of d.resolve(mm, 5).modifiers || []) {
    const x = R(raw, 6);
    if (x && x._type === 'ItemMineableRockModifierParams') mods = modifiersOf(R(x.MiningLaserModifier, 3) || x.MiningLaserModifier);
  }
  if (mods) gadgets.push({ id: className, name, mfr, ...mods });
}
gadgets.sort((a, b) => a.name.localeCompare(b.name));

// ── ships: where the mining lasers go ────────────────────────────────────────────────────────────────────
// Every flyable ship whose default loadout mounts a mining laser: one entry per laser head (the MOLE has three
// turrets, each its own laser). The ground vehicles (ROC) are left out.
const entClass = (n) => (n.entityClassName ? String(n.entityClassName) : (n.entityClassReference && n.entityClassReference.ref && byId.get(n.entityClassReference.ref) ? byId.get(n.entityClassReference.ref).name.replace(/^.*\./, '') : ''));
function plainDeep(v, dep) {
  if (v && typeof v === 'object') {
    if (v.ptr || v.weak) { if (dep <= 0) return null; const x = R(v, 8); return x ? plainDeep(x, dep - 1) : null; }
    if (Array.isArray(v)) return v.map(x => plainDeep(x, dep));
    const o = {}; for (const k in v) o[k] = plainDeep(v[k], dep); return o;
  }
  return v;
}
// The ships the planner offers. The base ships only: the variants (AI crews, the Alliance / Teach / Wikelo editions) have the same
// heads, and the ground vehicles (ROC) are left out on purpose.
const PLANNER_SHIPS = new Set(['MISC_Prospector', 'ARGO_MOLE', 'DRAK_Golem']);
const HEAD_LABEL = { front: 'Front (center)', left: 'Port (left)', right: 'Starboard (right)' };
const ships = [];
for (const r of d.records) {
  if (r.struct !== entStruct || !/\/entities\/spaceships\//i.test(r.file)) continue;
  const className = r.name.replace(/^EntityClassDefinition\./, '');
  if (!PLANNER_SHIPS.has(className)) continue;
  const o = d.readInstance(r.struct, r.inst, 1);
  const dl = comp(o, 'SEntityComponentDefaultLoadoutParams');
  if (!dl) continue;
  const heads = [];
  (function walk(n, dep, ancestors) {
    if (!n || typeof n !== 'object' || dep > 14) return;
    if (Array.isArray(n)) { n.forEach(x => walk(x, dep, ancestors)); return; }
    let next = ancestors;
    if (n.itemPortName !== undefined) {
      const cls = entClass(n);
      next = ancestors.concat([{ port: String(n.itemPortName), cls }]);
      if (/^Mining_Laser_/i.test(cls)) {
        const cab = [...ancestors].reverse().find(a => /^hardpoint_mining_(cab|arm)/i.test(a.port));
        const tag = cab ? cab.port.toLowerCase().match(/cab_(front|left|right)/) : null;
        heads.push({ key: tag ? tag[1] : 'main', label: tag ? HEAD_LABEL[tag[1]] : 'Mining laser', laser: cls });
      }
    }
    for (const k in n) { const v = n[k]; if (v && typeof v === 'object') walk(v, dep + 1, next); }
  })(plainDeep(d.resolve(dl, 14), 14), 0, []);
  if (!heads.length) continue;
  // the order the game lists them is not the order a player thinks in: front, port, starboard
  const rank = { main: 0, front: 0, left: 1, right: 2 };
  heads.sort((a, b) => rank[a.key] - rank[b.key]);
  const vc = comp(o, 'VehicleComponentParams');
  const vp = vc && d.resolve(vc, 3);
  const nm = vp ? L(vp.vehicleName) : '';
  ships.push({ id: className, name: nm || className.replace(/_/g, ' '), heads });
}

const bySize = (a, b) => a.size - b.size || a.name.localeCompare(b.name);
lasers.sort(bySize);
modules.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'active' ? -1 : 1));

let info = {};
try { info = JSON.parse(fs.readFileSync(path.join(install, 'build_manifest.id'), 'utf8')).Data || {}; } catch { /* optional */ }
const show = (x) => JSON.stringify(strip(x));
const text = `// Generated by scripts/gamedata/extract-mining-gear.js from the Star Citizen install — do not edit by hand.
// Ship mining lasers and mining modules, as the game stores them. Modifiers are percent:
// resistance -30 = the rock's resistance is reduced by 30%; instability +10 = 10% less stable;
// window = size of the optimal charge window; windowRate = how fast it fills; inert = share of
// inert material filtered out. "power" on a module multiplies the laser's beam power.
const MINING_GEAR_INFO = ${JSON.stringify({ game: info.Version || '', branch: info.Branch || '' })};
const MINING_LASERS = [
${lasers.map(l => ' ' + show(l)).join(',\n')}
];
const MINING_MODULES = [
${modules.map(m => ' ' + show(m)).join(',\n')}
];
// Mining gadgets: stuck onto a rock, they change it (same modifiers as a module, percent).
const MINING_GADGETS = [
${gadgets.map(g => ' ' + show(g)).join(',\n')}
];
// The ships that carry mining lasers and where each laser sits. A laser fits a head of its own size; one that "needs" a tag
// (the Golem's Pitman) only fits a head whose default laser needs the same.
const MINING_SHIPS = [
${ships.map(sh => ' ' + JSON.stringify(sh)).join(',\n')}
];
`;
fs.writeFileSync(OUT, text);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${lasers.length} lasers, ${modules.length} modules, ${gadgets.length} gadgets, ${ships.length} ships`);
for (const g of gadgets) console.log(`  G ${g.name.padEnd(10)} inst ${g.instability || 0} win ${g.window || 0} res ${g.resistance || 0} rate ${g.windowRate || 0} shatter ${g.shatter || 0} cluster ${g.cluster || 0} overcharge ${g.overcharge || 0}`);
for (const sh of ships) console.log(`  S ${sh.name} (${sh.id}): ` + sh.heads.map(h => `${h.label} <- ${h.laser}`).join(' | '));
for (const l of lasers) console.log(`  L ${l.name.padEnd(14)} S${l.size} slots ${l.slots} inst ${l.instability || 0} win ${l.window || 0} res ${l.resistance || 0} rate ${l.windowRate || 0} inert ${l.inert || 0} beam ${l.beam}`);
for (const m of modules) console.log(`  M ${m.name.padEnd(14)} ${m.kind.padEnd(7)} ${m.charges}x${m.seconds}s power ${m.power} inst ${m.instability || 0} win ${m.window || 0} res ${m.resistance || 0} rate ${m.windowRate || 0} inert ${m.inert || 0}`);
