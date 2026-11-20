#!/usr/bin/env node
'use strict';
// Compares renderer/blueprints.js (built from the game files) with sc-craft.tools, field by field.
// Read-only; needs a network connection. A difference is not necessarily a mistake: sc-craft.tools can lag a
// patch or fill a field differently. The point is to catch an extractor that drifts from what players see.
//
//   node scripts/gamedata/check-blueprints.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', '..', 'renderer', 'blueprints.js');
const ctx = {};
vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nthis.BLUEPRINTS = BLUEPRINTS; this.INFO = BLUEPRINTS_INFO;', ctx);
const mine = new Map(ctx.BLUEPRINTS.map(b => [b.blueprint_id, b]));

(async () => {
  const cfg = await (await fetch('https://sc-craft.tools/api/config')).json();
  const version = (cfg.versions || []).find(v => v.channel === 'live' && v.active)?.version || '';
  const theirs = new Map();
  for (let p = 1; p < 60; p++) {
    const j = await (await fetch(`https://sc-craft.tools/api/blueprints?page=${p}&limit=100&search=&version=${version}`)).json();
    (j.items || []).forEach(i => theirs.set(i.blueprint_id, i));
    if (p >= (j.pagination?.pages || 1)) break;
  }
  console.log(`game files ${ctx.INFO.game}: ${mine.size} blueprints | sc-craft.tools ${version}: ${theirs.size}`);
  const both = [...theirs.keys()].filter(k => mine.has(k));
  console.log(`in both ${both.length} | only on sc-craft.tools ${[...theirs.keys()].filter(k => !mine.has(k)).length} | only in the game files ${[...mine.keys()].filter(k => !theirs.has(k)).length}`);

  const diff = {};
  const note = (kind, ...x) => { (diff[kind] = diff[kind] || []).push(x); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const id of both) {
    const a = mine.get(id), b = theirs.get(id);
    if (a.name !== b.name) note('name', id, a.name, b.name);
    if (a.category !== b.category) note('category', id, a.category, b.category);
    if (a.craft_time_seconds !== b.craft_time_seconds) note('craft time', id, a.craft_time_seconds, b.craft_time_seconds);
    if ((a.default_owned ? 1 : 0) !== (b.default_owned ? 1 : 0)) note('starter flag', id, a.default_owned, b.default_owned);
    if (a.ingredients.length !== b.ingredients.length) { note('slot count', id, a.ingredients.length, b.ingredients.length); continue; }
    a.ingredients.forEach((s, i) => {
      const t = b.ingredients[i];
      if (s.slot !== t.slot) note('slot name', id, s.slot, t.slot);
      const strip = (o) => ({ name: o.name, quantity_scu: o.quantity_scu, min_quality: o.min_quality, unit: o.unit });
      if (!same(s.options.map(strip), (t.options || []).map(strip))) note('ingredient', id, s.slot, JSON.stringify(s.options.map(strip)).slice(0, 120), JSON.stringify((t.options || []).map(strip)).slice(0, 120));
      const eff = (q) => ({ stat: q.stat, quality_min: q.quality_min, quality_max: q.quality_max, modifier_at_min: q.modifier_at_min, modifier_at_max: q.modifier_at_max, type: q.type, ranges: q.ranges });
      if (!same(s.quality_effects.map(eff), (t.quality_effects || []).map(eff))) note('quality effects', id, s.slot, JSON.stringify(s.quality_effects.map(eff)).slice(0, 140), JSON.stringify((t.quality_effects || []).map(eff)).slice(0, 140));
    });
    // the base numbers the Stat table reads
    const sa = a.item_stats || {}, sb = b.item_stats || {};
    if (sb.type === 'weapon' || sb.type === 'armor') {
      if (sa.type !== sb.type) note('stats type', id, sa.type, sb.type);
      else if (sb.type === 'weapon') {
        const fa = (sa.fire_modes || [])[0] || {}, fb = (sb.fire_modes || [])[0] || {};
        if (fa.fire_rate !== fb.fire_rate) note('first fire mode rate', id, fa.fire_rate, fb.fire_rate);
        if (fa.damage_multiplier !== fb.damage_multiplier) note('damage multiplier', id, fa.damage_multiplier, fb.damage_multiplier);
      } else if (!same(sa.temperature_resistance, sb.temperature_resistance)) note('temperature range', id, JSON.stringify(sa.temperature_resistance), JSON.stringify(sb.temperature_resistance));
    }
    // where it comes from: does either side know a source
    const ma = (a.missions || []).length > 0, mb = (b.missions || []).length > 0;
    if (ma !== mb) note(mb ? 'source only on sc-craft.tools' : 'source only in game files', id, (mb ? b.missions : a.missions).map(m => m.name).slice(0, 2).join(' / '));
  }
  let bad = 0;
  for (const [k, v] of Object.entries(diff)) {
    console.log(`\n${k}: ${v.length}`);
    v.slice(0, 5).forEach(x => console.log('  ', x.join(' | ')));
    if (!/^source only/.test(k)) bad += v.length;
  }
  console.log(`\n${bad ? bad + ' differences in recipe or stat data (see above)' : 'recipe and stat data identical to sc-craft.tools'}`);
})().catch(e => { console.error(e); process.exit(1); });
