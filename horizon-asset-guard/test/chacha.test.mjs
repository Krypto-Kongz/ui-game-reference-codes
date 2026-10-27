// Checks the pure-TypeScript ChaCha20 (runtime/crypto/ChaCha20.ts, compiled to test/out)
// against the RFC 8439 test vectors (sections 2.3.2 and 2.4.2 plus appendix A.1) and
// against Node's own `chacha20` cipher for random keys, nonces, counters and lengths.
// Build first: npm run build:test      Then: node test/chacha.test.mjs   (or: npm test)
import { createCipheriv, getCiphers, randomBytes } from 'node:crypto';
import { chacha20 } from './out/runtime/crypto/ChaCha20.js';
import { bytesEqual, utf8ToBytes } from './out/runtime/crypto/Bytes.js';

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.log('  FAIL: ' + name);
  }
}
const arr = (buf) => Array.from(buf);
const hex = (s) => arr(Buffer.from(s.replace(/[^0-9a-fA-F]/g, ''), 'hex'));
const throwsOn = (fn) => {
  try {
    fn();
    return false;
  } catch (e) {
    return true;
  }
};

// Node's raw chacha20 takes a 16-byte IV: 32-bit little-endian block counter, then the
// 12-byte nonce (the RFC 8439 layout).
const haveNodeChaCha = getCiphers().includes('chacha20');
function nodeChaCha(key, nonce, counter, data) {
  const iv = Buffer.alloc(16);
  iv.writeUInt32LE(counter, 0);
  Buffer.from(nonce).copy(iv, 4);
  const c = createCipheriv('chacha20', Buffer.from(key), iv);
  return arr(Buffer.concat([c.update(Buffer.from(data)), c.final()]));
}

// ---- RFC 8439 vectors ----
console.log('ChaCha20 RFC 8439 vectors');
const key0to31 = [];
for (let i = 0; i < 32; i++) key0to31.push(i);
const zeros = (n) => new Array(n).fill(0);
const vectors = [
  {
    name: '2.3.2 block function (key 00..1f, nonce 00:00:00:09:00:00:00:4a:00:00:00:00, counter 1)',
    key: key0to31,
    nonce: hex('00 00 00 09 00 00 00 4a 00 00 00 00'),
    counter: 1,
    plain: zeros(64),
    cipher: hex(
      '10 f1 e7 e4 d1 3b 59 15 50 0f dd 1f a3 20 71 c4 c7 d1 f4 c7 33 c0 68 03 04 22 aa 9a c3 d4 6c 4e' +
        'd2 82 64 46 07 9f aa 09 14 c2 d7 05 d9 8b 02 a2 b5 12 9c d1 de 16 4e b9 cb d0 83 e8 a2 50 3c 4e',
    ),
  },
  {
    name: '2.4.2 encryption (sunscreen)',
    key: key0to31,
    nonce: hex('00 00 00 00 00 00 00 4a 00 00 00 00'),
    counter: 1,
    plain: utf8ToBytes("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."),
    cipher: hex(
      '6e 2e 35 9a 25 68 f9 80 41 ba 07 28 dd 0d 69 81 e9 7e 7a ec 1d 43 60 c2 0a 27 af cc fd 9f ae 0b' +
        'f9 1b 65 c5 52 47 33 ab 8f 59 3d ab cd 62 b3 57 16 39 d6 24 e6 51 52 ab 8f 53 0c 35 9f 08 61 d8' +
        '07 ca 0d bf 50 0d 6a 61 56 a3 8e 08 8a 22 b6 5e 52 bc 51 4d 16 cc f8 06 81 8c e9 1a b7 79 37 36' +
        '5a f9 0b bf 74 a3 5b e6 b4 0b 8e ed f2 78 5e 42 87 4d',
    ),
  },
  {
    name: 'A.1 #1 (zero key, zero nonce, counter 0)',
    key: zeros(32),
    nonce: zeros(12),
    counter: 0,
    plain: zeros(64),
    cipher: hex(
      '76 b8 e0 ad a0 f1 3d 90 40 5d 6a e5 53 86 bd 28 bd d2 19 b8 a0 8d ed 1a a8 36 ef cc 8b 77 0d c7' +
        'da 41 59 7c 51 57 48 8d 77 24 e0 3f b8 d8 4a 37 6a 43 b8 f4 15 18 a1 1c c3 87 b6 69 b2 ee 65 86',
    ),
  },
  {
    name: 'A.1 #2 (zero key, zero nonce, counter 1)',
    key: zeros(32),
    nonce: zeros(12),
    counter: 1,
    plain: zeros(64),
    cipher: hex(
      '9f 07 e7 be 55 51 38 7a 98 ba 97 7c 73 2d 08 0d cb 0f 29 a0 48 e3 65 69 12 c6 53 3e 32 ee 7a ed' +
        '29 b7 21 76 9c e6 4e 43 d5 71 33 b0 74 d8 39 d5 31 ed 1f 28 51 0a fb 45 ac e1 0a 1f 4b 79 4d 6f',
    ),
  },
  {
    name: 'A.1 #3 (key 00..01, zero nonce, counter 1)',
    key: zeros(31).concat([1]),
    nonce: zeros(12),
    counter: 1,
    plain: zeros(64),
    cipher: hex(
      '3a eb 52 24 ec f8 49 92 9b 9d 82 8d b1 ce d4 dd 83 20 25 e8 01 8b 81 60 b8 22 84 f3 c9 49 aa 5a' +
        '8e ca 00 bb b4 a7 3b da d1 92 b5 c4 2f 73 f2 fd 4e 27 36 44 c8 b3 61 25 a6 4a dd eb 00 6c 13 a0',
    ),
  },
  {
    name: 'A.1 #5 (zero key, nonce 00..02, counter 0)',
    key: zeros(32),
    nonce: zeros(11).concat([2]),
    counter: 0,
    plain: zeros(64),
    cipher: hex(
      'c2 c6 4d 37 8c d5 36 37 4a e2 04 b9 ef 93 3f cd 1a 8b 22 88 b3 df a4 96 72 ab 76 5b 54 ee 27 c7' +
        '8a 97 0e 0e 95 5c 14 f3 a8 8e 74 1b 97 c2 86 f7 5f 8f c2 99 e8 14 83 62 fa 19 8a 39 53 1b ed 6d',
    ),
  },
];
for (const v of vectors) {
  const got = chacha20(v.key, v.nonce, v.counter, v.plain);
  check('vector ' + v.name, bytesEqual(got, v.cipher));
  check('vector ' + v.name + ' decrypts back', bytesEqual(chacha20(v.key, v.nonce, v.counter, got), v.plain));
  if (haveNodeChaCha) check('vector ' + v.name + ' agrees with node', bytesEqual(nodeChaCha(v.key, v.nonce, v.counter, v.plain), v.cipher));
}
check('vectors do not modify their input', (() => {
  const v = vectors[1];
  const copy = v.plain.slice();
  chacha20(v.key, v.nonce, v.counter, v.plain);
  return bytesEqual(copy, v.plain);
})());

// ---- random cross-check against Node ----
console.log('ChaCha20 vs node:crypto chacha20' + (haveNodeChaCha ? '' : ' (cipher unavailable in this Node build: skipped)'));
if (haveNodeChaCha) {
  const lengths = [0, 1, 2, 3, 4, 5, 31, 32, 33, 63, 64, 65, 100, 127, 128, 129, 191, 192, 193, 255, 256, 257, 1000, 4096, 20000];
  // The largest counter leaves room for the longest message without crossing 2^32 (where
  // OpenSSL carries into the nonce and RFC 8439 defines nothing).
  const counters = [0, 1, 2, 7, 1000, 65536, 2147483647, 2147483648, 4294966000];
  let agree = 0;
  let total = 0;
  for (const n of lengths) {
    for (const ctr of counters) {
      const key = arr(randomBytes(32));
      const nonce = arr(randomBytes(12));
      const data = arr(randomBytes(n));
      total++;
      if (bytesEqual(chacha20(key, nonce, ctr, data), nodeChaCha(key, nonce, ctr, data))) agree++;
      else console.log('   mismatch at length ' + n + ', counter ' + ctr);
    }
  }
  check('agrees with node for ' + total + ' (length, counter) combinations', agree === total);
  // Keystream continuity: encrypting in one call equals encrypting block by block.
  const key = arr(randomBytes(32));
  const nonce = arr(randomBytes(12));
  const data = arr(randomBytes(300));
  const whole = chacha20(key, nonce, 5, data);
  const parts = chacha20(key, nonce, 5, data.slice(0, 64)).concat(chacha20(key, nonce, 6, data.slice(64, 128)), chacha20(key, nonce, 7, data.slice(128)));
  check('block-by-block equals one call', bytesEqual(whole, parts));
  // The counter wraps modulo 2^32 (RFC 8439 leaves overflow undefined; the blobs here are
  // a few KB, so this only documents the behaviour).
  const two = chacha20(key, nonce, 4294967295, zeros(128));
  check('counter 2^32-1 then wraps to 0', bytesEqual(two.slice(0, 64), chacha20(key, nonce, 4294967295, zeros(64))) && bytesEqual(two.slice(64), chacha20(key, nonce, 0, zeros(64))));
}

// ---- argument checks ----
console.log('ChaCha20 argument checks');
const k = arr(randomBytes(32));
const nn = arr(randomBytes(12));
check('rejects a 31-byte key', throwsOn(() => chacha20(k.slice(1), nn, 1, [1, 2, 3])));
check('rejects a 33-byte key', throwsOn(() => chacha20(k.concat([0]), nn, 1, [1, 2, 3])));
check('rejects an 8-byte nonce', throwsOn(() => chacha20(k, nn.slice(0, 8), 1, [1, 2, 3])));
check('rejects a 16-byte nonce', throwsOn(() => chacha20(k, nn.concat([0, 0, 0, 0]), 1, [1, 2, 3])));
check('rejects a negative counter', throwsOn(() => chacha20(k, nn, -1, [1])));
check('rejects a fractional counter', throwsOn(() => chacha20(k, nn, 1.5, [1])));
check('rejects a counter of 2^32', throwsOn(() => chacha20(k, nn, 4294967296, [1])));
check('rejects a NaN counter', throwsOn(() => chacha20(k, nn, NaN, [1])));
check('rejects a string counter', throwsOn(() => chacha20(k, nn, '1', [1])));
check('rejects a non-array key', throwsOn(() => chacha20('k'.repeat(32), nn, 1, [1])));
check('rejects non-array data', throwsOn(() => chacha20(k, nn, 1, 'data')));
check('empty data gives empty output', chacha20(k, nn, 1, []).length === 0);
check('output is a fresh plain array of bytes', (() => {
  const d = arr(randomBytes(70));
  const o = chacha20(k, nn, 1, d);
  return Array.isArray(o) && o !== d && o.length === 70 && o.every((b) => Number.isInteger(b) && b >= 0 && b <= 255);
})());

// ---- timing ----
{
  const data = arr(randomBytes(16 * 1024));
  for (let i = 0; i < 3; i++) chacha20(k, nn, 1, data);
  const runs = 20;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) chacha20(k, nn, 1, data);
  const ms = (performance.now() - t0) / runs;
  console.log('ChaCha20 over 16 KiB in Node: ' + ms.toFixed(2) + ' ms (' + (ms / 16).toFixed(3) + ' ms/KB)');
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
