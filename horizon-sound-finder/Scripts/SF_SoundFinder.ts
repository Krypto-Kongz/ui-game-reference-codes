// SF_SoundFinder.ts
// SF Sound Finder - Made For Horizons By Kryptoart3D
//
// Drop this script on ONE empty object, Execution Mode: Default, press Play, read the console.
// No properties to fill. Delete the object (or set SF_DEBUG = false) before you publish.
//
// What it prints:
//   1. One line per sound: short key, name, entity id, asset id (if your API exposes it),
//      position and flags (DUP-NAME, SAME-SPOT, UNNAMED, NAME-ONLY).
//   2. A ready-to-paste library script, SF_SoundMap.ts, with export const SND = { ... }
//      and a helper SF_sound('rain_loop').play().
//   3. A "Checks" line saying what this world's API allowed (see below).
//
// Why the checks: the Horizon TypeScript API has no documented "list every object in the world"
// call, no documented "what type of gizmo is this" call, and AudioGizmo does not document its
// sound asset id. So this tool tries every safe route, tests each one, and only trusts the ones
// that pass:
//   Finding objects (all routes are combined):
//     a. a world-wide entity list, if your API version has one;
//     b. an entity id sweep, only when this world's ids are small sequential numbers and
//        exists() proves it can tell a real id from a fake one;
//     c. everything grouped with this object (its top-most parent and every child below it);
//     d. objects tagged sfx, sound, audio, music or SF_sound.
//   Deciding which objects are sounds:
//     e. by type, only if a self-test passes (this empty object is the "not a sound" control);
//     f. by tag (the tags above);
//     g. by name (sound, sfx, music, amb, loop, ...) when the type test cannot be trusted;
//        those rows are flagged NAME-ONLY.
// Nothing here plays, stops, moves or edits anything. Every engine call is wrapped so the
// script never throws.

import * as hz from 'horizon/core';

// ---------------------------------------------------------------- settings
const SF_DEBUG = true;                 // false = the tool prints nothing and does nothing
const SF_TAGS = ['sfx', 'sound', 'audio', 'music', 'SF_sound'];
const SF_NAME_HINT = /(sound|sfx|snd|audio|music|song|ambien|amb_|_amb|loop|voice|bgm|jingle|chime|whoosh|click)/i;
const SF_START_DELAY_MS = 600;         // let the world finish loading first
const SF_TICK_MS = 40;                 // pause between work batches
const SF_BATCH = 250;                  // engine checks per batch (keeps every frame light)
const SF_DENSE_ID_LIMIT = 5000000;     // ids above this are not sequential: no sweep
const SF_SWEEP_GAP = 4000;             // stop sweeping after this many empty ids past the last hit
const SF_SWEEP_MAX = 300000;           // hard cap on the sweep
const SF_BLOCK_LINES = 20;             // lines per console message in the paste-ready map
const SF_SAME_SPOT_M = 0.01;           // two sounds closer than this are flagged SAME-SPOT
const SF_READ_TEST_MAX = 5000;         // most objects given the volume-read type test

// ---------------------------------------------------------------- types
type SF_Vec = [number, number, number];

interface SF_Item {
  e: any;
  id: string;
  name: string;
  pos: SF_Vec | null;
  tags: string[];
  via: string[];                       // how it was found: tag / type / name
  key: string;
  asset: string;
  flags: string[];
}

interface SF_Checks {
  worldList: string;
  sweep: string;
  group: string;
  tags: string;
  typeTest: string;
  assetId: string;
  idRef: string;
}

// ---------------------------------------------------------------- small helpers
function SF_try<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch (_e) {
    return fallback;
  }
}

function SF_log(msg: string): void {
  if (SF_DEBUG) console.log('[SF] ' + msg);
}

function SF_raw(msg: string): void {
  if (SF_DEBUG) console.log(msg);
}

// Plain ASCII only: the Horizon editor rejects non-ASCII text in scripts.
function SF_ascii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '?');
}

function SF_pad(s: string, n: number): string {
  return s.length >= n ? s : s + new Array(n - s.length + 1).join(' ');
}

function SF_count(n: number, word: string): string {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

function SF_num(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function SF_posText(p: SF_Vec | null): string {
  return p ? '(' + SF_num(p[0]) + ', ' + SF_num(p[1]) + ', ' + SF_num(p[2]) + ')' : '(?)';
}

// ---------------------------------------------------------------- safe entity reads
function SF_idOf(e: any): string {
  return SF_try(() => String(e.id), '');
}

function SF_nameOf(e: any): string {
  return SF_try(() => String(e.name.get()), '');
}

function SF_posOf(e: any): SF_Vec | null {
  return SF_try((): SF_Vec | null => {
    const p = e.position.get();
    if (!p || typeof p.x !== 'number') return null;
    return [p.x, p.y, p.z];
  }, null);
}

function SF_childrenOf(e: any): any[] {
  return SF_try(() => {
    const c = e.children.get();
    return Array.isArray(c) ? c : [];
  }, []);
}

function SF_parentOf(e: any): any {
  return SF_try(() => e.parent.get(), null);
}

function SF_tagsOf(e: any): string[] {
  return SF_try(() => {
    const t = e.tags.get();
    return Array.isArray(t) ? t.map((x: any) => String(x)) : [];
  }, []);
}

function SF_exists(e: any): boolean {
  return SF_try(() => (typeof e.exists === 'function' ? e.exists() === true : true), false);
}

// Builds an entity handle from an id string; null if this API version does not allow it.
function SF_entityFromId(id: string): any {
  return SF_try(() => {
    const Ctor: any = (hz as any).Entity;
    return new Ctor(BigInt(id));
  }, null);
}

// ---------------------------------------------------------------- sound tests
// Type test 1: does as(AudioGizmo) refuse an entity that is not a sound?
function SF_castTest(e: any): string {
  return SF_try(() => {
    const a = e.as(hz.AudioGizmo);
    return a === null || a === undefined ? 'no' : 'yes';
  }, 'no');
}

// Type test 2: does a sound gizmo let us READ its volume (some API versions are write-only)?
function SF_readTest(e: any): string {
  return SF_try(() => {
    const a: any = e.as(hz.AudioGizmo);
    if (!a || !a.volume || typeof a.volume.get !== 'function') return 'none';
    const v = a.volume.get();
    return typeof v === 'number' && isFinite(v) ? 'yes' : 'no';
  }, 'no');
}

// Lists AudioGizmo members whose name suggests a sound asset id (for the Checks line).
function SF_assetMembers(e: any): string[] {
  return SF_try(() => {
    const a: any = e.as(hz.AudioGizmo);
    const found: string[] = [];
    let o: any = a;
    for (let depth = 0; o && o !== Object.prototype && depth < 6; depth++) {
      for (const k of Object.getOwnPropertyNames(o)) {
        if (/asset|clip|soundid|audioid/i.test(k) && found.indexOf(k) < 0) found.push(k);
      }
      o = Object.getPrototypeOf(o);
    }
    return found;
  }, []);
}

// Reads a sound asset id if a matching member exists and returns something id-like.
function SF_assetOf(e: any, members: string[]): string {
  for (const k of members) {
    const v = SF_try(() => {
      const a: any = e.as(hz.AudioGizmo);
      const m = a[k];
      const got = m && typeof m.get === 'function' ? m.get() : typeof m === 'function' ? null : m;
      if (got === null || got === undefined) return '';
      if (typeof got === 'object' && got.id !== undefined) return String(got.id);
      const s = String(got);
      return /^[0-9]{3,}$/.test(s) ? s : '';
    }, '');
    if (v) return v;
  }
  return '';
}

// ---------------------------------------------------------------- names and keys
const SF_DEFAULT_NAME = /^(sound( recorder)?|audio( gizmo)?|new (object|sound)|entity|object|empty object|sfx|sound gizmo)\s*(\(?\d+\)?)?$/i;

function SF_isUnnamed(name: string): boolean {
  const n = name.trim();
  return n === '' || SF_DEFAULT_NAME.test(n);
}

function SF_keyFrom(name: string): string {
  let k = SF_ascii(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')   // RainLoop -> Rain_Loop
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  k = k.replace(/^(sfx|snd|sound|audio)_(?=.)/, '');  // SFX_Rain_Loop -> rain_loop
  if (k.length > 32) k = k.slice(0, 32).replace(/_+$/g, '');
  if (k === '') k = 'sound';
  if (/^[0-9]/.test(k)) k = 's_' + k;
  return k;
}

// ---------------------------------------------------------------- the component
class SF_SoundFinder extends hz.Component<typeof SF_SoundFinder> {
  static propsDefinition = {};

  private sfSeen: { [id: string]: any } = {};
  private sfOrder: string[] = [];
  private sfChecks: SF_Checks = {
    worldList: 'not available', sweep: 'not used', group: '0 objects', tags: '0 objects',
    typeTest: 'not run', assetId: 'not checked', idRef: 'not checked',
  };

  start() {
    if (!SF_DEBUG) return;
    this.sfLater(SF_START_DELAY_MS, () => this.sfStep1WorldList());
  }

  // ---- scheduling (only this.async timers run in Horizon)
  private sfLater(ms: number, fn: () => void): void {
    try {
      this.async.setTimeout(() => {
        try { fn(); } catch (e) { SF_log('Stopped by an unexpected error: ' + SF_try(() => String(e), '?')); }
      }, ms);
    } catch (_e) {
      try { fn(); } catch (_e2) { /* never throw out of the tool */ }
    }
  }

  private sfAdd(e: any): boolean {
    if (!e) return false;
    const id = SF_idOf(e);
    if (!id || this.sfSeen[id]) return false;
    this.sfSeen[id] = e;
    this.sfOrder.push(id);
    return true;
  }

  // ---- route a: a world-wide list, if this API version has one
  private sfStep1WorldList(): void {
    const w: any = this.world;
    const names = ['getEntities', 'getAllEntities', 'getRootEntities'];
    const used: string[] = [];
    const roots: any[] = [];
    for (const n of names) {
      const list = SF_try(() => (typeof w[n] === 'function' ? w[n].call(w) : null), null);
      if (Array.isArray(list) && list.length > 0) {
        used.push(n + ' (' + list.length + ')');
        for (const e of list) { this.sfAdd(e); roots.push(e); }
      }
    }
    if (used.length > 0) this.sfChecks.worldList = 'used ' + used.join(', ');
    this.sfWalk(roots, 0, () => this.sfStep2Group());
  }

  // ---- route c: everything grouped with this object
  private sfStep2Group(): void {
    let top: any = this.entity;
    for (let i = 0; i < 64; i++) {
      const p = SF_parentOf(top);
      if (!p || SF_idOf(p) === '' || SF_idOf(p) === SF_idOf(top)) break;
      top = p;
    }
    const before = this.sfOrder.length;
    this.sfAdd(top);
    this.sfWalk([top], 0, () => {
      this.sfChecks.group = SF_count(this.sfOrder.length - before, 'object') +
        (SF_idOf(top) === SF_idOf(this.entity) ? ' (this object is not inside a group)' : '');
      this.sfStep3Tags();
    });
  }

  // Breadth-first walk over children, a batch at a time.
  private sfWalk(queue: any[], index: number, done: () => void): void {
    let n = 0;
    while (index < queue.length && n < SF_BATCH) {
      for (const c of SF_childrenOf(queue[index])) {
        if (this.sfAdd(c)) queue.push(c);
      }
      index++;
      n++;
    }
    if (index < queue.length) this.sfLater(SF_TICK_MS, () => this.sfWalk(queue, index, done));
    else done();
  }

  // ---- route d: tags
  private sfStep3Tags(): void {
    const w: any = this.world;
    const tagged: { [id: string]: boolean } = {};
    for (const t of SF_TAGS) {
      const list = SF_try(() => w.getEntitiesWithTags([t]), []);
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        const id = SF_idOf(e);
        if (!id) continue;
        tagged[id] = true;
        this.sfAdd(e);
      }
    }
    this.sfChecks.tags = SF_count(Object.keys(tagged).length, 'object');
    this.sfStep4Sweep();
  }

  // ---- route b: id sweep, only when it is provably safe and useful
  private sfStep4Sweep(): void {
    const own = SF_idOf(this.entity);
    const ownN = Number(own);
    let maxKnown = 0;
    let allSmall = ownN > 0 && ownN < SF_DENSE_ID_LIMIT;
    for (const id of this.sfOrder) {
      const v = Number(id);
      if (!(v > 0 && v < SF_DENSE_ID_LIMIT)) allSmall = false;
      if (v > maxKnown) maxKnown = v;
    }
    if (!allSmall) {
      this.sfChecks.sweep = 'skipped (ids are not small sequential numbers)';
      return this.sfStep5Classify();
    }
    // exists() must say NO to an id that cannot be real, and YES to this object.
    const fake = SF_entityFromId(String(Math.floor(SF_DENSE_ID_LIMIT * 1.7) + 12345));
    const self = SF_entityFromId(own);
    if (!fake || !self || SF_exists(fake) || !SF_exists(self)) {
      this.sfChecks.sweep = 'skipped (cannot tell real ids from empty ones)';
      return this.sfStep5Classify();
    }
    this.sfSweep(1, 0, Math.max(maxKnown, ownN), 0);
  }

  private sfSweep(next: number, lastHit: number, maxKnown: number, hits: number): void {
    const end = next + SF_BATCH;
    for (let n = next; n < end; n++) {
      const e = SF_entityFromId(String(n));
      if (e && SF_exists(e)) {
        hits++;
        lastHit = n;
        this.sfAdd(e);
      }
    }
    const past = end > maxKnown + SF_SWEEP_GAP && end - lastHit > SF_SWEEP_GAP;
    if (past || end > SF_SWEEP_MAX) {
      this.sfChecks.sweep = 'used (ids 1-' + (end - 1) + ', ' + SF_count(hits, 'object') + ')';
      return this.sfStep5Classify();
    }
    this.sfLater(SF_TICK_MS, () => this.sfSweep(end, lastHit, maxKnown, hits));
  }

  // ---- decide which objects are sounds
  private sfStep5Classify(): void {
    const ownId = SF_idOf(this.entity);
    const ids = this.sfOrder.filter((id) => id !== ownId);

    // Self-test: this empty object is NOT a sound, so a trustworthy test must say "no" for it.
    // ('none' means the API has no readable volume at all, so that test is skipped entirely.)
    const castUsable = SF_castTest(this.entity) === 'no';
    const readUsable = SF_readTest(this.entity) === 'no';
    const st = { i: 0, castYes: 0, readYes: 0, reads: 0, cast: {} as { [id: string]: boolean }, read: {} as { [id: string]: boolean } };

    const batch = (): void => {
      const end = Math.min(ids.length, st.i + SF_BATCH);
      for (; st.i < end; st.i++) {
        const id = ids[st.i];
        const e = this.sfSeen[id];
        if (castUsable && SF_castTest(e) === 'yes') { st.cast[id] = true; st.castYes++; }
        if (readUsable && st.reads < SF_READ_TEST_MAX) {
          st.reads++;
          if (SF_readTest(e) === 'yes') { st.read[id] = true; st.readYes++; }
        }
      }
      if (st.i < ids.length) { this.sfLater(SF_TICK_MS, batch); return; }

      // A test that calls almost everything a sound is not a real test.
      const total = Math.max(1, ids.length);
      const castOk = castUsable && st.castYes > 0 && st.castYes / total < 0.6;
      const readOk = readUsable && st.readYes > 0 && st.readYes / Math.max(1, st.reads) < 0.6;
      const typeOk = castOk || readOk;
      this.sfChecks.typeTest = typeOk
        ? 'works (' + (castOk ? 'cast check' : 'volume read') + ')'
        : 'not possible in this API version, using tags and names';
      this.sfCollect(ids, typeOk, castOk ? st.cast : {}, readOk ? st.read : {}, 0, []);
    };
    batch();
  }

  // Reads names and tags a batch at a time and keeps the objects that are sounds.
  private sfCollect(ids: string[], typeOk: boolean, cast: { [id: string]: boolean }, read: { [id: string]: boolean },
    from: number, items: SF_Item[]): void {
    const end = Math.min(ids.length, from + SF_BATCH);
    for (let i = from; i < end; i++) {
      const id = ids[i];
      const e = this.sfSeen[id];
      const name = SF_nameOf(e);
      const tags = SF_tagsOf(e);
      const via: string[] = [];
      for (const t of tags) {
        if (SF_TAGS.some((x) => x.toLowerCase() === t.toLowerCase())) { via.push('tag'); break; }
      }
      if (typeOk && (cast[id] || read[id])) via.push('type');
      // Name match only for leaf objects: a folder called "Audio" or "Sounds" is not a sound.
      if (!typeOk && via.length === 0 && SF_NAME_HINT.test(name) && SF_childrenOf(e).length === 0) via.push('name');
      if (via.length === 0) continue;
      items.push({ e, id, name, pos: SF_posOf(e), tags, via, key: '', asset: '', flags: [] });
    }
    if (end < ids.length) this.sfLater(SF_TICK_MS, () => this.sfCollect(ids, typeOk, cast, read, end, items));
    else this.sfStep6Finish(items, ids.length);
  }

  // ---- flags, keys, asset ids and the printout
  private sfStep6Finish(items: SF_Item[], scanned: number): void {
    // Asset id: only if AudioGizmo actually exposes something asset-like.
    const members = items.length > 0 ? SF_assetMembers(items[0].e) : SF_assetMembers(this.entity);
    for (const it of items) it.asset = SF_assetOf(it.e, members);
    const anyAsset = items.some((it) => it.asset !== '');
    this.sfChecks.assetId = anyAsset
      ? 'readable (' + members.join(', ') + ')'
      : 'not exposed to scripts' + (members.length > 0 ? ' (members ' + members.join(', ') + ' gave no id)' : '');

    // Can a script rebuild an entity from its id? (the SND helper relies on this)
    const probe = items.length > 0 ? items[0].id : SF_idOf(this.entity);
    const rebuilt = SF_entityFromId(probe);
    this.sfChecks.idRef = rebuilt && SF_idOf(rebuilt) === probe && SF_exists(rebuilt) ? 'works' : 'not available';

    // Flags
    const byName: { [k: string]: number } = {};
    for (const it of items) {
      const n = it.name.trim().toLowerCase();
      if (n) byName[n] = (byName[n] || 0) + 1;
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (SF_isUnnamed(it.name)) it.flags.push('UNNAMED');
      else if (byName[it.name.trim().toLowerCase()] > 1) it.flags.push('DUP-NAME');
      for (let j = 0; j < items.length; j++) {
        if (i === j || !it.pos || !items[j].pos) continue;
        const a = it.pos;
        const b = items[j].pos as SF_Vec;
        const d = Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]));
        if (d < SF_SAME_SPOT_M) { it.flags.push('SAME-SPOT'); break; }
      }
      if (it.via.length === 1 && it.via[0] === 'name') it.flags.push('NAME-ONLY');
    }

    // Unique short keys
    const used: { [k: string]: boolean } = {};
    items.sort((a, b) => (SF_keyFrom(a.name) < SF_keyFrom(b.name) ? -1 : SF_keyFrom(a.name) > SF_keyFrom(b.name) ? 1 : 0));
    for (const it of items) {
      const base = SF_isUnnamed(it.name) ? 'sound' : SF_keyFrom(it.name);
      let k = base;
      for (let n = 2; used[k]; n++) k = base + '_' + n;
      used[k] = true;
      it.key = k;
    }

    this.sfPrint(items, scanned);
  }

  private sfPrint(items: SF_Item[], scanned: number): void {
    const worldId = SF_try(() => String((this.world as any).id.get()), '');
    SF_log('===== SF Sound Finder | Made For Horizons By Kryptoart3D =====');
    SF_log('Scanned ' + SF_count(scanned, 'object') + '. Found ' + SF_count(items.length, 'sound') + '.');

    if (items.length > 0) {
      SF_log(SF_pad('#', 4) + SF_pad('key', 24) + SF_pad('name', 30) + SF_pad('entity id', 18) +
        SF_pad('asset id', 18) + SF_pad('position', 26) + 'flags');
      items.forEach((it, i) => {
        SF_log(SF_pad(i + 1 < 10 ? '0' + (i + 1) : String(i + 1), 4) + SF_pad(it.key, 24) +
          SF_pad('"' + SF_ascii(it.name) + '"', 30) + SF_pad(it.id, 18) + SF_pad(it.asset || 'n/a', 18) +
          SF_pad(SF_posText(it.pos), 26) + it.flags.join(' '));
      });
    }

    const c = this.sfChecks;
    SF_log('Checks: world list: ' + c.worldList + ' | id sweep: ' + c.sweep + ' | group: ' + c.group +
      ' | tags: ' + c.tags + ' | type test: ' + c.typeTest + ' | asset id: ' + c.assetId +
      ' | sound from id: ' + c.idRef);

    const dup = items.filter((it) => it.flags.indexOf('DUP-NAME') >= 0).length;
    const unnamed = items.filter((it) => it.flags.indexOf('UNNAMED') >= 0).length;
    const spot = items.filter((it) => it.flags.indexOf('SAME-SPOT') >= 0).length;
    const nameOnly = items.filter((it) => it.flags.indexOf('NAME-ONLY') >= 0).length;
    if (dup) SF_log('DUP-NAME: ' + SF_count(dup, 'sound') + ' share a name. Their keys got _2, _3 ... rename them to keep keys stable.');
    if (unnamed) SF_log('UNNAMED: ' + SF_count(unnamed, 'sound') + ' with a default name. Rename them for clear keys.');
    if (spot) SF_log('SAME-SPOT: ' + SF_count(spot, 'sound') + ' on top of another sound (likely accidental copies).');
    if (nameOnly) SF_log('NAME-ONLY: ' + SF_count(nameOnly, 'row') + ' matched by name only. Check them; tag real sounds "sfx" to be sure.');
    if (c.assetId.indexOf('not exposed') === 0 && items.length > 0) {
      SF_log('Asset ids: scripts cannot read them. Get one from Asset Library > select the sound > Asset ID.');
    }

    if (items.length === 0) {
      this.sfPrintHelp();
      return;
    }
    this.sfPrintMap(items, worldId);
  }

  private sfPrintHelp(): void {
    SF_log('No sounds found. This world does not let a script see every object, so do ONE of these and press Play again:');
    SF_log('  A) Select all your sound gizmos in the Hierarchy and add the tag sfx to them (Properties > Gameplay Tags).');
    SF_log('  B) Drag this SF object into the folder or group that holds your sounds.');
  }

  private sfPrintMap(items: SF_Item[], worldId: string): void {
    const lines: string[] = [];
    lines.push('// SF_SoundMap.ts - ' + items.length + ' sounds found by SF_SoundFinder' + (worldId ? ' in world ' + worldId : '') + '.');
    lines.push('// Made For Horizons By Kryptoart3D. Library script: do not attach it to anything.');
    lines.push('// Entity ids belong to THIS world. In a copied world, run SF_SoundFinder again.');
    lines.push("import * as hz from 'horizon/core';");
    lines.push('');
    lines.push('export const SND = {');
    for (const it of items) {
      lines.push('  ' + it.key + ": '" + it.id + "', // " + SF_ascii(it.name).replace(/\*\//g, '* /') + ' ' +
        SF_posText(it.pos) + (it.asset ? ' asset ' + it.asset : '') + (it.flags.length ? ' ' + it.flags.join(' ') : ''));
    }
    lines.push('};');
    lines.push('');
    lines.push('export type SF_SoundKey = keyof typeof SND;');
    lines.push('');
    lines.push("// Use: SF_sound('" + items[0].key + "').play();");
    lines.push('export function SF_sound(key: SF_SoundKey): hz.AudioGizmo {');
    lines.push('  return new (hz.Entity as any)(BigInt(SND[key])).as(hz.AudioGizmo);');
    lines.push('}');

    const blocks = Math.ceil(lines.length / SF_BLOCK_LINES);
    SF_log('----- copy the ' + blocks + ' block' + (blocks === 1 ? '' : 's') + ' below, in order, into a new script SF_SoundMap.ts -----');
    for (let i = 0; i < lines.length; i += SF_BLOCK_LINES) {
      SF_raw(lines.slice(i, i + SF_BLOCK_LINES).join('\n'));
    }
    SF_log('----- end of SF_SoundMap.ts -----');
    if (this.sfChecks.idRef !== 'works') {
      SF_log('Note: this API version cannot rebuild a sound from its id, so SF_sound() will not work here.');
      SF_log('Link sounds with Entity properties instead; the names above tell you which is which.');
    }
  }
}

hz.Component.register(SF_SoundFinder);
