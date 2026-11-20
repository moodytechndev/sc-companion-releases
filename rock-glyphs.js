'use strict';
// Reads the HUD's small numbers one character at a time by matching each character against ones learned from labelled
// frames (rock-glyphs.json, built by scripts/rock-glyphs/). The HUD always draws its numbers in the same font, so a
// character matched to known examples is far more reliable than general text recognition on a 10 px digit.
//
// A number's crop is turned into "ink" (what is brighter than its neighbourhood), cut into characters at the gaps
// between them, each character is shrunk to a small bitmap, and the nearest known example wins.

const fs = require('fs');
const path = require('path');

const GW = 10, GH = 14;              // a character's bitmap
const BANK_FILE = path.join(__dirname, 'rock-glyphs.json');
let bank = null;
function loadBank() {
  if (bank) return bank;
  try { const j = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8')); bank = (j.samples || []).map(s => ({ ch: s.ch, v: Float32Array.from(s.v), aspect: s.aspect, hrel: s.hrel })); }
  catch { bank = []; }
  return bank;
}
function setBank(samples) { bank = samples.map(s => ({ ch: s.ch, v: Float32Array.from(s.v), aspect: s.aspect, hrel: s.hrel })); }

// ── ink ────────────────────────────────────────────────────────────────────────────────────────────────────
// A crop, enlarged, as a 0..1 map of how much each pixel is brighter than its surroundings.
function inkMap(image, rect, scale) {
  let img = image.crop(rect);
  if (scale > 1.01) img = img.resize({ width: Math.round(rect.width * scale), height: Math.round(rect.height * scale), quality: 'best' });
  const { width: w, height: h } = img.getSize(), px = img.toBitmap(), n = w * h, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  // local background: a box average over a window about twice the text height
  const half = Math.max(4, Math.round(h * 0.9)), W1 = w + 1, integ = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += L[y * w + x]; integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + row; } }
  const ink = new Float32Array(n);
  let mx = 0;
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - half), yb = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - half), xb = Math.min(w, x + half + 1);
      const mean = (integ[yb * W1 + xb] - integ[ya * W1 + xb] - integ[yb * W1 + xa] + integ[ya * W1 + xa]) / ((xb - xa) * (yb - ya));
      const d = Math.max(0, L[y * w + x] - mean * 1.05);
      ink[y * w + x] = d; if (d > mx) mx = d;
    }
  }
  if (mx > 0) for (let i = 0; i < n; i++) ink[i] /= mx;
  return { w, h, ink, mx };
}

// ── cutting into characters ───────────────────────────────────────────────────────────────────────────────
// Returns the characters of a crop, left to right: { x0, x1, y0, y1, mask } with mask a (w x h) Uint8Array of the
// character's own box.
function segment(map, thr = 0.5) {
  const { w, h, ink } = map;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = ink[i] > thr ? 1 : 0;
  const col = new Int32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on[y * w + x]) col[x]++;
  // runs of columns with ink
  let runs = [], start = -1;
  for (let x = 0; x <= w; x++) {
    const has = x < w && col[x] > 0;
    if (has && start < 0) start = x;
    if (!has && start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  // ink in a run
  const rowsOf = (x0, x1) => { let y0 = h, y1 = -1; for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) if (on[y * w + x]) { if (y < y0) y0 = y; if (y > y1) y1 = y; } return [y0, y1]; };
  const tall = Math.max(1, ...runs.map(([a, b]) => { const [y0, y1] = rowsOf(a, b); return y1 - y0 + 1; }));
  // ignore specks
  runs = runs.filter(([a, b]) => { const [y0, y1] = rowsOf(a, b); return (b - a + 1) >= Math.max(2, tall * 0.08) && (y1 - y0 + 1) >= tall * 0.1; });
  // split a run that is much wider than a digit (two touching characters) at its thinnest column
  const digitW = median(runs.filter(([a, b]) => { const [y0, y1] = rowsOf(a, b); return (y1 - y0 + 1) > tall * 0.7; }).map(([a, b]) => b - a + 1)) || tall * 0.55;
  const out = [];
  for (const [a, b] of runs) {
    const [y0, y1] = rowsOf(a, b);
    const full = (y1 - y0 + 1) > tall * 0.7;
    if (full && (b - a + 1) > digitW * 1.55) {
      const parts = Math.round((b - a + 1) / digitW);
      let cuts = [a];
      for (let k = 1; k < parts; k++) {
        const target = a + Math.round(((b - a + 1) * k) / parts), lo = Math.max(a + 2, target - Math.round(digitW * 0.3)), hi = Math.min(b - 2, target + Math.round(digitW * 0.3));
        let best = target, bv = 1e9; for (let x = lo; x <= hi; x++) if (col[x] < bv) { bv = col[x]; best = x; }
        cuts.push(best);
      }
      cuts.push(b + 1);
      for (let k = 0; k < cuts.length - 1; k++) out.push([cuts[k], cuts[k + 1] - 1]);
    } else out.push([a, b]);
  }
  return out.map(([a, b]) => {
    const [y0, y1] = rowsOf(a, b), gw = b - a + 1, gh = y1 - y0 + 1, mask = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) mask[y * gw + x] = on[(y0 + y) * w + a + x];
    return { x0: a, x1: b, y0, y1, gw, gh, mask, tall };
  });
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }

// A character's bitmap: its box shrunk to GW x GH by averaging (0..1).
function features(g) {
  const v = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const ya = Math.floor((j * g.gh) / GH), yb = Math.max(ya + 1, Math.floor(((j + 1) * g.gh) / GH));
    const xa = Math.floor((i * g.gw) / GW), xb = Math.max(xa + 1, Math.floor(((i + 1) * g.gw) / GW));
    let s = 0, c = 0; for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { s += g.mask[y * g.gw + x]; c++; }
    v[j * GW + i] = c ? s / c : 0;
  }
  return { v, aspect: g.gw / g.gh, hrel: g.gh / g.tall };
}

// the nearest known character: { ch, d } (d is smaller for a better match)
function classify(f) {
  // a dot is short and sits low; nothing else in these numbers is
  if (f.hrel < 0.38) return { ch: '.', d: 0 };
  let best = null, bd = 1e9, second = 1e9;
  for (const s of loadBank()) {
    if (s.ch === '.') continue;
    let d = 0; for (let i = 0; i < s.v.length; i++) { const t = f.v[i] - s.v[i]; d += t * t; }
    d = Math.sqrt(d / s.v.length) * 4 + Math.abs(f.aspect - s.aspect) * 0.8 + Math.abs(f.hrel - s.hrel) * 0.8;
    if (d < bd) { second = bd; bd = d; best = s.ch; } else if (d < second && s.ch !== best) second = d;
  }
  return best == null ? null : { ch: best, d: bd, margin: second - bd };
}

// The ink of a number's crop, aligned to its line of text: the crop is taken a little taller than asked, and only the rows
// where the text actually is are kept, so a panel found a pixel or two off still reads cleanly and the neighbouring
// line's digits stay out.
function prepare(image, rect, scale, band) {
  if (band === false) return inkMap(image, rect, scale || 3);
  const { width: W, height: H } = image.getSize();
  const pad = Math.round(rect.height * 0.45);
  const y0 = Math.max(0, rect.y - pad), y1 = Math.min(H, rect.y + rect.height + pad);
  const big = { x: rect.x, y: y0, width: rect.width, height: y1 - y0 };
  const map = inkMap(image, big, scale || 3);
  const { w, h, ink } = map, rs = new Float32Array(h); let mx = 0;
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) if (ink[y * w + x] > 0.5) c++; rs[y] = c; if (c > mx) mx = c; }
  if (mx < 3) return map;
  const centre = (rect.y + rect.height / 2 - y0) * (h / (y1 - y0));
  let best = null;
  for (let y = 0; y < h;) {
    if (rs[y] > mx * 0.12) { let e = y; while (e + 1 < h && rs[e + 1] > mx * 0.12) e++; const mid = (y + e) / 2, ht = e - y + 1, dist = (centre >= y && centre <= e) ? 0 : Math.min(Math.abs(centre - y), Math.abs(centre - e));
      if (ht >= h * 0.12 && (!best || dist < best.dist || (dist === best.dist && ht > best.ht))) best = { y, e, dist, ht }; y = e + 1; } else y++;
  }
  if (!best) return map;
  const ya = Math.max(0, best.y - 2), yb = Math.min(h - 1, best.e + 2), nh = yb - ya + 1, out = new Float32Array(w * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < w; x++) out[y * w + x] = ink[(ya + y) * w + x];
  return { w, h: nh, ink: out, mx: map.mx };
}

// The characters of a crop at one threshold, with options:
//   stopAtGap  the number ends where a much wider gap starts (the " SCU" after a size)
//   noDot      a whole number: small specks are not decimal points
//   band       false: do not align to the line of text first (the laser panel's dim numbers read better without)
function cut(map, thr, opts) {
  // a thin tall line is the edge of the box a number sits in, not a character
  let gs = segment(map, thr).filter(g => !(g.gw / g.gh < 0.2 && g.gh > g.tall * 0.6));
  if (opts && opts.noDot) gs = gs.filter(g => g.gh / g.tall >= 0.38);      // a whole number has no point; a speck is noise
  if (opts && opts.stopAtGap && gs.length >= 3) {
    const gaps = []; for (let i = 1; i < gs.length; i++) gaps.push(gs[i].x0 - gs[i - 1].x1);
    const typical = median(gaps), maxGap = Math.max(...gaps);
    if (maxGap > Math.max(typical * 1.8, gs[0].tall * 0.3)) gs = gs.slice(0, gaps.indexOf(maxGap) + 1);
  }
  return gs;
}

// Reads a number's crop. Returns { text, worst, mean, chars } or null when there is nothing to read.
// The percent sign is two pieces to the cutter; they are learned as "P" and "Q" and come back as "%".
function readCrop(image, rect, opts) {
  opts = opts || {};
  if (!rect || !loadBank().length) return null;
  const map = prepare(image, rect, opts.scale || 3, opts.band);
  if (map.mx < 40) return null;                                    // nothing bright in there
  let best = null;
  for (const thr of [0.5, 0.62, 0.75, 0.85, 0.92, 0.38]) {                     // dim digits need a different threshold than bright ones
    const gs = cut(map, thr, opts);
    if (!gs.length) continue;
    const chars = gs.map(g => { const c = classify(features(g)); return c ? { ch: c.ch, d: c.d, margin: c.margin } : { ch: '?', d: 9 }; });
    const mean = chars.reduce((a, c) => a + c.d, 0) / chars.length, worst = Math.max(...chars.map(c => c.d));
    if (!best || mean < best.mean) best = { text: chars.map(c => c.ch).join('').replace(/PQ/g, '%').replace(/[PQ]/g, ''), worst, mean, chars };
  }
  return best;
}

module.exports = { inkMap, prepare, segment, cut, features, classify, readCrop, loadBank, setBank, GW, GH, BANK_FILE };
