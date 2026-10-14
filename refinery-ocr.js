'use strict';
// Reads the in-game refinery "Setup" screen out of a screenshot.
//
// Two passes, because one whole-screen OCR pass was not enough on real captures:
//   1. OCR the whole frame — that reliably finds the *landmarks* ("MATERIALS SELECTED",
//      "REFINEMENT CENTER") and usually the duration, but the station title, the
//      method dropdown and the 2nd/3rd material rows are small, low-contrast text
//      that comes back empty or garbled at full-frame scale.
//   2. Use the landmark positions to cut out just the materials table, the method
//      dropdown and the station title, enlarge them to a comfortable text size and
//      OCR each on its own. Cut out and enlarged, the same text reads cleanly.
//
// The text-parsing helpers below (everything above "Region pass") are the original
// whole-frame parser; it is kept as the fallback when a landmark can't be found.

// ─── Whole-frame text parsing ────────────────────────────────────────────────

// Parsing rules, tuned against real refinery-terminal screenshots (setup screen,
// after a processing method is chosen — that's the state that actually shows a
// duration and cost; the pre-selection state shows "--" for both).
//
// Two lessons from those screenshots drive the approach here:
// 1. The station's left-hand "Material Specializations" sidebar lists ~6 ore
//    names totally unrelated to the active job (it's the station's general yield
//    bonus table). A blind whole-screen search for known ore names picks those up
//    as false positives. So material extraction is anchored on the "MATERIALS
//    SELECTED" label, which only appears in the job panel, never the sidebar.
// 2. Refinery jobs aren't limited to mined ore — one real job had "Construction
//    Pieces" (ship salvage) as the material. A closed ore whitelist misses that
//    entirely, so matching now covers a broader material list, and duration uses
//    the in-game "32m 0s" letter-suffixed format, not HH:MM:SS.
const REFINERY_METHODS = [
  'Cormack Method', 'Dinyx Solventation', 'Electrostarolysis', 'Ferron Exchange',
  'Gaskin Process', 'Kazen Winnowing', 'Pyrometric Chromalysis',
  'Thermonatic Deposition', 'XCR Reaction',
];
const KNOWN_MATERIALS = [
  'Agricium', 'Aluminum', 'Beryl', 'Bexalite', 'Borase', 'Carbon', 'Chlorine',
  'Copper', 'Corundum', 'Diamond', 'Fluorine', 'Gold', 'Hadanite', 'Hephaestanite',
  'Hydrogen', 'Ice', 'Inertite', 'Iron', 'Laranite', 'Quantainium', 'Quartz',
  'Silicon', 'Stileron', 'Taranite', 'Tin', 'Titanium', 'Tungsten',
  'Construction Pieces', 'Construction Rubble', 'Construction Salvage',
  'Construction Materials', 'Scrap', 'Waste',
  'Recycled Material Composite', 'Inert Materials',
];

// Method names are safe to substring-match across the whole screen — unlike ore
// names, they don't also appear in the sidebar.
function extractMethod(lowerText) {
  for (const m of REFINERY_METHODS) {
    if (lowerText.includes(m.toLowerCase())) return m;
  }
  return null;
}

// Column headers/labels are two or three words wide (e.g. "MATERIALS SELECTED"),
// and a column narrower than the label can make Tesseract wrap it onto its own
// line — the literal character between the words then becomes a newline instead
// of a space, which an exact-substring search (`indexOf('materials selected')`)
// would silently fail to find. Every multi-word anchor below matches on flexible
// whitespace (`\s+`, which matches newlines too) instead, for that reason.
function findLabel(lowerText, pattern, fromIndex = 0) {
  const m = lowerText.slice(fromIndex).match(pattern);
  if (!m) return null;
  const start = fromIndex + m.index;
  return { start, end: start + m[0].length };
}

// In-game format is "32m 0s" / "1h 5m 30s" (letters, not colons). This used to
// anchor on the "PROCESSING TIME" label, but real captures show that label is
// almost never OCR'd intact ("iis TIME", "EROGESSING JHE") even when the actual
// duration digits right next to it come through fine — so this searches the
// whole text for an h+m(+s) or m+s cluster instead of requiring the label.
// Requiring two adjacent units (not just a lone "12m") is what keeps this from
// matching an unrelated stray number elsewhere on screen.
function extractDuration(text) {
  let m = text.match(/(\d{1,3})\s*h[^a-zA-Z0-9]{0,6}(\d{1,2})\s*m(?:[^a-zA-Z0-9]{0,6}(\d{1,2})\s*s)?\b/i);
  if (m) return { h: parseInt(m[1], 10), m: parseInt(m[2], 10), s: m[3] ? parseInt(m[3], 10) : 0 };
  m = text.match(/(\d{1,3})\s*m[^a-zA-Z0-9]{0,6}(\d{1,2})\s*s\b/i);
  if (m) return { h: 0, m: parseInt(m[1], 10), s: parseInt(m[2], 10) };
  return null;
}

// The "MATERIALS SELECTED / QUALITY / QTY / YIELD / REFINE" column headers sit on
// the same visual row as (and sometimes the same OCR line as) "MATERIALS SELECTED"
// itself, so anchoring there and taking "whatever comes next" risks grabbing the
// header remainder instead of the actual material row. "REFINE" is the last header
// column — anchor past *that* instead, so the search always starts at the data row.
function materialRowStart(lowerText, fromIdx) {
  const refine = findLabel(lowerText, /refine/, fromIdx);
  return refine ? refine.end : fromIdx;
}

// A real material row's line isn't just the name — OCR glues on neighboring UI
// noise ("bie ae CONSTRUCTIONPI", "oil ADDED. TT  TRUCTION PIECES"), and the name
// itself can be clipped at either end (missing "CONS" prefix, or missing "ECES"
// suffix). Whole-line containment breaks on the first, and exact-name containment
// breaks on the second — so this checks whether any long contiguous chunk of the
// known name (spaces stripped from both sides) shows up anywhere in the line.
function fuzzyChunkIncludes(lineCompact, nameCompact) {
  if (lineCompact.includes(nameCompact)) return true;
  const minLen = Math.max(6, Math.floor(nameCompact.length * 0.6));
  for (let len = nameCompact.length; len >= minLen; len--) {
    for (let start = 0; start + len <= nameCompact.length; start++) {
      if (lineCompact.includes(nameCompact.slice(start, start + len))) return true;
    }
  }
  return false;
}

// Anchored on "MATERIALS SELECTED" (unique to the job panel) rather than a blind
// scan, to avoid the sidebar false-positive problem. Handles a materials list
// longer than one screen the same way a single row is handled: each line in the
// block is tried independently, so a frame that only shows rows 3-5 (because the
// user scrolled the in-game list before this shot) still contributes those rows.
function extractMaterialRows(text, lowerText) {
  const label = findLabel(lowerText, /materials\s+selected/);
  if (!label) return [];
  const from = materialRowStart(lowerText, label.start);
  const totalCost = findLabel(lowerText, /total\s+cost/, from);
  const to = totalCost ? totalCost.start : from + 500; // generous cap for a long scrolled list
  const lines = text.slice(from, to).split('\n').map(s => s.trim()).filter(Boolean);

  const rows = [];
  for (const line of lines) {
    const nums = line.match(/\d+(?:\.\d+)?/g) || [];
    if (nums.length < 3) continue; // not a data row — [QUALITY, QTY, YIELD] per row
    const lineCompact = line.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (lineCompact.length < 3) continue;
    const match = KNOWN_MATERIALS.find(name => fuzzyChunkIncludes(lineCompact, name.toLowerCase().replace(/[^a-z]/g, '')));
    if (!match) continue;
    const tail = nums.slice(-3); // last 3 numbers on the line = quality, qty, yield
    rows.push({ name: match, quality: tail[0], yield: tail[2] });
  }
  return rows;
}

// The refinery fee shown on the setup screen: "TOTAL COST 415.00 aUEC". The label is
// often garbled ("TOTAL cosT", "TOTAL COST") and the unit comes out as "UEC" / "°C" /
// "“=", so this takes the first number after the label and ignores whatever follows.
function extractTotalCost(text) {
  const m = String(text || '').match(/total\s*cos[t7l]?[^0-9\n]{0,6}(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(v) && v >= 0 && v < 10000000 ? v : null;
}

// Real capture confirms the station name sits on the SAME OCR line as the anchor
// ("1 AMBITIOUS DREAM STATION REFINEMENT CENTER"), immediately before "STATION" —
// and that "CENTER" itself is frequently clipped ("REFINEMENT C"), so the anchor
// only requires "refinement". Pulling single/double-letter OCR noise tokens
// ("|", "V7", "1", "§") off that line via a letters-only word filter is what
// isolates the real name — grabbing the whole line (or two) as one blob, as this
// used to, pulls in unrelated UI fragments from earlier on the same line.
function extractNameWords(segment) {
  const words = segment.match(/[a-zA-Z]{3,}/g) || [];
  while (words.length && /^(station|refinement|center)$/i.test(words[words.length - 1])) {
    words.pop();
  }
  return words;
}

// Returned as raw cleaned text, not matched against a location list: the renderer
// owns the definitive station list (the Add Job modal's own dropdown), so it does
// the fuzzy-matching itself rather than main.js duplicating that list.
//
// No same-line-above fallback: an icon frequently overlaps the station name
// entirely (OCR reads it as a single "©" glyph), and when that happens the
// previous line is just unrelated UI text — a real capture proved this by
// returning "pad aie proses TEREST" from two lines up. Returning nothing here
// is safer than returning confident-looking garbage.
function extractLocation(text, lowerText) {
  const label = findLabel(lowerText, /refinement(\s+center)?/);
  if (!label) return null;
  const lineStart = text.lastIndexOf('\n', label.start - 1) + 1;
  const words = extractNameWords(text.slice(lineStart, label.start));
  const candidate = words.slice(-4).join(' ');
  return candidate.length >= 3 ? candidate : null;
}

function parseRefineryOcrText(text) {
  const lowerText = text.toLowerCase();
  return {
    method: extractMethod(lowerText),
    duration: extractDuration(text),
    materials: extractMaterialRows(text, lowerText),
    location: extractLocation(text, lowerText),
    cost: extractTotalCost(text),
    rawText: text,
  };
}

// ─── Region pass ─────────────────────────────────────────────────────────────

// Text height (px) the cropped regions are enlarged to before OCR. Tesseract is
// happiest around 25–35px; the in-game header text is ~10px on a 2000px-wide frame.
const TARGET_TEXT_PX = 30;
const MAX_SCALE = 4;

// A character OCR commonly returns in place of a digit, in the number columns.
// "B" is ambiguous (8 or 6); the other letters have one sensible reading.
const DIGIT_LOOKALIKES = { o: '0', O: '0', Q: '0', D: '0', l: '1', I: '1', i: '1', '|': '1', '!': '1',
  Z: '2', z: '2', S: '5', s: '5', G: '6', b: '6', g: '9' };

function flattenWords(data) {
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    for (const w of l.words || []) {
      out.push({ text: w.text || '', x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
    }
  }
  return out;
}

const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const lettersOf = (s) => s.replace(/[^a-zA-Z]/g, '').toLowerCase();

// Cheap "is this even the refinery screen" test on the first whole-frame read.
function looksLikeRefinery(text) {
  const t = text.toLowerCase();
  return ['refine', 'yield', 'materials', 'quality', 'processing', 'selected', 'setup', 'cost']
    .filter(k => t.includes(k)).length >= 2;
}

// Finds the "MATERIALS SELECTED" header row and returns its geometry. Everything
// else on the screen sits at a fixed distance from it, measured in `u` — one 34th of
// the header's width ("MATERIALS" … "REFINE"), which is ~one text-height. Width is
// measured far more precisely than height, and the layout holds at any resolution.
function findTableAnchor(words) {
  const mats = words.filter(w => /^mat[a-z]{3,6}$/.test(lettersOf(w.text)) && w.text.length >= 6);
  for (const m of mats.sort((a, b) => a.y0 - b.y0)) {
    const mh = Math.max(m.y1 - m.y0, 6);
    const sel = words.find(w => /^sel[a-z]{3,5}$/.test(lettersOf(w.text)) &&
      Math.abs(w.y0 - m.y0) <= mh * 0.8 && w.x0 >= m.x1 - 2 && w.x0 - m.x1 <= mh * 3);
    if (!sel) continue;
    const row = words.filter(w => Math.abs(w.y0 - m.y0) <= mh * 0.8 && w.x0 >= m.x0);
    const hh = Math.max(median(row.map(w => w.y1 - w.y0)), 6);
    const refine = row.filter(w => lettersOf(w.text) === 'refine' && w.x0 > sel.x1 && w.x0 - m.x0 <= hh * 45)
      .sort((a, b) => b.x1 - a.x1)[0];
    const near = row.filter(w => w.x0 - m.x0 <= hh * 40);
    const right = refine ? refine.x1 : Math.max(...near.map(w => w.x1), sel.x1);
    let u = refine ? (refine.x1 - m.x0) / 34 : hh;
    if (u < hh * 0.6 || u > hh * 1.7) u = hh;            // implausible — a stray word, fall back
    return { left: m.x0, top: m.y0, right: right > sel.x1 ? right : m.x0 + hh * 34, hh, u };
  }
  return null;
}

// "REFINEMENT CENTER" sits on the same row as the station title, to its right.
function findTitleAnchor(words) {
  const ref = words.find(w => lettersOf(w.text).startsWith('refinem') );
  if (!ref) return null;
  const c = words.find(w => /^c?ent[a-z]{0,3}$/.test(lettersOf(w.text)) && w.x0 >= ref.x1 - 5 &&
    Math.abs(w.y0 - ref.y0) <= 40 && w.x0 - ref.x1 <= 80);
  return { refLeft: ref.x0, c };
}

function clampRect(r, W, H) {
  const x0 = Math.max(0, Math.round(r.x0)), y0 = Math.max(0, Math.round(r.y0));
  const x1 = Math.min(W, Math.round(r.x1)), y1 = Math.min(H, Math.round(r.y1));
  return (x1 - x0 >= 8 && y1 - y0 >= 4) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

// Crop → enlarge → grayscale → stretch contrast → invert (dark text on light, which
// is what Tesseract is trained on). Returns a PNG buffer.
function grayRegion(image, rect, scale, binarize) {
  let img = image.crop(rect);
  if (scale > 1.01) img = img.resize({ width: Math.round(rect.width * scale), height: Math.round(rect.height * scale), quality: 'best' });
  const { width, height } = img.getSize();
  const px = img.toBitmap();                       // BGRA
  const n = width * height, luma = new Uint8Array(n), hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const l = (px[i * 4 + 2] * 299 + px[i * 4 + 1] * 587 + px[i * 4] * 114) / 1000 | 0;
    luma[i] = l; hist[l]++;
  }
  const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
  let lo = pct(0.01), hi = pct(0.99);
  if (hi - lo < 24) { lo = Math.max(0, hi - 24); }
  const v = new Uint8Array(n);                     // 0 = ink … 255 = paper (dark text on light)
  for (let i = 0; i < n; i++) {
    let q = 255 - Math.max(0, Math.min(255, Math.round((luma[i] - lo) * 255 / (hi - lo))));
    if (binarize) q = q > 150 ? 255 : 0;
    v[i] = q;
  }
  return { w: width, h: height, v };
}

function encodeGray(g) {
  const { nativeImage } = require('electron');
  const out = Buffer.alloc(g.w * g.h * 4);
  for (let i = 0; i < g.w * g.h; i++) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g.v[i]; out[i * 4 + 3] = 255; }
  return nativeImage.createFromBitmap(out, { width: g.w, height: g.h }).toPNG();
}

function prepRegion(image, rect, scale, binarize) {
  return encodeGray(grayRegion(image, rect, scale, binarize));
}

// The in-game tables draw a faint rule under every row and a scrollbar down the side. To
// Tesseract those are the biggest "characters" in the picture and they wreck the reading
// of everything next to them. A rule is a thin band that is a little darker than the paper
// and almost perfectly uniform across the width — text rows are far more varied, however
// dense — so rows are classified on that. The scrollbar is a near-black column running most
// of the height. Returns the rule positions and a copy with both wiped out.
const INK = 140;
function wipeRules(g) {
  const { w, h } = g;
  const v = Uint8Array.from(g.v);
  const rowMean = new Array(h), rowStd = new Array(h), colInk = new Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    let sum = 0, sq = 0;
    for (let x = 0; x < w; x++) {
      const p = g.v[y * w + x];
      sum += p; sq += p * p;
      if (p < INK) colInk[x]++;
    }
    rowMean[y] = sum / w;
    rowStd[y] = Math.sqrt(Math.max(0, sq / w - rowMean[y] * rowMean[y]));
  }
  const paper = [...rowMean].sort((a, b) => a - b)[Math.floor(h / 2)];
  const isRule = rowMean.map((m, y) => rowStd[y] < 28 && m < paper - 5);
  const rules = [];
  for (let y = 0; y < h;) {
    if (!isRule[y]) { y++; continue; }
    let y2 = y; while (y2 < h && isRule[y2]) y2++;
    if (y2 - y <= Math.max(6, h * 0.1)) rules.push([y, y2 - 1]);      // a broad dim area is not a rule
    y = y2;
  }
  for (const [y0, y1] of rules) {
    for (let y = Math.max(0, y0 - 1); y <= Math.min(h - 1, y1 + 1); y++) for (let x = 0; x < w; x++) v[y * w + x] = 255;
  }
  for (let x = 0; x < w; x++) {
    if (colInk[x] > 0.55 * h) for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) for (let y = 0; y < h; y++) v[y * w + xx] = 255;
  }
  return { g: { w, h, v }, rules };
}

// Crop to the ink (plus a margin) so a single-line read isn't thrown by empty space or bars.
function trimToInk(g, pad = 8) {
  const { w, h, v } = g;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (v[y * w + x] < INK) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) out[y * nw + x] = v[(y0 + y) * w + (x0 + x)];
  return { w: nw, h: nh, v: out };
}

// one cleaned, trimmed PNG for a single-line region (the time, the YIELD total)
function cleanLinePng(image, rect, scale, binarize) {
  const g = trimToInk(wipeRules(grayRegion(image, rect, scale, binarize)).g, 10);
  return g ? encodeGray(g) : null;
}

// The tallest line of ink in a band, trimmed. The time and the YIELD total are set in a much
// bigger size than the labels and bars around them, so within a generous band the biggest line
// is the one wanted — this works wherever in the band it landed.
function tallestLinePng(image, rect, scale, binarize, sharpen) {
  const full = grayRegion(image, rect, scale, binarize);
  const { g } = wipeRules(full);
  const { w, h, v } = g;
  const has = new Array(h).fill(false);
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (v[y * w + x] < INK) c++;
    has[y] = c >= 2;
  }
  const gapMax = Math.max(2, Math.round(h * 0.03));
  const runs = [];
  for (let y = 0; y < h;) {
    if (!has[y]) { y++; continue; }
    let y2 = y, last = y;
    while (y2 < h && (has[y2] || y2 - last <= gapMax)) { if (has[y2]) last = y2; y2++; }
    runs.push([y, last]);
    y = y2;
  }
  if (!runs.length) return null;
  const tallest = runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  const strip = { w, h: tallest[1] - tallest[0] + 1, v: v.slice(tallest[0] * w, (tallest[1] + 1) * w) };
  const t = trimToInk(strip, 10);
  return t ? encodeGray(sharpen ? sharpenGray(t) : t) : null;
}

// Unsharp mask on a gray image: out = v + amount·(v − blur(v)). At this size the digits 6, 8
// and 9 differ by a pixel or two of curve; sharpening is what separates them for the digits
// pass below (measured: it took five quality values from 3/5 to 5/5 correct).
function sharpenGray(g, radius = 3, amount = 1.8) {
  const { w, h, v } = g;
  const blur = (src) => {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), d = 2 * radius + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / d;
        sum += src[y * w + Math.min(w - 1, x + radius + 1)] - src[y * w + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / d;
        sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
      }
    }
    return out;
  };
  const b = blur(blur(Float32Array.from(v)));
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.max(0, Math.min(255, Math.round(v[i] + amount * (v[i] - b[i]))));
  return { w, h, v: out };
}

// Rescale a small image so its 1st–99th percentile spans the full range.
function stretchGray(g) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.v.length; i++) hist[g.v[i]]++;
  const n = g.v.length;
  const pct = (p) => { let acc = 0; for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc >= n * p) return k; } return 255; };
  const lo = pct(0.01), hi = pct(0.99);
  if (hi - lo < 24) return g;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round((g.v[i] - lo) * 255 / (hi - lo))));
  return { w: g.w, h: g.h, v: out };
}

// A margin of paper around a small image — Tesseract reads a number far better with room around it.
function padGray(g, n) {
  const w = g.w + 2 * n, h = g.h + 2 * n;
  const out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) out[(y + n) * w + x + n] = g.v[y * g.w + x];
  return { w, h, v: out };
}

// Reads a picture with only digits (and a few unit letters) allowed — a digit can't be
// mistaken for a letter if letters aren't in the answer set.
async function ocrWhitelist(worker, png, psm, whitelist) {
  await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist });
  try {
    const { data } = await worker.recognize(png);
    return (data.text || '').trim();
  } finally {
    await worker.setParameters({ tessedit_char_whitelist: '' });
  }
}

// A table cut into its rows at the rules. Each row comes back twice: `trimmed` (cleaned,
// trimmed to its ink — what a line read wants) and `band` (the same full-width strip, so the
// columns keep their positions — what cutting out single numbers wants).
function tableRowGrays(image, rect, scale) {
  const full = grayRegion(image, rect, scale);
  const { g, rules } = wipeRules(full);
  const bounds = [-1, ...rules.map(r => Math.round((r[0] + r[1]) / 2)), g.h];
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const y0 = bounds[i] + 1, y1 = bounds[i + 1] - 1;
    if (y1 - y0 < 10) continue;
    const band = { w: g.w, h: y1 - y0 + 1, v: g.v.slice(y0 * g.w, (y1 + 1) * g.w) };
    const t = trimToInk(band, 8);
    if (t && t.w >= 40 && t.h >= 12) out.push({ trimmed: t, band });
  }
  return out;
}

function tableRowPngs(image, rect, scale, sharpen) {
  return tableRowGrays(image, rect, scale).map(r => encodeGray(sharpen ? sharpenGray(r.trimmed) : r.trimmed));
}

// Where the number columns sit, in text-heights (u) right of the panel's left edge. They are
// fixed by the game's layout; measured on a real capture, to within a fraction of a digit.
const NUMBER_COLUMNS_U = [18.5, 22.9, 27.2, 31.6];     // quality, yield, to do, done

// The numbers of a row, each as its own image, cut at the known columns. Ink in a row is given
// to the nearest column (within ~2u), so a drifting perspective doesn't matter and a name's
// letters, which sit left of the first column, are left out. `need` = 4 for ores, 3 for
// materials with no quality (their yield/to do/done are the last three columns). Returns null
// unless every wanted column has a number in it.
function numberCells(band, need, leftEdgeU, u, scale) {
  const { w, h, v } = band;
  const cols = NUMBER_COLUMNS_U.slice(NUMBER_COLUMNS_U.length - need);
  const pxPerU = u * scale;
  const centers = cols.map(c => (leftEdgeU + c) * pxPerU);
  const half = 2.15 * pxPerU;
  const inkCol = new Array(w).fill(false);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (v[y * w + x] < INK) { inkCol[x] = true; break; }
  const cells = [];
  for (const c of centers) {
    let x0 = -1, x1 = -1;
    for (let x = Math.max(0, Math.round(c - half)); x <= Math.min(w - 1, Math.round(c + half)); x++) {
      if (inkCol[x]) { if (x0 < 0) x0 = x; x1 = x; }
    }
    if (x0 < 0) return null;
    const pad = 6, X0 = Math.max(0, x0 - pad), X1 = Math.min(w - 1, x1 + pad), nw = X1 - X0 + 1;
    const out = new Uint8Array(nw * h).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < nw; x++) out[y * nw + x] = v[y * w + X0 + x];
    const cell = trimToInk({ w: nw, h, v: out }, 6);
    if (!cell || cell.h < h * 0.12 || cell.h < 14) return null;        // a speck, not a digit (a row band is mostly paper)
    cells.push(cell);
  }
  return cells;
}

// Longest stretch of `name` that appears in `text` (both letters-only, lowercase).
function bestChunk(text, name) {
  for (let len = name.length; len >= 4; len--) {
    for (let s = 0; s + len <= name.length; s++) if (text.includes(name.slice(s, s + len))) return len;
  }
  return 0;
}

function methodFromRegion(text) {
  const t = lettersOf(text);
  let best = null, bestLen = 0;
  for (const m of REFINERY_METHODS) {
    const name = lettersOf(m);
    const len = bestChunk(t, name);
    // must cover most of the name — "processing" on its own must not read as "Gaskin Process"
    if (len > bestLen && len >= Math.max(8, Math.ceil(name.length * 0.75))) { best = m; bestLen = len; }
  }
  return best;
}

// "MIC-L5 MODERN ICARUS STATION" — keeps word-like tokens, drops "|"/"©"/"7" debris.
function locationFromRegion(text) {
  const line = text.split('\n').map(s => s.trim()).filter(s => lettersOf(s).length >= 4)[0] || '';
  const tokens = line.split(/\s+/).filter(tok => /^[A-Za-z]{3,}$/.test(tok) || /^[A-Za-z]{2,4}-?L\d$/i.test(tok) || /^[A-Za-z]+-[A-Za-z0-9]+$/.test(tok));
  const name = tokens.join(' ').trim();
  return name.length >= 3 ? name : null;
}

// A station title looks like "MIC-L5 MODERN ICARUS STATION" / "Pyro Gateway Station" /
// "Levski": a Lagrange code, or at least one real word. Debris like "ron TIT" fails.
function plausibleStation(name) {
  if (!name) return false;
  if (/(^|[^A-Za-z])[A-Za-z]{2,4}-?L[1-5]($|[^A-Za-z0-9])/i.test(name)) return true;
  const words = name.split(/\s+/).filter(w => /^[A-Za-z]{4,}$/.test(w));
  return words.length >= 1 && lettersOf(name).length >= 6;
}

// One number column cell → candidate integers. Letters that OCR substitutes for
// digits are mapped back; "B" yields two candidates (8, 6).
function numberCandidates(rawToken) {
  const token = rawToken.replace(/[^A-Za-z0-9|!]/g, '');   // ";", ":", "'", "." … are noise, not digits
  if (!/\d/.test(token)) return null;                     // "o", "@", "®" are toggle-icon debris
  let cands = [''];
  for (const ch of token) {
    if (/\d/.test(ch)) { cands = cands.map(c => c + ch); continue; }
    if (ch === 'B') { cands = cands.flatMap(c => [c + '8', c + '6']); continue; }
    if (DIGIT_LOOKALIKES[ch]) { cands = cands.map(c => c + DIGIT_LOOKALIKES[ch]); continue; }
    return null;
  }
  return { cands: cands.map(Number), clean: /^\d+$/.test(token) };
}

// Parses the OCR text of the cropped materials table. Rows are [name] [quality]
// [qty] [yield] followed by the refine-toggle icon (which OCR reads as "o", "3",
// "@" …) — so it takes the FIRST three numeric cells after the name, not the last.
function parseTableText(text) {
  const rows = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const lineCompact = lettersOf(line);
    if (lineCompact.length < 3) continue;
    const name = KNOWN_MATERIALS.find(n => fuzzyChunkIncludes(lineCompact, lettersOf(n)));
    if (!name) continue;
    // Numbers start after the name. The row's leading icon can read as a digit ("4 IRON
    // (ORE) 521 …"), so start from the first real word; and when the name ends in
    // "(ORE)" skip past that ")" — the FIRST one, because the refine-toggle icon at the
    // end of the row often reads as "E)" / "Ie)".
    const nameStart = Math.max(0, line.search(/[A-Za-z]{3}/));
    const close = line.indexOf(')', nameStart);
    const afterName = (close >= 0 && !/\d/.test(line.slice(nameStart, close)))
      ? line.slice(close + 1) : line.slice(nameStart);
    const cells = [];
    for (const tok of afterName.split(/\s+/)) {
      const c = numberCandidates(tok);
      if (c) cells.push(c);
      if (cells.length === 3) break;
    }
    if (cells.length < 3) continue;
    rows.push({ name, cells });
  }

  // Yield ÷ qty is the same for every box of one ore (same station, same method), so
  // the rows of an ore vouch for each other: the ratio most rows agree on settles
  // ambiguous digits (B = 8 or 6) and restores a digit the OCR dropped ("73" for
  // "736", because the refine-toggle icon sits right against the number).
  const TOL = 0.03;
  const refFor = {};
  for (const name of new Set(rows.map(r => r.name))) {
    const ratios = [];
    for (const r of rows.filter(x => x.name === name)) {
      const q = r.cells[1].cands[0];
      if (q > 0) for (const y of r.cells[2].cands) if (y > 0) ratios.push(y / q);
    }
    let best = null, bestCount = 1;                     // need at least 2 rows agreeing
    for (const cand of ratios) {
      const count = ratios.filter(x => Math.abs(x - cand) <= cand * TOL).length;
      if (count > bestCount) { best = cand; bestCount = count; }
    }
    if (best) refFor[name] = best;
  }
  const editDistanceOne = (a, b) => {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    const [s, l] = a.length < b.length ? [a, b] : [b, a];
    return s.slice(i) === l.slice(i + 1);
  };

  const out = [];
  for (const r of rows) {
    const qty = r.cells[1].cands[0];
    const quality = r.cells[0].cands.find(v => v <= 1000) ?? r.cells[0].cands[0];
    const ref = refFor[r.name];
    let yld = r.cells[2].cands[0];
    let repaired = false;
    if (ref && qty > 0) {
      const expected = Math.round(qty * ref);
      const near = (v) => Math.abs(v - expected) <= Math.max(1, expected * TOL);
      const ok = r.cells[2].cands.find(near);
      if (ok !== undefined) yld = ok;
      else if (r.cells[2].cands.some(v => editDistanceOne(String(v), String(expected)))) { yld = expected; repaired = true; }
    }
    if (r.name === 'Inert Materials' || yld === 0) continue;   // not refined — no yield to record
    out.push({ name: r.name, quality: String(quality), qty: String(qty), yield: String(yld),
      clean: !repaired && r.cells.every(c => c.clean) });
  }
  return out;
}

// Rows seen across several frames of one capture burst. A row is "the same row"
// when it has the same material and agrees on at least two of its three numbers —
// one number can be misread between frames, but two different boxes of the same ore
// almost never share two. A duplicate is visible in the review form; a dropped row
// would not be, so when in doubt the rows are kept apart.
function mergeRows(acc, rows) {
  const same = (a, b) => a.name === b.name &&
    ((a.quality === b.quality) + (a.qty === b.qty) + (a.yield === b.yield)) >= 2;
  const claimed = new Set();
  for (const r of rows) {
    const hit = acc.find(a => !claimed.has(a) && same(a, r));
    if (hit) { claimed.add(hit); if (!hit.clean && r.clean) Object.assign(hit, r); }
    else { acc.push(r); claimed.add(r); }
  }
  return acc;
}

// Majority vote, cell by cell, over several readings of the same table. Readings are
// only compared when they found the same number of rows (the most common count wins;
// a tie goes to the larger one — a missing row is the worse mistake).
function voteRows(readings) {
  const reads = readings.filter(r => r.length);
  if (!reads.length) return [];
  if (reads.length === 1) return reads[0];
  const counts = {};
  for (const r of reads) counts[r.length] = (counts[r.length] || 0) + 1;
  const n = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b - a)[0]);
  const same = reads.filter(r => r.length === n);
  const pick = (vals) => {
    const tally = {};
    for (const v of vals) tally[v] = (tally[v] || 0) + 1;
    return Object.keys(tally).sort((a, b) => tally[b] - tally[a] || vals.indexOf(a) - vals.indexOf(b))[0];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const cells = same.map(r => r[i]);
    const row = { name: cells[0].name };
    let unanimous = true;
    for (const k of ['quality', 'qty', 'yield']) {
      const vals = cells.map(c => c[k]);
      row[k] = pick(vals);
      if (vals.some(v => v !== row[k])) unanimous = false;
    }
    row.clean = unanimous && cells.every(c => c.clean);
    out.push(row);
  }
  return out;
}

async function ocrRegion(worker, png, psm) {
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(png);
  return (data.text || '').trim();
}

// image: an Electron nativeImage of the full frame; worker: a ready Tesseract worker.
// ─── Running jobs ("PROCESSING" work orders) ──────────────────────────────────
// A different screen from the setup panel: one panel per running work order, side by side.
// Each has a "MATERIALS YIELDED" table — name, quality, yield, to do, done — a YIELD total
// (what is done so far) and TIME REMAINING. It is read the same way as the setup screen:
// find the headers, crop each panel, enlarge, read.
//
// Every row carries its own checksum: yield = to do + done. That repairs most misread
// digits — whichever of the three numbers disagrees is rebuilt from the other two.
// Materials with no quality (Construction Materials) show three numbers instead of four.

// Refined outputs that don't appear in KNOWN_MATERIALS (that list is for ore inputs).
const OUTPUT_NAMES = KNOWN_MATERIALS.concat([
  'Aslarite', 'Aphorite', 'Dolivine', 'Janalite', 'Ouratite', 'Riccite', 'Savrilium', 'Torite',
  'Lindinium', 'Sadaryx', 'Feynmaline', 'Jaclium', 'Glacosite', 'Saldynium', 'Beradom',
  'Hephaestanite', 'Quantanium', 'Construction Materials',
]);

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// "RON" → "Iron", "CONSTRUCTION MATERIALS" → "Construction Materials"
function closestMaterialName(raw) {
  const key = lettersOf(raw);
  if (!key) return '';
  let best = null, bestD = Infinity;
  for (const n of OUTPUT_NAMES) {
    const d = levenshtein(key, lettersOf(n));
    if (d < bestD) { best = n; bestD = d; }
  }
  const allow = Math.max(1, Math.floor(key.length * 0.25));
  if (best && bestD <= allow) return best;
  return raw.toLowerCase().replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase()).trim();
}

// Header pairs "MATERIALS" + "YIELDED" — one per running work order, left to right.
// The word MATERIALS also appears inside "CONSTRUCTION MATERIALS" rows, so a header must
// start its row (nothing to its left), have "YIELDED" right after it on the SAME row, and
// have the QUALITY column heading further along that row.
function findProcessingPanels(words) {
  const panels = [];
  for (const m of words) {
    const mk = lettersOf(m.text);
    if (!/^mat[a-z]{3,6}$/.test(mk) || m.text.length < 6) continue;
    const mw = Math.max(m.x1 - m.x0, 20);
    const sameRow = (w) => Math.abs(w.y0 - m.y0) <= mw * 0.35;
    if (words.some(w => w !== m && sameRow(w) && w.x1 <= m.x0 + 2 && m.x0 - w.x1 < mw * 0.3)) continue;   // a word right against it: a row ("CONSTRUCTION MATERIALS"), not a header
    const y = words.find(w => sameRow(w) && w.x0 >= m.x1 - 2 && w.x0 - m.x1 <= mw && /^yiel(d|de|ded|deo)$/.test(lettersOf(w.text)) && lettersOf(w.text).length >= 5);
    if (!y) continue;
    const q = words.find(w => sameRow(w) && w.x0 > y.x1 && w.x0 - m.x0 < mw * 8 && /^qual[a-z]{2,4}$/.test(lettersOf(w.text)));
    if (!q && lettersOf(y.text).length < 6) continue;                     // neither "YIELDED" nor a QUALITY heading
    panels.push({ left: m.x0, top: m.y0, u: Math.min(48, Math.max(6, mw / 6)) });
  }
  panels.sort((a, b) => a.left - b.left);
  return panels.filter((p, i) => i === 0 || p.left - panels[i - 1].left > p.u * 8);   // the same header twice
}

// Per-panel geometry. Panels sit side by side; each ends where the next begins. Below the
// header the layout is fixed — the YIELD total is ~33 text-heights down and TIME REMAINING
// ~41 — so those positions come from the header, and a word found by the whole-frame read is
// used only when it agrees (those boxes are loose, and a stray match 20 px off ruins a crop).
function processingGeometry(panel, i, panels, words, W, H) {
  const u = panel.u;
  const x0 = panel.left - 1.2 * u;
  const next = panels[i + 1];
  const x1 = next ? next.left - 1.6 * u : panel.left + 36 * u;
  const col = words.filter(w => w.x0 >= x0 && w.x0 < x1);
  const expFoot = panel.top + 33.4 * u, expTime = panel.top + 41 * u;
  const closest = (list, target) => list
    .filter(w => Math.abs((w.y0 + w.y1) / 2 - target) < 6 * u)
    .sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - target) - Math.abs((b.y0 + b.y1) / 2 - target))[0];
  const foot = closest(col.filter(w => lettersOf(w.text).startsWith('yiel')), expFoot);
  const footTop = foot ? foot.y0 : expFoot - 1.5 * u;
  const rem = closest(col.filter(w => lettersOf(w.text).startsWith('remain')), expTime);
  const remY = rem ? (rem.y0 + rem.y1) / 2 : expTime;
  return {
    table: clampRect({ x0, y0: panel.top + 2.0 * u, x1, y1: footTop - 0.2 * u }, W, H),
    footer: clampRect({ x0: panel.left + 6 * u, y0: footTop - 1.2 * u, x1, y1: footTop + 4.6 * u }, W, H),
    time: clampRect({ x0: rem ? rem.x1 + 0.5 * u : panel.left + 12 * u, y0: remY - 4.2 * u, x1, y1: remY + 5.2 * u }, W, H),
  };
}

// One checksum-consistent reading of a row's numbers, or null.
const QUALITYLESS = /construction|recycled|scrap|waste|inert/i;
// How much the table is enlarged (relative to the normal reading scale) for the per-number
// pass. Two scales: a number that one scale loses, the other usually keeps.
const DIGIT_SCALES = [1.35, 2.0];       // ≈ 4x and 6x
function interpretProcessingCells(cells, expectQuality) {
  const tol = (y) => Math.max(1, Math.round(y * 0.003));
  const combos = (arr) => arr.reduce((acc, c) => acc.flatMap(a => c.cands.map(v => [...a, v])), [[]]);
  // Construction Materials & co. have no quality (three numbers); every ore does (four).
  // A four-number reading is therefore the only sensible one for an ore, so the
  // quality-less readings are tried for it only when there are no four numbers to use.
  const asks = [];
  const withQ = cells.length >= 4 ? [{ q: true, cells: cells.slice(0, 4) }] : [];
  const noQ = [];
  if (cells.length >= 3) noQ.push({ q: false, cells: cells.slice(0, 3) });       // yield todo done
  if (cells.length >= 4) noQ.push({ q: false, cells: cells.slice(1, 4) });       // a stray number before the row
  if (expectQuality && withQ.length) asks.push(...withQ);
  else asks.push(...withQ, ...noQ);
  if (expectQuality && !withQ.length) asks.push(...noQ);
  let best = null;
  for (const ask of asks) {
    for (const nums of combos(ask.cells)) {
      const [yy, td, dn] = ask.q ? nums.slice(1) : nums;
      const quality = ask.q ? nums[0] : null;
      if (!(yy > 0) || td < 0 || dn < 0) continue;
      if (quality != null && quality > 1000) continue;
      const resid = Math.abs(td + dn - yy);
      let cand = { quality, yield: yy, todo: td, done: dn, clean: resid <= tol(yy) && ask.cells.every(c => c.clean) };
      if (resid > tol(yy)) {
        // one number disagrees: rebuild whichever of the three is a one-digit slip of what is implied
        const one = (a, b) => {
          const x = String(a), y = String(b);
          if (x === y) return true;
          if (Math.abs(x.length - y.length) > 1) return false;
          let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
          if (x.length === y.length) return x.slice(i + 1) === y.slice(i + 1);
          const [sh, lo] = x.length < y.length ? [x, y] : [y, x];
          return sh.slice(i) === lo.slice(i + 1);
        };
        const tries = [
          { k: 'done', v: yy - td, ok: yy - td >= 0 && one(dn, yy - td) },
          { k: 'todo', v: yy - dn, ok: yy - dn >= 0 && one(td, yy - dn) },
          { k: 'yield', v: td + dn, ok: one(yy, td + dn) },
        ].filter(t => t.ok);
        if (tries.length === 1) cand = { ...cand, [tries[0].k]: tries[0].v, clean: false };
        else cand.clean = false;          // none, or several equally good fixes: keep what was read and flag it
      }
      const after = Math.abs(cand.todo + cand.done - cand.yield);
      cand.score = (after <= tol(cand.yield) ? 100 : 0) + (cand.clean ? 10 : 0) + (ask.q ? 1 : 0);
      if (!best || cand.score > best.score) best = cand;
    }
  }
  // An ore row with three numbers has lost one (a digit-less misread such as "SB" or "$8"
  // vanishes). Quality is the first; of yield / to do / done, any one is the sum or the
  // difference of the other two — so rebuild whichever is missing, trying each place.
  if (expectQuality && cells.length === 3) {
    for (const [qc, a, b] of [[cells[0], cells[1], cells[2]]]) {
      for (const q of qc.cands) for (const x of a.cands) for (const y of b.cands) {
        if (q > 1000) continue;
        const options = [
          { yield: x, todo: x - y, done: y },        // to do is the one that went missing
          { yield: x, todo: y, done: x - y },        // done is
          { yield: x + y, todo: x, done: y },        // yield is
        ].filter(o => o.todo >= 0 && o.done >= 0 && o.yield > 0 && o.yield >= o.todo && o.yield >= o.done);
        if (options.length) {
          // prefer the reading where the two numbers actually read are the larger ones
          const o = options[0];
          const cand = { quality: q, yield: o.yield, todo: o.todo, done: o.done, clean: false, score: 50 };
          if (!best || cand.score > best.score) best = cand;
        }
      }
    }
  }
  // a row that doesn't add up is still a row — it is returned flagged (clean:false) so a
  // consistent reading from another pass can outvote it
  return best || null;
}

// Rows of one panel's table. Lines that aren't "name + 3 or 4 numbers" are ignored, which
// is how the header, the scrollbar and the YIELD total are skipped.
function parseProcessingRows(text) {
  const rows = [];
  for (const raw of String(text || '').split('\n')) {
    const toks = raw.trim().split(/\s+/).filter(Boolean);
    if (toks.length < 4) continue;
    const nameToks = [], cells = [];
    for (const tok of toks) {
      const num = numberCandidates(tok);
      if (num && /\d/.test(tok) && (nameToks.length || tok.length > 1)) { if (nameToks.length) cells.push(num); continue; }
      if (cells.length) continue;                       // stuff after the numbers (a scrollbar, a toggle)
      if (/^[A-Za-z][A-Za-z'.-]*$/.test(tok) && tok.length >= 2) nameToks.push(tok);
    }
    if (!nameToks.length || cells.length < 3) continue;
    const name = closestMaterialName(nameToks.join(' '));
    if (lettersOf(name).length < 3) continue;
    const r = interpretProcessingCells(cells.slice(0, 4), !QUALITYLESS.test(name));
    if (r) rows.push({ name, quality: r.quality, yield: r.yield, todo: r.todo, done: r.done, clean: r.clean });
  }
  return rows;
}

// "18h 35m" / "2d 3h" / "45m 10s" → seconds, or null. The only letters in this text are the
// units d/h/m/s, so anything else that sits among digits is a digit misread ("2lh4lm").
function parseRemaining(text) {
  const t = String(text || '').replace(/[lI|!]/g, '1').replace(/[Oo]/g, '0');
  let total = 0, found = 0;
  for (const m of t.matchAll(/(\d{1,4})\s*([dhms])/gi)) {
    const v = parseInt(m[1], 10), u = m[2].toLowerCase();
    total += v * { d: 86400, h: 3600, m: 60, s: 1 }[u];
    found++;
  }
  return found ? total : null;
}

// the YIELD total at the foot of a panel: "22548.20 cSCU"
function parseFooterYield(text) {
  const t = String(text || '').replace(/[lI|!]/g, '1').replace(/[OQoD]/g, '0');
  const m = t.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
  return Number.isFinite(v) ? v : null;
}

// Row-by-row majority over several reads of the same table. `reads` is one list of
// per-strip results for each scale; strips line up by index when every read found the same
// number of them, otherwise the first read with rows is used on its own.
function voteProcessingRows(reads) {
  const usable = reads.filter(r => r.length);
  if (!usable.length) return [];
  const counts = {};
  usable.forEach(r => { counts[r.length] = (counts[r.length] || 0) + 1; });
  const n = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b - a)[0]);
  const same = usable.filter(r => r.length === n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const cands = same.map(r => r[i].rows[0]).filter(Boolean);          // one row per strip
    if (!cands.length) continue;
    // numbers: a checksum-clean reading from the digits pass wins; else the plurality of the
    // checksum-clean readings; else of all readings
    const fromDigits = cands.filter(c => c.fromDigits && c.clean);
    const clean = cands.filter(c => c.clean);
    const pool = fromDigits.length ? fromDigits : (clean.length ? clean : cands);
    const key = (c) => [c.yield, c.todo, c.done].join('/');
    const tally = {};
    pool.forEach(c => { tally[key(c)] = (tally[key(c)] || 0) + 1; });
    const topKey = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
    const chosen = pool.find(c => key(c) === topKey);
    // name and quality: plurality over every reading of the row
    const plural = (vals) => {
      const t = {};
      vals.forEach(v => { t[v] = (t[v] || 0) + 1; });
      const k = Object.keys(t).sort((a, b) => t[b] - t[a] || vals.indexOf(Number(a)) - vals.indexOf(Number(b)))[0];
      return { value: k, unanimous: Object.keys(t).length === 1 };
    };
    const nm = plural(cands.map(c => c.name));
    const hasQ = chosen.quality != null;
    // quality has no checksum, so it is judged on agreement alone: every digits-pass reading
    // counts here (clean or not), and any disagreement flags the row for the user to check
    const anyDigits = cands.filter(c => c.fromDigits);
    const qPool = anyDigits.length ? anyDigits : cands;
    const q = hasQ ? plural(qPool.filter(c => c.quality != null).map(c => c.quality)) : null;
    out.push({ name: nm.value, quality: hasQ ? Number(q.value) : null, yield: chosen.yield, todo: chosen.todo, done: chosen.done,
      clean: !!chosen.clean && (!q || q.unanimous), seenIn: cands.length });
  }
  return out;
}

async function readProcessingPanels(image, worker, panels, words, W, H) {
  const regionTexts = {};
  const workOrders = [];
  const read = async (rect, psm, sc, bin) => {
    if (!rect) return '';
    try { return await ocrRegion(worker, prepRegion(image, rect, sc, bin), psm); } catch { return ''; }
  };
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const g = processingGeometry(p, i, panels, words, W, H);
    const scale = Math.min(MAX_SCALE, Math.max(1, TARGET_TEXT_PX / p.u));

    // Table: cut into rows at the grid lines and read each row on its own, at three
    // scales. A row that comes out checksum-consistent (yield = to do + done) is trusted
    // for its numbers; the quality column has no checksum, so it is settled by majority.
    const reads = [];
    // (these crops are small, so they take more enlargement than the setup screen's — up to ~6.5x)
    for (const sc of [scale, scale * 1.35, scale * 1.7, scale * 2.2]) {
      if (!g.table) break;
      const strips = tableRowPngs(image, g.table, sc);
      const parsed = [];
      for (const png of strips) {
        let txt = '';
        try { txt = await ocrRegion(worker, png, '7'); } catch { /* an unreadable strip is just skipped */ }
        parsed.push({ text: txt, rows: parseProcessingRows(txt) });
      }
      reads.push(parsed);
    }
    // Digits pass: each row is split into its separate numbers; every number is sharpened and
    // read on its own with only digits allowed. That is what tells 9 from 8 and 6 from 8.
    // Rows whose numbers don't split cleanly (a long name running into the first number) keep
    // their text reading. These readings outrank the text ones when they add up.
    const letterRows = voteProcessingRows(reads);
    const digitTexts = [];
    const digitReads = [];
    if (g.table && letterRows.length) {
      for (const mult of DIGIT_SCALES) {
        const grays = tableRowGrays(image, g.table, scale * mult);
        if (grays.length !== letterRows.length) continue;           // strips don't line up — skip rather than misalign
        const parsed = [];
        for (let k = 0; k < grays.length; k++) {
          const need = QUALITYLESS.test(letterRows[k].name) ? 3 : 4;
          // a long name (Construction Materials) crowds the first number, and those rows read well as text
          const cellImgs = need === 4 ? numberCells(grays[k].band, need, 1.2, p.u, scale * mult) : null;
          let row = null, txt = '';
          if (cellImgs) {
            const nums = [];
            for (const c of cellImgs) {
              const png = encodeGray(padGray(sharpenGray(stretchGray(c)), 24));
              let t = '';
              // a one-number picture is fussy: if single-line mode gives nothing, try single-word and raw-line
              for (const psm of ['7', '8', '13']) {
                try { t = (await ocrWhitelist(worker, png, psm, '0123456789')).replace(/\D/g, ''); } catch { t = ''; }
                if (t) break;
              }
              nums.push(t);
            }
            txt = nums.join(' ');
            if (nums.every(n => n.length)) {
              const r = interpretProcessingCells(nums.map(n => ({ cands: [Number(n)], clean: true })), need === 4);
              if (r) row = { name: letterRows[k].name, quality: r.quality, yield: r.yield, todo: r.todo, done: r.done, clean: r.clean, fromDigits: true };
            }
          }
          digitTexts.push(`${mult}x: ${txt}`);
          parsed.push({ text: txt, rows: row ? [row] : [] });
        }
        digitReads.push(parsed);
      }
    }
    const best = {
      rows: digitReads.length ? voteProcessingRows([...reads, ...digitReads]) : letterRows,
      text: reads.map(r => r.map(x => x.text).join('\\n')).join('\\n--\\n') + (digitTexts.length ? '\\n-- digits --\\n' + digitTexts.join('\\n') : ''),
    };
    const timeText = await firstNonEmpty([
      async () => { const png = g.time && tallestLinePng(image, g.time, scale * 1.4, false, true); return png ? ocrWhitelist(worker, png, '7', '0123456789hdms ') : ''; },
      async () => { const png = g.time && tallestLinePng(image, g.time, scale, false, true); return png ? ocrWhitelist(worker, png, '7', '0123456789hdms ') : ''; },
      async () => { const png = g.time && tallestLinePng(image, g.time, scale); return png ? ocrRegion(worker, png, '7') : ''; },
    ], (t) => parseRemaining(t) != null);
    const footText = await firstNonEmpty([
      async () => { const png = g.footer && tallestLinePng(image, g.footer, scale * 1.4, false, true); return png ? ocrWhitelist(worker, png, '7', '0123456789.,') : ''; },
      async () => { const png = g.footer && tallestLinePng(image, g.footer, scale); return png ? ocrRegion(worker, png, '7') : ''; },
    ], (t) => parseFooterYield(t) != null);
    regionTexts[`panel${i + 1}.rects`] = JSON.stringify({ u: Math.round(p.u * 10) / 10, left: p.left, top: p.top, table: g.table, time: g.time, footer: g.footer });
    regionTexts[`panel${i + 1}.table`] = best.text;
    regionTexts[`panel${i + 1}.time`] = timeText;
    regionTexts[`panel${i + 1}.footer`] = footText;

    const rows = best.rows;
    const totalYield = rows.reduce((n, r) => n + r.yield, 0);
    const doneSum = rows.reduce((n, r) => n + r.done, 0);
    let footerDone = parseFooterYield(footText);
    // a lost decimal point reads ten- or a hundred-fold too large; the rows' own total says which
    if (footerDone != null && doneSum > 0 && footerDone > doneSum * 2) {
      for (const f of [10, 100]) if (Math.abs(footerDone / f - doneSum) <= Math.max(5, doneSum * 0.03)) { footerDone = footerDone / f; break; }
    }
    // progress: what is done of what is expected. The rows give it directly; the YIELD total
    // at the foot is only a cross-check — if it is clearly larger than the rows' own total, some
    // rows were not visible (a scrolled list) and the figure can't be trusted.
    let progress = null;
    if (totalYield > 0) {
      const rowsIncomplete = footerDone != null && footerDone > doneSum * 1.02 + 5;
      if (!rowsIncomplete) progress = Math.min(1, doneSum / totalYield);
    }
    workOrders.push({ index: i + 1, rows, remainingSeconds: parseRemaining(timeText), doneTotal: footerDone, progress });
  }
  await worker.setParameters({ tessedit_pageseg_mode: '3' });
  return { workOrders, regionTexts };
}

// Work orders read from several frames of one burst (the user may scroll a long list between
// shots): panels line up by their left-to-right index, and their rows are unioned — a row is
// "the same" when it has the same material and agrees on quality and yield.
function mergeWorkOrders(acc, frame) {
  const out = acc || { location: null, workOrders: [] };
  if (!out.location && frame.location) out.location = frame.location;
  for (const wo of frame.workOrders || []) {
    const have = out.workOrders.find(x => x.index === wo.index);
    if (!have) { out.workOrders.push({ ...wo, rows: wo.rows.map(r => ({ ...r })) }); continue; }
    if (have.remainingSeconds == null) have.remainingSeconds = wo.remainingSeconds;
    if (have.doneTotal == null) have.doneTotal = wo.doneTotal;
    for (const r of wo.rows) {
      const hit = have.rows.find(x => x.name === r.name && x.quality === r.quality && Math.abs(x.yield - r.yield) <= Math.max(1, r.yield * 0.003));
      if (hit) { if (!hit.clean && r.clean) Object.assign(hit, r); }
      else have.rows.push({ ...r });
    }
    // progress again, from the merged rows
    const totalYield = have.rows.reduce((n, r) => n + r.yield, 0);
    const doneSum = have.rows.reduce((n, r) => n + r.done, 0);
    const incomplete = have.doneTotal != null && have.doneTotal > doneSum * 1.02 + 5;
    have.progress = totalYield > 0 && !incomplete ? Math.min(1, doneSum / totalYield) : null;
  }
  return out;
}

async function firstNonEmpty(fns, ok) {
  let last = '';
  for (const f of fns) {
    const t = await f();
    if (t) last = t;
    if (ok(t)) return t;
  }
  return last;
}

async function readFrame(image, worker) {
  const { width: W, height: H } = image.getSize();

  // The in-game header text is ~10px tall on a 2000px-wide frame. That is about the
  // smallest the landmark pass can reliably see, so a small frame starts from an
  // enlarged copy, and any frame whose header isn't found is retried enlarged.
  const factors = W < 1800 ? [2400 / W, 1] : [1, 1.7];
  let fullText = '', words = [], t = null, firstText = null, procPanels = [];
  for (const f of factors) {
    const img = f === 1 ? image : image.resize({ width: Math.round(W * f), height: Math.round(H * f), quality: 'best' });
    await worker.setParameters({ tessedit_pageseg_mode: '3' });
    const full = await worker.recognize(img.toPNG(), {}, { blocks: true, text: true });
    const text = full.data.text || '';
    if (firstText === null) firstText = text;
    const w = flattenWords(full.data).map(x => (f === 1 ? x : { text: x.text, x0: x.x0 / f, y0: x.y0 / f, x1: x.x1 / f, y1: x.y1 / f }));
    const anchor = findTableAnchor(w);
    const panels = anchor ? [] : findProcessingPanels(w);
    if (anchor || panels.length || !words.length) { fullText = text; words = w; t = anchor; procPanels = panels; }
    if (anchor || panels.length) break;
    // not a refinery screen at all (map, inventory, desktop…) — don't burn time
    // re-reading it enlarged
    if (!looksLikeRefinery(text)) break;
  }
  const base = parseRefineryOcrText(fullText || firstText || '');

  const regionTexts = {};
  let method = base.method, location = base.location, duration = base.duration, cost = base.cost;
  let materials = base.materials.map(r => ({ ...r, qty: '', clean: false }));
  let usedRegions = false;

  if (t) {
    const scale = Math.min(MAX_SCALE, Math.max(1, TARGET_TEXT_PX / t.u));
    const hh = t.u;
    const rects = {
      table: clampRect({ x0: t.left - hh, y0: t.top + 1.2 * hh, x1: t.right + 5 * hh, y1: t.top + 30 * hh }, W, H),
      method: clampRect({ x0: t.left - hh, y0: t.top - 9.8 * hh, x1: t.right + 3 * hh, y1: t.top - 5.0 * hh }, W, H),
    };
    const ta = findTitleAnchor(words);
    const titleX0 = Math.max(0, t.left - 29.5 * hh);
    const titleX1 = ta ? Math.min(ta.refLeft - 0.5 * hh, t.left + 38 * hh) : t.left + 38 * hh;
    rects.title = clampRect({ x0: titleX0, y0: t.top - 33.8 * hh, x1: titleX1, y1: t.top - 30.2 * hh }, W, H);
    if (!duration) {
      rects.duration = clampRect({ x0: t.left - hh, y0: t.top + 31 * hh, x1: t.right + 5 * hh, y1: t.top + 39 * hh }, W, H);
    }

    const read = async (rect, psm, sc, bin) => {
      if (!rect) return '';
      try { return await ocrRegion(worker, prepRegion(image, rect, sc, bin), psm); } catch (e) { return ''; }
    };
    // Single-line regions are fussy about page-segmentation mode and scale (a box
    // outline or an icon next to the text can make a mode return nothing), so try
    // a few readings and keep the first that actually yields something usable.
    const firstUsable = async (rect, attempts, usable) => {
      let last = '';
      for (const [psm, sc, bin, alt] of attempts) {
        const text = await read(alt || rect, psm, sc, bin);
        last = text || last;
        if (usable(text)) return text;
      }
      return last;
    };

    // Table: a single misread digit can't be told from a right one, so read it at two
    // scales and, when they disagree, a third time and take the majority per cell.
    let tableRows = [];
    {
      const sig = (rs) => JSON.stringify(rs.map(r => [r.name, r.quality, r.qty, r.yield]));
      const texts = [], reads = [];
      for (const sc of [scale, Math.min(MAX_SCALE, scale * 1.35), scale * 0.8]) {
        const text = await read(rects.table, '6', sc);
        texts.push(text); reads.push(parseTableText(text));
        if (reads.length === 2 && reads[0].length && sig(reads[0]) === sig(reads[1])) break;   // two reads agree
      }
      tableRows = voteRows(reads);
      regionTexts.table = texts.join('\n--\n');
    }
    // The dropdown is white text inside an outlined box; the outline and the chevron
    // are what confuse a single-line read, so also try just the text area, and a
    // hard black-and-white version of both.
    const inner = clampRect({ x0: t.left + 0.5 * hh, y0: t.top - 9.1 * hh, x1: t.left + 26 * hh, y1: t.top - 5.9 * hh }, W, H);
    regionTexts.method = await firstUsable(rects.method, [
      ['7', scale, false, inner], ['7', scale, true, inner], ['7', scale], ['6', scale], ['7', scale, true],
      ['7', scale * 0.75, false, inner], ['7', scale * 1.3, true, inner], ['11', scale], ['7', scale * 0.75],
    ], txt => !!methodFromRegion(txt));
    regionTexts.title = await firstUsable(rects.title,
      [['7', scale], ['6', scale], ['7', scale * 0.75]], txt => !!plausibleStation(locationFromRegion(txt)));
    if (!plausibleStation(locationFromRegion(regionTexts.title)) && ta && ta.c) {
      // fall back to where the "REFINEMENT CENTER" landmark says the title row is
      const ch = Math.max(ta.c.y1 - ta.c.y0, 6);
      const alt = clampRect({ x0: titleX0, y0: ta.c.y0 - 0.4 * ch, x1: ta.refLeft - 0.3 * ch, y1: ta.c.y1 + 1.0 * ch }, W, H);
      const txt = await firstUsable(alt, [['7', scale], ['6', scale]], x => !!plausibleStation(locationFromRegion(x)));
      if (plausibleStation(locationFromRegion(txt))) regionTexts.title = txt;
    }
    if (rects.duration) regionTexts.duration = await read(rects.duration, '6', scale);
    await worker.setParameters({ tessedit_pageseg_mode: '3' });

    if (tableRows.length) { materials = tableRows; usedRegions = true; }
    if (regionTexts.method) method = methodFromRegion(regionTexts.method) || method;
    const fromTitle = locationFromRegion(regionTexts.title || '');
    if (plausibleStation(fromTitle)) location = fromTitle;
    else if (!plausibleStation(location)) location = null;
    if (!duration && regionTexts.duration) duration = extractDuration(regionTexts.duration);
    // the fee sits under the table, so the enlarged table read is the clearest copy of it
    if (cost == null) cost = extractTotalCost(regionTexts.table);
  }

  if (!t && procPanels.length) {
    const proc = await readProcessingPanels(image, worker, procPanels, words, W, H);
    // The station name sits left of "REFINEMENT CENTER" on the same row — found by that
    // landmark when it was read, else by its fixed distance (~13.5 text-heights) above the
    // panel headers.
    const ta2 = findTitleAnchor(words);
    const u0 = procPanels[0].u;
    const ref = words.find(w => lettersOf(w.text).startsWith('refinem'));
    const sc = Math.min(MAX_SCALE, Math.max(1, TARGET_TEXT_PX / u0));
    const x0 = Math.max(0, procPanels[0].left - 30 * u0);
    const rects = [];
    if (ta2 && ref) rects.push(clampRect({ x0, y0: ref.y0 - 2.8 * u0, x1: ta2.refLeft - 0.5 * u0, y1: ref.y1 + 0.8 * u0 }, W, H));
    for (const [a1, b1] of [[17.5, 9.5], [15.5, 11.5]]) {
      rects.push(clampRect({ x0, y0: procPanels[0].top - a1 * u0, x1: procPanels[0].left + 6 * u0, y1: procPanels[0].top - b1 * u0 }, W, H));
    }
    let station = base.location;
    outer: for (const rect of rects.filter(Boolean)) {
      for (const [psm, s2] of [['7', sc], ['6', sc], ['7', sc * 0.75]]) {
        let txt = '';
        try { txt = await ocrRegion(worker, prepRegion(image, rect, s2), psm); } catch { /* try the next */ }
        proc.regionTexts.title = txt;
        const name = locationFromRegion(txt);
        if (plausibleStation(name)) { station = name; break outer; }
      }
    }
    await worker.setParameters({ tessedit_pageseg_mode: '3' });
    const dbg = [`[full frame ${W}x${H} — running jobs: ${procPanels.length} work order(s)]`, fullText.trim(),
      ...Object.entries(proc.regionTexts).map(([k, v]) => `[region: ${k}]\n${v}`)].join('\n\n');
    return { kind: 'processing', workOrders: proc.workOrders, location: plausibleStation(station) ? station : null,
      method: null, duration: null, cost: null, materials: [], usedRegions: true, anchor: null, rawText: dbg };
  }

  const debug = [`[full frame ${W}x${H}${t ? '' : ' — header not found, no region pass'}]`, fullText.trim(),
    ...Object.entries(regionTexts).map(([k, v]) => `[region: ${k}]\n${v}`)].join('\n\n');
  return { kind: 'setup', method, duration, location, cost, materials, usedRegions, anchor: t, rawText: debug };
}

module.exports = {
  REFINERY_METHODS, KNOWN_MATERIALS, parseRefineryOcrText, readFrame, mergeRows,
  // exposed for tests
  parseTableText, voteRows, extractTotalCost, methodFromRegion,
  findProcessingPanels, parseProcessingRows, parseRemaining, parseFooterYield, closestMaterialName, voteProcessingRows, mergeWorkOrders,
  grayRegion, wipeRules, trimToInk, cleanLinePng, tallestLinePng, tableRowPngs, encodeGray,
  tableRowGrays, numberCells, sharpenGray, stretchGray, padGray, locationFromRegion, plausibleStation, findTableAnchor, findTitleAnchor, numberCandidates,
};
