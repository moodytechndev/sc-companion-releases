'use strict';
// Reads the Prospector's mining HUD from a picture of the game: the RESULTS panel (the rock: ore, mass, resistance,
// instability, how hard it is, and what it is made of) and the mining laser panel (what the laser and its modules do).
//
// The panels drift a little with your head movement, so they are found on every new lock by reading the whole area
// they live in; the percentages of the composition rows (11.71%) are the most reliably read text on the panel, so
// their column is the anchor. Everything else sits at a fixed distance from it, measured in `p`, the row spacing
// (about 13.4 px on a 1440p frame), so the layout holds at any resolution. Each number is then read from its own small
// crop with only digits allowed, which is far more accurate than reading the panel as a block of text.
//
// readFrame() does one reading; RockVoter smooths a run of readings (one misread digit never reaches the screen).

const refinery = require('./refinery-ocr');
const glyphs = require('./rock-glyphs');
const { grayRegion, encodeGray, closestMaterialName, sharpenGray } = refinery;

// Settings that were tuned against real frames (see scripts/tune-rock-ocr.js); the environment can override them to try others.
const CFG = Object.assign({ prep: 'gray', target: 80, sharp: 1.8, pctile: 0.995 }, process.env.ROCK_CFG ? JSON.parse(process.env.ROCK_CFG) : {});
// Where the two panels sit on a 16:9 screen at the usual field of view, as fractions of the frame (x0, y0, x1, y1). Only
// these areas are read first; the rest of the screen is searched only when the laser panel is not here (the HUD has
// moved, for example after a change of field of view).
const ROI = { results: [0.6775, 0.4498, 0.7705, 0.6853], laser: [0.2185, 0.455, 0.34, 0.9244] };
const P_REF = 13.44;     // composition row spacing on a 1440p frame
const Q_REF = 13.1;      // laser panel row spacing on a 1440p frame

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────────
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const lettersOf = (s) => String(s || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
function levenshtein(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const LOOK = { o: '0', O: '0', Q: '0', D: '0', l: '1', I: '1', i: '1', '|': '1', '!': '1', Z: '2', z: '2', S: '5', s: '5', G: '6', b: '6', g: '9', B: '8' };
const digitsOnly = (s) => String(s || '').replace(/[^0-9A-Za-z.|!,%]/g, '').split('').map(c => (/[0-9.,%]/.test(c) ? c : (LOOK[c] || ''))).join('').replace(/,/g, '.');

function rectAt(W, H, cx, cy, hw, hh) {
  const x0 = Math.max(0, Math.round(cx - hw)), y0 = Math.max(0, Math.round(cy - hh));
  const x1 = Math.min(W, Math.round(cx + hw)), y1 = Math.min(H, Math.round(cy + hh));
  return (x1 - x0 >= 8 && y1 - y0 >= 4) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
function rectBox(W, H, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(W, Math.round(x1)); y1 = Math.min(H, Math.round(y1));
  return (x1 - x0 >= 8 && y1 - y0 >= 4) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

// Crop, enlarge, then keep what is brighter than its own neighbourhood (the HUD's text is lighter than the ground
// behind it, but "lighter" means different things in front of snow, rock and sky, so the comparison is local: a pixel
// against the average of the pixels around it). Returns dark text on a white page, which is what Tesseract wants.
function prepLocal(image, rect, scale, win, t0, t1) {
  let img = image.crop(rect);
  if (scale > 1.01) img = img.resize({ width: Math.round(rect.width * scale), height: Math.round(rect.height * scale), quality: 'best' });
  const { width: w, height: h } = img.getSize();
  const px = img.toBitmap();                                   // BGRA
  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) luma[i] = (px[i * 4 + 2] * 299 + px[i * 4 + 1] * 587 + px[i * 4] * 114) / 1000;
  const W1 = w + 1, integ = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += luma[y * w + x]; integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + row; } }
  const half = Math.max(3, win >> 1), v = new Uint8Array(w * h), span = Math.max(1, t1 - t0);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - half), yb = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - half), xb = Math.min(w, x + half + 1);
      const mean = (integ[yb * W1 + xb] - integ[ya * W1 + xb] - integ[yb * W1 + xa] + integ[ya * W1 + xa]) / ((xb - xa) * (yb - ya));
      const d = luma[y * w + x] - mean;
      v[y * w + x] = 255 - Math.max(0, Math.min(255, Math.round((d - t0) * 255 / span)));
    }
  }
  return { w, h, v };
}
const PREP = { win: 0.0, t0: 3, t1: 38 };   // win is set per call from the text height
const prepPng = (image, rect, scale) => encodeGray(prepLocal(image, rect, scale, Math.round(scale * 11) | 1, PREP.t0, PREP.t1));

// One value per pixel chosen from the colour channels, stretched so the text is black on white. The HUD's text is lit
// in different colours (red, green, white) and has coloured fringes; which mix of channels keeps the strokes whole
// is one of the things tuned.
function chanPrep(image, rect, scale, mode) {
  let img = image.crop(rect);
  if (scale > 1.01) img = img.resize({ width: Math.round(rect.width * scale), height: Math.round(rect.height * scale), quality: 'best' });
  const { width: w, height: h } = img.getSize(), px = img.toBitmap(), n = w * h, val = new Uint8Array(n), hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const b = px[i * 4], g = px[i * 4 + 1], r = px[i * 4 + 2];
    const l = mode === 'max' ? Math.max(r, g, b) : mode === 'avg' ? (r + g + b) / 3 : mode === 'g' ? g : (r * 299 + g * 587 + b * 114) / 1000;
    val[i] = l; hist[l | 0]++;
  }
  const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
  let lo = pct(0.02), hi = pct(CFG.pctile);
  if (hi - lo < 24) lo = Math.max(0, hi - 24);
  const v = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(1, (val[i] - lo) / (hi - lo)));
    v[i] = CFG.bin ? (t > CFG.bin ? 0 : 255) : 255 - Math.round(t * 255);
  }
  return { w, h, v };
}

function whiteText(image, rect, scale, lo, hi) {
  let img = image.crop(rect);
  if (scale > 1.01) img = img.resize({ width: Math.round(rect.width * scale), height: Math.round(rect.height * scale), quality: 'best' });
  const { width: w, height: h } = img.getSize(), px = img.toBitmap(), v = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const m = Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); v[i] = 255 - Math.max(0, Math.min(255, Math.round((m - lo) * 255 / (hi - lo)))); }
  return { w, h, v };
}

async function readText(worker, image, rect, scale, psm, whitelist, white) {
  if (!rect) return '';
  let g;
  if (white) g = whiteText(image, rect, scale, white[0], white[1]);
  else {
    g = CFG.prep === 'gray' ? grayRegion(image, rect, scale, false) : chanPrep(image, rect, scale, CFG.prep);
    if (CFG.sharp > 0) { const sharp = sharpenGray(g, 3, CFG.sharp); if (sharp && sharp.v) g.v = sharp.v; }
  }
  const png = encodeGray(g);
  await worker.setParameters({ tessedit_pageseg_mode: String(psm), tessedit_char_whitelist: whitelist || '' });
  try { const { data } = await worker.recognize(png); return String(data.text || '').trim(); }
  finally { if (whitelist) await worker.setParameters({ tessedit_char_whitelist: '' }); }
}

async function readWords(worker, image, rect, scale, psm) {
  if (!rect) return [];
  const png = prepPng(image, rect, scale);
  await worker.setParameters({ tessedit_pageseg_mode: String(psm), tessedit_char_whitelist: '' });
  const { data } = await worker.recognize(png, {}, { blocks: true, text: true });
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
    out.push({ text: w.text || '', x0: rect.x + w.bbox.x0 / scale, y0: rect.y + w.bbox.y0 / scale, x1: rect.x + w.bbox.x1 / scale, y1: rect.y + w.bbox.y1 / scale });
  }
  return out;
}

// ── the RESULTS panel ────────────────────────────────────────────────────────────────────────────────────
const PCT = /^\d{1,3}[.,]\d{2}\s*%$/;   // the % is required: the cargo list shows plain numbers (4.13) in a column too

// Finds the composition column: words like "11.71%" stacked in one column. Returns { px, y0, p, rows } or null.
function findResultsAnchor(words, scaleGuess) {
  const cands = words.filter(w => PCT.test(w.text.replace(/\s/g, '')) && (w.y1 - w.y0) < 70 * scaleGuess);
  if (cands.length < 2) return null;
  let best = null;
  for (const c of cands) {
    const col = cands.filter(d => Math.abs(d.x0 - c.x0) <= 5 * scaleGuess).sort((a, b) => a.y0 - b.y0);
    if (!best || col.length > best.length) best = col;
  }
  if (!best || best.length < 2) return null;
  const gaps = []; for (let i = 1; i < best.length; i++) gaps.push(best[i].y0 - best[i - 1].y0);
  const gmin = Math.min(...gaps), p = median(gaps.filter(g => g < gmin * 1.35));
  if (p < 7 * scaleGuess || p > 45 * scaleGuess) return null;
  const first = best[0];
  return { px: median(best.map(w => w.x0)), y0: (first.y0 + first.y1) / 2, p, rows: best.length };
}

// the ore a rock is mostly made of: "AGRICIUM (ORE)" -> "Agricium"
function oreName(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const key = lettersOf(t);
  if (key.length >= 5 && levenshtein(key.slice(0, 5), 'inert') <= 1 && (key.includes('mat') || key.length <= 6)) return 'Inert Materials';
  const nm = closestMaterialName(t.replace(/\(.*$/, '').replace(/\)+$/, '').trim());
  return nm || '';
}

const DIFFICULTY = ['easy', 'medium', 'hard', 'very hard', 'extreme', 'impossible'];
function difficultyOf(text) {
  const k = lettersOf(text); if (k.length < 3) return '';
  let best = '', bd = 99;
  for (const d of DIFFICULTY) { const dd = levenshtein(k, d.replace(/ /g, '')); if (dd < bd) { bd = dd; best = d; } }
  return bd <= Math.max(1, Math.floor(k.length * 0.34)) ? best : '';
}

function numberFrom(text, kind) {
  const s = digitsOnly(text);
  if (kind === 'int') { const m = s.replace(/\./g, '').match(/\d{2,7}/); return m ? parseInt(m[0], 10) : null; }
  if (kind === 'digit') { const m = s.replace(/\./g, '').match(/\d{1,7}/); return m ? parseInt(m[0], 10) : null; }
  if (kind === 'pct') { const m = s.match(/\d{1,3}(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; }
  if (kind === 'scu') { const m = s.match(/\d{1,5}\.\d{1,2}/); return m ? parseFloat(m[0]) : null; }
  const m = s.match(/\d{1,5}(?:\.\d{1,3})?/); return m ? parseFloat(m[0]) : null;   // 'dec'
}

// A number from a crop. The tiny digits are easy to misread one way or another, so each is read several ways (two
// enlargements of the plainly stretched crop, two of a "whitest part only" version) and the most common answer wins.
async function readNumber(worker, image, rect, scale, kind, whitelist, gopts) {
  // First choice: the character-by-character reader (rock-glyphs.js). It is used when every character matched a known
  // one closely and the result has the shape the number should have; otherwise the text reader below takes over.
  const g = glyphs.readCrop(image, rect, gopts || {});
  if (g && g.worst <= GLYPH_OK && SHAPE[kind] && SHAPE[kind].test(g.text)) { const n = numberFrom(g.text, kind); if (n != null) return n; }
  const tries = [
    [scale, null], [Math.max(2, scale - 1), null],
    [scale, [180, 240]], [scale + 1, [190, 245]],
  ];
  const votes = new Map();
  for (const [sc, white] of tries) {
    const n = numberFrom(await readText(worker, image, rect, sc, 7, whitelist, white), kind);
    if (n != null) votes.set(n, (votes.get(n) || 0) + 1);
  }
  let best = null, bc = 0;
  for (const [n, c] of votes) if (c > bc || (c === bc && best != null && String(n).length > String(best).length)) { best = n; bc = c; }
  return best;
}
const GLYPH_OK = 1.8;        // how far a character may be from the known one it is matched to (correct reads were below 1.65)
const SHAPE = { int: /^\d{2,7}$/, digit: /^\d{1,7}$/, pct: /^\d{1,3}(\.\d{1,2})?%?$/, dec: /^\d{1,5}\.\d{1,3}$/, scu: /^\d{1,3}\.\d{1,2}$/ };

// Where each piece of the results panel sits, from the anchor (the composition column), in px.
function resultsCells(a, W, H) {
  const { px, y0, p } = a;
  const R = (dy, x0, x1, hu) => rectBox(W, H, px + x0 * p, y0 + (dy - hu) * p, px + x1 * p, y0 + (dy + hu) * p);
  return { ore: R(-9.4, -0.3, 9.5, 0.6), mass: R(-8.15, 4.75, 8.4, 0.55), res: R(-6.95, 4.75, 8.4, 0.55), inst: R(-5.76, 4.75, 8.4, 0.55),
    diff: R(-4.52, 2.2, 10.8, 0.6), scu: R(-2.49, 6.8, 10.4, 0.55), pct: (i) => R(i, -0.5, 2.9, 0.55), name: (i) => R(i, 2.5, 8.7, 0.55), qual: (i) => R(i, 8.85, 11.0, 0.55) };
}
function laserCells(a, W, H) {
  const { lx0, slope, row0, q } = a, left = (r) => lx0 + slope * r;
  return { name: rectBox(W, H, left(0) + 0.4 * q, row0 - 3.23 * q - 0.7 * q, left(0) + 15.8 * q, row0 - 3.23 * q + 0.7 * q),
    value: (r) => rectBox(W, H, left(r) + 5.65 * q, row0 + r * q - 0.6 * q, left(r) + 7.6 * q, row0 + r * q + 0.6 * q),
    row: (r) => rectBox(W, H, left(r) - 0.8 * q, row0 + r * q - 0.6 * q, left(r) + 8.2 * q, row0 + r * q + 0.6 * q) };
}

// One read of the results panel given where its composition column is.
async function readResults(image, worker, a, sc) {
  const { width: W, height: H } = image.getSize();
  const S = Math.max(3, Math.min(8, Math.round(CFG.target / a.p)));     // enlarge so a row of text is ~80 px tall
  const c = resultsCells(a, W, H);
  const out = { ore: '', mass: null, resistance: null, instability: null, difficulty: '', totalScu: null, comp: [] };
  out.ore = oreName(await readText(worker, image, c.ore, S, 7, ''));
  out.mass = await readNumber(worker, image, c.mass, S, 'int', '0123456789.', { noDot: true });
  out.resistance = await readNumber(worker, image, c.res, S, 'pct', '0123456789.%', { noDot: true });
  out.instability = await readNumber(worker, image, c.inst, S, 'dec', '0123456789.');
  out.difficulty = difficultyOf(await readText(worker, image, c.diff, S, 7, ''));
  out.totalScu = await readNumber(worker, image, c.scu, S, 'scu', '0123456789.', { stopAtGap: true });

  // composition rows, until one has no percentage
  for (let i = 0; i < 9; i++) {
    const pct = await readNumber(worker, image, c.pct(i), S, 'pct', '0123456789.%');
    const nameText = await readText(worker, image, c.name(i), S, 7, '');
    if (pct == null || lettersOf(nameText).length < 3) break;
    const quality = await readNumber(worker, image, c.qual(i), S, 'digit', '0123456789', { noDot: true });
    out.comp.push({ pct, name: oreName(nameText), quality: quality == null ? null : quality });
  }
  // the rock's ore is the one it has most of (more reliable than the small heading above it)
  const main = out.comp.filter(c => c.name && !/inert/i.test(c.name)).sort((a, b) => (b.pct || 0) - (a.pct || 0))[0];
  if (main && (!out.ore || !KNOWN_ORES.has(out.ore.toLowerCase()))) out.ore = main.name;
  else if (main && out.ore !== main.name && main.pct >= 50) out.ore = main.name;
  // the inert row's share is the rest of the rock, which is read more reliably than its own digits
  const last = out.comp[out.comp.length - 1];
  if (last && /inert/i.test(last.name) && out.comp.length >= 2) {
    const others = out.comp.slice(0, -1).reduce((a, c) => a + (c.pct || 0), 0);
    const rest = Math.round((100 - others) * 100) / 100;
    if (others > 0 && others < 100 && (last.pct == null || Math.abs(last.pct - rest) > 0.6)) last.pct = rest;   // the read value stands when it agrees
  }
  return out;
}

// ── the mining laser panel ───────────────────────────────────────────────────────────────────────────────
const LASER_ROWS = ['fracture', 'resistance', 'instability', 'optimalRate', 'overchargeRate', 'window', 'shatter'];
const LASER_WORDS = [['fracture'], ['resistance', 'resist'], ['instability', 'instab'], ['optimal'], ['overch', 'overcharge'], ['window'], ['shatter']];

function findLaserAnchor(words, scaleGuess) {
  // each label word → the row it names
  let hits = [];
  for (const w of words) {
    const k = lettersOf(w.text);
    if (k.length < 4) continue;
    for (let r = 0; r < LASER_WORDS.length; r++) {
      if (LASER_WORDS[r].some(t => levenshtein(k.slice(0, t.length), t) <= (t.length >= 7 ? 2 : 1))) { hits.push({ r, x0: w.x0, yc: (w.y0 + w.y1) / 2 }); break; }
    }
  }
  if (hits.length < 2) return null;
  // spacing from pairs of different rows, row 0's y from each, then the median
  const qs = [];
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) if (hits[j].r !== hits[i].r) qs.push((hits[j].yc - hits[i].yc) / (hits[j].r - hits[i].r));
  const q = median(qs.filter(v => v > 0));
  if (!(q > 6 * scaleGuess && q < 45 * scaleGuess)) return null;
  let row0 = median(hits.map(h => h.yc - h.r * q));
  // keep only the labels that sit where a row of this spacing would put them; three different rows must agree
  hits = hits.filter(h => Math.abs(h.yc - (row0 + h.r * q)) <= 0.5 * q);
  if (new Set(hits.map(h => h.r)).size < 3) return null;
  row0 = median(hits.map(h => h.yc - h.r * q));
  // the panel is drawn at a slant, so each row's left edge sits a little further left than the one above
  const rows = new Set(hits.map(h => h.r));
  let slope = 0, lx0 = median(hits.map(h => h.x0));
  if (rows.size >= 3) {
    const n = hits.length, mr = hits.reduce((a, h) => a + h.r, 0) / n, mx = hits.reduce((a, h) => a + h.x0, 0) / n;
    let num = 0, den = 0; for (const h of hits) { num += (h.r - mr) * (h.x0 - mx); den += (h.r - mr) * (h.r - mr); }
    if (den > 0) { slope = Math.max(-0.5 * q, Math.min(0.5 * q, num / den)); lx0 = mx - slope * mr; }
  } else {
    lx0 = median(hits.map(h => h.x0 - 0));   // too few rows to tell the slant
  }
  return { lx0, slope, row0, q, hits: hits.length };
}

async function readLaser(image, worker, a) {
  const { width: W, height: H } = image.getSize();
  const S = Math.max(3, Math.min(8, Math.round(CFG.target / a.q)));
  const c = laserCells(a, W, H);
  const out = { name: '', mods: {} };
  out.name = (await readText(worker, image, c.name, S, 7, '')).replace(/\s+/g, ' ').replace(/\s*mining\s*laser.*$/i, '').trim();
  for (let r = 0; r < LASER_ROWS.length; r++) {
    // the number's own box (read several ways) and, as a second opinion, the end of the whole row (label and number)
    const votes = new Map();
    const add = (n, w) => { if (n != null && n >= 20 && n <= 300) votes.set(n, (votes.get(n) || 0) + w); };
    add(await readNumber(worker, image, c.value(r), S, 'int', '0123456789', { noDot: true, band: false }), 2);
    const row = await readText(worker, image, c.row(r), S, 7, '');
    const m = digitsOnly(row).match(/(\d{2,3})(?!.*\d)/); if (m) add(parseInt(m[1], 10), 1);
    let best = null, bc = 0; for (const [n, c2] of votes) if (c2 > bc) { best = n; bc = c2; }
    out.mods[LASER_ROWS[r]] = best;
  }
  return out;
}

// A reading is only used when it hangs together: at least two ores the game knows, and shares that add up to about
// a whole rock. A misread digit or two is smoothed out later; a panel read from the wrong place is thrown away here.
const KNOWN_ORES = new Set((refinery.KNOWN_MATERIALS || []).map(n => n.toLowerCase()));
function plausibleRock(r) {
  if (!r || r.comp.length < 2) return false;
  const named = r.comp.filter(c => c.name && (/inert/i.test(c.name) || KNOWN_ORES.has(c.name.toLowerCase()))).length;
  if (named < Math.max(2, r.comp.length - 1)) return false;
  const sum = r.comp.reduce((a, c) => a + (c.pct || 0), 0);
  return sum >= 80 && sum <= 120;
}

// ── one reading ──────────────────────────────────────────────────────────────────────────────────────────
// lock: { results, laser } from an earlier reading (or {}), so the big search only runs when the panels are not where
// they were. Returns { results, laser, lock, ms }.
async function readFrame(image, worker, lock, onPhase, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const { width: W, height: H } = image.getSize();
  const sc = H / 1440;
  lock = Object.assign({ results: null, laser: null, cur: { results: 0, laser: 0 }, resMiss: 0, nextSearch: { results: 0, laser: 0 }, roiMiss: { results: 0, laser: 0 }, layoutOk: null }, lock || {});
  lock.roiMiss = Object.assign({ results: 0, laser: 0 }, lock.roiMiss);
  lock.cur = Object.assign({ results: 0, laser: 0 }, lock.cur); lock.nextSearch = Object.assign({ results: 0, laser: 0 }, lock.nextSearch);
  const out = { results: null, laser: null, lock, ms: 0 };

  // The HUD is projected, so where it sits and how big it is depends on the field of view and on head movement. The
  // panels are searched for in overlapping tiles, nearest the usual place first. A few tiles are looked at per reading
  // (and a full round that finds nothing is followed by a rest), so a screen without the panel costs little.
  const tiles = (xs, ys, w, h, cx, cy) => {
    const list = [];
    for (const x of xs) for (const y of ys) list.push([x, y, Math.min(1, x + w), Math.min(1, y + h)]);
    const d = (t) => Math.hypot((t[0] + (t[2] - t[0]) / 2) - cx, (t[1] + (t[3] - t[1]) / 2) - cy);
    return list.sort((a, b) => d(a) - d(b));
  };
  const RESULT_TILES = tiles([0.5, 0.61, 0.72, 0.8], [0.3, 0.45, 0.6, 0.72], 0.2, 0.28, 0.72, 0.6);
  const LASER_TILES = tiles([0.12, 0.22, 0.32, 0.42], [0.55, 0.68, 0.8, 0.72], 0.22, 0.28, 0.28, 0.82);
  const PER_READING = 4;
  const grow = (r) => [Math.max(0, r[0] - 0.012), Math.max(0, r[1] - 0.015), Math.min(1, r[2] + 0.012), Math.min(1, r[3] + 0.015)];
  const readBox = async (b, scale) => readWords(worker, image, rectBox(W, H, b[0] * W, b[1] * H, b[2] * W, b[3] * H), scale, 11);
  async function search(key, boxes, find) {
    if (Date.now() < lock.nextSearch[key]) return null;
    if (onPhase) onPhase('searching');
    // 1. the marked area
    const a0 = find(await readBox(grow((opts.regions || ROI)[key]), 3), sc);
    if (process.env.ROCK_DEBUG) console.log('[rock] roi', key, a0 ? 'FOUND' : '-');
    if (a0) { lock.layoutOk = true; lock.roiMiss[key] = 0; return a0; }
    lock.roiMiss[key] = (lock.roiMiss[key] || 0) + 1;
    // 2. elsewhere: only when the laser panel is not where it was expected either, so the HUD is laid out differently
    if (lock.layoutOk !== false && !(key === 'laser' && lock.roiMiss.laser >= 3)) return null;
    lock.layoutOk = false;
    const start = lock.cur[key] || 0;
    for (let i = 0; i < PER_READING; i++) {
      const b = boxes[(start + i) % boxes.length];
      const a = find(await readBox(b, 2.2), sc);
      if (process.env.ROCK_DEBUG) console.log('[rock] tile', b.map(v => v.toFixed(2)).join(','), a ? 'FOUND' : '-');
      if (a) { lock.cur[key] = 0; return a; }
    }
    lock.cur[key] = (start + PER_READING) % boxes.length;
    if (lock.cur[key] <= start) lock.nextSearch[key] = Date.now() + 8000;   // a whole round found nothing
    return null;
  }
  // a panel found at the edge of a tile can be cut off there, so it is read again from a crop centred on it
  async function locateLaser() {
    const a = await search('laser', LASER_TILES, findLaserAnchor);
    if (!a) return null;
    const q = a.q, words = await readWords(worker, image, rectBox(W, H, a.lx0 - 4 * q, a.row0 - 5 * q, a.lx0 + 17 * q, a.row0 + 9 * q), 2.4, 11);
    return findLaserAnchor(words, sc) || a;
  }

  // ── the rock ──
  if (!lock.results) lock.results = await search('results', RESULT_TILES, findResultsAnchor);
  if (lock.results) {
    // is there a rock at all? one number is looked at before the whole panel is read
    const a = lock.results, S0 = Math.max(3, Math.min(8, Math.round(CFG.target / a.p)));
    const probe = numberFrom(await readText(worker, image, rectBox(W, H, a.px - 0.5 * a.p, a.y0 - 0.55 * a.p, a.px + 2.9 * a.p, a.y0 + 0.55 * a.p), S0, 7, '0123456789.%'), 'pct');
    if (probe == null) { lock.resMiss++; if (lock.resMiss >= 8) { lock.results = null; lock.resMiss = 0; } }
    else {
      const r = await readResults(image, worker, a, sc);
      if (plausibleRock(r)) { out.results = r; lock.resMiss = 0; } else { lock.resMiss++; if (lock.resMiss >= 4) { lock.results = null; lock.resMiss = 0; } }
    }
  }
  // ── the laser ──
  if (!lock.laser) lock.laser = await locateLaser();
  if (lock.laser) {
    const l = await readLaser(image, worker, lock.laser);
    const filled = Object.values(l.mods).filter(v => v != null).length;
    if (filled >= 4) out.laser = l; else lock.laser = null;
  }
  out.ms = Date.now() - t0;
  return out;
}

// ── smoothing a run of readings ──────────────────────────────────────────────────────────────────────────
// A single misread digit appears in one frame and not the next, so the shown value is the most common one over
// the last few readings. A different rock (other ore or a very different mass) starts the count again.
const mode = (vals) => {
  const m = new Map(); let best = null, bc = 0;
  for (const v of vals) { if (v == null || v === '') continue; const c = (m.get(v) || 0) + 1; m.set(v, c); if (c >= bc) { best = v; bc = c; } }
  return { value: best, count: bc, of: vals.filter(v => v != null && v !== '').length };
};

class RockVoter {
  constructor(size = 6) { this.size = size; this.rock = []; this.laser = []; }
  reset() { this.rock = []; this.laser = []; }
  add(res) {
    if (res.results) {
      const r = res.results;
      const last = this.rock[this.rock.length - 1];
      if (last && ((last.ore && r.ore && last.ore !== r.ore) || (last.mass && r.mass && Math.abs(last.mass - r.mass) / Math.max(last.mass, r.mass) > 0.15 && this.rock.length >= 2 && !this.rock.some(x => x.mass && Math.abs(x.mass - r.mass) / Math.max(x.mass, r.mass) <= 0.15)))) this.rock = [];
      this.rock.push(r); if (this.rock.length > this.size) this.rock.shift();
    }
    if (res.laser) { this.laser.push(res.laser); if (this.laser.length > this.size) this.laser.shift(); }
  }
  rockView() {
    const rs = this.rock; if (!rs.length) return null;
    const f = (k) => mode(rs.map(r => r[k]));
    const v = { ore: f('ore'), mass: f('mass'), resistance: f('resistance'), instability: f('instability'), difficulty: f('difficulty'), totalScu: f('totalScu') };
    const rows = Math.max(...rs.map(r => r.comp.length));
    const comp = [];
    for (let i = 0; i < rows; i++) {
      const at = rs.map(r => r.comp[i]).filter(Boolean);
      comp.push({ pct: mode(at.map(c => c.pct)), name: mode(at.map(c => c.name)), quality: mode(at.map(c => c.quality)) });
    }
    const reads = rs.length;
    return { reads, ore: v.ore.value, mass: v.mass.value, resistance: v.resistance.value, instability: v.instability.value, difficulty: v.difficulty.value, totalScu: v.totalScu.value,
      comp: comp.map(c => ({ pct: c.pct.value, name: c.name.value, quality: c.quality.value, sure: Math.min(c.pct.count, c.name.count) >= Math.min(3, reads) })),
      agree: Math.min(v.mass.count, v.resistance.count, v.instability.count) };
  }
  laserView() {
    const ls = this.laser; if (!ls.length) return null;
    const mods = {}; let agree = 99;
    for (const k of LASER_ROWS) { const m = mode(ls.map(l => l.mods[k])); mods[k] = m.value; agree = Math.min(agree, m.count); }
    return { reads: ls.length, name: mode(ls.map(l => l.name)).value, mods, agree };
  }
}

module.exports = { resultsCells, laserCells, readLaser, readResults, readWords, readText, prepLocal, PREP, readFrame, RockVoter, findResultsAnchor, findLaserAnchor, LASER_ROWS, oreName, difficultyOf, numberFrom };
