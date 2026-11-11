// Runtime mock of the parts of horizon/core the Sound Finder touches. Behaviour switches in MOCK.mode
// let one test run the tool against every API shape it has to survive.
'use strict';
const MOCK = { db: new Map(), mode: {}, timers: [], logs: [], registered: [], worldId: 777n };

function rec(id) { return MOCK.db.get(String(id)); }
function boom(r, what) { if (r && r.throwOn && r.throwOn.includes(what)) throw new Error('engine: ' + what); }

class Vec3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }

class Entity {
  constructor(id) {
    if (MOCK.mode.noEntityCtor && !MOCK.internal) throw new TypeError('Entity is not a constructor');
    this.id = BigInt(id);
    const self = this;
    this.name = { get() { const r = rec(self.id); boom(r, 'name'); return r ? r.name : ''; }, set() {} };
    this.position = { get() { const r = rec(self.id); boom(r, 'position'); return r ? new Vec3(...r.pos) : new Vec3(0, 0, 0); }, set() {} };
    this.parent = { get() { const r = rec(self.id); boom(r, 'parent'); return r && r.parent ? mk(r.parent) : null; } };
    this.children = { get() { const r = rec(self.id); boom(r, 'children'); return r ? r.children.map(mk) : []; } };
    this.tags = { get() { const r = rec(self.id); boom(r, 'tags'); return r ? r.tags.slice() : []; } };
  }
  exists() { return MOCK.mode.existsAlwaysTrue ? true : MOCK.db.has(String(this.id)); }
  as(cls) {
    const r = rec(this.id);
    if (MOCK.mode.castValidates && cls === AudioGizmo && (!r || r.type !== 'audio')) return null;
    MOCK.internal = true; try { return new cls(this.id); } finally { MOCK.internal = false; }
  }
}
function mk(id) { MOCK.internal = true; try { return new Entity(BigInt(id)); } finally { MOCK.internal = false; } }

class AudioGizmo extends Entity {
  constructor(id) {
    super(id);
    const self = this;
    this.volume = { set() { MOCK.logs.push('!! volume.set called'); } };
    this.pitch = { set() { MOCK.logs.push('!! pitch.set called'); } };
    if (MOCK.mode.readableVolume) {
      this.volume.get = () => { const r = rec(self.id); if (!r || r.type !== 'audio') throw new Error('not audio'); return 0.8; };
    }
    if (MOCK.mode.assetMember) {
      this.soundAsset = { get() { const r = rec(self.id); return r && r.type === 'audio' ? { id: BigInt(r.asset) } : null; } };
    }
  }
  play() { MOCK.logs.push('!! play called'); }
  stop() { MOCK.logs.push('!! stop called'); }
}

class World {
  constructor() {
    this.id = { get: () => MOCK.worldId };
    if (MOCK.mode.worldList) this.getAllEntities = () => [...MOCK.db.keys()].map(mk);
  }
  getEntitiesWithTags(tags) {
    if (MOCK.mode.tagsThrow) throw new Error('tags api');
    const out = [];
    for (const [id, r] of MOCK.db) if (r.tags.some((t) => tags.includes(t))) out.push(mk(id));
    return out;
  }
}

class Component {
  constructor() {
    this.props = {};
    this.entity = mk(MOCK.selfId);
    this.world = new World();
    this.async = {
      setTimeout(cb, ms) { MOCK.timers.push({ cb, ms }); return MOCK.timers.length; },
      clearTimeout() {},
    };
  }
  preStart() {}
  static register(cls) { MOCK.registered.push(cls); }
}

module.exports = { Entity, AudioGizmo, World, Component, Vec3, __MOCK: MOCK };
