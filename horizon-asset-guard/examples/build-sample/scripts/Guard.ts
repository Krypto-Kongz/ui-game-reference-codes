// Guard.ts
// The registry every guarded script in a world shares, and the API game code reads data
// through. Nothing here is a boolean a cracker can flip: game code asks for tables and
// tunables, and gets the decrypted real value or the seller's trial fallback.
//
//   generated GuardData_* modules  -> Guard.register({ name, blobHash, unlock })  at load
//   AssetGuard (server component)  -> Guard.attach(world, license) in preStart,
//                                     Guard.setState(...) after the verify, Guard.warm(name)
//   any game component             -> Guard.data(name, fallback) / Guard.tune(name, fallback)
//                                     or `extends GuardedComponent` and `this.guard.*`
//
// Rules of the road (contract section 0): TypeScript 4.7 / ES2020, number[] bytes only,
// timers only through a component's `this.async`, every Horizon call feature-detected and
// in try/catch, and no path that can brick a paying buyer: every failure returns the
// fallback and logs a reason.

import * as hz from 'horizon/core';
import { sha256 } from 'Sha256';
import { bytesToHex, bytesToUtf8, utf8ToBytes } from 'Bytes';

export type GuardStateName = 'UNVERIFIED' | 'LICENSED' | 'TRIAL' | 'MISMATCH' | 'INVALID' | 'EXPIRED';

export interface GuardState {
  state: GuardStateName;
  tier: 0 | 1 | 2;
  code: string;
  detail: string;
  worldId: string | null;
  requestCode: string;
  buyer: string | null;
  verifiedAt: number;
}

export interface GuardSource {
  name: string;
  blobHash: string;
  unlock: (rawLicense: string, world: any) => number[] | null;
}

// Per-component view: the shared API bound to one component, plus enroll() (sentinel) and
// request() (client components asking the server guard for an already-decrypted table).
export interface GuardClient {
  readonly state: GuardState;
  data<T>(name: string, fallback: T): T;
  tune(name: string, fallback: number): number;
  ready(): Promise<GuardState>;
  onReady(cb: (s: GuardState) => void): void;
  onTier(cb: (tier: number) => void): void;
  onKeystone(cb: (ents: any[] | null) => void): void;
  enroll(id?: string): void;
  request<T>(name: string, fallback: T, cb: (value: T, live: boolean) => void): void;
}

export interface GuardApi {
  register(source: GuardSource): void;
  attach(world: any, license: string): void;
  setState(s: GuardState): void;
  readonly state: GuardState;
  ready(): Promise<GuardState>;
  onReady(cb: (s: GuardState) => void): void;
  onTier(cb: (tier: number) => void): void;
  onKeystone(cb: (ents: any[] | null) => void): void;
  setKeystone(ents: any[] | null): void;
  data<T>(name: string, fallback: T): T;
  tune(name: string, fallback: number): number;
  warm(name: string): void;
  sentinel(component: any, id: string): void;
  halfPatched: boolean;
  reset(dropSources?: boolean): void;
  for(component: any): GuardClient;
  // Additions beyond the contract table, all additive:
  sources(): string[]; // registered names, in registration order (AssetGuard staggers warms)
  degrade(reason: string): void; // keystone-degraded path -> tier 2 (same effect as halfPatched)
  license(): string; // the raw license handed to attach(), for diagnostics
}

const TEN_MIN = 600000;
const NONE = {}; // unique "no value" marker for data() lookups
const log = (m: string): void => console.log('[Guard] ' + m);

function freshState(): GuardState {
  return { state: 'UNVERIFIED', tier: 0, code: '', detail: '', worldId: null, requestCode: '', buyer: null, verifiedAt: 0 };
}

// ---- registry and run state ---------------------------------------------------------------

const registry = new Map<string, GuardSource>();
const order: string[] = [];
let world: any = null;
let license = '';
let seed = 0; // first 32 bits of sha256(license): per-buyer, unpredictable without the license
const parsedCache = new Map<string, any>(); // name -> plaintext JSON `.d`
const hashCache = new Map<string, string>(); // name -> sha256 hex of the plaintext bytes
const failed = new Map<string, boolean>(); // name -> unlock failed under the current license
let current: GuardState = freshState();
let readyFired = false;
let lastTier = -1;
let half = false;
let degraded = '';
let keystone: any[] | null | undefined = undefined; // undefined = not reported yet
let readyCbs: Array<(s: GuardState) => void> = [];
let tierCbs: Array<(t: number) => void> = [];
let keystoneCbs: Array<(e: any[] | null) => void> = [];
let readyResolve: (s: GuardState) => void = () => undefined;
let readyPromise: Promise<GuardState> = newDeferred();
let jitterBucket = -1;
const jitterCache = new Map<string, boolean>();
let autoIds = 0;

function newDeferred(): Promise<GuardState> {
  return new Promise<GuardState>((resolve) => {
    readyResolve = resolve;
  });
}

function hash32(text: string): number {
  const h = sha256(utf8ToBytes(text));
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}

function nowMs(): number {
  try {
    if (typeof Date !== 'undefined' && typeof Date.now === 'function') return Date.now();
  } catch (e) {
    // fall through
  }
  return 0;
}

// Seed-derived delay in [minMs, maxMs): the same salt always yields the same delay for one
// buyer, and a different one for another, so a cracker cannot time the checks from a
// second copy. Exported for GuardKeystone's degrade clock.
export function guardJitterMs(salt: string, minMs: number, maxMs: number): number {
  const span = Math.max(1, Math.floor(maxMs - minMs));
  return minMs + (hash32(salt + '|' + seed) % span);
}

// Timers may only be scheduled through a component's own `this.async` (global timers never
// run in Horizon). Helpers outside a component borrow one by calling this with the host
// component as `this`, so the schedule really is `this.async.setTimeout` of that component.
function viaAsync(this: any, fn: () => void, ms: number): number {
  return this.async.setTimeout(fn, ms);
}
export function guardTimeout(host: any, fn: () => void, ms: number): number {
  return viaAsync.call(host, fn, ms);
}

function effectiveTier(): 0 | 1 | 2 {
  if (half || degraded) return 2;
  return current.tier;
}

function stateView(): GuardState {
  const s = current;
  return {
    state: s.state,
    tier: effectiveTier(),
    code: s.code,
    detail: s.detail,
    worldId: s.worldId,
    requestCode: s.requestCode,
    buyer: s.buyer,
    verifiedAt: s.verifiedAt,
  };
}

function fire<T>(cbs: Array<(v: T) => void>, v: T): void {
  for (let i = 0; i < cbs.length; i++) {
    try {
      cbs[i](v);
    } catch (e) {
      log('callback threw: ' + e);
    }
  }
}

function refreshTier(): void {
  if (!readyFired) return;
  const t = effectiveTier();
  if (t === lastTier) return;
  lastTier = t;
  fire(tierCbs, t);
}

// Decrypts one source under the attached license and caches the parsed table and the
// plaintext hash. False on any failure; failures are remembered until attach()/warm() so a
// game calling data() every frame in trial mode does not pay an RSA verify per frame.
function unlockNow(name: string): boolean {
  const src = registry.get(name);
  if (!src || !license) return false;
  let bytes: number[] | null = null;
  try {
    bytes = src.unlock(license, world);
  } catch (e) {
    log('E20 unlock threw for ' + name + ': ' + e);
    bytes = null;
  }
  if (!bytes || bytes.length === 0) {
    failed.set(name, true);
    return false;
  }
  try {
    const obj = JSON.parse(bytesToUtf8(bytes));
    if (!obj || typeof obj !== 'object' || !('d' in obj)) {
      log('E20 plaintext of ' + name + ' is not a guard table');
      failed.set(name, true);
      return false;
    }
    if (obj.n !== name) log('W10 source ' + name + ' carries table ' + obj.n + ' (seller build mismatch)');
    parsedCache.set(name, obj.d);
    hashCache.set(name, bytesToHex(sha256(bytes)));
    failed.delete(name);
    return true;
  } catch (e) {
    log('E20 plaintext of ' + name + ' is not JSON: ' + e);
    failed.set(name, true);
    return false;
  }
}

// Tier-2 substitution rule: a source (or tunable) is served as its fallback when
// sha256(name | 10-minute bucket | seed) % 4 === 0, so about a quarter of the lookups
// change every ten minutes in a pattern only the seed decides. Cached per bucket because
// game code may call data() per frame.
function jitterHit(name: string): boolean {
  const bucket = Math.floor(nowMs() / TEN_MIN);
  if (bucket !== jitterBucket) {
    jitterBucket = bucket;
    jitterCache.clear();
  }
  const cached = jitterCache.get(name);
  if (cached !== undefined) return cached;
  const hit = hash32(name + '|' + bucket + '|' + seed) % 4 === 0;
  jitterCache.set(name, hit);
  return hit;
}

function lookup(name: string): any {
  if (!parsedCache.has(name)) {
    if (failed.get(name)) return NONE;
    if (!unlockNow(name)) return NONE;
  }
  if (effectiveTier() === 2 && jitterHit(name)) return NONE;
  return parsedCache.get(name);
}

function data<T>(name: string, fallback: T): T {
  try {
    const v = lookup(name);
    return v === NONE ? fallback : (v as T);
  } catch (e) {
    log('data(' + name + ') failed: ' + e);
    return fallback;
  }
}

// Tunables are a plain { name: number } table named 'tunables'. Tier factor is 1.0 at
// tiers 0 and 1; at tier 2 the jitter rule swaps individual values for their fallback.
function tune(name: string, fallback: number): number {
  let out = fallback;
  try {
    const t = lookup('tunables');
    const v = t !== NONE && t && typeof t === 'object' ? t[name] : undefined;
    if (typeof v === 'number' && isFinite(v)) out = v;
    if (effectiveTier() === 2 && jitterHit('tune:' + name)) out = fallback;
  } catch (e) {
    out = fallback;
  }
  return typeof out === 'number' && isFinite(out) ? out : 0;
}

function warm(name: string): void {
  try {
    if (parsedCache.has(name)) return;
    failed.delete(name);
    unlockNow(name);
  } catch (e) {
    log('warm(' + name + ') failed: ' + e);
  }
}

function flagHalfPatched(reason: string): void {
  if (half) return;
  half = true;
  log('W20 integrity disagreement, tier 2: ' + reason);
  refreshTier();
}

function degrade(reason: string): void {
  if (degraded) return;
  degraded = reason;
  log('W21 degraded, tier 2: ' + reason);
  refreshTier();
}

// One sentinel round: re-decrypt one registered source and compare its plaintext hash with
// the cached one. Sources rotate per round so N sentinels cover every table. A source that
// has no cached hash yet is simply warmed. Disagreement while LICENSED means some copy of
// the verify-and-derive core has been tampered with (half-patched build).
function sentinelRound(key: string, round: number): void {
  if (order.length === 0 || !license) return;
  const name = order[(hash32(key) + round) % order.length];
  const src = registry.get(name);
  const cached = hashCache.get(name);
  if (!src) return;
  if (cached === undefined) {
    if (!failed.get(name)) unlockNow(name);
    return;
  }
  let bytes: number[] | null = null;
  try {
    bytes = src.unlock(license, world);
  } catch (e) {
    bytes = null;
  }
  const h = bytes && bytes.length > 0 ? bytesToHex(sha256(bytes)) : '';
  if (h !== cached && current.state === 'LICENSED') flagHalfPatched('sentinel ' + key + ' on ' + name);
}

// Enrolls a cross-check hosted by a game component: first round after a seed-derived 3 to
// 20 minute delay (computed on a short first timer so the seed is known even when this
// component's preStart ran before AssetGuard's), then every ten minutes with a little
// jitter. All timers belong to the host component, so they stop with it.
function sentinel(component: any, id: string): void {
  try {
    if (!component || !component.async || typeof component.async.setTimeout !== 'function') return;
    const key = id || 's' + ++autoIds;
    let round = 0;
    const tick = (): void => {
      try {
        sentinelRound(key, round++);
      } catch (e) {
        log('sentinel ' + key + ' failed: ' + e);
      }
      schedule(TEN_MIN + guardJitterMs('sentinel-next:' + key + ':' + round, 0, 60000));
    };
    const schedule = (ms: number): void => {
      try {
        guardTimeout(component, tick, ms);
      } catch (e) {
        log('sentinel ' + key + ' timer failed: ' + e);
      }
    };
    guardTimeout(component, () => schedule(guardJitterMs('sentinel:' + key, 180000, 1200000)), 1000);
  } catch (e) {
    log('sentinel enroll failed: ' + e);
  }
}

// Client-side request: Local/Shared components never hold the content key, so they ask the
// server guard (AssetGuard answers 'hag:req' with 'hag:res') and fall back to the trial
// value until the reply arrives, or after a timeout. Answered locally when this script is
// the server and already has the table.
function request<T>(component: any, name: string, fallback: T, cb: (value: T, live: boolean) => void): void {
  let done = false;
  let sub: any = null;
  const finish = (v: T, live: boolean): void => {
    if (done) return;
    done = true;
    try {
      if (sub && typeof sub.disconnect === 'function') sub.disconnect();
    } catch (e) {
      // subscription already gone
    }
    try {
      cb(v, live);
    } catch (e) {
      log('request callback threw: ' + e);
    }
  };
  try {
    const local = lookup(name);
    if (local !== NONE) {
      finish(local as T, true);
      return;
    }
    if (!component || typeof component.connectNetworkBroadcastEvent !== 'function' || typeof component.sendNetworkBroadcastEvent !== 'function') {
      finish(fallback, false);
      return;
    }
    const res = new hz.NetworkEvent<{ name: string; json: string }>('hag:res');
    const req = new hz.NetworkEvent<{ name: string }>('hag:req');
    sub = component.connectNetworkBroadcastEvent(res, (p: { name: string; json: string }) => {
      if (!p || p.name !== name) return;
      if (!p.json) {
        finish(fallback, false);
        return;
      }
      try {
        finish(JSON.parse(p.json) as T, true);
      } catch (e) {
        finish(fallback, false);
      }
    });
    guardTimeout(component, () => finish(fallback, false), 5000);
    component.sendNetworkBroadcastEvent(req, { name: name });
  } catch (e) {
    log('request(' + name + ') failed: ' + e);
    finish(fallback, false);
  }
}

function onReady(cb: (s: GuardState) => void): void {
  readyCbs.push(cb);
  if (readyFired) fire([cb], stateView());
}

function onTier(cb: (tier: number) => void): void {
  tierCbs.push(cb);
  if (readyFired) fire([cb], effectiveTier());
}

function onKeystone(cb: (ents: any[] | null) => void): void {
  keystoneCbs.push(cb);
  if (keystone !== undefined) fire([cb], keystone);
}

function clientFor(component: any): GuardClient {
  return {
    get state(): GuardState {
      return stateView();
    },
    data: data,
    tune: tune,
    ready: (): Promise<GuardState> => readyPromise,
    onReady: onReady,
    onTier: onTier,
    onKeystone: onKeystone,
    enroll: (id?: string): void => {
      let key = id || '';
      if (!key) {
        try {
          key = String(component.entity.id);
        } catch (e) {
          key = '';
        }
      }
      sentinel(component, key);
    },
    request: <T>(name: string, fallback: T, cb: (value: T, live: boolean) => void): void => request(component, name, fallback, cb),
  };
}

// Clears everything a new run must not inherit (license, caches, state, readiness) but
// keeps subscriptions: components may have registered callbacks before AssetGuard's
// preStart ran, and a Reset re-runs everybody's start() anyway.
function attach(w: any, lic: string): void {
  world = w;
  license = typeof lic === 'string' ? lic.trim() : '';
  seed = hash32(license);
  parsedCache.clear();
  hashCache.clear();
  failed.clear();
  jitterCache.clear();
  jitterBucket = -1;
  current = freshState();
  readyFired = false;
  lastTier = -1;
  half = false;
  degraded = '';
  keystone = undefined;
  readyPromise = newDeferred();
}

function setState(s: GuardState): void {
  current = {
    state: s.state,
    tier: s.tier,
    code: s.code,
    detail: s.detail,
    worldId: s.worldId,
    requestCode: s.requestCode,
    buyer: s.buyer,
    verifiedAt: s.verifiedAt,
  };
  const complete = s.state !== 'UNVERIFIED' || s.verifiedAt > 0;
  if (complete && !readyFired) {
    readyFired = true;
    const view = stateView();
    try {
      readyResolve(view);
    } catch (e) {
      // promise already settled
    }
    fire(readyCbs, view);
  }
  refreshTier();
}

export const Guard: GuardApi = {
  register(source: GuardSource): void {
    if (!source || typeof source.name !== 'string' || typeof source.unlock !== 'function') return;
    if (!registry.has(source.name)) order.push(source.name);
    registry.set(source.name, source);
  },
  attach: attach,
  setState: setState,
  get state(): GuardState {
    return stateView();
  },
  ready(): Promise<GuardState> {
    return readyPromise;
  },
  onReady: onReady,
  onTier: onTier,
  onKeystone: onKeystone,
  setKeystone(ents: any[] | null): void {
    keystone = ents;
    fire(keystoneCbs, ents);
  },
  data: data,
  tune: tune,
  warm: warm,
  sentinel: sentinel,
  get halfPatched(): boolean {
    return half;
  },
  set halfPatched(v: boolean) {
    if (v) flagHalfPatched('set by caller');
    else {
      half = false;
      refreshTier();
    }
  },
  reset(dropSources?: boolean): void {
    attach(null, '');
    readyCbs = [];
    tierCbs = [];
    keystoneCbs = [];
    if (dropSources) {
      registry.clear();
      order.length = 0;
    }
  },
  for: clientFor,
  sources(): string[] {
    return order.slice();
  },
  degrade: degrade,
  license(): string {
    return license;
  },
};

// Base class for guarded game scripts: `this.guard` is the bound client and preStart()
// enrolls this component as a sentinel. Subclasses that override preStart() must call
// super.preStart().
export abstract class GuardedComponent<T> extends hz.Component<T> {
  protected guard: GuardClient = Guard.for(this);

  preStart(): void {
    try {
      this.guard.enroll();
    } catch (e) {
      log('enroll failed: ' + e);
    }
  }
}
