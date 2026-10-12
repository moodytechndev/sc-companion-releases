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
function prepRegion(image, rect, scale, binarize) {
  const { nativeImage } = require('electron');
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
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    let v = 255 - Math.max(0, Math.min(255, Math.round((luma[i] - lo) * 255 / (hi - lo))));
    if (binarize) v = v > 150 ? 255 : 0;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBitmap(out, { width, height }).toPNG();
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
async function readFrame(image, worker) {
  const { width: W, height: H } = image.getSize();

  // The in-game header text is ~10px tall on a 2000px-wide frame. That is about the
  // smallest the landmark pass can reliably see, so a small frame starts from an
  // enlarged copy, and any frame whose header isn't found is retried enlarged.
  const factors = W < 1800 ? [2400 / W, 1] : [1, 1.7];
  let fullText = '', words = [], t = null, firstText = null;
  for (const f of factors) {
    const img = f === 1 ? image : image.resize({ width: Math.round(W * f), height: Math.round(H * f), quality: 'best' });
    await worker.setParameters({ tessedit_pageseg_mode: '3' });
    const full = await worker.recognize(img.toPNG(), {}, { blocks: true, text: true });
    const text = full.data.text || '';
    if (firstText === null) firstText = text;
    const w = flattenWords(full.data).map(x => (f === 1 ? x : { text: x.text, x0: x.x0 / f, y0: x.y0 / f, x1: x.x1 / f, y1: x.y1 / f }));
    const anchor = findTableAnchor(w);
    if (anchor || !words.length) { fullText = text; words = w; t = anchor; }
    if (anchor) break;
    // not a refinery screen at all (map, inventory, desktop…) — don't burn time
    // re-reading it enlarged
    if (!looksLikeRefinery(text)) break;
  }
  const base = parseRefineryOcrText(fullText || firstText || '');

  const regionTexts = {};
  let method = base.method, location = base.location, duration = base.duration;
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
  }

  const debug = [`[full frame ${W}x${H}${t ? '' : ' — header not found, no region pass'}]`, fullText.trim(),
    ...Object.entries(regionTexts).map(([k, v]) => `[region: ${k}]\n${v}`)].join('\n\n');
  return { method, duration, location, materials, usedRegions, anchor: t, rawText: debug };
}

module.exports = {
  REFINERY_METHODS, KNOWN_MATERIALS, parseRefineryOcrText, readFrame, mergeRows,
  // exposed for tests
  parseTableText, voteRows, methodFromRegion, locationFromRegion, plausibleStation, findTableAnchor, findTitleAnchor, numberCandidates,
};
