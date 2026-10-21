'use strict';
// Contract data from SCMDB (scmdb.net): what each contract pays, who offers it, the standing it needs,
// its time limit and the blueprints it can award. SCMDB is a fan project like this one, and its author
// has agreed to this use; its data is credited in the app.
//
// The site publishes one large JSON file per game version (a few MB compressed). It is downloaded
// only when the version changes (or the first time), cut down to what the Contracts view uses, and
// kept next to the app's other data. Checking for a newer version is one tiny request, made at most
// every few hours.

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BASE = 'https://scmdb.net';
const CHECK_EVERY_MS = 12 * 3600 * 1000;       // look for a newer version at most this often
const MIN_RECHECK_MS = 30 * 60 * 1000;          // ... and never twice within this, even after a failure
const MAX_BYTES = 80 * 1024 * 1024;

function get(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SC-Companion (fan project)', 'Accept': 'application/json', 'Accept-Encoding': 'gzip' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); resolve(get(new URL(res.headers.location, url).toString(), timeoutMs)); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`SCMDB answered ${res.statusCode}`)); return; }
      const stream = /gzip/i.test(res.headers['content-encoding'] || '') ? res.pipe(zlib.createGunzip()) : res;
      const chunks = []; let size = 0;
      stream.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(new Error('SCMDB data is larger than expected')); return; } chunks.push(c); });
      stream.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('SCMDB sent data that could not be read')); } });
      stream.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('SCMDB took too long to answer')));
    req.on('error', reject);
  });
}

// The whole merged file -> only what the app shows.
function compact(raw) {
  const pools = {};
  const wanted = new Set();
  const contracts = (raw.contracts || []).map(c => {
    const blueprints = (c.blueprintRewards || []).map(b => ({ pool: b.blueprintPool, chance: b.chance, trigger: b.trigger }));
    blueprints.forEach(b => wanted.add(b.pool));
    return {
      names: [...new Set([c.debugName, ...(c.debugNames || [])].filter(Boolean))],
      ids: [...new Set([c.id, ...(c.contractDefinitionIds || [])].filter(Boolean))],
      title: c.title || '',
      org: c.contractorName || '',
      type: c.missionType || '',
      reward: typeof c.rewardUEC === 'number' ? c.rewardUEC : null,
      minutes: typeof c.timeToComplete === 'number' ? c.timeToComplete : null,
      buyIn: typeof c.buyIn === 'number' ? c.buyIn : null,
      standing: (c.minStanding && c.minStanding.name) || '',
      shareable: !!c.canBeShared,
      illegal: !!c.illegal,
      blueprints,
    };
  });
  for (const id of wanted) {
    const p = (raw.blueprintPools || {})[id];
    if (p) pools[id] = { name: p.name || '', blueprints: (p.blueprints || []).map(b => [b.name, b.weight || 1]) };
  }
  return { contracts, pools };
}

class Scmdb {
  constructor(dir) {
    this.file = path.join(dir, 'scmdb-contracts.json');
    this.data = null;
    this.lastCheck = 0;
    this.busy = null;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = null; }
  }

  status() {
    return this.data ? { ok: true, version: this.data.version, fetchedAt: this.data.fetchedAt, count: this.data.contracts.length } : { ok: false };
  }
  snapshot() { return this.data; }

  // Makes sure the data is there and recent. `force` ignores the check interval. Never throws:
  // a failed check keeps what is already stored.
  refresh(force = false) {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      const now = Date.now();
      const fresh = this.data && now - (this.data.checkedAt || this.data.fetchedAt || 0) < CHECK_EVERY_MS;
      if (!force && fresh) return { ok: true, changed: false };
      if (!force && this.data && now - this.lastCheck < MIN_RECHECK_MS) return { ok: true, changed: false };
      this.lastCheck = now;
      try {
        const versions = await get(`${BASE}/data/game-versions.json`, 30000);
        const v = (Array.isArray(versions) ? versions : []).find(x => /live/i.test(x.version)) || (versions || [])[0];
        if (!v || !v.file) throw new Error('SCMDB has no data listed');
        if (this.data && this.data.version === v.version && !force) {
          this.data.checkedAt = now; this.persist();
          return { ok: true, changed: false };
        }
        const raw = await get(`${BASE}/data/${encodeURIComponent(v.file)}`, 180000);
        const slim = compact(raw);
        this.data = { version: v.version, fetchedAt: now, checkedAt: now, source: 'scmdb.net', ...slim };
        this.persist();
        return { ok: true, changed: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })().finally(() => { this.busy = null; });
    return this.busy;
  }

  persist() {
    const tmp = this.file + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); } catch { /* the data is still in memory */ }
  }
}

module.exports = { Scmdb, compact };
