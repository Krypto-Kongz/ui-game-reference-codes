// Cross-checks the pure-TypeScript SHA-256 / BigNum / RSA PKCS#1 v1.5 / byte helpers against
// Node's crypto and BigInt (Node 18+).
// Build first (one line): npm run build:test      Then: node test/crypto.test.mjs
// Or lint + build + test:  npm test
import { constants, createHash, generateKeyPairSync, randomBytes, sign, verify as nodeVerify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256 } from './out/runtime/crypto/Sha256.js';
import { compareBytes, limbCountForBytes, limbsFromBytes, limbsToBytes, modPow, modReduce } from './out/runtime/crypto/BigNum.js';
import { rsaPublicKeyFromBase64Url, rsaVerifyPkcs1Sha256 } from './out/runtime/crypto/Rsa.js';
import {
  base64UrlToBytes,
  bytesEqual,
  bytesToBase64Url,
  bytesToHex,
  bytesToUtf8,
  concatBytes,
  hexToBytes,
  utf8ToBytes,
} from './out/runtime/crypto/Bytes.js';

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.log('  FAIL: ' + name);
  }
}
const arr = (buf) => Array.from(buf); // Buffer -> plain number[]
const hexOf = (a) => Buffer.from(a).toString('hex');
const flipBit = (a, bitIndex) => {
  const copy = a.slice();
  copy[bitIndex >> 3] ^= 1 << (bitIndex & 7);
  return copy;
};
const bytesToBigInt = (a) => (a.length === 0 ? 0n : BigInt('0x' + hexOf(a)));
const LIMB_BITS = 25; // must match BigNum.ts
const LIMB_BASE = 1 << LIMB_BITS;
const limbsToBigInt = (limbs) => limbs.reduce((acc, l, i) => acc + (BigInt(l) << BigInt(LIMB_BITS * i)), 0n);
function bigIntToBytes(x, len) {
  let h = x.toString(16);
  if (h.length % 2) h = '0' + h;
  const b = arr(Buffer.from(h, 'hex'));
  if (b.length > len) throw new Error('bigIntToBytes: does not fit');
  return new Array(len - b.length).fill(0).concat(b);
}
function bigModPow(b, e, m) {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    e >>= 1n;
    b = (b * b) % m;
  }
  return r;
}
function randomOddBytes(len) {
  const b = arr(randomBytes(len));
  b[len - 1] |= 1;
  return b;
}
// RSA key as the seller tool embeds it: JWK n (base64url) and e as a number.
function embeddedKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  const eBytes = base64UrlToBytes(jwk.e);
  let e = 0;
  for (const b of eBytes) e = e * 256 + b;
  return { nB64: jwk.n, n: base64UrlToBytes(jwk.n), e };
}
const pkcs1Sign = (privateKey, msg) => arr(sign('sha256', Buffer.from(msg), { key: privateKey, padding: constants.RSA_PKCS1_PADDING }));

// ---- SHA-256 against Node ----
console.log('SHA-256');
const shaLengths = [0, 1, 2, 3, 31, 32, 33, 54, 55, 56, 57, 63, 64, 65, 100, 111, 119, 120, 127, 128, 129, 255, 256, 1000, 5000, 70000];
for (const n of shaLengths) {
  const msg = arr(randomBytes(n));
  const expected = createHash('sha256').update(Buffer.from(msg)).digest('hex');
  check('sha256 of ' + n + ' random bytes', hexOf(sha256(msg)) === expected);
}
check('sha256("") known answer', hexOf(sha256([])) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
check('sha256("abc") known answer', hexOf(sha256(utf8ToBytes('abc'))) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
check(
  'sha256 of the 56-byte NIST message',
  hexOf(sha256(utf8ToBytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))) ===
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
);
check('sha256 does not modify its input', (() => {
  const m = [1, 2, 3];
  sha256(m);
  return m.length === 3 && m[0] === 1;
})());

// ---- Bytes helpers ----
console.log('Bytes helpers');
const strings = ['', 'a', 'abc', 'héllo wörld', '日本語', 'emoji \u{1F600} end', 'lone\ud800surrogate', '\u0000\u007f\u0080߿ࠀ￿'];
for (const s of strings) {
  const expected = arr(Buffer.from(s, 'utf8'));
  check('utf8ToBytes(' + JSON.stringify(s) + ')', bytesEqual(utf8ToBytes(s), expected));
  check('bytesToUtf8 round trip of ' + JSON.stringify(s), bytesToUtf8(utf8ToBytes(s)) === Buffer.from(expected).toString('utf8'));
}
check('bytesToUtf8 replaces malformed bytes', bytesToUtf8([0x61, 0xff, 0xc0, 0x80, 0x62]) === Buffer.from([0x61, 0xff, 0xc0, 0x80, 0x62]).toString('utf8'));
for (const n of [0, 1, 2, 3, 4, 5, 6, 31, 32, 33, 256, 1000]) {
  const b = arr(randomBytes(n));
  const buf = Buffer.from(b);
  check('hex round trip ' + n, bytesToHex(b) === buf.toString('hex') && bytesEqual(hexToBytes(bytesToHex(b)), b));
  check('hex accepts upper case ' + n, bytesEqual(hexToBytes(bytesToHex(b).toUpperCase()), b));
  const b64 = bytesToBase64Url(b);
  check('base64url matches Buffer ' + n, b64 === buf.toString('base64url'));
  check('base64url round trip ' + n, bytesEqual(base64UrlToBytes(b64), b));
  check('base64url accepts padded standard alphabet ' + n, bytesEqual(base64UrlToBytes(buf.toString('base64')), b));
}
check('base64url rejects an impossible length', (() => {
  try {
    base64UrlToBytes('A');
    return false;
  } catch (e) {
    return true;
  }
})());
check('base64url rejects a bad character', (() => {
  try {
    base64UrlToBytes('AB*C');
    return false;
  } catch (e) {
    return true;
  }
})());
check('hexToBytes rejects odd length', (() => {
  try {
    hexToBytes('abc');
    return false;
  } catch (e) {
    return true;
  }
})());
check('concatBytes', bytesEqual(concatBytes([1, 2], [], [3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]));
check('concatBytes of nothing', concatBytes().length === 0);
check('bytesEqual equal', bytesEqual([1, 2, 3], [1, 2, 3]));
check('bytesEqual different value', !bytesEqual([1, 2, 3], [1, 2, 4]));
check('bytesEqual different length', !bytesEqual([1, 2, 3], [1, 2]));
check('bytesEqual empty', bytesEqual([], []));

// ---- BigNum against BigInt ----
console.log('BigNum (modPow vs BigInt)');
for (const len of [1, 2, 3, 4, 7, 13, 32, 33, 100, 256, 384, 512]) {
  const b = arr(randomBytes(len));
  const limbs = limbsFromBytes(b, limbCountForBytes(len));
  check('limbs round trip ' + len, bytesEqual(limbsToBytes(limbs, len), b) && limbs.every((l) => l >= 0 && l < LIMB_BASE) && bytesToBigInt(b) === limbsToBigInt(limbs));
}
check('compareBytes ignores leading zeros', compareBytes([0, 0, 1, 2], [1, 2]) === 0 && compareBytes([1, 3], [0, 1, 2]) === 1 && compareBytes([], [0]) === 0 && compareBytes([0, 1], [2]) === -1);
check('modPow with exponent 0', bytesEqual(modPow([5, 5], 0, [0, 7]), [0, 1]) && bytesEqual(modPow([5, 5], 0, [1]), [0]));
check('modPow with exponent 1 reduces the base', bytesEqual(modPow([1, 0], 1, [0, 7]), [0, 256 % 7]));
check('modPow with a zero base', bytesEqual(modPow([0, 0], 65537, [1, 1]), [0, 0]));
check('modPow with an empty base', bytesEqual(modPow([], 65537, [1, 1]), [0, 0]));
check('modPow rejects an even modulus', (() => {
  try {
    modPow([1], 3, [2]);
    return false;
  } catch (e) {
    return true;
  }
})());
check('modPow rejects a zero modulus', (() => {
  try {
    modPow([1], 3, [0, 0]);
    return false;
  } catch (e) {
    return true;
  }
})());
// Exhaustive small cases: every odd modulus below 300 with every base below 2*modulus.
let smallOk = true;
for (let m = 1; m < 300 && smallOk; m += 2) {
  for (let b = 0; b < 2 * m && smallOk; b++) {
    for (const e of [1, 2, 3, 17, 65537]) {
      const got = modPow(bigIntToBytes(BigInt(b), 2), e, bigIntToBytes(BigInt(m), 2));
      if (bytesToBigInt(got) !== bigModPow(BigInt(b), BigInt(e), BigInt(m))) {
        smallOk = false;
        console.log('   mismatch b=' + b + ' e=' + e + ' m=' + m);
        break;
      }
    }
  }
}
check('modPow matches BigInt for all small odd moduli', smallOk);
// Random pairs of various widths, bases both shorter and longer than the modulus.
let randomOk = 0;
const pairs = 200;
for (let i = 0; i < pairs; i++) {
  const modLen = [1, 2, 3, 4, 5, 8, 13, 16, 32, 64, 128, 129, 256, 384, 512][i % 15];
  const mod = randomOddBytes(modLen);
  if (i % 7 === 0 && modLen > 1) mod[0] = 0; // leading zero byte in the modulus
  if (i % 5 === 0 && modLen > 1) mod[0] &= 0x01; // small top limb (exercises normalisation)
  const baseLen = i % 3 === 0 ? modLen + 1 + (i % 4) : i % 3 === 1 ? Math.max(1, modLen - (i % 3)) : modLen;
  const base = arr(randomBytes(baseLen));
  const e = [3, 17, 65537][i % 3];
  const got = modPow(base, e, mod);
  const want = bigModPow(bytesToBigInt(base), BigInt(e), bytesToBigInt(mod));
  if (got.length === modLen && bytesToBigInt(got) === want) randomOk++;
  else console.log('   mismatch at pair ' + i + ' (modLen=' + modLen + ', baseLen=' + baseLen + ', e=' + e + ')');
}
check('modPow matches BigInt for ' + pairs + ' random (base, mod) pairs', randomOk === pairs);
// Edge values around the modulus for a 2048-bit modulus and e = 65537.
{
  const mod = randomOddBytes(256);
  mod[0] |= 0x80;
  const N = bytesToBigInt(mod);
  const cases = { zero: 0n, one: 1n, two: 2n, 'n-1': N - 1n, 'n-2': N - 2n, n: N, 'n+1': N + 1n, '2n-1': 2n * N - 1n, '2n+1': 2n * N + 1n };
  for (const name of Object.keys(cases)) {
    const base = bigIntToBytes(cases[name], 257);
    for (const e of [3, 17, 65537]) {
      check('modPow edge base ' + name + ' e=' + e, bytesToBigInt(modPow(base, e, mod)) === bigModPow(cases[name], BigInt(e), N));
    }
  }
  check('modReduce of a 4-limb value by a 2-limb modulus', (() => {
    const n = [LIMB_BASE - 1, 0x1];
    const a = [0x1234567, 0x0345678, 0x1456789, 0x0abcdef];
    return limbsToBigInt(modReduce(a, n)) === limbsToBigInt(a) % limbsToBigInt(n);
  })());
  check('modReduce with a top limb of 1 (maximal normalisation shift)', (() => {
    const n = [0x1234567, 0x1abcdef, 0x1];
    const a = [LIMB_BASE - 1, LIMB_BASE - 1, LIMB_BASE - 1, LIMB_BASE - 1, LIMB_BASE - 1, 0x3];
    return limbsToBigInt(modReduce(a, n)) === limbsToBigInt(a) % limbsToBigInt(n);
  })());
}

// ---- RSA PKCS#1 v1.5 with SHA-256 ----
console.log('RSA PKCS#1 v1.5 / SHA-256 verify (Node-generated keys and signatures)');
const key2048 = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key2048b = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key3072 = generateKeyPairSync('rsa', { modulusLength: 3072 });
const key4096 = generateKeyPairSync('rsa', { modulusLength: 4096 });
const key2048e3 = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 3 });
const key2048e17 = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 17 });
const pub = embeddedKey(key2048.publicKey);
check('embedded 2048-bit key has 256 modulus bytes and e = 65537', pub.n.length === 256 && pub.e === 65537);
const msgLengths = [0, 1, 31, 32, 33, 55, 56, 63, 64, 65, 100, 5000];
for (const n of msgLengths) {
  const msg = arr(randomBytes(n));
  const sig = pkcs1Sign(key2048.privateKey, msg);
  check('node verifies its own ' + n + '-byte signature', nodeVerify('sha256', Buffer.from(msg), { key: key2048.publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(sig)));
  check('verify ' + n + '-byte message (2048, e=65537)', rsaVerifyPkcs1Sha256(sig, msg, pub.n, pub.e) === true);
}
for (const [label, key] of [['3072', key3072], ['4096', key4096], ['2048 e=3', key2048e3], ['2048 e=17', key2048e17]]) {
  const k = embeddedKey(key.publicKey);
  const msg = utf8ToBytes('license:' + label);
  const sig = pkcs1Sign(key.privateKey, msg);
  check('verify with ' + label + ' key (e=' + k.e + ', ' + k.n.length + ' bytes)', rsaVerifyPkcs1Sha256(sig, msg, k.n, k.e) === true);
  check('reject flipped signature bit with ' + label + ' key', rsaVerifyPkcs1Sha256(flipBit(sig, 777), msg, k.n, k.e) === false);
}
check('rsaPublicKeyFromBase64Url builds the same key', (() => {
  const k = rsaPublicKeyFromBase64Url(pub.nB64, pub.e);
  const msg = utf8ToBytes('hello');
  return bytesEqual(k.n, pub.n) && k.e === 65537 && rsaVerifyPkcs1Sha256(pkcs1Sign(key2048.privateKey, msg), msg, k.n, k.e);
})());
check('verify accepts a modulus with leading zero bytes', (() => {
  const msg = utf8ToBytes('padded modulus');
  return rsaVerifyPkcs1Sha256(pkcs1Sign(key2048.privateKey, msg), msg, [0, 0].concat(pub.n), pub.e);
})());

console.log('RSA negative tests');
{
  const msg = utf8ToBytes('The quick brown fox jumps over the lazy dog');
  const sig = pkcs1Sign(key2048.privateKey, msg);
  check('control: good signature verifies', rsaVerifyPkcs1Sha256(sig, msg, pub.n, pub.e) === true);
  for (const bit of [0, 1, 7, 8, 1000, 2047]) check('reject flipped signature bit ' + bit, rsaVerifyPkcs1Sha256(flipBit(sig, bit), msg, pub.n, pub.e) === false);
  for (const bit of [0, 5, 100, 343]) check('reject flipped message bit ' + bit, rsaVerifyPkcs1Sha256(sig, flipBit(msg, bit), pub.n, pub.e) === false);
  for (const bit of [1, 2, 1024, 2046]) check('reject flipped modulus bit ' + bit, rsaVerifyPkcs1Sha256(sig, msg, flipBit(pub.n, bit), pub.e) === false);
  check('reject flipped modulus bit 0 (even modulus)', rsaVerifyPkcs1Sha256(sig, msg, flipBit(pub.n, 0), pub.e) === false);
  const pubB = embeddedKey(key2048b.publicKey);
  check('reject wrong key', rsaVerifyPkcs1Sha256(sig, msg, pubB.n, pubB.e) === false);
  check('reject signature from the wrong key', rsaVerifyPkcs1Sha256(pkcs1Sign(key2048b.privateKey, msg), msg, pub.n, pub.e) === false);
  check('reject all-zero signature', rsaVerifyPkcs1Sha256(new Array(256).fill(0), msg, pub.n, pub.e) === false);
  check('reject signature of all ones (0x01)', rsaVerifyPkcs1Sha256(new Array(256).fill(1), msg, pub.n, pub.e) === false);
  check('reject signature == n', rsaVerifyPkcs1Sha256(pub.n.slice(), msg, pub.n, pub.e) === false);
  check('reject signature == n + 1', rsaVerifyPkcs1Sha256(bigIntToBytes(bytesToBigInt(pub.n) + 1n, 256), msg, pub.n, pub.e) === false);
  check('reject signature == n - 1', rsaVerifyPkcs1Sha256(bigIntToBytes(bytesToBigInt(pub.n) - 1n, 256), msg, pub.n, pub.e) === false);
  check('reject signature of all 0xff (> n)', rsaVerifyPkcs1Sha256(new Array(256).fill(255), msg, pub.n, pub.e) === false);
  check('reject signature one byte short', rsaVerifyPkcs1Sha256(sig.slice(1), msg, pub.n, pub.e) === false);
  check('reject signature one byte long (leading zero)', rsaVerifyPkcs1Sha256([0].concat(sig), msg, pub.n, pub.e) === false);
  check('reject signature one byte long (trailing zero)', rsaVerifyPkcs1Sha256(sig.concat([0]), msg, pub.n, pub.e) === false);
  check('reject empty signature', rsaVerifyPkcs1Sha256([], msg, pub.n, pub.e) === false);
  check('reject wrong exponent 3', rsaVerifyPkcs1Sha256(sig, msg, pub.n, 3) === false);
  check('reject wrong exponent 65539', rsaVerifyPkcs1Sha256(sig, msg, pub.n, 65539) === false);
  check('reject even exponent', rsaVerifyPkcs1Sha256(sig, msg, pub.n, 65536) === false);
  check('reject exponent 1', rsaVerifyPkcs1Sha256(sig, msg, pub.n, 1) === false);
  check('reject exponent 0', rsaVerifyPkcs1Sha256(sig, msg, pub.n, 0) === false);
  check('reject non-integer exponent', rsaVerifyPkcs1Sha256(sig, msg, pub.n, 65537.5) === false);
  check('reject NaN exponent', rsaVerifyPkcs1Sha256(sig, msg, pub.n, NaN) === false);
  check('reject modulus shorter than 62 bytes', rsaVerifyPkcs1Sha256(sig.slice(0, 61), msg, pub.n.slice(0, 61).map((b, i) => (i === 60 ? b | 1 : b)), pub.e) === false);
  check('reject empty modulus', rsaVerifyPkcs1Sha256(sig, msg, [], pub.e) === false);
  check('reject non-byte values in the signature', rsaVerifyPkcs1Sha256(sig.map((b, i) => (i === 3 ? 256 : b)), msg, pub.n, pub.e) === false);
  check('reject non-array signature', rsaVerifyPkcs1Sha256('not bytes', msg, pub.n, pub.e) === false);
  check('reject a message with an extra byte', rsaVerifyPkcs1Sha256(sig, msg.concat([0]), pub.n, pub.e) === false);
  check('reject the empty message for a non-empty signature', rsaVerifyPkcs1Sha256(sig, [], pub.n, pub.e) === false);
  // A PKCS#1 v1.5 signature over the same hash but with a different (also valid) key's modulus must not cross-verify.
  const pub3 = embeddedKey(key3072.publicKey);
  check('reject a 2048-bit signature against the 3072-bit key', rsaVerifyPkcs1Sha256(sig, msg, pub3.n, pub3.e) === false);
  // Forged EM with too-short padding (Bleichenbacher-style) under e = 3 must fail, since the full EM is compared.
  const pubE3 = embeddedKey(key2048e3.publicKey);
  const digest = sha256(msg);
  const forgedEm = [0, 1, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20].concat(digest);
  while (forgedEm.length < 256) forgedEm.push(0);
  const root = cubeRootFloor(bytesToBigInt(forgedEm));
  check('reject e=3 cube-root forgery with short padding', rsaVerifyPkcs1Sha256(bigIntToBytes(root, 256), msg, pubE3.n, pubE3.e) === false && rsaVerifyPkcs1Sha256(bigIntToBytes(root + 1n, 256), msg, pubE3.n, pubE3.e) === false);
}
function cubeRootFloor(x) {
  let lo = 0n;
  let hi = 1n << BigInt(Math.ceil(x.toString(2).length / 3) + 1);
  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    if (mid * mid * mid <= x) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

// ---- lint-runtime self-test ----
console.log('lint-runtime guard');
{
  const dir = mkdtempSync(join(tmpdir(), 'hag-lint-'));
  const lint = join(new URL('.', import.meta.url).pathname, 'lint-runtime.mjs');
  writeFileSync(join(dir, 'Clean.ts'), "// Uint8Array, BigInt, 10n, ** and eval( in a comment are fine\n/* so is setTimeout(\n   in a block comment */\nexport const x = 'no typed arrays here';\nexport function f(a: number[]): number { return a[0] + 1; }\n");
  const clean = spawnSync(process.execPath, [lint, dir], { encoding: 'utf8' });
  check('lint passes a clean file', clean.status === 0);
  const bad = [
    'export const a = new Uint8Array(4);',
    'export const b = 2 ** 10;',
    'export const c = 10n;',
    'export const d = BigInt(1);',
    'export const e = [1].at(0);',
    'export const f = setTimeout(() => {}, 1);',
    'export const g = new Proxy({}, {});',
    'export const h = eval("1");',
    'export const i = "a".replaceAll("a", "b");',
    'let j = 0; j ||= 1; export { j };',
  ];
  let caught = 0;
  for (let i = 0; i < bad.length; i++) {
    writeFileSync(join(dir, 'Clean.ts'), bad[i] + '\n');
    const r = spawnSync(process.execPath, [lint, dir], { encoding: 'utf8' });
    if (r.status === 1) caught++;
    else console.log('   lint missed: ' + bad[i]);
  }
  check('lint catches every forbidden construct (' + bad.length + ')', caught === bad.length);
  writeFileSync(join(dir, 'Clean.ts'), 'export class A { async: { setTimeout: (f: () => void, ms: number) => number } | null = null; go(): void { if (this.async) this.async.setTimeout(() => {}, 1); } }\n');
  check('lint allows this.async.setTimeout(', spawnSync(process.execPath, [lint, dir], { encoding: 'utf8' }).status === 0);
  writeFileSync(join(dir, 'Clean.ts'), "export const s = 'Uint8Array named in a string is still flagged';\n");
  check('lint flags forbidden names inside strings (comments only are exempt)', spawnSync(process.execPath, [lint, dir], { encoding: 'utf8' }).status === 1);
  writeFileSync(join(dir, 'Clean.ts'), 'export const big = "' + 'x'.repeat(26 * 1024) + '";\n');
  check('lint flags a script over 25 KB', spawnSync(process.execPath, [lint, dir], { encoding: 'utf8' }).status === 1);
  rmSync(dir, { recursive: true, force: true });
}

// ---- timing ----
{
  const msg = utf8ToBytes('timing message');
  const sig = pkcs1Sign(key2048.privateKey, msg);
  const runs = 100;
  for (let i = 0; i < 5; i++) rsaVerifyPkcs1Sha256(sig, msg, pub.n, pub.e); // warm-up
  const t0 = performance.now();
  let ok = 0;
  for (let i = 0; i < runs; i++) ok += rsaVerifyPkcs1Sha256(sig, msg, pub.n, pub.e) ? 1 : 0;
  const ms = (performance.now() - t0) / runs;
  check('timing loop verified every run', ok === runs);
  console.log('Mean RSA-2048 (e=65537) verify time in Node over ' + runs + ' runs: ' + ms.toFixed(3) + ' ms');
  const pub3 = embeddedKey(key3072.publicKey);
  const sig3 = pkcs1Sign(key3072.privateKey, msg);
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) rsaVerifyPkcs1Sha256(sig3, msg, pub3.n, pub3.e);
  console.log('Mean RSA-3072 verify time in Node over 20 runs: ' + ((performance.now() - t1) / 20).toFixed(3) + ' ms');
  const big = arr(randomBytes(1 << 20));
  const t2 = performance.now();
  sha256(big);
  console.log('SHA-256 of 1 MiB in Node: ' + (performance.now() - t2).toFixed(1) + ' ms');
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
