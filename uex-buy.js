'use strict';
// "Where to buy": type a ship or an item and see which shops sell it, where they are and what they charge.
// The prices are the ones players report to UEX Corp (the same community data as the commodity prices).
//
// Three lists are read from UEX the first time they are needed and kept in memory for a while: every ship
// purchase price (a few hundred rows), every item price (about 24,000 rows, 6 MB, so it is only fetched when
// someone searches for an item, and cut down to a few numbers per row), and the terminal list that says where
// each shop is. Searching is done here so the window only ever receives the handful of matches it shows.

const KEEP_MS = 30 * 60 * 1000;          // reuse a downloaded list this long
const MAX_RESULTS = 30;                  // matches returned for one search
const MAX_OFFERS = 12;                   // shops listed per match and per side (buy / sell)
const BASE = 'https://api.uexcorp.space/2.0/';

const lettersOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Matches when every word the player typed is inside the name (any order), so "mk ii avenger" finds
// "Avenger Titan Mk II". Names that start with the text, or are shorter, come first.
function rank(name, q) {
  const n = lettersOf(name), words = lettersOf(q).split(' ').filter(Boolean);
  if (!words.length || !words.every(w => n.includes(w))) return null;
  const joined = words.join(' ');
  return (n === joined ? 0 : n.startsWith(joined) ? 1 : n.split(' ').some(p => p.startsWith(words[0])) ? 2 : 3) * 1000 + Math.min(n.length, 999);
}

function create(fetchJson) {
  const lists = {};      // name -> { at, rows, busy }

  // One download at a time per list; if UEX is down, an older copy is better than nothing.
  async function load(name, make) {
    const e = lists[name] = lists[name] || { at: 0, rows: null, busy: null };
    if (e.rows && Date.now() - e.at < KEEP_MS) return { rows: e.rows, stale: false };
    if (!e.busy) {
      e.busy = make().then(rows => { e.rows = rows; e.at = Date.now(); }).finally(() => { e.busy = null; });
    }
    try { await e.busy; return { rows: e.rows, stale: false }; }
    catch (err) { if (e.rows) return { rows: e.rows, stale: true }; throw err; }
  }

  const data = async (endpoint, timeout) => {
    const res = await fetchJson(BASE + endpoint, timeout);
    if (!res || !Array.isArray(res.data)) throw new Error('UEX sent no data');
    return res.data;
  };

  // terminal id -> where it is. "Stanton > ArcCorp > Area 18", plus the shop's own name.
  const terminals = () => load('terminals', async () => {
    const map = new Map();
    for (const t of await data('terminals', 30000)) {
      const place = t.city_name || t.outpost_name || t.space_station_name || t.poi_name || '';
      const parts = [t.star_system_name, t.planet_name || t.orbit_name, t.moon_name, place].filter(Boolean);
      const path = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[i - 1].toLowerCase());
      map.set(t.id, { name: t.displayname || t.nickname || t.name || '', loc: path.join(' > ') });
    }
    return map;
  });

  const place = (map, id, fallbackName) => {
    const t = map.get(id);
    return { terminal: (t && t.name) || fallbackName || 'Unknown terminal', loc: (t && t.loc) || '' };
  };
  // UEX can list one shop twice (two terminals with the same name in the same place): show it once, with how many.
function merge(offers) {
  const seen = new Map(), out = [];
  for (const o of offers) {
    const k = `${o.terminal}|${o.loc}|${o.price}`, e = seen.get(k);
    if (e) { e.count++; if (o.days != null && (e.days == null || o.days < e.days)) e.days = o.days; }
    else { const n = { ...o, count: 1 }; seen.set(k, n); out.push(n); }
  }
  return out;
}
const ago = (sec) => (sec ? Math.max(0, Math.round((Date.now() / 1000 - sec) / 86400)) : null);   // days since UEX last heard the price

  async function ships(q) {
    const [t, v, p] = await Promise.all([
      terminals(),
      load('vehicles', async () => (await data('vehicles', 30000)).map(x => ({ id: x.id, name: x.name_full || x.name, maker: x.company_name || '', crew: x.crew || '', scu: x.scu || 0 }))),
      load('vehiclePrices', async () => (await data('vehicles_purchases_prices_all', 30000)).map(x => ({ id: x.id_vehicle, term: x.id_terminal, tname: x.terminal_name, price: x.price_buy, days: ago(x.date_modified) }))),
    ]);
    const byVeh = new Map();
    for (const r of p.rows) { if (!(r.price > 0)) continue; (byVeh.get(r.id) || byVeh.set(r.id, []).get(r.id)).push(r); }
    const hits = [];
    for (const veh of v.rows) {
      const s = rank(`${veh.maker} ${veh.name}`, q) ?? rank(veh.name, q);
      if (s != null) hits.push({ s, veh });
    }
    hits.sort((a, b) => a.s - b.s);
    return {
      stale: t.stale || v.stale || p.stale,
      total: hits.length,
      results: hits.slice(0, MAX_RESULTS).map(({ veh }) => {
        const offers = (byVeh.get(veh.id) || []).slice().sort((a, b) => a.price - b.price);
        return {
          name: veh.name, maker: veh.maker, crew: veh.crew, scu: veh.scu,
          buyCount: offers.length,
          buy: merge(offers.map(o => ({ ...place(t.rows, o.term, o.tname), price: o.price, days: o.days }))).slice(0, MAX_OFFERS),
        };
      }),
    };
  }

  async function items(q) {
    const [t, cats, all] = await Promise.all([
      terminals(),
      load('categories', async () => {
        const m = new Map();
        for (const c of await data('categories', 30000)) if (c.type === 'item') m.set(c.id, [c.section, c.name].filter(Boolean).join(' / '));
        return m;
      }).catch(() => ({ rows: new Map() })),
      load('itemPrices', async () => {
        const groups = new Map();      // id_item -> { name, rows: [[terminal id, terminal name, buy, sell, days]] }
        for (const x of await data('items_prices_all', 120000)) {
          if (!(x.price_buy > 0) && !(x.price_sell > 0)) continue;
          let g = groups.get(x.id_item);
          if (!g) groups.set(x.id_item, g = { name: x.item_name || '', cat: x.id_category, rows: [] });
          g.rows.push([x.id_terminal, x.terminal_name, x.price_buy || 0, x.price_sell || 0, ago(x.date_modified)]);
        }
        return [...groups.values()].filter(g => g.name);
      }),
    ]);
    const hits = [];
    for (const g of all.rows) { const s = rank(g.name, q); if (s != null) hits.push({ s, g }); }
    hits.sort((a, b) => a.s - b.s);
    return {
      stale: t.stale || all.stale || cats.stale,
      total: hits.length,
      results: hits.slice(0, MAX_RESULTS).map(({ g }) => {
        const mk = (r, price) => ({ ...place(t.rows, r[0], r[1]), price, days: r[4] });
        const buy = g.rows.filter(r => r[2] > 0).sort((a, b) => a[2] - b[2]);
        const sell = g.rows.filter(r => r[3] > 0).sort((a, b) => b[3] - a[3]);
        return {
          name: g.name, category: cats.rows.get(g.cat) || '',
          buyCount: buy.length, sellCount: sell.length,
          buy: merge(buy.map(r => mk(r, r[2]))).slice(0, MAX_OFFERS),
          sell: merge(sell.map(r => mk(r, r[3]))).slice(0, MAX_OFFERS),
        };
      }),
    };
  }

  async function search(kind, q) {
    q = String(q || '').trim().slice(0, 60);
    if (lettersOf(q).length < 2) return { status: 'ok', total: 0, results: [], short: true };
    try {
      const out = kind === 'items' ? await items(q) : await ships(q);
      return { status: 'ok', ...out };
    } catch (e) {
      return { status: 'error', error: e.message || 'Could not reach UEX' };
    }
  }

  return { search };
}

module.exports = { create, rank };
