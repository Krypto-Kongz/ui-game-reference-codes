// GuardCore.ts
// Pure license logic for the asset guard: parse a HAG1 license string, verify its RSA
// signature, evaluate it against this build's SKU and the live world id, unwrap the buyer's
// content key and open a HAGD1 data blob. No Horizon import, no timers, no state: every
// function is deterministic and never throws, so Node tests exercise exactly the code that
// runs in a world. Formats are those of the implementation contract (license, request code,
// blob, diagnostic codes).
//
// The section between the `@hag-core-begin` and `@hag-core-end` marker lines is copied
// verbatim by `hag build` into every generated GuardData_* module, with every `g_*`
// identifier renamed per buyer, so that each data module re-verifies the license and
// re-derives the key on its own (there is no single boolean to patch). Inside that region
// only the `g_*` names, the crypto imports below, JSON, String, Math, Array, Date, typeof
// and plain object literals may be referenced: no classes, no exports, no other
// module-level names, no Horizon API. test/core.test.mjs compiles and runs the region on
// its own, with the names mangled, to keep that promise.
import { sha256 } from 'Sha256';
import { chacha20 } from 'ChaCha20';
import { rsaVerifyPkcs1Sha256, rsaPublicKeyFromBase64Url } from 'Rsa';
import { utf8ToBytes, base64UrlToBytes, concatBytes, bytesEqual } from 'Bytes';

// @hag-core-begin
// Decoded license payload (contract section 2); kw[i] wraps the content key for w[i].
interface g_Payload {
  v: number;
  s: string;
  b: string;
  m: 'W' | 'U';
  w: string[];
  kw: string[];
  i: number;
  e: number;
  wm: string;
  n?: string;
}

// `signed` is the literal ASCII of HAG1.<payload> (what the seller signed); empty when !ok.
interface g_Parsed {
  ok: boolean;
  code: string;
  detail: string;
  raw: string;
  signed: number[];
  sig: number[];
  payload: g_Payload | null;
}

interface g_Verdict {
  state: 'LICENSED' | 'INVALID' | 'MISMATCH' | 'EXPIRED';
  code: string;
  detail: string;
}

const g_B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, for the request code check
const g_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const g_SIG_CHARS = 342; // 256 signature bytes as unpadded base64url
const g_KW_CHARS = 43; // 32 wrapped key bytes as unpadded base64url

// UTF-8 decode for the JSON payload (bytesToUtf8 is not among a generated module's imports).
function g_utf8(b: number[]): string {
  let s = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i++];
    let cp = -1;
    let need = 0;
    if (c < 0x80) cp = c;
    else if (c >= 0xc2 && c <= 0xdf) {
      cp = c & 0x1f;
      need = 1;
    } else if (c >= 0xe0 && c <= 0xef) {
      cp = c & 0x0f;
      need = 2;
    } else if (c >= 0xf0 && c <= 0xf4) {
      cp = c & 0x07;
      need = 3;
    }
    for (let j = 0; cp >= 0 && j < need; j++) {
      const t = i < b.length ? b[i] : 0;
      if (t < 0x80 || t > 0xbf) {
        cp = -1;
        break;
      }
      cp = (cp << 6) | (t & 0x3f);
      i++;
    }
    if (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) s += '�';
    else if (cp < 0x10000) s += String.fromCharCode(cp);
    else {
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return s;
}

// Offset of the first character in s[from, to) outside the base64url alphabet, or -1.
function g_b64bad(s: string, from: number, to: number): number {
  for (let i = from; i < to; i++) if (g_B64.indexOf(s.charAt(i)) < 0) return i;
  return -1;
}

// '' when the decoded payload has the contract's shape, else the reason for the E10 detail.
function g_check(o: any): string {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return 'payload is not an object';
  if (o.v !== 1) return 'payload field v must be 1';
  if (typeof o.s !== 'string' || o.s.length === 0) return 'payload field s (sku) missing';
  if (typeof o.b !== 'string' || o.b.length === 0) return 'payload field b (buyer) missing';
  if (o.m !== 'W' && o.m !== 'U') return 'payload field m must be W or U';
  if (!Array.isArray(o.w) || o.w.length < 1 || o.w.length > 4) return 'payload field w must list 1..4 world ids';
  if (!Array.isArray(o.kw) || o.kw.length !== o.w.length) return 'payload field kw must align with w';
  for (let i = 0; i < o.w.length; i++) {
    if (typeof o.w[i] !== 'string' || o.w[i].length === 0) return 'payload field w[' + i + '] must be a non-empty string';
    if (typeof o.kw[i] !== 'string' || o.kw[i].length !== g_KW_CHARS) return 'payload field kw[' + i + '] must be ' + g_KW_CHARS + ' base64url characters';
  }
  if (o.m === 'U' && o.w[0] !== '*') return 'payload field w must be ["*"] for an unbound license';
  if (typeof o.i !== 'number' || typeof o.e !== 'number' || o.e < 0) return 'payload fields i/e must be epoch seconds';
  if (typeof o.wm !== 'string' || o.wm.length === 0) return 'payload field wm missing';
  if (o.n !== undefined && o.n !== null && typeof o.n !== 'string') return 'payload field n must be a string';
  return '';
}

// Parses HAG1.<payload>.<sig>. Every structural problem is E10 with the reason and the
// character offset (a buyer whose prop truncated the string sees where it was cut).
function g_parse(raw: string): g_Parsed {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, '') : '';
  const fail = function (detail: string): g_Parsed {
    return { ok: false, code: 'E10', detail: detail, raw: s, signed: [], sig: [], payload: null };
  };
  if (s.length === 0) return fail('empty license');
  const head = 'HAG1.';
  for (let i = 0; i < head.length; i++) {
    if (i >= s.length) return fail('truncated inside the HAG1. prefix at offset ' + i);
    if (s.charAt(i) !== head.charAt(i)) return fail('expected "HAG1." at offset 0, got "' + s.slice(0, 5) + '"');
  }
  const dot = s.indexOf('.', 5);
  if (dot < 0) return fail('truncated: no "." before the signature; the license ends at offset ' + s.length);
  if (dot === 5) return fail('empty payload at offset 5');
  let bad = g_b64bad(s, 5, dot);
  if (bad >= 0) return fail('invalid character "' + s.charAt(bad) + '" at offset ' + bad);
  if ((dot - 5) % 4 === 1) return fail('payload has an impossible base64 length, ending at offset ' + dot);
  const sigStart = dot + 1;
  if (sigStart >= s.length) return fail('truncated: signature missing at offset ' + sigStart);
  bad = g_b64bad(s, sigStart, s.length);
  if (bad >= 0) return fail('invalid character "' + s.charAt(bad) + '" at offset ' + bad);
  const sigLen = s.length - sigStart;
  if (sigLen < g_SIG_CHARS) return fail('truncated: signature ends at offset ' + s.length + ' (' + sigLen + ' of ' + g_SIG_CHARS + ' characters)');
  if (sigLen > g_SIG_CHARS) return fail('signature too long: ' + sigLen + ' characters from offset ' + sigStart + ' (expected ' + g_SIG_CHARS + ')');
  let pb: number[];
  let sig: number[];
  try {
    pb = base64UrlToBytes(s.slice(5, dot));
    sig = base64UrlToBytes(s.slice(sigStart));
  } catch (e) {
    return fail('base64 decode failed at offset 5');
  }
  let obj: any = null;
  try {
    obj = JSON.parse(g_utf8(pb));
  } catch (e) {
    return fail('payload is not valid JSON (offset 5)');
  }
  const why = g_check(obj);
  if (why !== '') return fail(why);
  const p: g_Payload = { v: 1, s: obj.s, b: obj.b, m: obj.m, w: obj.w.slice(), kw: obj.kw.slice(), i: obj.i, e: obj.e, wm: obj.wm };
  if (typeof obj.n === 'string') p.n = obj.n;
  return { ok: true, code: 'OK', detail: 'parsed', raw: s, signed: utf8ToBytes(s.slice(0, dot)), sig: sig, payload: p };
}

// RSA-2048 PKCS#1 v1.5 / SHA-256 over the signed text (~22 ms in a slow interpreter).
function g_verify(p: g_Parsed, pubN: string, pubE: number): boolean {
  if (!p || !p.ok || p.payload === null) return false;
  try {
    const k = rsaPublicKeyFromBase64Url(pubN, pubE);
    return rsaVerifyPkcs1Sha256(p.sig, p.signed, k.n, k.e);
  } catch (e) {
    return false;
  }
}

// Live world id as a decimal string, or null when unreadable (W02: the caller fails open).
// world.id is [likely] a property with get(); a plain bigint/number/string is tolerated too.
function g_live(world: any): string | null {
  try {
    if (world === null || world === undefined) return null;
    let id: any = world.id;
    if (id !== null && typeof id === 'object' && typeof id.get === 'function') id = id.get();
    if (id === null || id === undefined) return null;
    const t = typeof id;
    if (t !== 'bigint' && t !== 'number' && t !== 'string') return null;
    const s = String(id).replace(/\s+/g, '');
    if (s.length === 0 || s === 'NaN' || s === 'undefined' || s === 'null') return null;
    return s;
  } catch (e) {
    return null;
  }
}

// Id used for key unwrap: "*" unbound, else the live id, else (W02 fail-open) w[0].
function g_eff(p: g_Payload, live: string | null): string {
  if (p.m === 'U') return '*';
  if (live !== null && live !== undefined && live !== '') return live;
  return p.w[0];
}

// HAG-REQ-<sku>-<id|NOWID>-<check4>; check4 = first 20 bits of SHA-256(sku "|" id) in
// Crockford base32, a typo catch for `hag issue`.
function g_req(sku: string, live: string | null): string {
  const wid = live === null || live === undefined || live === '' ? 'NOWID' : String(live);
  const h = sha256(utf8ToBytes(String(sku) + '|' + wid));
  const c =
    g_B32.charAt(h[0] >> 3) +
    g_B32.charAt(((h[0] & 7) << 2) | (h[1] >> 6)) +
    g_B32.charAt((h[1] >> 1) & 31) +
    g_B32.charAt(((h[1] & 1) << 4) | (h[2] >> 4));
  return 'HAG-REQ-' + String(sku) + '-' + wid + '-' + c;
}

// Policy verdict in contract order: parse, signature, SKU, world, expiry (policy only).
function g_eval(p: g_Parsed, pubN: string, pubE: number, sku: string, live: string | null, now: number): g_Verdict {
  if (!p || !p.ok || p.payload === null) {
    return { state: 'INVALID', code: p && p.code ? p.code : 'E10', detail: p && p.detail ? p.detail : 'no license' };
  }
  const pl = p.payload;
  if (!g_verify(p, pubN, pubE)) return { state: 'INVALID', code: 'E11', detail: 'signature does not verify under the public key of this build' };
  if (pl.s !== sku) return { state: 'INVALID', code: 'E14', detail: 'license is for SKU "' + pl.s + '" but this build is SKU "' + sku + '"' };
  if (pl.m === 'W' && live !== null && live !== undefined && live !== '' && pl.w.indexOf(live) < 0) {
    return {
      state: 'MISMATCH',
      code: 'E12',
      detail:
        'license is bound to world ' + pl.w.join(' / ') + ' but this is world ' + live +
        '. Duplicated your world? Send this code to the seller for a free re-issue: ' + g_req(sku, live),
    };
  }
  if (pl.e > 0 && now > 0 && now > pl.e) return { state: 'EXPIRED', code: 'E13', detail: 'license expired at epoch ' + pl.e + ' (now ' + now + ')' };
  return { state: 'LICENSED', code: 'I00', detail: 'licensed to ' + (pl.n ? pl.n : pl.b) };
}

// kw[i] XOR SHA-256("HAGKW1" | w[i] | sku | wm) for w[i] === eff; null when eff is not bound.
function g_ck(p: g_Payload, eff: string, sku: string): number[] | null {
  try {
    if (!p || typeof p.wm !== 'string' || !Array.isArray(p.w) || !Array.isArray(p.kw)) return null;
    const idx = p.m === 'U' ? 0 : p.w.indexOf(eff);
    if (idx < 0 || idx >= p.kw.length) return null;
    const wrapped = base64UrlToBytes(p.kw[idx]);
    if (wrapped.length !== 32) return null;
    const mask = sha256(concatBytes(utf8ToBytes('HAGKW1'), utf8ToBytes(p.w[idx]), utf8ToBytes(String(sku)), utf8ToBytes(p.wm)));
    const ck: number[] = new Array(32);
    for (let i = 0; i < 32; i++) ck[i] = wrapped[i] ^ mask[i];
    return ck;
  } catch (e) {
    return null;
  }
}

// HAGD1.<base64url(nonce12 | ct | tag16)>, tag16 = SHA-256(key | nonce | ct)[0..16] (a check
// against the seller's own mistakes, not an attacker); ChaCha20 counter 1. null on any fault.
function g_open(blob: string, key: number[]): number[] | null {
  try {
    if (typeof blob !== 'string' || !Array.isArray(key) || key.length !== 32) return null;
    if (blob.slice(0, 6) !== 'HAGD1.') return null;
    const body = base64UrlToBytes(blob.slice(6));
    if (body.length < 28) return null;
    const nonce = body.slice(0, 12);
    const ct = body.slice(12, body.length - 16);
    const tag = body.slice(body.length - 16);
    const want = sha256(concatBytes(key, nonce, ct)).slice(0, 16);
    if (!bytesEqual(tag, want)) return null;
    return chacha20(key, nonce, 1, ct);
  } catch (e) {
    return null;
  }
}

// The whole chain for one data module; null on any failure (trial data). Expiry is not checked.
function g_unlock(blob: string, raw: string, pubN: string, pubE: number, sku: string, world: any): number[] | null {
  try {
    const p = g_parse(raw);
    if (!p.ok || p.payload === null) return null;
    if (!g_verify(p, pubN, pubE)) return null;
    if (p.payload.s !== sku) return null;
    const ck = g_ck(p.payload, g_eff(p.payload, g_live(world)), sku);
    if (ck === null) return null;
    return g_open(blob, ck);
  } catch (e) {
    return null;
  }
}

// Epoch seconds, or 0 without a clock (0 disables expiry: an unknown clock never expires a buyer).
function g_now(): number {
  try {
    if (typeof Date.now !== 'function') return 0;
    const t = Date.now();
    return t > 0 ? Math.floor(t / 1000) : 0;
  } catch (e) {
    return 0;
  }
}
// @hag-core-end

// Public API: thin, non-throwing wrappers around the region. The exported interfaces are
// the region's shapes under their contract names (see g_Payload / g_Parsed for the fields).
export interface LicensePayload extends g_Payload {}
export interface ParsedLicense extends g_Parsed {}
export interface Verdict extends g_Verdict {}

export function parseLicense(raw: string): ParsedLicense {
  try {
    return g_parse(raw);
  } catch (e) {
    return { ok: false, code: 'E10', detail: 'internal parse error', raw: '', signed: [], sig: [], payload: null };
  }
}

export function verifySignature(p: ParsedLicense, pubN: string, pubE: number): boolean {
  try {
    return g_verify(p, pubN, pubE);
  } catch (e) {
    return false;
  }
}

export function liveWorldId(world: any): string | null {
  return g_live(world);
}

export function effectiveWorldId(payload: LicensePayload, live: string | null): string {
  try {
    return g_eff(payload, live);
  } catch (e) {
    return '';
  }
}

export function evaluate(p: ParsedLicense, pubN: string, pubE: number, sku: string, live: string | null, nowSec: number): Verdict {
  try {
    return g_eval(p, pubN, pubE, sku, live, nowSec);
  } catch (e) {
    return { state: 'INVALID', code: 'E10', detail: 'internal evaluate error' };
  }
}

export function contentKey(payload: LicensePayload, effectiveId: string, sku: string): number[] | null {
  try {
    return g_ck(payload, effectiveId, sku);
  } catch (e) {
    return null;
  }
}

export function openBlob(blob: string, key: number[]): number[] | null {
  return g_open(blob, key);
}

export function unlock(blob: string, rawLicense: string, pubN: string, pubE: number, sku: string, world: any): number[] | null {
  return g_unlock(blob, rawLicense, pubN, pubE, sku, world);
}

export function requestCode(sku: string, live: string | null): string {
  try {
    return g_req(sku, live);
  } catch (e) {
    return 'HAG-REQ-' + String(sku) + '-NOWID-0000';
  }
}

export function nowSeconds(): number {
  return g_now();
}
