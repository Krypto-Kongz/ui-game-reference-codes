// Rsa.ts
// RSASSA-PKCS1-v1_5 signature verification with SHA-256 (RFC 8017 section 8.2.2) for Meta
// Horizon Worlds scripts, over plain number[] byte arrays. Verification only: there is no
// private key here and nothing is secret, so no constant-time care is needed.
//
// The expected encoded message EM = 0x00 0x01 FF..FF 0x00 || DigestInfo || SHA-256(message)
// is built in full and compared byte for byte with s^e mod n; the recovered EM is never
// parsed, which rules out the padding-parsing bugs of the Bleichenbacher '06 kind.

import { base64UrlToBytes, bytesEqual } from 'Bytes';
import { compareBytes, modPow } from 'BigNum';
import { sha256 } from 'Sha256';

// DER prefix of DigestInfo for SHA-256 (RFC 8017 section 9.2, note 1).
const DIGEST_INFO_SHA256: number[] = [
  0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
];
const MIN_MODULUS_BYTES = 62; // 3 framing bytes + 8 bytes of PS + 51 bytes of T

export interface RsaPublicKey {
  n: number[]; // modulus, big-endian bytes
  e: number; // public exponent (65537 typically)
}

// Builds a key from the JWK-style representation the seller tool embeds: `n` as unpadded
// base64url of the big-endian modulus bytes, `e` as a plain number.
export function rsaPublicKeyFromBase64Url(nB64: string, e: number): RsaPublicKey {
  return { n: base64UrlToBytes(nB64), e: e };
}

function isByteArray(a: number[]): boolean {
  if (!Array.isArray(a)) return false;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (typeof v !== 'number' || v < 0 || v > 255 || v !== Math.floor(v)) return false;
  }
  return true;
}

// True iff `signature` is a valid PKCS#1 v1.5 SHA-256 signature of `message` under the
// public key (modulus, exponent). Returns false, never throws, for malformed input: wrong
// signature length, s >= n, even or too-short modulus, bad exponent, non-byte entries.
export function rsaVerifyPkcs1Sha256(signature: number[], message: number[], modulus: number[], exponent: number): boolean {
  if (!isByteArray(signature) || !isByteArray(message) || !isByteArray(modulus)) return false;
  if (typeof exponent !== 'number' || exponent !== Math.floor(exponent) || exponent < 3 || exponent % 2 === 0) return false;
  if (exponent > 9007199254740991) return false;

  // Strip leading zero bytes so k is the true length of n (JWK moduli have none anyway).
  let start = 0;
  while (start < modulus.length && modulus[start] === 0) start++;
  const n = start === 0 ? modulus : modulus.slice(start);
  const k = n.length;
  if (k < MIN_MODULUS_BYTES) return false;
  if ((n[k - 1] & 1) === 0) return false;
  if (signature.length !== k) return false;
  if (compareBytes(signature, n) >= 0) return false;

  const em = modPow(signature, exponent, n);

  const expected: number[] = new Array(k);
  expected[0] = 0x00;
  expected[1] = 0x01;
  const tLen = DIGEST_INFO_SHA256.length + 32;
  const psEnd = k - tLen - 1;
  for (let i = 2; i < psEnd; i++) expected[i] = 0xff;
  expected[psEnd] = 0x00;
  let p = psEnd + 1;
  for (let i = 0; i < DIGEST_INFO_SHA256.length; i++) expected[p++] = DIGEST_INFO_SHA256[i];
  const digest = sha256(message);
  for (let i = 0; i < 32; i++) expected[p++] = digest[i];

  return bytesEqual(em, expected);
}
