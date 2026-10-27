// Runtime mock of the 'horizon/core' subset the asset-guard runtime touches, for Node tests.
// test/fix-esm-imports.mjs points the compiled runtime's `import * as hz from 'horizon/core'`
// at this file. Same surface as types/horizon-core.d.ts, with everything observable:
//
//   mock.worldId        bigint returned by world.id.get(); null makes get() throw (W02),
//                       and mock.worldIdMissing = true removes world.id entirely
//   mock.registered     classes passed to Component.register
//   mock.texts          every TextGizmo text.set() call, in order ({ id, text })
//   mock.spawn          SpawnController behaviour: error (SpawnError), reject, delayMs
//                       (null = never settles), entities, sequence (per-attempt errors)
//   mock.log            console output captured while mock.captureConsole is true
//   flush(ms)           (also global) advances the virtual clock, firing component timers
//                       in order and draining promises between them; await it
//
// Timers never run on their own: `this.async.setTimeout` only queues. Date.now() is
// redirected to the virtual clock while this module is loaded so licence expiry and the
// ten-minute jitter buckets follow flush() too; mock.realNow() is the wall clock.

export const SpawnError = Object.freeze({ None: 0, ExceedsCapacity: 1, Cancelled: 2, InvalidAsset: 3, UnauthorizedContent: 4, InvalidParams: 5, Unknown: 6 });
export const SpawnState = Object.freeze({ NotReady: 0, Unloaded: 1, Loading: 2, Paused: 3, Loaded: 4, Spawning: 5, Active: 6, Unloading: 7, Disposed: 8 });
export const PlayerDeviceType = Object.freeze({ VR: 0, Mobile: 1, Desktop: 2 });
export const PropTypes = Object.freeze({
  Number: 'number', String: 'string', Boolean: 'boolean', Vec3: 'Vec3', Color: 'Color', Entity: 'Entity', Quaternion: 'Quaternion',
  Player: 'Player', Asset: 'Asset', NumberArray: 'Array<number>', StringArray: 'Array<string>', BooleanArray: 'Array<boolean>',
  Vec3Array: 'Array<Vec3>', ColorArray: 'Array<Color>', EntityArray: 'Array<Entity>', QuaternionArray: 'Array<Quaternion>',
  PlayerArray: 'Array<Player>', AssetArray: 'Array<Asset>',
});

const realNow = Date.now;
const realBase = realNow();

export const mock = {
  now: 0,
  worldId: 123n,
  worldIdMissing: false,
  worldName: 'Mock World',
  registered: [],
  texts: [],
  textById: new Map(),
  timers: [],
  timerSeq: 0,
  nextTimerId: 1,
  nextEntityId: 1000n,
  broadcast: new Map(), // event name -> Set<{ cb, owner }>
  targeted: new Map(), // entityId:name -> Set
  codeBlock: new Map(), // entityId:name -> Set
  localBroadcast: new Map(),
  sent: [], // every network send { kind, name, data }
  spawn: { error: 0, reject: false, delayMs: 10, entities: null, sequence: [], attempts: [], controllers: [] },
  assetData: new Map(), // asset id (string) -> text returned by fetchAsData
  components: [],
  players: [],
  errors: [],
  log: [],
  captureConsole: false,
  realNow: () => realNow(),
  reset() {
    this.now = 0;
    this.worldId = 123n;
    this.worldIdMissing = false;
    this.registered.length = 0;
    this.texts.length = 0;
    this.textById.clear();
    this.timers.length = 0;
    this.broadcast.clear();
    this.targeted.clear();
    this.codeBlock.clear();
    this.localBroadcast.clear();
    this.sent.length = 0;
    this.spawn = { error: 0, reject: false, delayMs: 10, entities: null, sequence: [], attempts: [], controllers: [] };
    this.assetData.clear();
    this.components.length = 0;
    this.players.length = 0;
    this.errors.length = 0;
    this.log.length = 0;
  },
};

Date.now = () => realBase + mock.now;

const origLog = console.log;
const origWarn = console.warn;
console.log = (...args) => {
  if (mock.captureConsole) mock.log.push(args.map(String).join(' '));
  else origLog(...args);
};
console.warn = (...args) => {
  if (mock.captureConsole) mock.log.push(args.map(String).join(' '));
  else origWarn(...args);
};

// ---- timers ------------------------------------------------------------------------------

function queueTimer(owner, fn, ms, interval) {
  const id = mock.nextTimerId++;
  mock.timers.push({ id, at: mock.now + Math.max(0, Number(ms) || 0), fn, owner, seq: mock.timerSeq++, interval: interval || 0 });
  return id;
}

function cancelTimer(id) {
  const i = mock.timers.findIndex((t) => t.id === id);
  if (i >= 0) mock.timers.splice(i, 1);
}

const drain = () => new Promise((r) => setImmediate(r));

export async function flush(ms = 0) {
  const target = mock.now + Math.max(0, ms);
  let guard = 0;
  for (;;) {
    await drain();
    let next = null;
    for (const t of mock.timers) if (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq)) next = t;
    if (!next || next.at > target) break;
    mock.timers.splice(mock.timers.indexOf(next), 1);
    if (next.at > mock.now) mock.now = next.at;
    try {
      next.fn();
    } catch (e) {
      mock.errors.push(e);
    }
    if (next.interval > 0) mock.timers.push({ ...next, at: mock.now + next.interval, seq: mock.timerSeq++ });
    if (++guard > 100000) throw new Error('flush: runaway timers');
  }
  mock.now = target;
  await drain();
}
globalThis.flush = flush;

function makeAsync(owner) {
  return {
    setTimeout: (fn, ms) => queueTimer(owner, fn, ms, 0),
    clearTimeout: (id) => cancelTimer(id),
    setInterval: (fn, ms) => queueTimer(owner, fn, ms, Math.max(1, Number(ms) || 1)),
    clearInterval: (id) => cancelTimer(id),
  };
}

// ---- properties and math -------------------------------------------------------------------

const prop = (initial) => {
  let v = initial;
  return { get: () => v, set: (x) => { v = x; } };
};

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  static get zero() { return new Vec3(0, 0, 0); }
  static get one() { return new Vec3(1, 1, 1); }
  static get forward() { return new Vec3(0, 0, 1); }
  static get up() { return new Vec3(0, 1, 0); }
  static get right() { return new Vec3(1, 0, 0); }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v) { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
  mul(s) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z; }
  magnitude() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  normalize() { const m = this.magnitude() || 1; return this.mul(1 / m); }
  toString() { return `Vec3(${this.x}, ${this.y}, ${this.z})`; }
}

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  static get zero() { return new Quaternion(0, 0, 0, 0); }
  static get one() { return new Quaternion(0, 0, 0, 1); }
  static fromEuler() { return new Quaternion(0, 0, 0, 1); }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  toString() { return `Quaternion(${this.x}, ${this.y}, ${this.z}, ${this.w})`; }
}

export class Color {
  constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
  static get red() { return new Color(1, 0, 0); }
  static get green() { return new Color(0, 1, 0); }
  static get blue() { return new Color(0, 0, 1); }
  static get white() { return new Color(1, 1, 1); }
  static get black() { return new Color(0, 0, 0); }
  clone() { return new Color(this.r, this.g, this.b); }
  toString() { return `Color(${this.r}, ${this.g}, ${this.b})`; }
}

// ---- players, entities, assets -------------------------------------------------------------

export class Player {
  constructor(id, name = '', opts = {}) {
    this.id = id;
    this.name = prop(name);
    this.index = prop(opts.index ?? 0);
    this.position = prop(new Vec3());
    this.rotation = prop(Quaternion.one);
    this.isInBuildMode = prop(!!opts.build);
    this.deviceType = prop(opts.device ?? PlayerDeviceType.Desktop);
  }
  toString() { return `[Player ${this.id}]`; }
}

export class Entity {
  constructor(id) {
    this.id = typeof id === 'bigint' ? id : BigInt(id);
    this.name = prop('Entity' + this.id);
    this.position = prop(new Vec3());
    this.rotation = prop(Quaternion.one);
    this.scale = prop(Vec3.one);
    this.owner = prop(null);
    const tags = new Set();
    this.tags = { get: () => [...tags], set: (v) => { tags.clear(); v.forEach((t) => tags.add(t)); }, add: (t) => tags.add(t), remove: (t) => tags.delete(t), contains: (t) => tags.has(t), clear: () => tags.clear(), get length() { return tags.size; } };
  }
  exists() { return true; }
  as(cls) { return new cls(this.id); }
  toString() { return `[Entity ${this.id}]`; }
}

export class TextGizmo extends Entity {
  constructor(id) {
    super(id);
    const key = String(this.id);
    this.text = {
      get: () => mock.textById.get(key) ?? '',
      set: (s) => { mock.textById.set(key, String(s)); mock.texts.push({ id: this.id, text: String(s) }); },
    };
  }
}

export class AssetContentData {
  constructor(text) { this.text = text; }
  asText() { return this.text; }
  asJSON() { try { return JSON.parse(this.text); } catch { return null; } }
}

export class Asset {
  constructor(id, versionId = 0n) { this.id = typeof id === 'bigint' ? id : BigInt(id); this.versionId = versionId; }
  as(cls) { return new cls(this.id, this.versionId); }
  fetchAsData() {
    const t = mock.assetData.get(String(this.id));
    return t === undefined ? Promise.reject(new Error('asset not readable')) : Promise.resolve(new AssetContentData(t));
  }
  toString() { return `[Asset ${this.id}]`; }
}

export class SpawnController {
  constructor(asset, position, rotation, scale) {
    this.asset = asset; this.position = position; this.rotation = rotation; this.scale = scale;
    this._state = SpawnState.NotReady; this._error = SpawnError.None; this._entities = [];
    this.rootEntities = { get: () => this._entities.slice() };
    this.currentState = { get: () => this._state };
    this.spawnError = { get: () => this._error };
    mock.spawn.controllers.push(this);
  }
  load() { this._state = SpawnState.Loaded; return Promise.resolve(); }
  spawn() {
    const cfg = mock.spawn;
    const err = cfg.sequence.length ? cfg.sequence.shift() : cfg.error;
    cfg.attempts.push({ id: this.asset.id, at: mock.now, err });
    this._state = SpawnState.Spawning;
    return new Promise((resolve, reject) => {
      if (cfg.delayMs === null) return; // never settles: exercises the 20 s timeout
      queueTimer(null, () => {
        if (err === SpawnError.None) {
          this._state = SpawnState.Active;
          this._entities = cfg.entities ? cfg.entities.slice() : [new Entity(mock.nextEntityId++)];
          resolve();
        } else {
          this._error = err;
          this._state = SpawnState.Unloaded;
          if (cfg.reject) reject(new Error('spawn failed: ' + err));
          else resolve();
        }
      }, cfg.delayMs, 0);
    });
  }
  pause() { this._state = SpawnState.Paused; return Promise.resolve(); }
  unload() { this._state = SpawnState.Unloaded; this._entities = []; return Promise.resolve(); }
  dispose() { this._state = SpawnState.Disposed; this._entities = []; return Promise.resolve(); }
}

// ---- world ---------------------------------------------------------------------------------

export class World {
  constructor() {
    this.name = { get: () => mock.worldName };
    this.serverPlayer = new Player(0, '');
  }
  get id() {
    if (mock.worldIdMissing) return undefined;
    return {
      get: () => {
        if (mock.worldId === null || mock.worldId === undefined) throw new Error('world id unavailable');
        return mock.worldId;
      },
    };
  }
  getPlayers() { return mock.players.slice(); }
  getServerPlayer() { return this.serverPlayer; }
  getLocalPlayer() { return this.serverPlayer; }
  getEntitiesWithTags() { return []; }
  spawnAsset() { return Promise.resolve([]); }
  deleteAsset() { return Promise.resolve(undefined); }
}
export const world = new World();

// ---- events --------------------------------------------------------------------------------

export class LocalEvent { constructor(name = 'local' + Math.random()) { this.name = name; } }
export class NetworkEvent { constructor(name) { this.name = name; } }
export class CodeBlockEvent { constructor(name, expectedTypes = []) { this.name = name; this.expectedTypes = expectedTypes; } }
export const CodeBlockEvents = Object.freeze({
  OnPlayerEnterWorld: new CodeBlockEvent('OnPlayerEnterWorld'), OnPlayerExitWorld: new CodeBlockEvent('OnPlayerExitWorld'),
  OnPlayerEnterTrigger: new CodeBlockEvent('OnPlayerEnterTrigger'), OnPlayerExitTrigger: new CodeBlockEvent('OnPlayerExitTrigger'),
  OnEntityEnterTrigger: new CodeBlockEvent('OnEntityEnterTrigger'), OnEntityExitTrigger: new CodeBlockEvent('OnEntityExitTrigger'),
  OnGrabStart: new CodeBlockEvent('OnGrabStart'), OnGrabEnd: new CodeBlockEvent('OnGrabEnd'),
  OnIndexTriggerDown: new CodeBlockEvent('OnIndexTriggerDown'), OnIndexTriggerUp: new CodeBlockEvent('OnIndexTriggerUp'),
  OnButton1Down: new CodeBlockEvent('OnButton1Down'), OnButton2Down: new CodeBlockEvent('OnButton2Down'),
  OnAssetSpawned: new CodeBlockEvent('OnAssetSpawned'), OnAssetDespawned: new CodeBlockEvent('OnAssetDespawned'),
  OnAssetSpawnFailed: new CodeBlockEvent('OnAssetSpawnFailed'),
});

function subscribe(map, key, cb, owner) {
  if (!map.has(key)) map.set(key, new Set());
  const entry = { cb, owner };
  map.get(key).add(entry);
  return { disconnect: () => map.get(key)?.delete(entry) };
}

// Delivery is synchronous (Horizon delivers on a later frame); handlers see the same
// object the sender passed. Handlers that throw are recorded in mock.errors.
function deliver(map, key, ...args) {
  const set = map.get(key);
  if (!set) return 0;
  let n = 0;
  for (const e of [...set]) {
    n++;
    try { e.cb(...args); } catch (err) { mock.errors.push(err); }
  }
  return n;
}

export const fireCodeBlockEvent = (target, event, ...payload) => deliver(mock.codeBlock, String(target.id) + ':' + event.name, ...payload);

// ---- components ----------------------------------------------------------------------------

export class Component {
  static propsDefinition = {};
  static register(cls, name) { mock.registered.push({ cls, name: name || cls.name }); }
  constructor() { this.props = {}; this.entity = null; this.world = null; this.async = null; }
  preStart() {}
  start() {}
  dispose() { mock.timers = mock.timers.filter((t) => t.owner !== this); }
  receiveOwnership() {}
  transferOwnership() { return null; }
  connectCodeBlockEvent(target, event, cb) { return subscribe(mock.codeBlock, String(target.id) + ':' + event.name, cb, this); }
  connectLocalEvent(target, event, cb) { return subscribe(mock.targeted, 'L' + String(target.id) + ':' + event.name, cb, this); }
  sendLocalEvent(target, event, data) { deliver(mock.targeted, 'L' + String(target.id) + ':' + event.name, data); }
  connectLocalBroadcastEvent(event, cb) { return subscribe(mock.localBroadcast, event.name, cb, this); }
  sendLocalBroadcastEvent(event, data) { deliver(mock.localBroadcast, event.name, data); }
  connectNetworkEvent(target, event, cb) { return subscribe(mock.targeted, 'N' + String(target.id) + ':' + event.name, cb, this); }
  sendNetworkEvent(target, event, data) {
    mock.sent.push({ kind: 'entity', name: event.name, data });
    deliver(mock.targeted, 'N' + String(target.id) + ':' + event.name, data);
  }
  connectNetworkBroadcastEvent(event, cb) { return subscribe(mock.broadcast, event.name, cb, this); }
  sendNetworkBroadcastEvent(event, data) {
    mock.sent.push({ kind: 'broadcast', name: event.name, data });
    deliver(mock.broadcast, event.name, data);
  }
}

// Builds a component the way the engine would: props from propsDefinition defaults
// overridden by `props`, an entity, the world and a component-scoped async; then runs
// preStart() and start() unless opts.start === false.
export function instantiate(cls, props = {}, opts = {}) {
  const c = new cls();
  const defs = cls.propsDefinition || {};
  const p = {};
  for (const k of Object.keys(defs)) p[k] = k in props ? props[k] : defs[k].default;
  for (const k of Object.keys(props)) if (!(k in p)) p[k] = props[k];
  c.props = p;
  c.entity = opts.entity || new Entity(mock.nextEntityId++);
  c.world = opts.world || world;
  c.async = makeAsync(c);
  mock.components.push(c);
  if (opts.start !== false) {
    c.preStart();
    c.start();
  }
  return c;
}
