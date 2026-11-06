'use strict';
// UEX Corp marketplace, read through our own layer. The Market tab (Prices -> Market) never sees UEX's raw
// rows: everything is turned into one listing shape here, so the screen, the watchlist and any later chat
// work against that shape and not against UEX's field names. Public reads only, no key needed.
//
// Listings are written by other players, so every text field is untrusted: the renderer escapes them, and
// links and images are only kept when they point at UEX's own hosts.

const BASE = 'https://api.uexcorp.space/2.0';
const LISTING_URL = 'https://uexcorp.space/marketplace/item/info/';
const CDN = /^https:\/\/cdn\.uexcorp\.space\//;
const CACHE_MS = 2 * 60 * 1000;           // one request per side every two minutes, however often the screen asks
const CATEGORY_MS = 24 * 60 * 60 * 1000;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// UEX row -> our listing.
function normalize(r) {
  if (!r || num(r.id) == null || !r.slug) return null;
  const photos = String(r.photos || '').split(',').map(s => s.trim()).filter(s => CDN.test(s));
  const quality = num(r.quality);
  return {
    id: num(r.id),
    slug: String(r.slug),
    url: LISTING_URL + encodeURIComponent(r.slug),
    op: r.operation === 'buy' ? 'buy' : 'sell',     // sell = someone is selling, buy = someone wants to buy
    type: String(r.type || 'item'),
    categoryId: num(r.id_category) || 0,
    itemId: num(r.id_item) || 0,
    title: String(r.title || '').slice(0, 200),
    desc: String(r.description || '').slice(0, 2000),
    price: num(r.price),
    currency: String(r.currency || 'UEC'),
    unit: String(r.unit || 'unit'),
    quality: quality && quality > 0 ? quality : null,   // 1-1000 for crafted gear; 0 or empty means not given
    source: r.source ? String(r.source) : '',
    availability: r.availability ? String(r.availability) : '',
    location: String(r.location || '').slice(0, 120),
    seller: String(r.user_username || r.user_name || '').slice(0, 60),
    avatar: CDN.test(r.user_avatar || '') ? r.user_avatar : '',
    photos,
    added: (num(r.date_added) || 0) * 1000,
    expires: (num(r.date_expiration) || 0) * 1000,
    soldOut: r.is_sold_out === 1 || r.is_sold_out === '1' || r.is_sold_out === true,
  };
}

// UEX negotiation -> our deal. Names are the players' in-game names only (UEX also holds full names; we never keep them).
// Dates come as seconds. "mine" is deliberately not worked out: which side the caller is has not been confirmed,
// so a deal shows who advertised and who made contact, and never guesses which one is you.
function normalizeDeal(r) {
  if (!r || num(r.id) == null || !r.hash) return null;
  const closedAt = Math.max(num(r.date_closed) || 0, num(r.date_closed_client) || 0);
  return {
    id: num(r.id),
    hash: String(r.hash),
    listingId: num(r.id_listing) || 0,
    title: String(r.listing_title || '').slice(0, 200),
    url: r.listing_slug ? LISTING_URL + encodeURIComponent(r.listing_slug) : '',
    price: num(r.price),
    unit: String(r.unit || 'unit'),
    dealValue: num(r.deal_value),
    advertiser: String(r.advertiser_username || '').slice(0, 60),
    client: String(r.client_username || '').slice(0, 60),
    added: (num(r.date_added) || 0) * 1000,
    modified: (num(r.date_modified) || num(r.date_added) || 0) * 1000,
    closed: closedAt > 0,
  };
}

// What a listing page offers the signed-in session, read from UEX's own HTML:
//   needsignin - "Start Deal" is a link to the login page      unverified - UEX wants the account verified first
//   ready      - Start Deal goes straight through              terms      - UEX shows its terms first (a person has to accept those)
//   unknown    - anything else (the person finishes on UEX itself)
function parseListingPage(html) {
  const h = String(html || '');
  if (/<a[^>]*href="[^"]*\/login"[^>]*>\s*(?:<[^>]+>\s*)*Start Deal/i.test(h)) return 'needsignin';
  if (/Verify your account<\/a>\s*to start negotiating/i.test(h)) return 'unverified';
  const m = h.match(/onclick="initiate_negotiation\(([^)]*)\)"/);
  if (m) return m[1].trim() === 'true' ? 'terms' : 'ready';
  return 'unknown';
}

// Who a UEX page was served to. Every UEX page names its visitor in a script constant; the id is empty when signed out.
function parseSession(html) {
  const h = String(html || '');
  const id = h.match(/const app_id_user = `(\d+)`/);
  const name = h.match(/const app_username = "([^"]{0,60})"/);
  return id && Number(id[1]) > 0 ? { signedIn: true, username: name ? name[1] : '' } : { signedIn: false, username: '' };
}

// One chat message. `user` is the name UEX attaches to the message; which person that is gets learned in main.js.
function normalizeMessage(r) {
  if (!r || num(r.id) == null) return null;
  return {
    id: num(r.id),
    text: String(r.message || '').slice(0, 4000),
    event: r.event ? String(r.event).slice(0, 60) : '',
    user: String(r.user_username || '').slice(0, 60),
    at: (num(r.date_added) || 0) * 1000,
    read: (num(r.date_read) || 0) > 0,
  };
}

// Does a listing match a watch? watch = { op, text, price, minQuality, category }.
// For a "selling" watch price is the most you will pay; for a "wanted" watch it is the least you will take.
function matches(l, w, now = Date.now()) {
  if (l.op !== w.op || l.soldOut) return false;
  if (l.expires && l.expires < now) return false;
  if (w.category && l.categoryId !== Number(w.category)) return false;
  if (w.text) {
    const hay = (l.title + ' ' + l.desc).toLowerCase();
    if (!String(w.text).toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t))) return false;
  }
  if (w.price > 0) {
    if (l.price == null) return false;
    if (w.op === 'sell' ? l.price > w.price : l.price < w.price) return false;
  }
  if (w.minQuality > 0 && !(l.quality >= w.minQuality)) return false;
  return true;
}

class MarketService {
  constructor({ fetchJson }) {
    this.get = fetchJson;
    this.cache = {};       // 'sell' | 'buy' -> { at, rows }
    this.cats = null;
  }

  // Current listings for one side. A failed request hands back the last good answer (marked stale) when there is one.
  async listings(op, force = false) {
    const key = op === 'buy' ? 'buy' : 'sell';
    const c = this.cache[key];
    if (!force && c && Date.now() - c.at < CACHE_MS) return c;
    try {
      const res = await this.get(`${BASE}/marketplace_listings?operation=${key}`);
      if (!res || res.status !== 'ok' || !Array.isArray(res.data)) throw new Error((res && res.status) || 'unexpected answer');
      return (this.cache[key] = { at: Date.now(), rows: res.data.map(normalize).filter(Boolean), stale: false });
    } catch (e) {
      if (c) return { ...c, stale: true, error: e.message };
      throw e;
    }
  }

  // Item categories, for the filter: [{ id, section, name }].
  async categories() {
    if (this.cats && Date.now() - this.cats.at < CATEGORY_MS) return this.cats.list;
    const res = await this.get(`${BASE}/categories`);
    if (!res || res.status !== 'ok' || !Array.isArray(res.data)) throw new Error('categories unavailable');
    const list = res.data.filter(c => c.type === 'item').map(c => ({ id: c.id, section: String(c.section || ''), name: String(c.name || '') }));
    this.cats = { at: Date.now(), list };
    return list;
  }
}

module.exports = { MarketService, normalize, normalizeDeal, normalizeMessage, parseListingPage, parseSession, matches, LISTING_URL };
