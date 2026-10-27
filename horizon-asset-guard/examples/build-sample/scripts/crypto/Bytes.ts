// Bytes.ts
// Byte helpers for the asset-guard runtime. A "byte array" here is a plain number[] whose
// entries are integers 0..255: Horizon's script engine exposes no typed arrays, so nothing
// in runtime/ may touch Uint8Array. Also free of TextEncoder, Buffer, atob and btoa, and
// written for TypeScript 4.7 / ES2020 (no bigint, no `**`, no `??=`, no `.at()`).

const HEX = '0123456789abcdef';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// UTF-8 encode a JS string. Lone surrogates become U+FFFD, like TextEncoder does.
export function utf8ToBytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

// UTF-8 decode. Malformed sequences decode to U+FFFD (one per bad byte), like TextDecoder
// in its default non-fatal mode; overlong forms and surrogate code points are rejected the same way.
export function bytesToUtf8(bytes: number[]): string {
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let cp = -1;
    let need = 0;
    let min = 0;
    if (b0 < 0x80) {
      cp = b0;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      cp = b0 & 0x1f;
      need = 1;
      min = 0x80;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      cp = b0 & 0x0f;
      need = 2;
      min = 0x800;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      cp = b0 & 0x07;
      need = 3;
      min = 0x10000;
    }
    let j = 1;
    for (; cp >= 0 && j <= need; j++) {
      const b = i + j < bytes.length ? bytes[i + j] : 0;
      if (b < 0x80 || b > 0xbf) {
        cp = -1;
        break;
      }
      cp = (cp << 6) | (b & 0x3f);
    }
    if (cp >= 0 && (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))) cp = -1;
    if (cp < 0) {
      s += '�';
      i += 1;
      continue;
    }
    i += need + 1;
    if (cp < 0x10000) s += String.fromCharCode(cp);
    else {
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return s;
}

export function bytesToHex(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return s;
}

// Accepts upper or lower case. Throws on odd length or a non-hex character.
export function hexToBytes(hex: string): number[] {
  if (hex.length % 2 !== 0) throw new Error('hexToBytes: odd length');
  const out: number[] = new Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = (hexDigit(hex.charCodeAt(i * 2)) << 4) | hexDigit(hex.charCodeAt(i * 2 + 1));
  }
  return out;
}

function hexDigit(c: number): number {
  if (c >= 48 && c <= 57) return c - 48; // 0-9
  if (c >= 97 && c <= 102) return c - 87; // a-f
  if (c >= 65 && c <= 70) return c - 55; // A-F
  throw new Error('hexToBytes: invalid hex digit');
}

// Unpadded base64url (RFC 4648 section 5), the encoding used for license blobs and JWK keys.
export function bytesToBase64Url(bytes: number[]): string {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const hasSecond = i + 1 < bytes.length;
    const n = (bytes[i] << 16) | ((hasSecond ? bytes[i + 1] : 0) << 8);
    s += B64[n >> 18] + B64[(n >> 12) & 63];
    if (hasSecond) s += B64[(n >> 6) & 63];
  }
  return s;
}

// Decodes base64url; tolerates '=' padding and the standard '+' '/' alphabet.
// Throws on an impossible length or a character outside the alphabet.
export function base64UrlToBytes(text: string): number[] {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 61) end--; // strip '='
  if (end % 4 === 1) throw new Error('base64UrlToBytes: invalid length');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < end; i++) {
    buf = ((buf << 6) | b64Value(text.charCodeAt(i))) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return out;
}

function b64Value(c: number): number {
  if (c >= 65 && c <= 90) return c - 65; // A-Z
  if (c >= 97 && c <= 122) return c - 71; // a-z
  if (c >= 48 && c <= 57) return c + 4; // 0-9
  if (c === 45 || c === 43) return 62; // '-' or '+'
  if (c === 95 || c === 47) return 63; // '_' or '/'
  throw new Error('base64UrlToBytes: invalid character');
}

export function concatBytes(...parts: number[][]): number[] {
  const out: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    for (let j = 0; j < p.length; j++) out.push(p[j]);
  }
  return out;
}

export function bytesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
