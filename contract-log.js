'use strict';
// Reads contract activity out of Star Citizen's Game.log: which contracts were accepted, how each
// ended (completed, failed, abandoned) and which blueprints were awarded. The same lines are read
// live (what the log watcher appends) and from old logs (the logbackups folder).
//
// What the log gives, per line:
//   Added notification "Contract Accepted:  <title>: " ... MissionId: [id]
//   Creating objective marker: missionId [id], generator name [G], contract [C]   (who offers it, and the contract's own name)
//   <EndMission> Ending mission for player. MissionId[id] ... CompletionType[Complete|Fail|Abandon|Deactivate]
//   Added notification "New Objective: <text>: " (also "Objective Complete / Failed / Withdrawn") with MissionId and ObjectiveId
//   <ObjectiveUpserted> ... mission_id X - objective_id Y - state MISSION_OBJECTIVE_STATE_INPROGRESS|COMPLETED|FAILED|WITHDRAWN
//   Added notification "Received Blueprint: <name>: " ... (its MissionId is empty; it arrives ~1 s after the contract completes)
//   Added notification "Awarded <n> aUEC: " ... (its MissionId is empty too, and it does not line up with the
//     contract that paid, so it is kept as a running total only, never attached to one contract)
// A mission is announced again each time the player logs back in, so records are keyed by MissionId.

const fs = require('fs');
const path = require('path');

const NIL_ID = '00000000-0000-0000-0000-000000000000';
const OUTCOMES = { Complete: 'completed', Fail: 'failed', Abandon: 'abandoned', Deactivate: 'ended' };
const MAX_RECORDS = 3000;
const MAX_AWARDS = 4000;
const MAX_BLUEPRINTS = 500;
const BLUEPRINT_LINK_MS = 15000;     // a blueprint reward arrives within seconds of the completion that earned it

const RE_TS = /^<([^>]+)> /;
const RE_NOTIFY = /Added notification "(.*?)" \[\d+\] to queue\. New queue size: \d+, MissionId: \[([0-9a-f-]+)\](?:, ObjectiveId: \[([^\]]*)\])?/;
const RE_OBJ = /ObjectiveUpserted> Received ObjectiveUpserted push message for: mission_id ([0-9a-f-]+) - objective_id (\S+) - state MISSION_OBJECTIVE_STATE_([A-Z]+)/;
const OBJ_STATE = { INPROGRESS: 'active', COMPLETED: 'done', FAILED: 'failed', WITHDRAWN: 'withdrawn' };
const objKind = (oid) => (/^pickup/i.test(oid) ? 'pickup' : /^dropoff/i.test(oid) ? 'dropoff' : 'other');
const MAX_OBJECTIVES = 40;
const OPEN_MS = 36 * 3600 * 1000;           // a mission never seen ending and last announced longer ago than this is not open
const RE_MARKER = /Creating objective marker: missionId \[([0-9a-f-]+)\], generator name \[([^\]]*)\], contract \[([^\]]*)\]/;
const RE_END = /<(?:CSCPlayerMissionLog::)?EndMission(?:_Impl)?> Ending mission for player\. MissionId\[([0-9a-f-]+)\].*?CompletionType\[(\w+)\]/;

const tidy = (s) => s.replace(/:\s*$/, '').replace(/\s+/g, ' ').trim();

// One log line -> an event, or null for the many lines that are not about contracts.
function parseLine(line) {
  if (line.indexOf('Mission') === -1 && line.indexOf('Awarded') === -1 && line.indexOf('Received Blueprint') === -1) return null;
  const tsM = RE_TS.exec(line);
  const ts = tsM ? Date.parse(tsM[1]) : NaN;
  if (!Number.isFinite(ts)) return null;
  let m;
  if ((m = RE_NOTIFY.exec(line))) {
    const text = m[1], id = m[2], oid = m[3] || '';
    let t;
    if (oid && id !== NIL_ID) {
      if ((t = /^New Objective:\s*(.*)$/.exec(text))) return { type: 'objective', id, oid, text: tidy(t[1]), state: 'active', ts };
      if ((t = /^Objective Complete:\s*(.*)$/.exec(text))) return { type: 'objective', id, oid, text: tidy(t[1]), state: 'done', ts };
      if ((t = /^Objective Failed:\s*(.*)$/.exec(text))) return { type: 'objective', id, oid, text: tidy(t[1]), state: 'failed', ts };
      if ((t = /^Objective Withdrawn:\s*(.*)$/.exec(text))) return { type: 'objective', id, oid, text: tidy(t[1]), state: 'withdrawn', ts };
    }
    if ((t = /^Contract Accepted:\s*(.*)$/.exec(text))) return id === NIL_ID ? null : { type: 'accepted', id, title: tidy(t[1]), ts };
    if ((t = /^Received Blueprint:\s*(.*)$/.exec(text))) return { type: 'blueprint', name: tidy(t[1]), ts };
    if ((t = /^Awarded (\d+) aUEC/.exec(text))) return { type: 'award', amount: Number(t[1]), ts };
    return null;
  }
  if ((m = RE_OBJ.exec(line))) return { type: 'objective', id: m[1], oid: m[2], text: '', state: OBJ_STATE[m[3]] || 'active', ts };
  if ((m = RE_MARKER.exec(line))) return { type: 'marker', id: m[1], generator: m[2], contract: m[3], ts };
  if ((m = RE_END.exec(line))) return { type: 'ended', id: m[1], outcome: OUTCOMES[m[2]] || 'ended', ts };
  return null;
}

class ContractTracker {
  // `backing` is { get(key, default), set(key, value) } — the app's electron-store.
  constructor(backing, key = 'contractLog') {
    this.backing = backing;
    this.key = key;
    const saved = backing.get(key) || {};
    this.records = new Map((saved.records || []).map(r => [r.id, r]));
    this.awards = saved.awards || [];
    this.blueprints = saved.blueprints || [];
    this.imported = saved.imported || null;
    this.carry = '';                  // the unfinished last line of a live chunk
    this.meta = new Map();            // MissionId -> { generator, contract }: the marker lines come before the acceptance
    this.pendingObj = new Map();      // MissionId -> objective events seen before the acceptance was
  }

  save() {
    // objectives are kept only for contracts that can still be open (not for ones whose ending was never seen)
    for (const r of this.records.values()) if (r.objectives && r.objectives.length && (r.outcome !== 'active' || Date.now() - (r.seenAt || r.acceptedAt) > OPEN_MS)) r.objectives = [];
    const recs = [...this.records.values()].sort((a, b) => b.acceptedAt - a.acceptedAt).slice(0, MAX_RECORDS);
    this.backing.set(this.key, {
      records: recs, awards: this.awards.slice(-MAX_AWARDS), blueprints: this.blueprints.slice(-MAX_BLUEPRINTS), imported: this.imported,
    });
  }

  // Closes open contracts by hand, for the ones whose ending the log never showed (the player quit to the menu,
  // the game crashed, a log was lost). `manual` keeps them out of the time statistics: the time between
  // accepting and the moment the player cleared them says nothing about how long the contract took.
  resolve(ids, outcome) {
    if (!['completed', 'failed', 'abandoned'].includes(outcome)) return 0;
    const want = new Set(ids);
    const now = Date.now();
    let n = 0;
    for (const r of this.records.values()) {
      if (r.outcome !== 'active' || !want.has(r.id)) continue;
      r.outcome = outcome; r.endedAt = now; r.objectives = []; r.manual = true;
      n++;
    }
    if (n) this.save();
    return n;
  }

  clear() {
    this.records.clear(); this.awards = []; this.blueprints = []; this.imported = null; this.carry = '';
    this.save();
  }

  // Applies a list of events in order. Returns what is new: { changed, blueprints: [new blueprint events] }.
  apply(events) {
    let changed = false;
    const fresh = [];
    for (const e of events) {
      if (e.type === 'accepted') {
        const r = this.records.get(e.id);
        const meta = this.meta.get(e.id) || {};
        if (!r) {
          this.records.set(e.id, { id: e.id, title: e.title, acceptedAt: e.ts, seenAt: e.ts, outcome: 'active', endedAt: null, generator: meta.generator || '', contract: meta.contract || '', blueprints: [], objectives: [] });
          changed = true;
        } else {
          if (!r.title) { r.title = e.title; changed = true; }
          if (e.ts < r.acceptedAt) { r.acceptedAt = e.ts; changed = true; }
          if (e.ts > (r.seenAt || 0)) { r.seenAt = e.ts; changed = true; }   // announced again after a log-in: still open then
          if (!r.contract && meta.contract) { r.generator = meta.generator; r.contract = meta.contract; changed = true; }
        }
        if (!r && this.pendingObj.has(e.id)) {
          const rec = this.records.get(e.id);
          for (const o of this.pendingObj.get(e.id)) this.applyObjective(rec, o);
          this.pendingObj.delete(e.id);
        }
      } else if (e.type === 'objective') {
        const r = this.records.get(e.id);
        if (r) { if (this.applyObjective(r, e)) changed = true; }
        else {
          const list = this.pendingObj.get(e.id) || [];
          if (list.length < 60) list.push(e);
          this.pendingObj.set(e.id, list);
          if (this.pendingObj.size > 200) this.pendingObj.delete(this.pendingObj.keys().next().value);
        }
      } else if (e.type === 'marker') {
        const r = this.records.get(e.id);
        if (r && !r.contract) { r.generator = e.generator; r.contract = e.contract; changed = true; }
        else if (!r) {
          this.meta.set(e.id, { generator: e.generator, contract: e.contract });
          if (this.meta.size > 500) this.meta.delete(this.meta.keys().next().value);
        }
      } else if (e.type === 'ended') {
        const r = this.records.get(e.id);
        // the first real ending wins ("Deactivate" is only a placeholder); a mission the log never
        // announced has no title to show, so it is left out
        if (r && (r.outcome === 'active' || (r.outcome === 'ended' && e.outcome !== 'ended'))) {
          r.outcome = e.outcome; r.endedAt = e.ts; changed = true;
          if (e.outcome !== 'ended') r.objectives = [];        // objectives are only worth keeping while the contract is open
        }
      } else if (e.type === 'blueprint') {
        if (!this.blueprints.some(b => b.name === e.name && b.ts === e.ts)) {
          // the contract that was completed a moment ago is the one that paid it out
          let src = null;
          for (const r of this.records.values()) {
            if (r.outcome === 'completed' && r.endedAt != null && e.ts - r.endedAt >= -2000 && e.ts - r.endedAt <= BLUEPRINT_LINK_MS && (!src || r.endedAt > src.endedAt)) src = r;
          }
          const entry = { name: e.name, ts: e.ts, contractId: src ? src.id : null };
          this.blueprints.push(entry);
          if (src) { (src.blueprints = src.blueprints || []).push(e.name); }
          fresh.push(entry);
          changed = true;
        }
      } else if (e.type === 'award') {
        if (!this.awards.some(a => a.ts === e.ts && a.amount === e.amount)) { this.awards.push({ ts: e.ts, amount: e.amount }); changed = true; }
      }
    }
    return { changed, blueprints: fresh };
  }

  // One objective event for a contract. An objective that is already done/failed/withdrawn is not
  // reopened by a later "in progress" (a log-in announces the open ones again). Returns true when something changed.
  applyObjective(r, e) {
    if (r.outcome !== 'active') return false;
    const list = r.objectives = r.objectives || [];
    let o = list.find(x => x.id === e.oid);
    if (!o) {
      if (list.length >= MAX_OBJECTIVES) return false;
      o = { id: e.oid, kind: objKind(e.oid), text: '', state: 'active' };
      list.push(o);
      o.text = e.text || '';
      o.state = e.state || 'active';
      return true;
    }
    let changed = false;
    const closed = (st) => st === 'done' || st === 'failed' || st === 'withdrawn';
    // a log-in announces the open objectives again with their starting text; that must not overwrite a finished one's
    if (e.text && o.text !== e.text && !(closed(o.state) && e.state === 'active')) { o.text = e.text; changed = true; }
    if (e.state && e.state !== o.state && !(closed(o.state) && e.state === 'active')) { o.state = e.state; changed = true; }
    return changed;
  }

  // Text that just arrived from the live log: whole lines only, the rest waits for the next chunk.
  ingestLive(text) {
    const all = this.carry + text;
    const cut = all.lastIndexOf('\n');
    if (cut === -1) { this.carry = all.length > 20000 ? '' : all; return { changed: false, blueprints: [] }; }
    this.carry = all.slice(cut + 1);
    const events = [];
    for (const line of all.slice(0, cut).split('\n')) { const e = parseLine(line); if (e) events.push(e); }
    const res = this.apply(events);
    if (res.changed) this.save();
    return res;
  }

  // Every event in one whole log file, in file order.
  static eventsFromFile(file) {
    const events = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) { const e = parseLine(line); if (e) events.push(e); }
    return events;
  }

  // Reads the current log and the logbackups folder beside it, oldest first, so a mission is
  // announced before it ends. Safe to run again: records are keyed by MissionId.
  importLogs(logPath, { currentOnly = false } = {}) {
    const dir = path.dirname(logPath);
    const files = [];
    const back = path.join(dir, 'logbackups');
    if (!currentOnly) try { for (const f of fs.readdirSync(back)) if (/\.log$/i.test(f)) files.push(path.join(back, f)); } catch { /* no backups folder */ }
    if (fs.existsSync(logPath)) files.push(logPath);
    const firstStamp = (f) => {
      try {
        const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(200); fs.readSync(fd, b, 0, 200, 0); fs.closeSync(fd);
        const m = RE_TS.exec(b.toString('utf8')); const t = m ? Date.parse(m[1]) : NaN;
        return Number.isFinite(t) ? t : fs.statSync(f).mtimeMs;
      } catch { return 0; }
    };
    const ordered = files.map(f => [f, firstStamp(f)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const before = this.records.size;
    const newBlueprints = [];
    let read = 0;
    for (const f of ordered) {
      try {
        const res = this.apply(ContractTracker.eventsFromFile(f));
        newBlueprints.push(...res.blueprints);
        read++;
      } catch { /* a log that can't be read is skipped */ }
    }
    if (!currentOnly) this.imported = { at: Date.now(), files: read };
    this.save();
    return { files: read, contracts: this.records.size - before, total: this.records.size, blueprints: newBlueprints };
  }

  snapshot() {
    return {
      records: [...this.records.values()].sort((a, b) => b.acceptedAt - a.acceptedAt),
      awards: this.awards, blueprints: this.blueprints, imported: this.imported,
    };
  }
}

module.exports = { ContractTracker, parseLine, NIL_ID };
