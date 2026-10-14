'use strict';
// SC Trade Tools (https://sc-trade.tools) as an alternative price source.
//
// What it reads: the public, community-provided `crowdsource/commodity-listings` feed —
// a raw log of price reports (shop, BUYS/SELLS, commodity, price, quantity, timestamp).
// The maintainer's guidance, which this module is built around:
//   • the endpoint is cached server-side for 60 minutes, so polling more often than
//     hourly is pointless — see MIN_REFRESH_MS;
//   • it is unaggregated and unfiltered — outliers happen, so filterOutliers() below;
//   • "SC Trade Tools" must be credited and linked wherever the data is shown (done in
//     the UI, not here).
//
// What it produces: rows shaped like UEX's `commodities_prices`, so the rest of the app
// doesn't need to know which source it is talking to.
//
// Direction, as the feed words it vs. as the app words it:
//   feed "BUYS"  = the shop buys from the player  → the player SELLS → row.price_sell
//   feed "SELLS" = the shop sells to the player   → the player BUYS  → row.price_buy

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://sc-trade.tools';
const PAGE_SIZE = 100;
const MIN_REFRESH_MS = 60 * 60 * 1000;       // the server caches for 60 minutes
const FIRST_LOAD_PAGES = 30;                 // ~3,000 newest reports, once
const REFRESH_MAX_PAGES = 8;                 // an hourly refresh needs a page or two
const PAGE_GAP_MS = 300;                     // be gentle between requests
const MAX_AGE_DAYS = 30;                     // older reports are dropped
const OUTLIER_FACTOR = 3;                    // a price >3× or <⅓ of the commodity's median is dropped
const CACHE_VERSION = 1;

// ─── name matching ───────────────────────────────────────────────────────────

const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// places: "Pyro Gateway (Nyx)" and "Pyro Gateway" are the same place
const normPlace = (s) => normKey(String(s || '').replace(/\(.*?\)/g, ''));

function titleCase(s) {
  return String(s || '').replace(/\S+/g, (w) => (/^[a-z]{1,4}-?l\d$/i.test(w) || /^[a-z]+-[a-z0-9]+$/i.test(w)
    ? w.toUpperCase() === w ? w : w.replace(/(^|-)([a-z])/g, (m, a, b) => a + b.toUpperCase())
    : w.charAt(0).toUpperCase() + w.slice(1)));
}

const placeOf = (t) => t.city_name || t.outpost_name || t.space_station_name || t.poi_name || '';

// Lookup tables built from UEX's own commodity and terminal lists, so SC Trade Tools'
// names are resolved to the ids/names the rest of the app already uses.
function buildResolvers(uexCommodities, uexTerminals) {
  const commodityByKey = new Map();
  for (const c of uexCommodities || []) {
    const k = normKey(c.name);
    if (k && !commodityByKey.has(k)) commodityByKey.set(k, c);
  }
  const terminalsByKey = new Map();
  const add = (key, t) => {
    if (!key) return;
    const list = terminalsByKey.get(key) || [];
    if (!list.includes(t)) list.push(t);
    terminalsByKey.set(key, list);
  };
  for (const t of uexTerminals || []) {
    if (t.type && t.type !== 'commodity') continue;
    add(normPlace(placeOf(t)), t);
    add(normPlace(t.name), t);
    add(normPlace(t.displayname), t);
    add(normPlace(t.nickname), t);
  }
  return { commodityByKey, terminalsByKey };
}

// "stanton > hurston > arial > hdms-bezdek" → the UEX terminal at that place, if there is one.
function resolveTerminal(locPath, resolvers) {
  const segs = String(locPath || '').split('>').map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return null;
  const system = normKey(segs[0]);
  // the shop's own segment first, then its parent (e.g. a shop inside a station)
  for (const seg of [segs[segs.length - 1], segs[segs.length - 2]].filter(Boolean)) {
    const cands = resolvers.terminalsByKey.get(normPlace(seg));
    if (!cands || !cands.length) continue;
    const sameSystem = cands.filter((t) => normKey(t.star_system_name) === system);
    const pool = sameSystem.length ? sameSystem : (segs.length === 1 ? cands : []);
    if (pool.length) return pool.find((t) => t.is_available) || pool[0];
  }
  return null;
}

// ─── cleaning ────────────────────────────────────────────────────────────────

const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
};

// Per commodity: drop prices more than OUTLIER_FACTOR× above or below the median
// (the feed has the odd extra-digit report — e.g. Gold at 427,000). Commodities with
// fewer than 4 reports are left alone: there's nothing to compare against.
function filterOutliers(entries) {
  const byCommodity = new Map();
  for (const e of entries) {
    if (!(e.price > 0)) continue;
    const list = byCommodity.get(e.commodity) || [];
    list.push(e.price);
    byCommodity.set(e.commodity, list);
  }
  const bounds = new Map();
  for (const [c, prices] of byCommodity) {
    if (prices.length >= 4) { const m = median(prices); bounds.set(c, [m / OUTLIER_FACTOR, m * OUTLIER_FACTOR]); }
  }
  return entries.filter((e) => {
    if (!(e.price > 0)) return false;
    const b = bounds.get(e.commodity);
    return !b || (e.price >= b[0] && e.price <= b[1]);
  });
}

// ─── entries → UEX-shaped rows ───────────────────────────────────────────────

// `entries` are the latest report per (location, commodity, direction). Returns one row
// per (terminal, commodity) carrying both prices. Reports that can't be matched to a
// UEX commodity are skipped; shops that can't be matched to a UEX terminal are kept
// under a synthetic id so their prices still show.
function entriesToRows(entries, resolvers) {
  const rows = new Map();
  for (const e of entries) {
    const com = resolvers.commodityByKey.get(normKey(e.commodity));
    if (!com) continue;
    const t = resolveTerminal(e.location, resolvers);
    const segs = String(e.location).split('>').map((s) => s.trim()).filter(Boolean);
    let id, loc;
    if (t) {
      id = t.id;
      loc = {
        terminal_name: t.name, star_system_name: t.star_system_name, planet_name: t.planet_name, moon_name: t.moon_name,
        orbit_name: t.orbit_name, city_name: t.city_name, outpost_name: t.outpost_name,
        space_station_name: t.space_station_name, poi_name: t.poi_name,
      };
    } else {
      id = 'sct-' + normKey(segs.join('-'));
      const place = segs.length > 1 ? segs[segs.length - 1] : segs[0];
      const middle = segs.slice(1, -1).map(titleCase);
      loc = {
        terminal_name: titleCase(place), star_system_name: titleCase(segs[0] || ''),
        planet_name: middle[0] || null, moon_name: middle[1] || null, city_name: null, outpost_name: titleCase(place),
      };
    }
    const key = id + '|' + com.id;
    const row = rows.get(key) || {
      id_commodity: com.id, commodity_name: com.name, id_terminal: id, ...loc,
      price_sell: 0, price_buy: 0, date_modified: 0, source: 'sctrade',
    };
    const ts = Math.floor(Date.parse(e.timestamp) / 1000) || 0;
    const mine = e.transaction === 'BUYS' ? 'price_sell' : 'price_buy';
    // two shops can resolve to one terminal — keep the newer report
    if (!row[mine] || ts >= row.date_modified) row[mine] = e.price;
    if (ts > row.date_modified) row.date_modified = ts;
    rows.set(key, row);
  }
  return [...rows.values()];
}

// ─── the feed, with an on-disk cache and an hourly refresh ──────────────────────

function getJson(url, userAgent, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(new Error(`SC Trade Tools returned ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from SC Trade Tools')); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('SC Trade Tools timed out')));
  });
}

class SctFeed {
  // cachePath: JSON file in the app's data folder. version: app version, for the User-Agent.
  constructor({ cachePath, version, fetchJson }) {
    this.cachePath = cachePath;
    this.userAgent = `SC-Companion/${version || '1'} (+https://github.com/moodytechndev/sc-companion-releases)`;
    this._get = fetchJson || ((url) => getJson(url, this.userAgent));
    this.latest = new Map();        // "location|commodity|transaction" → newest entry
    this.fetchedAt = 0;             // when we last completed a refresh
    this.newestSeen = '';           // newest report timestamp we hold
    this._loaded = false;
    this._inflight = null;
  }

  _load() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const j = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (j && j.v === CACHE_VERSION && Array.isArray(j.entries)) {
        for (const e of j.entries) this.latest.set(this._key(e), e);
        this.fetchedAt = j.fetchedAt || 0;
        this.newestSeen = j.newestSeen || '';
      }
    } catch { /* no cache yet */ }
  }

  _key(e) { return `${e.location}|${e.commodity}|${e.transaction}`; }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify({ v: CACHE_VERSION, fetchedAt: this.fetchedAt, newestSeen: this.newestSeen, entries: [...this.latest.values()] }), 'utf8');
    } catch { /* the cache is a convenience */ }
  }

  _merge(rows) {
    for (const r of rows) {
      if (!r || !r.location || !r.commodity || !r.transaction) continue;
      const k = this._key(r);
      const cur = this.latest.get(k);
      const e = { location: r.location, transaction: r.transaction, commodity: r.commodity, price: r.price,
        quantity: r.quantity, saturation: r.saturation, timestamp: r.timestamp };
      if (!cur || e.timestamp > cur.timestamp) this.latest.set(k, e);
      if (e.timestamp > this.newestSeen) this.newestSeen = e.timestamp;
    }
  }

  _prune(now = Date.now()) {
    const cutoff = new Date(now - MAX_AGE_DAYS * 864e5).toISOString();
    for (const [k, e] of this.latest) if (e.timestamp < cutoff) this.latest.delete(k);
  }

  // Makes sure the data is no more than an hour old. The first ever load backfills a few
  // dozen pages; after that only the pages newer than what we already hold are fetched.
  // Never throws if there is something cached — stale data beats none.
  async ensureFresh({ force = false, now = Date.now() } = {}) {
    this._load();
    if (!force && this.latest.size && now - this.fetchedAt < MIN_REFRESH_MS) return { fetched: false, entries: this.latest.size };
    if (this._inflight) return this._inflight;
    this._inflight = (async () => {
      const firstLoad = this.latest.size === 0;
      const maxPages = firstLoad ? FIRST_LOAD_PAGES : REFRESH_MAX_PAGES;
      const before = this.newestSeen;
      let pages = 0;
      try {
        for (let p = 0; p < maxPages; p++) {
          const res = await this._get(`${BASE}/api/crowdsource/commodity-listings?page=${p}`);
          const rows = (res && res.content) || [];
          if (!rows.length) break;
          this._merge(rows);
          pages++;
          // a refresh stops as soon as a page reaches data we already have
          if (!firstLoad && before && rows.every((r) => r.timestamp <= before)) break;
          if (rows.length < PAGE_SIZE) break;
          if (p < maxPages - 1) await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
        }
        this._prune(now);
        this.fetchedAt = now;
        this._save();
        return { fetched: true, pages, entries: this.latest.size };
      } catch (e) {
        if (this.latest.size) return { fetched: false, stale: true, error: e.message, entries: this.latest.size };
        throw e;
      } finally {
        this._inflight = null;
      }
    })();
    return this._inflight;
  }

  // the cleaned latest entries
  entries() {
    this._load();
    return filterOutliers([...this.latest.values()]);
  }

  info() {
    return { fetchedAt: this.fetchedAt, entries: this.latest.size, newestSeen: this.newestSeen };
  }
}

module.exports = {
  SctFeed, buildResolvers, resolveTerminal, entriesToRows, filterOutliers,
  normKey, normPlace, titleCase, MIN_REFRESH_MS, MAX_AGE_DAYS,
};
