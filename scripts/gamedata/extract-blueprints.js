#!/usr/bin/env node
'use strict';
// Builds the app's crafting blueprint list from the player's own Star Citizen data and writes it to
// renderer/blueprints.js. No network and no third-party site: everything comes from Data.p4k.
//
//   node scripts/gamedata/extract-blueprints.js [path to the StarCitizen\LIVE folder]
//
// What it reads from Game2.dcb (the game's record database):
//   - every crafting blueprint: the item it makes, its category (from the record's folder), craft time,
//     each ingredient slot with the resources it takes (SCU, minimum quality) and what the slot's quality
//     does to which stat (the per-quality multipliers);
//   - the starter blueprints every player owns;
//   - where a blueprint comes from: the contracts whose rewards include a blueprint pool, and each pool's
//     weights, so the odds are chance x weight / total weight;
//   - the few base stats the Stat table needs: fire rate and damage multiplier of a weapon, the
//     temperature range of an armour piece.
// Run scripts/gamedata/check-blueprints.js afterwards to compare the result with sc-craft.tools.
// Re-run after every game patch, like the other extractors.

const fs = require('fs');
const path = require('path');
const { P4K } = require('./p4k');
const { DCB } = require('./dcb');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'renderer', 'blueprints.js');
const args = process.argv.slice(2);
const install = args.find(a => !a.startsWith('--')) || ['E:/Program/StarCitizen/LIVE', 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE'].find(p => fs.existsSync(path.join(p, 'Data.p4k')));
if (!install) { console.error('Pass the StarCitizen\\LIVE folder as the first argument.'); process.exit(1); }

const p4k = new P4K(path.join(install, 'Data.p4k'));
const { entries } = p4k.listEntries();
const d = new DCB(p4k.extract(p4k.find(entries, 'Data/Game2.dcb')));
const loc = new Map();
for (const line of p4k.englishIni(entries, install).split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0) loc.set(line.slice(0, i).replace(/,P$/, '').toLowerCase(), line.slice(i + 1).trim());
}
const L = (k) => (k ? loc.get(String(k).replace(/^@/, '').toLowerCase()) || '' : '');
const R = (x, dep = 7) => {
  if (!x) return x;
  if (x.ptr) return x.ptr[0] >= d.structs.length ? null : d.resolve(x, dep);
  if (x.weak) return x.weak[0] >= d.structs.length ? null : d.resolve(x, dep);
  return x;
};
const byId = new Map(d.records.map(r => [r.id, r]));
const rnd = (v, n = 1e4) => Math.round(v * n) / n;
// Only plain spaces are collapsed: the game's text uses non-breaking spaces in some names and the
// contract lists spell them the same way, so they must be kept to match.
const clean = (s) => String(s || '').replace(/<\/?[A-Za-z0-9]+>/g, '').replace(/[ \t\r\n]+/g, ' ').trim();
const titleCase = (s) => s.replace(/(^|_)([a-z0-9])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()).replace(/\s+/g, ' ');
const idOf = (rec) => rec.file.split('/').pop().replace(/\.xml$/, '');

// the display name of an item entity (null when it has none worth showing)
function entityName(er) {
  const o = d.readInstance(er.struct, er.inst, 1);
  const comp = (o.Components || []).find(c => c.ptr && c.ptr[0] < d.structs.length && d.structs[c.ptr[0]].name === 'SAttachableComponentParams');
  const def = comp && (d.resolve(comp, 3) || {}).AttachDef;
  const key = def && def.Localization ? String(def.Localization.Name || '').replace(/^@/, '') : '';
  const name = clean(L(key));
  return name && !/placeholder/i.test(name) ? name : '';
}
function entityComponent(er, struct, depth = 9) {
  const o = d.readInstance(er.struct, er.inst, 1);
  const c = (o.Components || []).find(x => x.ptr && x.ptr[0] < d.structs.length && d.structs[x.ptr[0]].name === struct);
  return c ? d.resolve(c, depth) : null;
}

// ── blueprint pools (who can award what) ─────────────────────────────────────────────────────────────
const pools = new Map();
for (const r of d.records) {
  if (d.structs[r.struct].name !== 'BlueprintPoolRecord') continue;
  const o = d.readInstance(r.struct, r.inst, 3);
  pools.set(r.id, {
    name: r.name.replace(/^.*\./, ''), file: r.file,
    rewards: (o.blueprintRewards || []).map(x => ({ w: x.weight || 1, bp: x.blueprintRecord && x.blueprintRecord.ref })).filter(x => x.bp && byId.has(x.bp)),
  });
}

// ── contracts that award blueprint pools ─────────────────────────────────────────────────────────────
// { blueprint record id → Map(title → best chance) }
const sources = new Map();
let contractCount = 0, untitled = 0;
const addSource = (bpId, name, chance, extra) => {
  let m = sources.get(bpId); if (!m) sources.set(bpId, m = new Map());
  const cur = m.get(name);
  if (!cur || cur.chance < chance) m.set(name, { chance, ...extra });
};
for (const r of d.records) {
  if (d.structs[r.struct].name !== 'ContractGenerator') continue;
  const gen = d.readInstance(r.struct, r.inst, 12);
  const titleOf = (params) => {
    const t = ((params && params.stringParamOverrides) || []).find(x => x && x.param === 'Title');
    return clean(L(t && t.value));
  };
  (function walk(n, depth, inherited) {
    if (!n || typeof n !== 'object' || depth > 14) return;
    if (Array.isArray(n)) { n.forEach(x => walk(x, depth + 1, inherited)); return; }
    // a generator can give all its contracts one title (and a contract can still override it)
    if (n.contractParams && n.contractParams._type === 'ContractParamOverrides') inherited = titleOf(n.contractParams) || inherited;
    if ((n._type === 'Contract' || n._type === 'CareerContract' || n._type === 'ContractLegacy') && n.contractResults) {
      const results = (n.contractResults.contractResults || []).filter(x => x && x._type === 'BlueprintRewards');
      if (results.length) {
        contractCount++;
        const title = titleOf(n.paramOverrides) || inherited;
        if (!title) { untitled++; return; }
        for (const b of results) {
          const pool = pools.get(b.blueprintPool && b.blueprintPool.ref);
          if (!pool || !pool.rewards.length) continue;
          const total = pool.rewards.reduce((s, x) => s + x.w, 0) || 1;
          for (const x of pool.rewards) addSource(x.bp, title, (b.chance == null ? 1 : b.chance) * x.w / total);
        }
      }
    }
    for (const k in n) { const v = n[k]; if (v && typeof v === 'object') walk(v, depth + 1, inherited); }
  })(resolveDeep(gen, 0), 0, '');
}
// the generator tree is stored as pointers; walk it as plain objects
function resolveDeep(v, depth) {
  if (v && typeof v === 'object') {
    if (v.ptr || v.weak) { if (depth > 13) return null; const x = R(v, 12 - depth); return x ? resolveDeep(x, depth + 1) : null; }
    if (v.ref !== undefined && !v._type) return { ref: v.ref };
    if (Array.isArray(v)) return v.map(x => resolveDeep(x, depth + 1));
    const o = {}; for (const k in v) o[k] = resolveDeep(v[k], depth + 1); return o;
  }
  return v;
}

// ── event rewards ─────────────────────────────────────────────────────────────────────────────────────
// Some pools are not awarded by a contract but by an event's progress tiers. The game data does not tie them
// to a named contract, so they are listed as event rewards (the odds are not known).
const EVENT_POOL = [
  [/crafting\/blueprintrewards\/xenothreat2rewards\//, 'Xenothreat event reward'],
  [/crafting\/blueprintrewards\/ors\//, 'ORS event reward'],
  [/crafting\/blueprintrewards\/48blueprints\/bp_rewards_redwind/, 'Red Wind event reward'],
  [/crafting\/blueprintrewards\/48blueprints\/bp_rewards_asd3vgear/, 'Project Hyperion event reward'],
  [/crafting\/blueprintrewards\/blueprintmissionpools\/bp_missionreward_asd/, 'Project Hyperion event reward'],
];
const hasContractSource = new Set(sources.keys());
for (const pool of pools.values()) {
  const ev = EVENT_POOL.find(([re]) => re.test(pool.file));
  if (!ev) continue;
  for (const x of pool.rewards) if (!hasContractSource.has(x.bp)) addSource(x.bp, ev[1], 0, { event: true });
}

// ── starter blueprints ────────────────────────────────────────────────────────────────────────────────
const gp = d.records.find(r => d.structs[r.struct].name === 'CraftingGlobalParams');
const starters = new Set();
{
  const g = d.readInstance(gp.struct, gp.inst, 4);
  const sel = R(g.defaultBlueprintSelection, 4);
  for (const x of (sel && sel.blueprintRecords) || []) if (x && x.ref) starters.add(x.ref);
}

// ── stat names ────────────────────────────────────────────────────────────────────────────────────────
const statName = (prop, propFile) => {
  const def = d.readInstance(prop.struct, prop.inst, 3);
  return clean(L(def.propertyName)) || clean(L('statname_' + propFile)) || titleCase(propFile.replace(/^gpp_/, ''));
};

// A hand-mined mineral is an item in the recipe ("Glacosite"), named by its commodity text.
function itemOptionName(er) {
  const n = entityName(er);
  if (n) return n;
  const m = er.name.replace(/^.*\./, '').toLowerCase().match(/^harvestable_mineral_[0-9a-z]+_([a-z]+)$/);
  if (m) { const c = clean(L('items_commodities_' + m[1])); if (c) return c; }
  return titleCase(er.name.replace(/^.*\./, '').toLowerCase());
}

// ── base stats the Stat table uses ───────────────────────────────────────────────────────────────────
function itemStats(er) {
  const out = {};
  const weapon = entityComponent(er, 'SCItemWeaponComponentParams', 9);
  const modes = [];
  const MODE_ORDER = { single: 1, burst: 2 };   // anything else (Rapid, Shotgun...) first; the game's own order within a kind
  const add = (name, rate, lp) => {
    if (!(rate > 0)) return;
    modes.push({ name, fire_rate: rnd(rate, 100), damage_multiplier: rnd(lp && lp.damageMultiplier != null ? lp.damageMultiplier : 1) });
  };
  const modeName = (act) => clean(String(act.localisedName || '').replace(/^@FireMode_/i, '')) || act.name;
  // A fire action is either a plain one, a charged one wrapping a plain one, or a sequence of plain ones; each
  // plain action is one mode of the weapon.
  const flatten = (act, depth) => {
    if (!act || depth > 4) return;
    if (/Sequence/i.test(act._type || '')) { for (const e of act.sequenceEntries || []) flatten(R(e.weaponAction, 6), depth + 1); return; }
    if (act.defaultWeaponAction) { flatten(R(act.defaultWeaponAction, 6), depth + 1); return; }
    if (act.weaponAction) { flatten(R(act.weaponAction, 6), depth + 1); return; }
    add(modeName(act), act.fireRate, R(act.launchParams, 4));
  };
  for (const a of (weapon && weapon.fireActions) || []) flatten(R(a, 6), 0);
  modes.sort((a, b) => (MODE_ORDER[a.name.toLowerCase()] ?? 0) - (MODE_ORDER[b.name.toLowerCase()] ?? 0));
  if (modes.length) { out.type = 'weapon'; out.fire_modes = modes; }
  const cloth = entityComponent(er, 'SCItemClothingParams', 6);
  const tr = cloth && R(cloth.TemperatureResistance, 3);
  const armor = entityComponent(er, 'SCItemSuitArmorParams', 2);
  if (armor && tr) { out.type = 'armor'; out.temperature_resistance = { min: tr.MinResistance, max: tr.MaxResistance }; }
  return out.type ? out : null;
}

// ── blueprints ────────────────────────────────────────────────────────────────────────────────────────
const out = [];
let noName = 0;
for (const r of d.records) {
  if (d.structs[r.struct].name !== 'CraftingBlueprintRecord') continue;
  const m = r.file.match(/^libs\/foundry\/records\/crafting\/blueprints\/crafting\/(.+)\/([^/]+)\.xml$/);
  if (!m) continue;   // the generic dismantle is not a craft
  const id = m[2];
  const bp = R(d.readInstance(r.struct, r.inst, 7).blueprint, 7);
  const tier = R((bp.tiers || [])[0], 7);
  if (!tier) continue;
  const costs = R(R(tier.recipe, 7).costs, 7);
  const tv = R(costs.craftTime, 3) || costs.craftTime || {};
  const craftSeconds = (tv.days || 0) * 86400 + (tv.hours || 0) * 3600 + (tv.minutes || 0) * 60 + (tv.seconds || 0);

  const ps = R(bp.processSpecificData, 3);
  const outRec = ps && ps.entityClass ? byId.get(ps.entityClass.ref) : null;
  let name = outRec ? entityName(outRec) : '';
  if (!name) { name = titleCase(id.replace(/^bp_craft_/, '').toLowerCase()); noName++; }

  const ingredients = [];
  const top = R(costs.mandatoryCost, 7);
  for (const raw of (top && top.options) || []) {
    const slot = R(raw, 7); if (!slot) continue;
    const info = slot.nameInfo || {};
    const options = [];
    for (const oraw of slot.options || []) {
      const o = R(oraw, 7); if (!o) continue;
      if (o._type === 'CraftingCost_Item') {
        const er = o.entityClass && byId.get(o.entityClass.ref); if (!er) continue;
        options.push({ name: itemOptionName(er), quantity_scu: o.quantity || 0, min_quality: o.minQuality || 0, unit: 'unit' });
        continue;
      }
      if (o._type !== 'CraftingCost_Resource') continue;
      const rec = o.resource && byId.get(o.resource.ref);
      let rname = '';
      if (rec) { const rt = d.readInstance(rec.struct, rec.inst, 3); rname = L(String(rt.displayName || '').replace(/^@/, '')) || rec.name.replace(/^.*\./, ''); }
      const q = R(o.quantity, 3);
      options.push({ name: rname, quantity_scu: rnd(q ? q.standardCargoUnits : 0), min_quality: o.minQuality || 0, unit: 'scu' });
    }
    const effects = [];
    for (const craw of slot.context || []) {
      const c = R(craw, 7);
      if (!c || c._type !== 'CraftingCostContext_ResultGameplayPropertyModifiers') continue;
      const list = R(c.gameplayPropertyModifiers, 7);
      for (const mraw of (list && list.gameplayPropertyModifiers) || []) {
        const mod = R(mraw, 7); if (!mod) continue;
        const prop = mod.gameplayPropertyRecord && byId.get(mod.gameplayPropertyRecord.ref);
        if (!prop) continue;
        const propFile = path.basename(prop.file, '.xml');
        const ranges = (mod.valueRanges || []).map(v => R(v, 4)).filter(v => v && 'startQuality' in v);
        if (!ranges.length) continue;
        const type = ranges.some(v => /Additive/i.test(v._type || '')) ? 'additive' : 'multiplicative';
        const rows = ranges.map(v => ({ quality_min: v.startQuality, quality_max: v.endQuality, modifier_at_min: rnd(v.modifierAtStart != null ? v.modifierAtStart : v.additiveModifierAtStart), modifier_at_max: rnd(v.modifierAtEnd != null ? v.modifierAtEnd : v.additiveModifierAtEnd) }));
        const last = rows[rows.length - 1];
        const eff = { stat: statName(prop, propFile), quality_min: rows[0].quality_min, quality_max: last.quality_max, modifier_at_min: rows[0].modifier_at_min, modifier_at_max: last.modifier_at_max, type };
        if (rows.length > 1) eff.ranges = rows;
        effects.push(eff);
      }
    }
    ingredients.push({
      slot: info.debugName ? String(info.debugName).replace(/:$/, '') : 'SLOT',
      options, quality_effects: effects,
      name: options[0] ? options[0].name : '', quantity_scu: options[0] ? options[0].quantity_scu : 0,
    });
  }

  const folders = m[1].split('/').filter(x => x.toLowerCase() !== 'fpsgear' && !x.startsWith('$')).map(x => (/^(smg|lmg)$/i.test(x) ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1)));
  const src = sources.get(r.id);
  const missions = src ? [...src.entries()].sort((a, b) => b[1].chance - a[1].chance || a[0].localeCompare(b[0]))
    .map(([title, v]) => (v.event ? { name: title, event: true } : { name: title, drop_chance: v.chance.toFixed(4) })) : [];
  const stats = outRec ? itemStats(outRec) : null;
  const row = {
    blueprint_id: id, name, category: folders.join(' / '), craft_time_seconds: craftSeconds, tiers: 1,
    default_owned: starters.has(r.id) ? 1 : 0, ingredients, missions,
  };
  if (stats) row.item_stats = stats;
  out.push(row);
}
out.sort((a, b) => a.name.localeCompare(b.name) || a.blueprint_id.localeCompare(b.blueprint_id));

let info = {};
try { info = JSON.parse(fs.readFileSync(path.join(install, 'build_manifest.id'), 'utf8')).Data || {}; } catch { /* optional */ }
const text = `// Generated by scripts/gamedata/extract-blueprints.js from the Star Citizen install — do not edit by hand.
// Every crafting blueprint in the game's own data: recipe, quality effects, where it is awarded, starter blueprints.
const BLUEPRINTS_INFO = ${JSON.stringify({ game: info.Version || '', branch: info.Branch || '', built: info.BuildDateStamp || '', blueprints: out.length })};
const BLUEPRINTS = [
${out.map(b => JSON.stringify(b)).join(',\n')}
];
`;
fs.writeFileSync(OUT, text);
const withMissions = out.filter(b => b.missions.length).length;
console.log(`${out.length} blueprints (${out.filter(b => b.default_owned).length} owned from the start); ${withMissions} have a known source (${contractCount} contracts, ${untitled} without a title); ${out.filter(b => b.item_stats).length} with base stats; ${noName} named from their id`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${Math.round(text.length / 1024)} KB) for game ${info.Version}`);
