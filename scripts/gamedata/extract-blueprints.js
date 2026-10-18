#!/usr/bin/env node
'use strict';
// Finds the crafting blueprints that exist in the player's own Star Citizen data but are missing
// from sc-craft.tools (the source the app normally uses) and writes them, in the same shape, to
// renderer/special-blueprints.js. The app adds them to the blueprint list marked "Special".
//
//   node scripts/gamedata/extract-blueprints.js [path to the StarCitizen\LIVE folder]
//
// It asks sc-craft.tools for its list of blueprint ids (read-only) to know which ones are missing,
// so it needs a network connection; with --offline it keeps the file it already wrote.
// Re-run after a patch: a blueprint that sc-craft.tools later adds simply stops showing as special.

const fs = require('fs');
const path = require('path');
const { P4K } = require('./p4k');
const { DCB } = require('./dcb');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'renderer', 'special-blueprints.js');
const args = process.argv.slice(2);
if (args.includes('--offline')) { console.log('--offline: nothing to do (the existing file is kept)'); process.exit(0); }
const install = args.find(a => !a.startsWith('--')) || ['E:/Program/StarCitizen/LIVE', 'C:/Program Files/Roberts Space Industries/StarCitizen/LIVE'].find(p => fs.existsSync(path.join(p, 'Data.p4k')));
if (!install) { console.error('Pass the StarCitizen\\LIVE folder as the first argument.'); process.exit(1); }

(async () => {
  // ── what sc-craft.tools has ──────────────────────────────────────────────────
  const cfg = await (await fetch('https://sc-craft.tools/api/config')).json();
  const version = (cfg.versions || []).find(v => v.channel === 'live' && v.active)?.version || '';
  const theirs = new Set();
  for (let p = 1; p < 60; p++) {
    const j = await (await fetch(`https://sc-craft.tools/api/blueprints?page=${p}&limit=100&search=&version=${version}`)).json();
    (j.items || []).forEach(i => theirs.add(String(i.blueprint_id).toLowerCase()));
    if (p >= (j.pagination?.pages || 1)) break;
  }
  console.log(`sc-craft.tools ${version}: ${theirs.size} blueprints`);

  // ── the game's own ───────────────────────────────────────────────────────────
  const p4k = new P4K(path.join(install, 'Data.p4k'));
  const { entries } = p4k.listEntries();
  const d = new DCB(p4k.extract(p4k.find(entries, 'Data\\Game2.dcb')));
  const loc = new Map();
  for (const line of fs.readFileSync(path.join(install, 'Data', 'Localization', 'english', 'global.ini'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) loc.set(line.slice(0, i).replace(/,P$/, '').toLowerCase(), line.slice(i + 1).trim());
  }
  const L = (k) => (k ? loc.get(String(k).replace(/^@/, '').toLowerCase()) || '' : '');
  const R = (x, dep = 7) => (x && (x.ptr || x.weak) ? d.resolve(x, dep) : x);
  const byId = new Map(d.records.map(r => [r.id, r]));
  const clean = (s) => s.replace(/<\/?[A-Za-z0-9]+>/g, '').replace(/\s+/g, ' ').trim();
  const titleCase = (s) => s.replace(/(^|_)([a-z])/g, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()).replace(/\s+/g, ' ');

  const specials = [];
  for (const r of d.records) {
    const m = r.file.match(/^libs\/foundry\/records\/crafting\/blueprints\/crafting\/(.+)\/([^/]+)\.xml$/);
    if (!m) continue;
    const id = m[2];
    if (theirs.has(id.toLowerCase())) continue;
    const bp = R(d.readInstance(r.struct, r.inst, 7).blueprint, 7);
    const tier = R((bp.tiers || [])[0], 7);
    const costs = R(R(tier.recipe, 7).costs, 7);
    const t = R(costs.craftTime, 3) || costs.craftTime || {};
    const craftSeconds = (t.days || 0) * 86400 + (t.hours || 0) * 3600 + (t.minutes || 0) * 60 + (t.seconds || 0);

    // what it makes
    const ps = R(bp.processSpecificData, 3);
    const outRec = ps && ps.entityClass ? byId.get(ps.entityClass.ref) : null;
    let name = '';
    if (outRec) {
      const o = d.readInstance(outRec.struct, outRec.inst, 1);
      const comp = (o.Components || []).find(c => c.ptr && c.ptr[0] < d.structs.length && d.structs[c.ptr[0]].name === 'SAttachableComponentParams');
      const def = comp && (d.resolve(comp, 3) || {}).AttachDef;
      name = clean(L(def && def.Localization && def.Localization.Name));
      if (/placeholder/i.test(name)) name = '';
    }
    if (!name) name = clean(titleCase(id.replace(/^bp_craft_/, '')));

    // slots → resources, and what each slot's quality does
    const ingredients = [];
    const top = R(costs.mandatoryCost, 7);
    for (const raw of top.options || []) {
      const slot = R(raw, 7);
      const info = slot.nameInfo || {};
      const options = [];
      for (const oraw of slot.options || []) {
        const o = R(oraw, 7);
        if (o._type === 'CraftingCost_Item') {
          // an item (not a bulk resource) is part of the recipe: counted in units
          const er = o.entityClass && byId.get(o.entityClass.ref);
          if (!er) continue;
          const eo = d.readInstance(er.struct, er.inst, 1);
          const ec = (eo.Components || []).find(c => c.ptr && c.ptr[0] < d.structs.length && d.structs[c.ptr[0]].name === 'SAttachableComponentParams');
          const edef = ec && (d.resolve(ec, 3) || {}).AttachDef;
          const nkey = edef && edef.Localization ? String(edef.Localization.Name || '').replace(/^@/, '') : '';
          options.push({ guid: er.id, name: clean(L(nkey)) || titleCase(er.name.replace(/^.*\./, '')), quantity_scu: o.quantity || 0, min_quality: o.minQuality || 0, unit: 'unit', loc_key: nkey });
          continue;
        }
        if (o._type !== 'CraftingCost_Resource') continue;
        const rec = o.resource && byId.get(o.resource.ref);
        let rname = '', locKey = '';
        if (rec) {
          const rt = d.readInstance(rec.struct, rec.inst, 3);
          locKey = String(rt.displayName || '').replace(/^@/, '');
          rname = L(locKey) || rec.name.replace(/^.*\./, '');
        }
        const q = R(o.quantity, 3);
        options.push({ guid: rec ? rec.id : '', name: rname, quantity_scu: Math.round((q ? q.standardCargoUnits : 0) * 1e4) / 1e4, min_quality: o.minQuality || 0, unit: 'scu', loc_key: locKey });
      }
      const effects = [];
      for (const craw of slot.context || []) {
        const c = R(craw, 7);
        if (!c || c._type !== 'CraftingCostContext_ResultGameplayPropertyModifiers') continue;
        const list = R(c.gameplayPropertyModifiers, 7);
        for (const mraw of (list && list.gameplayPropertyModifiers) || []) {
          const mod = R(mraw, 7);
          const prop = mod.gameplayPropertyRecord && byId.get(mod.gameplayPropertyRecord.ref);
          const propFile = prop ? path.basename(prop.file, '.xml') : '';
          const statKey = 'statname_' + propFile;
          const ranges = (mod.valueRanges || []).map(v => R(v, 4)).filter(v => v && 'startQuality' in v);
          const type = /Multiplic|Linear|Common/i.test(mod._type || '') ? 'multiplicative' : 'multiplicative';
          const rows = ranges.map(v => ({ quality_min: v.startQuality, quality_max: v.endQuality, modifier_at_min: Math.round(v.modifierAtStart * 1e4) / 1e4, modifier_at_max: Math.round(v.modifierAtEnd * 1e4) / 1e4 }));
          if (!rows.length) continue;
          const last = rows[rows.length - 1];
          const eff = { stat: L(statKey) || titleCase(propFile.replace(/^gpp_/, '')), stat_loc_key: statKey, quality_min: rows[0].quality_min, quality_max: last.quality_max, modifier_at_min: rows[0].modifier_at_min, modifier_at_max: last.modifier_at_max, type };
          if (rows.length > 1) eff.ranges = rows.map(x => ({ ...x, type }));
          effects.push(eff);
        }
      }
      ingredients.push({
        slot: info.debugName ? String(info.debugName).replace(/:$/, '') : 'SLOT',
        slot_loc_key: String(info.displayName || '').replace(/^@/, ''),
        options, quality_effects: effects,
        name: options[0] ? options[0].name : '', quantity_scu: options[0] ? options[0].quantity_scu : 0,
      });
    }

    const folders = m[1].split('/').filter(x => x.toLowerCase() !== 'fpsgear').map(x => x.charAt(0).toUpperCase() + x.slice(1));
    const mission = /collector|missionitem|carryable/i.test(id);
    specials.push({
      blueprint_id: id, name, loc_key: '', category: folders.join(' / '), craft_time_seconds: craftSeconds, tiers: 1, default_owned: 0,
      ingredients, missions: [], special: true,
      special_reason: mission ? 'A mission or collector item — it is in the game data but not on sc-craft.tools.' : 'In the game data but not (yet) on sc-craft.tools, so its stats are not listed.',
    });
  }
  specials.sort((a, b) => a.name.localeCompare(b.name));
  for (const s of specials) console.log(` ${s.blueprint_id} → "${s.name}" · ${s.category} · ${s.craft_time_seconds}s · ${s.ingredients.map(i => `${i.slot}: ${i.options.map(o => o.name + ' ' + o.quantity_scu).join('/')}`).join(' | ')}`);

  let info = {};
  try { info = JSON.parse(fs.readFileSync(path.join(install, 'build_manifest.id'), 'utf8')).Data || {}; } catch { /* optional */ }
  const text = `// Generated by scripts/gamedata/extract-blueprints.js from the Star Citizen install — do not edit by hand.
// Blueprints that are in the game's data but missing from sc-craft.tools (checked against ${version || 'its live list'}).
// The app adds any whose id sc-craft.tools does not list, marked "Special"; the rest are ignored.
const SPECIAL_BLUEPRINTS_INFO = ${JSON.stringify({ game: info.Version || '', craftTools: version })};
const SPECIAL_BLUEPRINTS = ${JSON.stringify(specials, null, 1)};
`;
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${specials.length} special blueprints)`);
})().catch(e => { console.error(e); process.exit(1); });
