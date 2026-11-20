'use strict';
// Builds rock-glyphs.json (the examples the live rock scan matches characters against) from labelled frames.
//
//   set FRAMES_DIR=<folder with the frames>  LABELS=scripts/rock-glyphs/labels.json
//   node_modules\electron\dist\electron.exe scripts/rock-glyphs
//
// labels.json: [{ "frame": "frame11.png", "results": { "mass": "1012", "res": "65%", "inst": "6.31", "scu": "1.13",
//   "pct": ["10.05%", ...], "qual": ["943", ...] }, "laser": ["100", "125", "65", "100", "100", "140", "100"],
//   "extra": [{ "rect": [x, y, w, h], "text": "0.89" }] }]
// "lockResults": {px, y0, p} fixes where the results panel is when the automatic search cannot be used; null entries in the lists are skipped.
// A frame must show the panels at the usual place (they are found the same way the app finds them). Every number in
// the labels is cut into characters; when the number of characters found equals the number written, each character is
// kept as an example. Numbers that do not cut cleanly are reported and skipped.

const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const rock = require(path.join(ROOT, 'rock-ocr.js'));
const glyphs = require(path.join(ROOT, 'rock-glyphs.js'));
const { createWorker } = require(path.join(ROOT, 'node_modules', 'tesseract.js'));

const FRAMES_DIR = process.env.FRAMES_DIR || __dirname;
const LABELS = process.env.LABELS || path.join(__dirname, 'labels.json');
const OUT = process.env.OUT || glyphs.BANK_FILE;
const KEEP_OLD = process.env.KEEP_OLD === '1';

app.whenReady().then(async () => {
  process.chdir(ROOT);
  const labels = JSON.parse(fs.readFileSync(LABELS, 'utf8'));
  const worker = await createWorker('eng');
  const samples = []; const skipped = []; let cells = 0;
  // opts.gap: the number is followed by a unit (" SCU"). The percent sign is written as PQ (its two pieces).
  const add = (image, rect, text, where, opts) => {
    if (!rect) { skipped.push(`${where}: no rectangle`); return; }
    cells++;
    const label = text.replace(/%/g, 'PQ');
    const map = glyphs.prepare(image, rect, 3, opts && opts.band);
    let gs = null;
    for (const thr of [0.5, 0.62, 0.75, 0.85, 0.92, 0.38]) { const g = glyphs.cut(map, thr, opts); if (g.length === label.length) { gs = g; break; } }
    if (!gs) { skipped.push(`${where}: "${text}" would not cut into ${label.length} pieces`); return; }
    gs.forEach((g, i) => {
      const ch = label[i]; if (ch === '.') return;           // a dot is told by its size
      const f = glyphs.features(g);
      samples.push({ ch, src: item_name, v: Array.from(f.v, x => Math.round(x * 100) / 100), aspect: Math.round(f.aspect * 100) / 100, hrel: Math.round(f.hrel * 100) / 100 });
    });
  };
  let item_name = '';
  for (const item of labels) {
    item_name = item.frame;
    const image = nativeImage.createFromPath(path.join(FRAMES_DIR, item.frame));
    const { width: W, height: H } = image.getSize();
    if (item.results || item.laser) {
      const res = await rock.readFrame(image, worker, {});
      if (item.lockResults) res.lock.results = item.lockResults;
      if (item.results) {
        const a = res.lock.results; if (!a) { skipped.push(`${item.frame}: results panel not found`); }
        else {
          const c = rock.resultsCells(a, W, H), r = item.results;
          if (r.mass) add(image, c.mass, r.mass, `${item.frame} mass`, { noDot: true });
          if (r.res) add(image, c.res, r.res, `${item.frame} res`, { noDot: true });
          if (r.inst) add(image, c.inst, r.inst, `${item.frame} inst`);
          if (r.scu) add(image, c.scu, r.scu, `${item.frame} scu`, { stopAtGap: true });
          (r.pct || []).forEach((t, i) => { if (t) add(image, c.pct(i), t, `${item.frame} pct${i}`); });
          (r.qual || []).forEach((t, i) => { if (t) add(image, c.qual(i), t, `${item.frame} qual${i}`, { noDot: true }); });
        }
      }
      if (item.laser) {
        const a = res.lock.laser; if (!a) { skipped.push(`${item.frame}: laser panel not found`); }
        else { const c = rock.laserCells(a, W, H); item.laser.forEach((t, r) => add(image, c.value(r), t, `${item.frame} laser${r}`, { noDot: true, band: false })); }
      }
    }
    for (const ex of item.extra || []) add(image, { x: ex.rect[0], y: ex.rect[1], width: ex.rect[2], height: ex.rect[3] }, ex.text, `${item.frame} extra "${ex.text}"`);
  }
  let all = samples;
  if (KEEP_OLD && fs.existsSync(OUT)) all = JSON.parse(fs.readFileSync(OUT, 'utf8')).samples.concat(samples);
  fs.writeFileSync(OUT, JSON.stringify({ made: new Date().toISOString(), samples: all }));
  const per = {}; all.forEach(s => { per[s.ch] = (per[s.ch] || 0) + 1; });
  console.log(`cells cut: ${cells}; examples kept: ${samples.length}; per character:`, JSON.stringify(per));
  if (skipped.length) console.log('skipped:\n  ' + skipped.join('\n  '));
  await worker.terminate(); app.quit();
});
app.on('window-all-closed', () => {});
