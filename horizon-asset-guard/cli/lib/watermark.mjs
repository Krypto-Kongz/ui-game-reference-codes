// watermark.mjs
// Data-domain watermarks (contract section 8), applied by `hag build` inside each table
// before encryption, so they survive the cracker's best move (dump the plaintext, delete
// the ciphertext): the dumped tables still carry them and `hag trace` scores them.
//
//   1. `_m` keys: every JSON object at any depth gets, with probability ~35 %, an extra key
//      `_m` + 4 hex chars with a small integer value. Game code ignores unknown keys.
//   2. slack constants: a numeric path listed in hag.config.json "marks" is replaced with a
//      seed-derived value inside [min, max], rounded to 4 decimals (the seller declared the
//      range semantically inert).
//   3. (in build.mjs) a fresh random nonce per buyer makes every ciphertext distinct.
//
// Everything is a pure function of (wm, table name, data, config): the same buyer rebuilt
// from the same inputs gets the same marks, so a ledger record stays valid across rebuilds,
// and two buyers never share a mark set except by a 1-in-65536 coincidence per key.
import { HagError } from './common.mjs';
import { sha256, utf8 } from './formats.mjs';

export const MARK_PROBABILITY = 0.35;
export const MARK_KEY_RE = /^_m[0-9a-f]{4}$/;

// 32-bit xorshift (Marsaglia) seeded from SHA-256 of the inputs; a zero seed would stick
// at zero, so it is replaced by a fixed non-zero constant.
export function seedFrom(...parts) {
  const h = sha256(...parts.map((p) => (Buffer.isBuffer(p) ? p : utf8(p))));
  const s = h.readUInt32BE(0);
  return s === 0 ? 0x9e3779b9 : s;
}

export function xorshift32(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Deep copy with `_m` keys added. Objects are visited parent-first in key order, arrays in
// index order; one draw decides whether an object is marked, two more pick key and value.
// Returns the marked copy and the list of [path, key, value] triples for the ledger.
export function addObjectMarks(data, wm, name) {
  const rng = xorshift32(seedFrom('HAGMARK1', '|', wm, '|', name));
  const used = new Set();
  const marks = [];
  const visit = (node, path) => {
    if (Array.isArray(node)) return node.map((v, i) => visit(v, path + '[' + i + ']'));
    if (!isPlainObject(node)) return node;
    const out = {};
    for (const k of Object.keys(node)) out[k] = visit(node[k], path === '' ? k : path + '.' + k);
    if (rng() / 4294967296 < MARK_PROBABILITY) {
      let key;
      do key = '_m' + (rng() & 0xffff).toString(16).padStart(4, '0');
      while (used.has(key) || Object.prototype.hasOwnProperty.call(out, key));
      used.add(key);
      const value = 1 + (rng() % 99);
      out[key] = value;
      marks.push([path === '' ? '$' : path, key, value]);
    }
    return out;
  };
  return { data: visit(data, ''), marks };
}

// "waves[1].rate", "waves.1.rate" and "boss.hp" all parse; numeric segments index arrays.
export function parsePath(path) {
  const parts = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(path)) !== null) parts.push(m[1] !== undefined ? m[1] : Number(m[2]));
  if (parts.length === 0) throw new HagError('empty mark path');
  return parts;
}

function resolveParent(root, parts, fullPath) {
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const key = Array.isArray(node) ? Number(p) : String(p);
    if (node === null || typeof node !== 'object' || !(key in node)) throw new HagError('mark path "' + fullPath + '": "' + parts.slice(0, i + 1).join('.') + '" does not exist in the table');
    node = node[key];
  }
  const last = parts[parts.length - 1];
  const key = Array.isArray(node) ? Number(last) : String(last);
  if (node === null || typeof node !== 'object' || !(key in node)) throw new HagError('mark path "' + fullPath + '" does not exist in the table');
  return { node, key };
}

export const round4 = (x) => Math.round(x * 10000) / 10000;

// A seed-derived number in [min, max] with 4 decimals; each path has its own hash so adding
// a mark never changes the others.
export function slackValue(wm, name, path, min, max) {
  const r = seedFrom('HAGSLACK1', '|', wm, '|', name, '|', path) / 4294967296;
  const v = round4(min + r * (max - min));
  return Math.min(max, Math.max(min, v));
}

// Applies every "<name>.<path>": [min, max] entry of the config that belongs to this table.
export function applySlackMarks(data, wm, name, marksConfig) {
  const slack = {};
  const out = JSON.parse(JSON.stringify(data)); // defensive copy; tables are plain JSON
  for (const fullKey of Object.keys(marksConfig || {})) {
    const dot = fullKey.indexOf('.');
    const bracket = fullKey.indexOf('[');
    const cut = dot < 0 ? bracket : bracket < 0 ? dot : Math.min(dot, bracket);
    if (cut < 0) throw new HagError('mark "' + fullKey + '" must be "<data name>.<json path>"');
    if (fullKey.slice(0, cut) !== name) continue;
    const path = fullKey.slice(cut === dot ? cut + 1 : cut);
    const range = marksConfig[fullKey];
    if (!Array.isArray(range) || range.length !== 2 || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] > range[1]) {
      throw new HagError('mark "' + fullKey + '" must map to [min, max] numbers with min <= max');
    }
    const { node, key } = resolveParent(out, parsePath(path), fullKey);
    if (typeof node[key] !== 'number') throw new HagError('mark "' + fullKey + '" points at a ' + typeof node[key] + ', not a number');
    const value = slackValue(wm, name, path, range[0], range[1]);
    node[key] = value;
    slack[path] = value;
  }
  return { data: out, slack };
}

// The full data-domain pass for one table. `keys` and `slack` go to the ledger.
export function watermarkTable(data, wm, name, marksConfig) {
  const slacked = applySlackMarks(data, wm, name, marksConfig);
  const marked = addObjectMarks(slacked.data, wm, name);
  return { data: marked.data, keys: marked.marks, slack: slacked.slack };
}

// Every `_m` key with its value, anywhere in a parsed JSON value (used by trace on dumps).
export function collectMarkKeys(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) collectMarkKeys(v, out);
  } else if (isPlainObject(value)) {
    for (const k of Object.keys(value)) {
      if (MARK_KEY_RE.test(k) && typeof value[k] === 'number') out.push([k, value[k]]);
      collectMarkKeys(value[k], out);
    }
  }
  return out;
}
