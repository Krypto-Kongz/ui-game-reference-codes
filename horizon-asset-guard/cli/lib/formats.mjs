// formats.mjs
// The seller-side half of the contract section 2 formats, byte for byte, on top of
// node:crypto. The runtime (runtime/GuardCore.ts) is the other half; test/cli.test.mjs
// checks that both halves agree where they overlap (request codes, key wrapping, blobs).
//
//   license      HAG1.<payloadB64url>.<sigB64url>; the signed bytes are the literal ASCII of
//                HAG1.<payloadB64url>; RSA-2048 PKCS#1 v1.5 + SHA-256; payload keys in the
//                fixed order v,s,b,m,w,kw,i,e,wm,n with no whitespace
//   kw[i]        base64url( CK XOR SHA256(utf8("HAGKW1") | utf8(w[i]) | utf8(SKU) | utf8(wm)) )
//   request code HAG-REQ-<SKU>-<worldId|NOWID>-<check4>, check4 = the first 20 bits of
//                SHA256(utf8(SKU) | "|" | utf8(worldId)) as 4 Crockford base32 symbols
//   blob         HAGD1.<base64url(nonce12 | ChaCha20(CK, nonce, counter 1, plain) | tag16)>,
//                tag16 = SHA256(CK | nonce | ciphertext)[0..16], plain = {"n","b","d"} JSON
import { constants, createCipheriv, createHash, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import { HagError } from './common.mjs';

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAYLOAD_KEYS = ['v', 's', 'b', 'm', 'w', 'kw', 'i', 'e', 'wm', 'n'];
export const SIG_B64_LEN = 342; // 256 signature bytes, unpadded base64url
export const KW_B64_LEN = 43; // 32 wrapped key bytes, unpadded base64url
export const MAX_WORLDS = 4;

export const utf8 = (s) => Buffer.from(String(s), 'utf8');
export const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))))).digest();
export const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
export const hex = (bytes) => Buffer.from(bytes).toString('hex');

// Buffer.from(text, 'base64url') silently skips characters outside the alphabet, so the
// text is validated first: a license with a stray character must fail, not decode to junk.
export function fromB64url(text, what = 'base64url text') {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new HagError(what + ' has a character outside the base64url alphabet');
  if (text.length % 4 === 1) throw new HagError(what + ' has an impossible base64url length');
  return Buffer.from(text, 'base64url');
}

// ---- request code ------------------------------------------------------------------------

// Same bit slicing as g_req in GuardCore.ts: 20 bits, MSB first, 5 bits per symbol.
export function check4(sku, worldId) {
  const h = sha256(utf8(sku), utf8('|'), utf8(worldId));
  return CROCKFORD[h[0] >> 3] + CROCKFORD[((h[0] & 7) << 2) | (h[1] >> 6)] + CROCKFORD[(h[1] >> 1) & 31] + CROCKFORD[((h[1] & 1) << 4) | (h[2] >> 4)];
}

export function requestCode(sku, worldId) {
  const w = worldId === null || worldId === undefined || worldId === '' ? 'NOWID' : String(worldId);
  return 'HAG-REQ-' + sku + '-' + w + '-' + check4(sku, w);
}

// Accepts what a buyer pastes: surrounding whitespace or quotes, lower-case check symbols.
// The SKU and the world id are case-sensitive parts of the hash and are left alone.
export function parseRequestCode(code) {
  const s = String(code).trim().replace(/^["'`]+|["'`]+$/g, '');
  const m = /^HAG-REQ-([A-Za-z0-9_]+)-(\d+|NOWID)-([0-9A-Za-z]{4})$/.exec(s);
  if (!m) return { ok: false, code: s, reason: 'not of the form HAG-REQ-<sku>-<worldId>-<check4>' };
  const sku = m[1];
  const worldId = m[2];
  const c4 = m[3].toUpperCase();
  const want = check4(sku, worldId);
  if (c4 !== want) return { ok: false, code: s, sku, worldId, reason: 'check characters "' + m[3] + '" do not match the SKU and world id (a typo somewhere: expected ' + want + ')' };
  return { ok: true, code: s, sku, worldId, check4: c4 };
}

// ---- key wrapping ------------------------------------------------------------------------

export function wrapMask(worldId, sku, wm) {
  return sha256(utf8('HAGKW1'), utf8(worldId), utf8(sku), utf8(wm));
}

export function wrapKey(ck, worldId, sku, wm) {
  const key = Buffer.from(ck);
  if (key.length !== 32) throw new HagError('content key must be 32 bytes');
  const mask = wrapMask(worldId, sku, wm);
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) out[i] = key[i] ^ mask[i];
  return b64url(out);
}

export function unwrapKey(kwB64, worldId, sku, wm) {
  const wrapped = fromB64url(kwB64, 'kw');
  if (wrapped.length !== 32) throw new HagError('kw entry is not 32 bytes');
  const mask = wrapMask(worldId, sku, wm);
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) out[i] = wrapped[i] ^ mask[i];
  return out;
}

// ---- license -----------------------------------------------------------------------------

// Builds the payload object with the keys in contract order; `n` only when a name exists.
export function buildPayload({ sku, buyer, mode, worlds, ck, wm, issued, expires, name }) {
  const w = mode === 'U' ? ['*'] : worlds.slice();
  if (w.length < 1 || w.length > MAX_WORLDS) throw new HagError('a license binds 1..' + MAX_WORLDS + ' worlds');
  const p = { v: 1, s: sku, b: buyer, m: mode, w, kw: w.map((id) => wrapKey(ck, id, sku, wm)), i: issued, e: expires, wm };
  if (typeof name === 'string' && name.length > 0) p.n = name;
  return p;
}

export function encodeLicense(payload, privateKey) {
  const payloadB64 = b64url(utf8(JSON.stringify(payload)));
  const signed = 'HAG1.' + payloadB64;
  const sig = sign('sha256', Buffer.from(signed, 'ascii'), { key: privateKey, padding: constants.RSA_PKCS1_PADDING });
  if (sig.length !== 256) throw new HagError('signature is ' + sig.length + ' bytes: the SKU key must be RSA-2048');
  return signed + '.' + b64url(sig);
}

// Shape check shared with the runtime's g_check (same reasons, same order).
export function checkPayloadShape(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return 'payload is not an object';
  if (o.v !== 1) return 'payload field v must be 1';
  if (typeof o.s !== 'string' || o.s.length === 0) return 'payload field s (sku) missing';
  if (typeof o.b !== 'string' || o.b.length === 0) return 'payload field b (buyer) missing';
  if (o.m !== 'W' && o.m !== 'U') return 'payload field m must be W or U';
  if (!Array.isArray(o.w) || o.w.length < 1 || o.w.length > MAX_WORLDS) return 'payload field w must list 1..4 world ids';
  if (!Array.isArray(o.kw) || o.kw.length !== o.w.length) return 'payload field kw must align with w';
  for (let i = 0; i < o.w.length; i++) {
    if (typeof o.w[i] !== 'string' || o.w[i].length === 0) return 'payload field w[' + i + '] must be a non-empty string';
    if (typeof o.kw[i] !== 'string' || o.kw[i].length !== KW_B64_LEN) return 'payload field kw[' + i + '] must be ' + KW_B64_LEN + ' base64url characters';
  }
  if (o.m === 'U' && o.w[0] !== '*') return 'payload field w must be ["*"] for an unbound license';
  if (typeof o.i !== 'number' || typeof o.e !== 'number' || o.e < 0) return 'payload fields i/e must be epoch seconds';
  if (typeof o.wm !== 'string' || o.wm.length === 0) return 'payload field wm missing';
  if (o.n !== undefined && o.n !== null && typeof o.n !== 'string') return 'payload field n must be a string';
  return '';
}

// Structural parse (E10 with an offset or a reason on failure), no signature check. The
// result's `signed` is the exact text the signature covers.
export function parseLicense(raw) {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, '') : '';
  const fail = (detail) => ({ ok: false, code: 'E10', detail, raw: s, signed: '', payloadB64: '', sigB64: '', payload: null });
  if (s.length === 0) return fail('empty license');
  if (!s.startsWith('HAG1.')) return fail(s.length < 5 ? 'truncated inside the HAG1. prefix at offset ' + s.length : 'expected "HAG1." at offset 0, got "' + s.slice(0, 5) + '"');
  const dot = s.indexOf('.', 5);
  if (dot < 0) return fail('truncated: no "." before the signature; the license ends at offset ' + s.length);
  if (dot === 5) return fail('empty payload at offset 5');
  const payloadB64 = s.slice(5, dot);
  const sigB64 = s.slice(dot + 1);
  const badPayload = /[^A-Za-z0-9_-]/.exec(payloadB64);
  if (badPayload) return fail('invalid character "' + badPayload[0] + '" at offset ' + (5 + badPayload.index));
  if (payloadB64.length % 4 === 1) return fail('payload has an impossible base64 length, ending at offset ' + dot);
  if (sigB64.length === 0) return fail('truncated: signature missing at offset ' + (dot + 1));
  const badSig = /[^A-Za-z0-9_-]/.exec(sigB64);
  if (badSig) return fail('invalid character "' + badSig[0] + '" at offset ' + (dot + 1 + badSig.index));
  if (sigB64.length < SIG_B64_LEN) return fail('truncated: signature ends at offset ' + s.length + ' (' + sigB64.length + ' of ' + SIG_B64_LEN + ' characters)');
  if (sigB64.length > SIG_B64_LEN) return fail('signature too long: ' + sigB64.length + ' characters from offset ' + (dot + 1) + ' (expected ' + SIG_B64_LEN + ')');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    return fail('payload is not valid JSON (offset 5)');
  }
  const why = checkPayloadShape(payload);
  if (why !== '') return fail(why);
  return { ok: true, code: 'OK', detail: 'parsed', raw: s, signed: s.slice(0, dot), payloadB64, sigB64, payload };
}

export function verifyLicense(parsed, publicKey) {
  if (!parsed || !parsed.ok) return false;
  try {
    return verify('sha256', Buffer.from(parsed.signed, 'ascii'), { key: publicKey, padding: constants.RSA_PKCS1_PADDING }, fromB64url(parsed.sigB64, 'signature'));
  } catch (e) {
    return false;
  }
}

// ---- blob --------------------------------------------------------------------------------

// Node's raw `chacha20` cipher takes a 16-byte IV: the 32-bit little-endian block counter
// followed by the 12-byte nonce (RFC 8439 layout). Encrypt and decrypt are the same call.
export function chacha20(key, nonce, counter, data) {
  const k = Buffer.from(key);
  const n = Buffer.from(nonce);
  if (k.length !== 32) throw new HagError('chacha20: key must be 32 bytes');
  if (n.length !== 12) throw new HagError('chacha20: nonce must be 12 bytes');
  const iv = Buffer.alloc(16);
  iv.writeUInt32LE(counter >>> 0, 0);
  n.copy(iv, 4);
  const c = createCipheriv('chacha20', k, iv);
  return Buffer.concat([c.update(Buffer.from(data)), c.final()]);
}

export function sealBlob(ck, name, buyer, data, nonce = randomBytes(12)) {
  const key = Buffer.from(ck);
  const plain = utf8(JSON.stringify({ n: name, b: buyer, d: data }));
  const ct = chacha20(key, nonce, 1, plain);
  const tag = sha256(key, nonce, ct).subarray(0, 16);
  return { blob: 'HAGD1.' + b64url(Buffer.concat([Buffer.from(nonce), ct, tag])), plain, nonce: Buffer.from(nonce), ct, tag };
}

// Plaintext bytes, or null on a bad prefix, a short body or a tag mismatch (never throws).
export function openBlob(blob, ck) {
  try {
    if (typeof blob !== 'string' || !blob.startsWith('HAGD1.')) return null;
    const key = Buffer.from(ck);
    if (key.length !== 32) return null;
    const body = fromB64url(blob.slice(6), 'blob');
    if (body.length < 28) return null;
    const nonce = body.subarray(0, 12);
    const ct = body.subarray(12, body.length - 16);
    const tag = body.subarray(body.length - 16);
    const want = sha256(key, nonce, ct).subarray(0, 16);
    if (!tag.equals(want)) return null;
    return chacha20(key, nonce, 1, ct);
  } catch (e) {
    return null;
  }
}

// The ledger / register() fingerprint of a blob: first 16 hex chars of SHA-256 of the text.
export function blobHash(blob) {
  return sha256(utf8(blob)).toString('hex').slice(0, 16);
}

// ---- keys --------------------------------------------------------------------------------

function exponentBytes(e) {
  const bytes = [];
  let x = e;
  while (x > 0) {
    bytes.unshift(x % 256);
    x = Math.floor(x / 256);
  }
  return Buffer.from(bytes);
}

// The embedded form (PUB_N as unpadded base64url big-endian modulus, PUB_E as a number)
// back to a Node KeyObject.
export function publicKeyFromEmbedded(n, e) {
  return createPublicKey({ key: { kty: 'RSA', n, e: b64url(exponentBytes(e)) }, format: 'jwk' });
}

// A Node key (private or public) to the embedded form.
export function embeddedFromKey(key) {
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  let e = 0;
  for (const b of Buffer.from(jwk.e, 'base64url')) e = e * 256 + b;
  return { n: jwk.n, e };
}

export const randomHex = (bytes) => randomBytes(bytes).toString('hex');
