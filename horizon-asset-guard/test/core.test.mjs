// GuardCore (runtime/GuardCore.ts, compiled to test/out) against licenses and blobs built
// here with node:crypto: RSA-2048 PKCS#1 v1.5 / SHA-256 licenses for world "123", kw key
// wrapping, HAGD1 blobs (ChaCha20 counter 1 + SHA-256 tag), request codes, every evaluate
// state and diagnostic code, the fail-open rules, and a fuzz pass proving nothing throws.
// Build first: npm run build:test      Then: node test/core.test.mjs   (or: npm test)
import { constants, createCipheriv, createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  contentKey,
  effectiveWorldId,
  evaluate,
  liveWorldId,
  nowSeconds,
  openBlob,
  parseLicense,
  requestCode,
  unlock,
  verifySignature,
} from './out/runtime/GuardCore.js';
import { bytesEqual, bytesToUtf8, utf8ToBytes } from './out/runtime/crypto/Bytes.js';
import { chacha20 } from './out/runtime/crypto/ChaCha20.js';

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.log('  FAIL: ' + name);
  }
}
const here = dirname(fileURLToPath(import.meta.url));
const arr = (buf) => Array.from(buf);
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const sha = (...parts) => arr(createHash('sha256').update(Buffer.concat(parts.map((p) => Buffer.from(p)))).digest());
const utf8 = (s) => Buffer.from(s, 'utf8');
const noThrow = (fn) => {
  try {
    fn();
    return true;
  } catch (e) {
    console.log('   threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e));
    return false;
  }
};

// ---- seller side, as `hag issue` / `hag build` do it ----
const SKU = 'demo';
const keyA = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyB = generateKeyPairSync('rsa', { modulusLength: 2048 });
function embed(pub) {
  const jwk = pub.export({ format: 'jwk' });
  let e = 0;
  for (const b of Buffer.from(jwk.e, 'base64url')) e = e * 256 + b;
  return { n: jwk.n, e };
}
const PUB = embed(keyA.publicKey);
const PUB_B = embed(keyB.publicKey);
const CK = arr(randomBytes(32)); // buyer content key (ledger only)
const WM = randomBytes(8).toString('hex'); // 16 hex chars
const NOW = Math.floor(Date.now() / 1000);

// kw[i] = CK XOR SHA256("HAGKW1" || w[i] || sku || wm)
function wrapKey(ck, worldId, sku, wm) {
  const mask = sha(utf8('HAGKW1'), utf8(worldId), utf8(sku), utf8(wm));
  return b64(ck.map((b, i) => b ^ mask[i]));
}
function makeLicense(opts) {
  const o = Object.assign({ sku: SKU, buyer: 'b017', mode: 'W', worlds: ['123'], ck: CK, wm: WM, issued: NOW - 60, expires: 0, name: 'Ana', key: keyA }, opts);
  const w = o.mode === 'U' ? ['*'] : o.worlds;
  const payload = { v: 1, s: o.sku, b: o.buyer, m: o.mode, w, kw: w.map((id) => wrapKey(o.ck, id, o.sku, o.wm)), i: o.issued, e: o.expires, wm: o.wm };
  if (o.name !== undefined) payload.n = o.name;
  if (o.mutate) o.mutate(payload);
  const payloadB64 = b64(utf8(JSON.stringify(payload)));
  const signed = 'HAG1.' + payloadB64;
  const sig = sign('sha256', utf8(signed), { key: o.key.privateKey, padding: constants.RSA_PKCS1_PADDING });
  return { license: signed + '.' + b64(sig), payload, payloadB64, sig: arr(sig), signed };
}
// HAGD1.<base64url(nonce12 || ChaCha20(ck, nonce, counter 1, plaintext) || SHA256(ck||nonce||ct)[0..16])>
function nodeChaCha(key, nonce, counter, data) {
  const iv = Buffer.alloc(16);
  iv.writeUInt32LE(counter, 0);
  Buffer.from(nonce).copy(iv, 4);
  const c = createCipheriv('chacha20', Buffer.from(key), iv);
  return arr(Buffer.concat([c.update(Buffer.from(data)), c.final()]));
}
function makeBlob(ck, name, buyer, data, opts) {
  const o = Object.assign({ nonce: arr(randomBytes(12)), counter: 1 }, opts);
  const plain = arr(utf8(JSON.stringify({ n: name, b: buyer, d: data })));
  const ct = nodeChaCha(ck, o.nonce, o.counter, plain);
  const tag = sha(ck, o.nonce, ct).slice(0, 16);
  return { blob: 'HAGD1.' + b64(o.nonce.concat(ct, tag)), plain, nonce: o.nonce, ct, tag };
}
const WAVES = { waves: [{ n: 1, enemies: 3, rate: 1.0137 }, { n: 2, enemies: 7, rate: 1.25, _m3f: 2 }], boss: { hp: 1200.5, name: 'Köenig \u{1F409}' } };
const world = (id) => ({ id: { get: () => id } });
const LIC = makeLicense({});
const BLOB = makeBlob(CK, 'waves', 'b017', WAVES);

// ---- parse ----
console.log('parseLicense');
{
  const p = parseLicense(LIC.license);
  check('good license parses', p.ok === true && p.code === 'OK' && p.payload !== null);
  check('payload fields round trip', p.payload.v === 1 && p.payload.s === SKU && p.payload.b === 'b017' && p.payload.m === 'W' && p.payload.w.length === 1 && p.payload.w[0] === '123' && p.payload.kw[0] === LIC.payload.kw[0] && p.payload.i === NOW - 60 && p.payload.e === 0 && p.payload.wm === WM && p.payload.n === 'Ana');
  check('signed bytes are the literal ASCII of HAG1.<payload>', bytesEqual(p.signed, arr(utf8(LIC.signed))));
  check('signature bytes decode to the 256-byte RSA signature', bytesEqual(p.sig, LIC.sig));
  check('raw keeps the cleaned string', p.raw === LIC.license);
  check('payload copy is detached from the parser', (() => {
    const q = parseLicense(LIC.license);
    q.payload.w.push('999');
    return parseLicense(LIC.license).payload.w.length === 1;
  })());
  check('whitespace and line breaks inside a pasted license are ignored', (() => {
    const l = LIC.license;
    const messy = '  ' + l.slice(0, 40) + '\n' + l.slice(40, 300) + ' \t' + l.slice(300) + '\r\n';
    const q = parseLicense(messy);
    return q.ok && q.raw === l && verifySignature(q, PUB.n, PUB.e);
  })());
  check('optional n may be absent', parseLicense(makeLicense({ name: undefined }).license).ok === true);
  check('non-ASCII buyer name decodes', parseLicense(makeLicense({ name: 'Zoë 日本 \u{1F600}' }).license).payload.n === 'Zoë 日本 \u{1F600}');
  check('multi-world license parses', (() => {
    const q = parseLicense(makeLicense({ worlds: ['123', '777', '888', '999'] }).license);
    return q.ok && q.payload.w.length === 4 && q.payload.kw.length === 4;
  })());
  check('unbound license parses', (() => {
    const q = parseLicense(makeLicense({ mode: 'U' }).license);
    return q.ok && q.payload.m === 'U' && q.payload.w[0] === '*';
  })());
}

console.log('parseLicense E10 (malformed / truncated, with offsets)');
{
  const l = LIC.license;
  const dot = l.indexOf('.', 5);
  const e10 = (s) => {
    const p = parseLicense(s);
    return p.ok === false && p.code === 'E10' && p.payload === null && p.signed.length === 0 && p.sig.length === 0 && typeof p.detail === 'string' && p.detail.length > 0;
  };
  const e10at = (s, offset) => e10(s) && parseLicense(s).detail.indexOf('offset ' + offset) >= 0;
  check('empty string', e10('') && parseLicense('').detail.indexOf('empty') >= 0);
  check('whitespace only', e10('  \n '));
  check('undefined / null / number / object input', e10(undefined) && e10(null) && e10(42) && e10({}) && e10(['HAG1']));
  check('wrong prefix reports offset 0', e10at('HAG2' + l.slice(4), 0) && e10at('hag1' + l.slice(4), 0) && e10at('X' + l, 0));
  for (const cut of [1, 3, 4]) check('cut inside the prefix at ' + cut, e10at(l.slice(0, cut), cut));
  check('cut at 5 (prefix only)', e10at(l.slice(0, 5), 5));
  for (const cut of [6, 20, dot - 1]) check('cut inside the payload at ' + cut + ' reports the end offset', e10at(l.slice(0, cut), cut));
  check('cut right after the payload dot', e10at(l.slice(0, dot + 1), dot + 1));
  check('cut at the dot (no signature separator)', e10at(l.slice(0, dot), dot));
  for (const cut of [dot + 2, dot + 100, l.length - 50, l.length - 1]) {
    check('cut inside the signature at ' + cut + ' reports the end offset', e10at(l.slice(0, cut), cut) && parseLicense(l.slice(0, cut)).detail.indexOf('truncated') >= 0);
  }
  check('prop-limit style truncation at 200 chars', e10at(l.slice(0, 200), 200));
  check('one extra signature character', e10(l + 'A') && parseLicense(l + 'A').detail.indexOf('too long') >= 0);
  check('invalid character in the payload reports its offset', e10at(l.slice(0, 30) + '*' + l.slice(31), 30));
  check('invalid character in the signature reports its offset', e10at(l.slice(0, dot + 10) + '!' + l.slice(dot + 11), dot + 10));
  check('standard base64 alphabet is rejected', e10at(l.slice(0, 30) + '+' + l.slice(31), 30) && e10at(l.slice(0, 30) + '/' + l.slice(31), 30));
  check('padding character is rejected', e10(l.slice(0, dot) + '=' + l.slice(dot)));
  check('payload with impossible base64 length', e10(l.slice(0, 5) + 'A' + l.slice(5)));
  check('empty payload', e10at('HAG1..' + l.slice(dot + 1), 5));
  const withPayload = (bytes) => 'HAG1.' + b64(bytes) + '.' + b64(LIC.sig);
  check('payload that is not JSON', e10(withPayload(utf8('not json'))) && parseLicense(withPayload(utf8('not json'))).detail.indexOf('JSON') >= 0);
  check('payload that is a JSON array', e10(withPayload(utf8('[1,2]'))));
  check('payload with malformed UTF-8', e10(withPayload([0x7b, 0xff, 0xfe, 0x7d])));
  const field = (mutate) => e10(makeLicense({ mutate }).license);
  check('v != 1', field((p) => (p.v = 2)) && field((p) => delete p.v));
  check('missing sku', field((p) => delete p.s) && field((p) => (p.s = '')) && field((p) => (p.s = 5)));
  check('missing buyer', field((p) => delete p.b) && field((p) => (p.b = 7)));
  check('bad mode', field((p) => (p.m = 'N')) && field((p) => (p.m = 'w')) && field((p) => delete p.m));
  check('w empty / too long / not strings', field((p) => (p.w = [])) && field((p) => ((p.w = ['1', '2', '3', '4', '5']), (p.kw = p.w.map(() => p.kw[0])))) && field((p) => (p.w = [123])) && field((p) => (p.w = '123')));
  check('kw misaligned / wrong length', field((p) => (p.kw = [])) && field((p) => (p.kw = [p.kw[0], p.kw[0]])) && field((p) => (p.kw = [p.kw[0].slice(1)])) && field((p) => (p.kw = [p.kw[0] + 'A'])) && field((p) => (p.kw = [42])));
  check('unbound license must carry w == ["*"]', field((p) => ((p.m = 'U'), (p.w = ['123']))));
  check('i / e must be numbers, e >= 0', field((p) => (p.i = '1')) && field((p) => delete p.e) && field((p) => (p.e = -1)) && field((p) => (p.e = null)));
  check('wm missing', field((p) => delete p.wm) && field((p) => (p.wm = '')));
  check('n must be a string when present', field((p) => (p.n = 5)) && !field((p) => (p.n = null)));
  check('E10 detail names the field', parseLicense(makeLicense({ mutate: (p) => (p.m = 'X') }).license).detail.indexOf('m') >= 0);
}

// ---- signature ----
console.log('verifySignature');
{
  const p = parseLicense(LIC.license);
  check('verifies under the signing key', verifySignature(p, PUB.n, PUB.e) === true);
  check('rejects another key', verifySignature(p, PUB_B.n, PUB_B.e) === false);
  check('rejects a wrong exponent', verifySignature(p, PUB.n, 3) === false);
  check('rejects a tampered payload (re-encoded without re-signing)', (() => {
    const t = Object.assign({}, LIC.payload, { b: 'b018' });
    const forged = 'HAG1.' + b64(utf8(JSON.stringify(t))) + '.' + b64(LIC.sig);
    const q = parseLicense(forged);
    return q.ok && verifySignature(q, PUB.n, PUB.e) === false;
  })());
  check('rejects a flipped signature character', (() => {
    const l = LIC.license;
    const i = l.length - 10;
    const c = l.charAt(i) === 'A' ? 'B' : 'A';
    const q = parseLicense(l.slice(0, i) + c + l.slice(i + 1));
    return q.ok && verifySignature(q, PUB.n, PUB.e) === false;
  })());
  check('rejects a license signed by another seller', verifySignature(parseLicense(makeLicense({ key: keyB }).license), PUB.n, PUB.e) === false);
  check('false for a failed parse', verifySignature(parseLicense('nope'), PUB.n, PUB.e) === false);
  check('false, not a throw, for garbage keys', noThrow(() => verifySignature(p, 'not base64!', PUB.e)) && verifySignature(p, 'not base64!', PUB.e) === false && verifySignature(p, undefined, undefined) === false && verifySignature(null, PUB.n, PUB.e) === false && verifySignature({}, PUB.n, PUB.e) === false);
  check('canonical signed bytes: a different payload encoding of the same JSON is a different message', (() => {
    // Same JSON with a space added: the seller signs the transmitted text, so this must fail.
    const spaced = b64(utf8(JSON.stringify(LIC.payload, null, 1)));
    const q = parseLicense('HAG1.' + spaced + '.' + b64(LIC.sig));
    return q.ok && verifySignature(q, PUB.n, PUB.e) === false;
  })());
}

// ---- liveWorldId / effectiveWorldId / requestCode ----
console.log('liveWorldId');
{
  check('ReadableHorizonProperty<bigint>', liveWorldId(world(123n)) === '123');
  check('ReadableHorizonProperty<number> / <string>', liveWorldId(world(123)) === '123' && liveWorldId(world('123')) === '123');
  check('16-digit bigint keeps every digit', liveWorldId(world(1234567890123456789n)) === '1234567890123456789');
  check('plain bigint / number / string id', liveWorldId({ id: 123n }) === '123' && liveWorldId({ id: 123 }) === '123' && liveWorldId({ id: '123' }) === '123');
  check('string id is trimmed', liveWorldId(world(' 123\n')) === '123');
  check('getter that throws -> null', liveWorldId({ id: { get: () => { throw new Error('bridge'); } } }) === null);
  check('throwing id property -> null', liveWorldId({ get id() { throw new Error('no id'); } }) === null);
  check('missing id -> null', liveWorldId({}) === null && liveWorldId({ id: null }) === null && liveWorldId({ id: undefined }) === null);
  check('null / undefined world -> null', liveWorldId(null) === null && liveWorldId(undefined) === null);
  check('getter returning nothing -> null', liveWorldId(world(undefined)) === null && liveWorldId(world(null)) === null && liveWorldId(world('')) === null);
  check('object / function / boolean ids -> null', liveWorldId({ id: {} }) === null && liveWorldId({ id: () => 1 }) === null && liveWorldId({ id: true }) === null && liveWorldId(world({})) === null && liveWorldId(world(Symbol('x'))) === null);
  check('NaN id -> null', liveWorldId(world(NaN)) === null);
}
console.log('effectiveWorldId');
{
  const w = parseLicense(makeLicense({ worlds: ['123', '777'] }).license).payload;
  const u = parseLicense(makeLicense({ mode: 'U' }).license).payload;
  check('W with a live id uses the live id (even when not bound)', effectiveWorldId(w, '123') === '123' && effectiveWorldId(w, '456') === '456');
  check('W with no live id fails open to w[0]', effectiveWorldId(w, null) === '123' && effectiveWorldId(w, '') === '123');
  check('U is always "*"', effectiveWorldId(u, '123') === '*' && effectiveWorldId(u, null) === '*');
  check('garbage payload does not throw', noThrow(() => effectiveWorldId(null, '1')) && noThrow(() => effectiveWorldId({}, null)) && noThrow(() => effectiveWorldId({ m: 'W', w: [] }, null)));
}
console.log('requestCode');
{
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const check4 = (sku, wid) => {
    const h = sha(utf8(sku + '|' + wid));
    const bits = (h[0] << 16) | (h[1] << 8) | h[2];
    let s = '';
    for (let i = 0; i < 4; i++) s += B32.charAt((bits >> (19 - 5 * i)) & 31);
    return s;
  };
  check('format HAG-REQ-<sku>-<world>-<check4>', requestCode(SKU, '123') === 'HAG-REQ-demo-123-' + check4('demo', '123'));
  check('unreadable world -> NOWID', requestCode(SKU, null) === 'HAG-REQ-demo-NOWID-' + check4('demo', 'NOWID') && requestCode(SKU, '') === requestCode(SKU, null));
  check('check4 is 4 Crockford symbols', /^HAG-REQ-demo-123-[0-9A-HJKMNP-TV-Z]{4}$/.test(requestCode(SKU, '123')));
  let ok = 0;
  for (let i = 0; i < 50; i++) {
    const sku = 'sku' + randomBytes(3).toString('hex');
    const wid = String(Number(randomBytes(6).readUIntBE(0, 6)));
    if (requestCode(sku, wid) === 'HAG-REQ-' + sku + '-' + wid + '-' + check4(sku, wid)) ok++;
  }
  check('check4 matches the reference for 50 random (sku, world) pairs', ok === 50);
  check('check4 depends on both sku and world', requestCode('demo', '123') !== requestCode('demo', '124') && requestCode('demo', '123') !== requestCode('demp', '123'));
  check('never throws on odd input', noThrow(() => requestCode(undefined, undefined)) && noThrow(() => requestCode(5, 7)) && noThrow(() => requestCode({}, [])));
}

// ---- evaluate ----
console.log('evaluate (states and diagnostic codes)');
{
  const ev = (lic, live, now, sku) => evaluate(parseLicense(lic), PUB.n, PUB.e, sku === undefined ? SKU : sku, live, now === undefined ? NOW : now);
  const good = ev(LIC.license, '123');
  check('valid license in world 123 -> LICENSED / I00 with the buyer name', good.state === 'LICENSED' && good.code === 'I00' && good.detail.indexOf('Ana') >= 0);
  check('I00 falls back to the buyer id without a name', ev(makeLicense({ name: undefined }).license, '123').detail.indexOf('b017') >= 0);
  const mm = ev(LIC.license, '456');
  check('world 456 -> MISMATCH / E12', mm.state === 'MISMATCH' && mm.code === 'E12');
  check('E12 detail prints live id, bound ids, a fresh request code and the re-issue hint', mm.detail.indexOf('456') >= 0 && mm.detail.indexOf('123') >= 0 && mm.detail.indexOf(requestCode(SKU, '456')) >= 0 && /re-issue/i.test(mm.detail) && /duplicated/i.test(mm.detail));
  check('unreadable world id -> LICENSED (W02 fail-open is policy-safe)', ev(LIC.license, null).state === 'LICENSED' && ev(LIC.license, '').state === 'LICENSED');
  check('multi-world license accepts any bound world and rejects others', ['123', '777', '888'].every((w) => ev(makeLicense({ worlds: ['123', '777', '888'] }).license, w).state === 'LICENSED') && ev(makeLicense({ worlds: ['123', '777', '888'] }).license, '999').code === 'E12');
  check('unbound license is LICENSED in any world', ev(makeLicense({ mode: 'U' }).license, '456').state === 'LICENSED' && ev(makeLicense({ mode: 'U' }).license, null).state === 'LICENSED');
  const bad = ev(LIC.license.slice(0, 100), '123');
  check('truncated -> INVALID / E10 with the parse detail', bad.state === 'INVALID' && bad.code === 'E10' && bad.detail.indexOf('offset 100') >= 0);
  check('no license -> INVALID / E10', ev('', '123').state === 'INVALID' && ev('', '123').code === 'E10');
  check('bad signature -> INVALID / E11', ev(makeLicense({ key: keyB }).license, '123').code === 'E11' && ev(makeLicense({ key: keyB }).license, '123').state === 'INVALID');
  check('wrong public key -> E11', evaluate(parseLicense(LIC.license), PUB_B.n, PUB_B.e, SKU, '123', NOW).code === 'E11');
  const sku = ev(makeLicense({ sku: 'other' }).license, '123');
  check('SKU mismatch -> INVALID / E14 naming both SKUs', sku.state === 'INVALID' && sku.code === 'E14' && sku.detail.indexOf('other') >= 0 && sku.detail.indexOf('demo') >= 0);
  check('E14 outranks E12 (SKU is checked before the world)', ev(makeLicense({ sku: 'other' }).license, '456').code === 'E14');
  check('E11 outranks E14 (signature is checked before the SKU)', ev(makeLicense({ sku: 'other', key: keyB }).license, '123').code === 'E11');
  const exp = ev(makeLicense({ expires: NOW - 10 }).license, '123');
  check('expired -> EXPIRED / E13', exp.state === 'EXPIRED' && exp.code === 'E13');
  check('E12 outranks E13', ev(makeLicense({ expires: NOW - 10 }).license, '456').code === 'E12');
  check('not yet expired -> LICENSED', ev(makeLicense({ expires: NOW + 3600 }).license, '123').state === 'LICENSED');
  check('expiry at exactly now is still licensed', ev(makeLicense({ expires: NOW }).license, '123', NOW).state === 'LICENSED');
  check('e = 0 is perpetual', ev(makeLicense({ expires: 0 }).license, '123', NOW + 1e9).state === 'LICENSED');
  check('nowSec 0 (no clock) never expires anyone', ev(makeLicense({ expires: NOW - 10 }).license, '123', 0).state === 'LICENSED');
  check('never throws on a null / garbage parse result', noThrow(() => evaluate(null, PUB.n, PUB.e, SKU, '123', NOW)) && evaluate(null, PUB.n, PUB.e, SKU, '123', NOW).state === 'INVALID' && evaluate({}, PUB.n, PUB.e, SKU, '123', NOW).state === 'INVALID' && evaluate({ ok: true, payload: null }, PUB.n, PUB.e, SKU, '123', NOW).code === 'E10' && evaluate(undefined, undefined, undefined, undefined, undefined, undefined).state === 'INVALID');
}

// ---- contentKey ----
console.log('contentKey');
{
  const one = parseLicense(LIC.license).payload;
  check('single world unwraps CK for its world', bytesEqual(contentKey(one, '123', SKU), CK));
  check('other world -> null', contentKey(one, '456', SKU) === null);
  check('wrong sku unwraps a different key (not CK)', (() => {
    const k = contentKey(one, '123', 'other');
    return k !== null && !bytesEqual(k, CK);
  })());
  const multi = makeLicense({ worlds: ['123', '777', '888'] });
  const mp = parseLicense(multi.license).payload;
  check('multi-world: each bound world unwraps CK from its own index', bytesEqual(contentKey(mp, '123', SKU), CK) && bytesEqual(contentKey(mp, '777', SKU), CK) && bytesEqual(contentKey(mp, '888', SKU), CK) && contentKey(mp, '999', SKU) === null);
  check('multi-world: the wrapped entries differ per world', new Set(mp.kw).size === 3);
  check('multi-world: a swapped index does not unwrap', (() => {
    const swapped = Object.assign({}, mp, { kw: [mp.kw[1], mp.kw[0], mp.kw[2]] });
    const k = contentKey(swapped, '123', SKU);
    return k !== null && !bytesEqual(k, CK);
  })());
  const up = parseLicense(makeLicense({ mode: 'U' }).license).payload;
  check('unbound: index 0 under "*"', bytesEqual(contentKey(up, '*', SKU), CK) && bytesEqual(contentKey(up, 'anything', SKU), CK));
  check('wm is part of the wrap', (() => {
    const other = Object.assign({}, one, { wm: 'ffffffffffffffff' });
    return !bytesEqual(contentKey(other, '123', SKU), CK);
  })());
  check('returns a fresh 32-byte number[]', (() => {
    const a = contentKey(one, '123', SKU);
    const b = contentKey(one, '123', SKU);
    return a !== b && a.length === 32 && a.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
  })());
  check('garbage payloads -> null, no throw', noThrow(() => contentKey(null, '123', SKU)) && contentKey(null, '123', SKU) === null && contentKey({}, '123', SKU) === null && contentKey({ m: 'W', w: ['123'], kw: ['!!'] }, '123', SKU) === null && contentKey({ m: 'W', w: ['123'], kw: [b64(randomBytes(31))] }, '123', SKU) === null && contentKey({ m: 'U', w: ['*'], kw: [] }, '*', SKU) === null && contentKey({ m: 'W', w: ['123'], kw: [b64(randomBytes(32))], wm: 5 }, '123', SKU) === null);
}

// ---- openBlob ----
console.log('openBlob');
{
  const plain = openBlob(BLOB.blob, CK);
  check('round trip gives the plaintext bytes', plain !== null && bytesEqual(plain, BLOB.plain));
  check('plaintext is the {n,b,d} JSON', (() => {
    const o = JSON.parse(bytesToUtf8(plain));
    return o.n === 'waves' && o.b === 'b017' && JSON.stringify(o.d) === JSON.stringify(WAVES);
  })());
  check('blob format: HAGD1. + base64url(nonce12 || ct || tag16)', BLOB.blob.startsWith('HAGD1.') && Buffer.from(BLOB.blob.slice(6), 'base64url').length === 12 + BLOB.ct.length + 16);
  check('cipher is ChaCha20 counter 1 under CK (matches the runtime cipher)', bytesEqual(chacha20(CK, BLOB.nonce, 1, BLOB.plain), BLOB.ct));
  check('wrong key -> null', openBlob(BLOB.blob, arr(randomBytes(32))) === null);
  check('E20: flipped ciphertext byte -> null', (() => {
    const body = BLOB.nonce.concat(BLOB.ct, BLOB.tag);
    body[12 + 5] ^= 1;
    return openBlob('HAGD1.' + b64(body), CK) === null;
  })());
  check('E20: flipped tag byte -> null', (() => {
    const body = BLOB.nonce.concat(BLOB.ct, BLOB.tag);
    body[body.length - 1] ^= 0x80;
    return openBlob('HAGD1.' + b64(body), CK) === null;
  })());
  check('E20: flipped nonce byte -> null', (() => {
    const body = BLOB.nonce.concat(BLOB.ct, BLOB.tag);
    body[0] ^= 1;
    return openBlob('HAGD1.' + b64(body), CK) === null;
  })());
  check('E20: truncated blob -> null', openBlob(BLOB.blob.slice(0, -4), CK) === null && openBlob(BLOB.blob.slice(0, 20), CK) === null);
  check('bad prefix -> null', openBlob('HAGD2.' + BLOB.blob.slice(6), CK) === null && openBlob(BLOB.blob.slice(6), CK) === null && openBlob('hagd1.' + BLOB.blob.slice(6), CK) === null);
  check('short body -> null', openBlob('HAGD1.' + b64(randomBytes(27)), CK) === null && openBlob('HAGD1.', CK) === null);
  check('minimum body (empty ciphertext) with a correct tag opens to []', (() => {
    const nonce = arr(randomBytes(12));
    const tag = sha(CK, nonce, []).slice(0, 16);
    const p = openBlob('HAGD1.' + b64(nonce.concat(tag)), CK);
    return p !== null && p.length === 0;
  })());
  check('invalid base64 -> null', openBlob('HAGD1.***', CK) === null);
  check('bad key shapes -> null', openBlob(BLOB.blob, null) === null && openBlob(BLOB.blob, CK.slice(1)) === null && openBlob(BLOB.blob, 'key') === null);
  check('non-string blob -> null', openBlob(null, CK) === null && openBlob(undefined, CK) === null && openBlob(42, CK) === null && openBlob({}, CK) === null);
  check('a larger table (20 KB) round-trips', (() => {
    const big = { rows: Array.from({ length: 600 }, (_, i) => ({ id: i, name: 'row' + i, v: i * 1.5 })) };
    const b = makeBlob(CK, 'big', 'b017', big);
    const p = openBlob(b.blob, CK);
    return p !== null && JSON.stringify(JSON.parse(bytesToUtf8(p)).d) === JSON.stringify(big);
  })());
  check('a blob encrypted with counter 0 does not open (counter 1 is the format)', openBlob(makeBlob(CK, 'waves', 'b017', WAVES, { counter: 0 }).blob, CK) === null || !bytesEqual(openBlob(makeBlob(CK, 'waves', 'b017', WAVES, { counter: 0 }).blob, CK), BLOB.plain));
}

// ---- unlock ----
console.log('unlock (full chain)');
{
  const un = (lic, w, blob, sku) => unlock(blob === undefined ? BLOB.blob : blob, lic, PUB.n, PUB.e, sku === undefined ? SKU : sku, w);
  const asData = (p) => (p === null ? null : JSON.parse(bytesToUtf8(p)).d);
  check('world 123 -> plaintext', JSON.stringify(asData(un(LIC.license, world(123n)))) === JSON.stringify(WAVES));
  check('world 456 -> null', un(LIC.license, world(456n)) === null);
  check('unreadable world -> fail-open to w[0] -> plaintext', un(LIC.license, {}) !== null && un(LIC.license, null) !== null && un(LIC.license, undefined) !== null && un(LIC.license, { id: { get: () => { throw new Error('x'); } } }) !== null && un(LIC.license, { id: null }) !== null);
  check('unreadable world with a license for another world unlocks that world\'s key (fail-open by design)', un(makeLicense({ worlds: ['456'] }).license, {}) !== null);
  check('unbound license unlocks in any world and without a world', un(makeLicense({ mode: 'U' }).license, world(456n)) !== null && un(makeLicense({ mode: 'U' }).license, world(123n)) !== null && un(makeLicense({ mode: 'U' }).license, null) !== null);
  check('multi-world license: index selection', (() => {
    const l = makeLicense({ worlds: ['555', '123', '777'] }).license;
    return un(l, world(123n)) !== null && un(l, world(555n)) !== null && un(l, world(777n)) !== null && un(l, world(999n)) === null;
  })());
  check('expired license still unlocks data (E13 is policy only)', un(makeLicense({ expires: NOW - 1000 }).license, world(123n)) !== null);
  check('SKU mismatch -> null', un(makeLicense({ sku: 'other' }).license, world(123n)) === null && un(LIC.license, world(123n), undefined, 'other') === null);
  check('bad signature -> null', un(makeLicense({ key: keyB }).license, world(123n)) === null);
  check('wrong public key -> null', unlock(BLOB.blob, LIC.license, PUB_B.n, PUB_B.e, SKU, world(123n)) === null);
  check('truncated license -> null', un(LIC.license.slice(0, -5), world(123n)) === null);
  check('empty / missing license -> null', un('', world(123n)) === null && un(undefined, world(123n)) === null && un(null, world(123n)) === null);
  check('tampered blob -> null', un(LIC.license, world(123n), BLOB.blob.slice(0, -1) + (BLOB.blob.endsWith('A') ? 'B' : 'A')) === null);
  check('blob of another buyer (other CK) -> null', un(LIC.license, world(123n), makeBlob(arr(randomBytes(32)), 'waves', 'b017', WAVES).blob) === null);
  check('license with whitespace unlocks', un(LIC.license.slice(0, 50) + '\n' + LIC.license.slice(50), world(123n)) !== null);
  check('plain bigint world.id unlocks', un(LIC.license, { id: 123n }) !== null);
  check('garbage arguments never throw', noThrow(() => unlock(undefined, undefined, undefined, undefined, undefined, undefined)) && unlock(undefined, undefined, undefined, undefined, undefined, undefined) === null && noThrow(() => unlock(42, [], {}, 'e', null, 7)) && unlock(42, [], {}, 'e', null, 7) === null);
  check('nowSeconds is epoch seconds', Math.abs(nowSeconds() - Date.now() / 1000) < 5);
}

// ---- fuzz: nothing throws on garbage ----
console.log('fuzz (500 random strings through parse / evaluate / unlock / openBlob)');
{
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.=+/ \n\t{}[]":,HAG1é日\u0000\u{1F600}';
  const randStr = (len) => {
    let s = '';
    for (let i = 0; i < len; i++) s += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    return s;
  };
  const mutate = (s) => {
    const i = Math.floor(Math.random() * s.length);
    const r = Math.random();
    if (r < 0.4) return s.slice(0, i) + alphabet.charAt(Math.floor(Math.random() * alphabet.length)) + s.slice(i + 1);
    if (r < 0.7) return s.slice(0, i) + s.slice(i + 1);
    if (r < 0.9) return s.slice(0, i);
    return s.slice(0, i) + randStr(1 + Math.floor(Math.random() * 10)) + s.slice(i);
  };
  let clean = 0;
  let total = 0;
  let falseAccepts = 0;
  for (let i = 0; i < 500; i++) {
    const kind = i % 5;
    let s;
    if (kind === 0) s = randStr(Math.floor(Math.random() * 900));
    else if (kind === 1) s = 'HAG1.' + randStr(Math.floor(Math.random() * 800));
    else if (kind === 2) s = 'HAG1.' + b64(utf8(randStr(Math.floor(Math.random() * 300)))) + '.' + b64(randomBytes(256));
    else s = mutate(mutate(LIC.license));
    total++;
    const ok = noThrow(() => {
      const p = parseLicense(s);
      if (typeof p.ok !== 'boolean' || typeof p.code !== 'string' || typeof p.detail !== 'string') throw new Error('bad parse shape');
      const v = evaluate(p, PUB.n, PUB.e, SKU, '123', NOW);
      if (typeof v.state !== 'string' || typeof v.code !== 'string') throw new Error('bad verdict shape');
      if (v.state === 'LICENSED' && s !== LIC.license) falseAccepts++;
      verifySignature(p, PUB.n, PUB.e);
      const u = unlock(BLOB.blob, s, PUB.n, PUB.e, SKU, world(123n));
      if (u !== null && s.replace(/\s+/g, '') !== LIC.license) falseAccepts++;
      openBlob(s, CK);
      openBlob('HAGD1.' + s, CK);
      contentKey(p.payload, '123', SKU);
      requestCode(s, s);
      liveWorldId({ id: s });
      liveWorldId({ id: { get: () => s } });
    });
    if (ok) clean++;
  }
  check('500 fuzzed inputs: nothing threw', clean === total);
  check('500 fuzzed inputs: no mutated license was accepted or unlocked', falseAccepts === 0);
  check('random blobs of the right shape never open', (() => {
    for (let i = 0; i < 100; i++) if (openBlob('HAGD1.' + b64(randomBytes(28 + Math.floor(Math.random() * 200))), CK) !== null) return false;
    return true;
  })());
  check('weird world objects never throw', noThrow(() => [liveWorldId(Symbol('w')), liveWorldId(5), liveWorldId('123'), liveWorldId(() => 1), liveWorldId({ id: { get: 7 } }), liveWorldId({ id: { get: () => ({ toString() { throw new Error('ts'); } }) } }), liveWorldId(new Proxy({}, { get() { throw new Error('proxy'); } }))]));
}

// ---- the core region as `hag build` consumes it ----
// The builder copies the text between the marker lines into every GuardData_* module next
// to the contract section 7 imports and renames every g_* identifier. Two checks make that
// safe: the TypeScript region compiles on its own with only those imports (tsc --noEmit),
// and the compiled region, mangled, runs in Node and unlocks the blob.
console.log('GuardCore.ts core region (builder contract)');
{
  const srcPath = join(here, '..', 'runtime', 'GuardCore.ts');
  const src = readFileSync(srcPath, 'utf8');
  const BEGIN = /^\/\/ @hag-core-begin[ \t]*$/m;
  const END = /^\/\/ @hag-core-end[ \t]*$/m;
  const cut = (text) => {
    const b = text.match(BEGIN);
    const e = text.match(END);
    if (!b || !e || e.index < b.index) return null;
    return text.slice(b.index + b[0].length, e.index);
  };
  const region = cut(src);
  check('marker lines present, ordered and unique', region !== null && src.match(/^\/\/ @hag-core-begin[ \t]*$/gm).length === 1 && src.match(/^\/\/ @hag-core-end[ \t]*$/gm).length === 1);
  const regionCode = region.replace(/^\s*\/\/.*$/gm, '');
  check('region has no export, class, import or horizon reference', !/^\s*export\b/m.test(regionCode) && !/\bclass\b/.test(regionCode) && !/^\s*import\b/m.test(regionCode) && !/horizon/i.test(regionCode));
  const decls = [...region.matchAll(/^(?:function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  check('every top-level declaration in the region is g_-prefixed (' + decls.length + ' found)', decls.length > 10 && decls.every((d) => d.startsWith('g_')));
  const outside = src.slice(0, src.match(BEGIN).index) + src.slice(src.match(END).index);
  const outsideDecls = [...outside.matchAll(/^(function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[2]);
  check('no un-prefixed non-exported helper outside the region', outsideDecls.every((d) => d.startsWith('g_')));
  const allowedImports = ['sha256', 'chacha20', 'utf8ToBytes', 'base64UrlToBytes', 'bytesToBase64Url', 'concatBytes', 'bytesEqual', 'rsaVerifyPkcs1Sha256', 'rsaPublicKeyFromBase64Url'];
  const imported = [...src.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'(\w+)'/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
  check('imports are a subset of the contract list', imported.length > 0 && imported.every((n) => allowedImports.includes(n)));
  check('GuardCore.ts is under the 25 KB per-script cap and the region under 12 KB', Buffer.byteLength(src) < 25 * 1024 && Buffer.byteLength(region) < 12 * 1024);
  console.log('   region size: ' + Buffer.byteLength(region) + ' bytes; file: ' + Buffer.byteLength(src) + ' bytes');

  // Deterministic rename of every g_* identifier, as section 7 describes (`_` + 6 base32 chars).
  const mangle = (text, seed) => {
    const names = [...new Set([...text.matchAll(/\bg_[A-Za-z0-9_]*/g)].map((m) => m[0]))];
    const map = new Map();
    for (const name of names) {
      const h = createHash('sha256').update(seed + name).digest();
      let s = '_';
      for (let i = 0; i < 6; i++) s += 'abcdefghijklmnopqrstuvwxyz234567'.charAt(h[i] & 31);
      map.set(name, s);
    }
    return { text: text.replace(/\bg_[A-Za-z0-9_]*/g, (m) => map.get(m)), map };
  };
  const SECTION7_IMPORTS =
    "import { sha256 } from 'Sha256';\nimport { chacha20 } from 'ChaCha20';\nimport { rsaVerifyPkcs1Sha256, rsaPublicKeyFromBase64Url } from 'Rsa';\nimport { utf8ToBytes, base64UrlToBytes, bytesToBase64Url, concatBytes, bytesEqual } from 'Bytes';\n";

  // 1. The TypeScript region type-checks in a synthetic GuardData module (noUnusedLocals off,
  //    as the builder's output has unused imports by design).
  const dir = mkdtempSync(join(tmpdir(), 'hag-region-'));
  const m = mangle(region, WM + 'waves');
  writeFileSync(join(dir, 'GuardData_waves.ts'), SECTION7_IMPORTS + "const _BLOB = 'HAGD1.x';\n" + m.text + '\nexport function unlockWaves(lic: string, world: any): number[] | null { return ' + m.map.get('g_unlock') + '(_BLOB, lic, "n", 65537, "demo", world); }\n');
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { target: 'ES2020', module: 'ES2020', moduleResolution: 'node', lib: ['ES2020'], types: [], strict: true, noEmit: true, baseUrl: join(here, '..', 'runtime'), paths: { '*': ['*', 'crypto/*'] } },
      files: [join(dir, 'GuardData_waves.ts')],
    }),
  );
  const tsc = spawnSync(process.execPath, [join(here, '..', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' });
  check('mangled region type-checks standalone with the section 7 imports under TS 4.7.4', tsc.status === 0);
  if (tsc.status !== 0) console.log(tsc.stdout.split('\n').slice(0, 10).join('\n'));

  // 2. The same synthetic module, transpiled the way Horizon compiles the builder's output
  //    (single-file emit, ES2020), runs standalone in Node against the compiled crypto.
  const mj = mangle(region, 'seed-b017');
  check('mangled region has no g_ identifiers left', !/\bg_/.test(mj.text) && mj.map.size === decls.length);
  const synthetic = SECTION7_IMPORTS + mj.text + '\nexport const unlockX = ' + mj.map.get('g_unlock') + ';\nexport const parseX = ' + mj.map.get('g_parse') + ';\nexport const reqX = ' + mj.map.get('g_req') + ';\n';
  const emitted = ts.transpileModule(synthetic, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 }, reportDiagnostics: true });
  check('mangled region transpiles without syntax diagnostics', (emitted.diagnostics || []).length === 0);
  const cryptoUrl = (name) => new URL('./out/runtime/crypto/' + name + '.js', import.meta.url).href;
  const modPath = join(dir, 'GuardData_waves.mjs');
  writeFileSync(modPath, emitted.outputText.replace(/from '(\w+)'/g, (whole, name) => "from '" + cryptoUrl(name) + "'"));
  const mod = await import(new URL('file://' + modPath).href);
  const p = mod.unlockX(BLOB.blob, LIC.license, PUB.n, PUB.e, SKU, world(123n));
  check('mangled compiled region unlocks the blob in world 123', p !== null && bytesEqual(p, BLOB.plain));
  check('mangled compiled region returns null in world 456', mod.unlockX(BLOB.blob, LIC.license, PUB.n, PUB.e, SKU, world(456n)) === null);
  check('mangled compiled region agrees with the exported API', JSON.stringify(mod.parseX(LIC.license)) === JSON.stringify(parseLicense(LIC.license)) && mod.reqX(SKU, '456') === requestCode(SKU, '456'));
  rmSync(dir, { recursive: true, force: true });
}

// ---- lint-runtime: the string-lookup BigInt form the keystone/probe need ----
console.log('lint-runtime BigInt lookup allowance');
{
  const dir = mkdtempSync(join(tmpdir(), 'hag-lint-core-'));
  const lint = join(here, 'lint-runtime.mjs');
  const run = (code) => {
    writeFileSync(join(dir, 'Probe.ts'), code + '\n');
    return spawnSync(process.execPath, [lint, dir], { encoding: 'utf8' }).status;
  };
  check("lint allows (g as any)['BigInt'] behind a typeof check", run("export function probe(g: any): boolean { const B = (g as any)['BigInt']; return typeof B === 'function'; }") === 0);
  check('lint allows the double-quoted lookup', run('export function probe(g: any): boolean { return typeof (g as any)["BigInt"] === "function"; }') === 0);
  check('lint still rejects the bare BigInt token', run('export const b = BigInt(1);') === 1 && run('export const t = typeof BigInt;') === 1 && run("export const s = 'BigInt';") === 1 && run("export const k = ['BigInt', 'x'];") === 1 && run('export const k = g.BigInt;') === 1);
  rmSync(dir, { recursive: true, force: true });
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
