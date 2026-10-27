// No-JIT benchmark and typed-array-free run of the runtime crypto.
//
// Concatenates the tsc output of runtime/crypto (imports/exports stripped; test-only, never
// shipped) into one plain script, loads it in QuickJS (quickjs-emscripten, a WASM bytecode
// interpreter with no JIT, standing in for Horizon's script engine) after deleting the
// globals Horizon lacks (every typed array, BigInt, Proxy, eval, ...), verifies a vector set
// generated here with Node's crypto, and times RSA verifies, SHA-256 and ChaCha20. Exit code
// 1 on any mismatch. The QuickJS loading and bundling live in test/quickjs-host.mjs, shared
// with test/e2e.test.mjs (which runs a real buyer module's unlock the same way).
//
// Usage: npm run bench:quickjs            (builds first)
//        node test/quickjs.bench.mjs [iterations]   (default 20)
import { constants, createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREAMBLE, bundleModules, evalOrThrow, loadQuickJS, sandboxOk } from './quickjs-host.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out', 'runtime', 'crypto');
const ITERS = Math.max(1, Number(process.argv[2] || 20));

// ---- 1. bundle: plain concatenation of the ES2020 module output ----
const ORDER = ['Bytes', 'Sha256', 'BigNum', 'Rsa', 'ChaCha20'];
const bundle = bundleModules(
  ORDER.map((name) => join(outDir, name + '.js')),
  { epilogue: 'globalThis.__hag = { rsaVerifyPkcs1Sha256: rsaVerifyPkcs1Sha256, sha256: sha256, modPow: modPow, chacha20: chacha20, hexToBytes: hexToBytes, bytesToHex: bytesToHex };' },
);

// ---- 2. vectors from Node's crypto ----
function makeVectors() {
  const hex = (b) => Buffer.from(b).toString('hex');
  const pkcs1 = (priv, msg) => sign('sha256', msg, { key: priv, padding: constants.RSA_PKCS1_PADDING });
  const embed = (pub) => {
    const jwk = pub.export({ format: 'jwk' });
    const eBytes = Buffer.from(jwk.e, 'base64url');
    let e = 0;
    for (const b of eBytes) e = e * 256 + b;
    return { n: Buffer.from(jwk.n, 'base64url').toString('hex'), e };
  };
  const keys = {
    rsa2048: generateKeyPairSync('rsa', { modulusLength: 2048 }),
    rsa2048b: generateKeyPairSync('rsa', { modulusLength: 2048 }),
    rsa2048e3: generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 3 }),
    rsa3072: generateKeyPairSync('rsa', { modulusLength: 3072 }),
  };
  const pub = {};
  for (const k of Object.keys(keys)) pub[k] = embed(keys[k].publicKey);
  const rsa = [];
  const add = (name, key, msg, sig, n, e, expect) => rsa.push({ name, msg: hex(msg), sig: hex(sig), n, e, expect });
  for (const len of [0, 1, 55, 56, 64, 100, 5000]) {
    const msg = randomBytes(len);
    add('2048 e=65537 msg ' + len, 'rsa2048', msg, pkcs1(keys.rsa2048.privateKey, msg), pub.rsa2048.n, pub.rsa2048.e, true);
  }
  const msg = Buffer.from('horizon asset guard license');
  const sig = pkcs1(keys.rsa2048.privateKey, msg);
  add('2048 e=3', 'rsa2048e3', msg, pkcs1(keys.rsa2048e3.privateKey, msg), pub.rsa2048e3.n, pub.rsa2048e3.e, true);
  add('3072 e=65537', 'rsa3072', msg, pkcs1(keys.rsa3072.privateKey, msg), pub.rsa3072.n, pub.rsa3072.e, true);
  const flip = (buf, bit) => {
    const c = Buffer.from(buf);
    c[bit >> 3] ^= 1 << (bit & 7);
    return c;
  };
  add('neg: flipped sig bit', 'rsa2048', msg, flip(sig, 1000), pub.rsa2048.n, pub.rsa2048.e, false);
  add('neg: flipped msg bit', 'rsa2048', flip(msg, 9), sig, pub.rsa2048.n, pub.rsa2048.e, false);
  add('neg: flipped modulus bit', 'rsa2048', msg, sig, hex(flip(Buffer.from(pub.rsa2048.n, 'hex'), 500)), pub.rsa2048.e, false);
  add('neg: wrong key', 'rsa2048b', msg, sig, pub.rsa2048b.n, pub.rsa2048b.e, false);
  add('neg: all-zero sig', 'rsa2048', msg, Buffer.alloc(256), pub.rsa2048.n, pub.rsa2048.e, false);
  add('neg: sig == n', 'rsa2048', msg, Buffer.from(pub.rsa2048.n, 'hex'), pub.rsa2048.n, pub.rsa2048.e, false);
  add('neg: sig all 0xff (> n)', 'rsa2048', msg, Buffer.alloc(256, 0xff), pub.rsa2048.n, pub.rsa2048.e, false);
  add('neg: sig one byte short', 'rsa2048', msg, sig.subarray(1), pub.rsa2048.n, pub.rsa2048.e, false);
  add('neg: wrong exponent', 'rsa2048', msg, sig, pub.rsa2048.n, 3, false);
  const sha = [];
  for (const len of [0, 3, 55, 56, 63, 64, 65, 1000]) {
    const m = randomBytes(len);
    sha.push({ len, msg: hex(m), digest: createHash('sha256').update(m).digest('hex') });
  }
  // RFC 8439 2.4.2: the "sunscreen" ciphertext under key 00..1f, nonce 00000000:0000004a:00000000, counter 1.
  const chacha = {
    key: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    nonce: '000000000000004a00000000',
    plain: hex(Buffer.from("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.")),
    cipher: '6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0bf91b65c5524733ab8f593dabcd62b3571639d624e65152ab8f530c359f0861d807ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab77937365af90bbf74a35be6b40b8eedf2785e42874d',
  };
  return { rsa, sha, chacha, timing: { name: '2048 e=65537', ...rsa[0] }, timing3072: rsa.find((v) => v.name === '3072 e=65537'), timingE3: rsa.find((v) => v.name === '2048 e=3') };
}

// ---- 3. run inside QuickJS ----
const RUN = (vectorsJson, iters) => `
(function () {
  var V = JSON.parse(${JSON.stringify(vectorsJson)});
  var H = globalThis.__hag;
  var failures = [];
  var rsaOk = 0;
  for (var i = 0; i < V.rsa.length; i++) {
    var v = V.rsa[i];
    var got = H.rsaVerifyPkcs1Sha256(H.hexToBytes(v.sig), H.hexToBytes(v.msg), H.hexToBytes(v.n), v.e);
    if (got === v.expect) rsaOk++; else failures.push('rsa "' + v.name + '" got ' + got + ' expected ' + v.expect);
  }
  var shaOk = 0;
  for (var j = 0; j < V.sha.length; j++) {
    var s = V.sha[j];
    if (H.bytesToHex(H.sha256(H.hexToBytes(s.msg))) === s.digest) shaOk++; else failures.push('sha256 len ' + s.len);
  }
  var cc = H.bytesToHex(H.chacha20(H.hexToBytes(V.chacha.key), H.hexToBytes(V.chacha.nonce), 1, H.hexToBytes(V.chacha.plain)));
  var chachaOk = cc === V.chacha.cipher;
  if (!chachaOk) failures.push('chacha20 RFC 8439 2.4.2 vector mismatch');
  function time(vec, n) {
    var sig = H.hexToBytes(vec.sig), msg = H.hexToBytes(vec.msg), mod = H.hexToBytes(vec.n);
    H.rsaVerifyPkcs1Sha256(sig, msg, mod, vec.e);
    var t0 = Date.now();
    var ok = 0;
    for (var k = 0; k < n; k++) ok += H.rsaVerifyPkcs1Sha256(sig, msg, mod, vec.e) ? 1 : 0;
    var dt = Date.now() - t0;
    if (ok !== n) failures.push('timing loop for ' + vec.name + ' verified ' + ok + '/' + n);
    return dt / n;
  }
  var ms2048 = time(V.timing, ${iters});
  var msE3 = time(V.timingE3, ${iters});
  var ms3072 = time(V.timing3072, ${Math.max(1, Math.ceil(iters / 4))});
  var big = [];
  for (var b = 0; b < 65536; b++) big.push(b & 255);
  var tS = Date.now();
  H.sha256(big);
  var shaMs = Date.now() - tS;
  var data = big.slice(0, 16384);
  var key = H.hexToBytes(V.chacha.key), nonce = H.hexToBytes(V.chacha.nonce);
  var tC = Date.now();
  H.chacha20(key, nonce, 1, data);
  var chachaMs = Date.now() - tC;
  return JSON.stringify({ rsaOk: rsaOk, rsaTotal: V.rsa.length, shaOk: shaOk, shaTotal: V.sha.length, chachaOk: chachaOk, failures: failures,
    ms2048: ms2048, msE3: msE3, ms3072: ms3072, sha64kMs: shaMs, chacha16kMs: chachaMs });
})()`;

const vectors = makeVectors();
const { mod, from } = await loadQuickJS();
const QuickJS = await mod.getQuickJS();
const ctx = QuickJS.newContext();
let exitCode = 0;
try {
  const env = JSON.parse(evalOrThrow(ctx, PREAMBLE, 'preamble'));
  console.log('QuickJS (' + from + ')');
  console.log('  globals deleted; still defined: ' + (env.remaining.length ? env.remaining.join(', ') : 'none') + '; new Uint8Array -> ' + env.canary + '; typeof BigInt=' + env.bigint + ' Proxy=' + env.proxy + ' eval=' + env.evalType);
  if (!sandboxOk(env)) exitCode = 1;
  const t0 = performance.now();
  evalOrThrow(ctx, bundle, 'bundle load');
  const load = performance.now() - t0;
  console.log('  bundle: ' + bundle.length + ' bytes of plain ES2020 (' + ORDER.join('+') + ', test-only concatenation), load ' + load.toFixed(1) + ' ms');
  const t1 = performance.now();
  const res = JSON.parse(evalOrThrow(ctx, RUN(JSON.stringify(vectors), ITERS), 'run'));
  const wall = performance.now() - t1;
  console.log('  vectors: RSA ' + res.rsaOk + '/' + res.rsaTotal + ' as expected, SHA-256 ' + res.shaOk + '/' + res.shaTotal + ' match, ChaCha20 RFC 8439 2.4.2 ' + (res.chachaOk ? 'match' : 'MISMATCH'));
  for (const f of res.failures) console.log('  FAIL: ' + f);
  if (res.failures.length || res.rsaOk !== res.rsaTotal || res.shaOk !== res.shaTotal || !res.chachaOk) exitCode = 1;
  console.log('  RSA-2048 e=65537 verify: ' + res.ms2048.toFixed(2) + ' ms mean over ' + ITERS + ' runs (no JIT, typed arrays/BigInt deleted)');
  console.log('  RSA-2048 e=3 verify:     ' + res.msE3.toFixed(2) + ' ms mean over ' + ITERS + ' runs');
  console.log('  RSA-3072 e=65537 verify: ' + res.ms3072.toFixed(2) + ' ms mean over ' + Math.max(1, Math.ceil(ITERS / 4)) + ' runs');
  console.log('  SHA-256 of 64 KiB:       ' + res.sha64kMs + ' ms');
  console.log('  ChaCha20 over 16 KiB:    ' + res.chacha16kMs + ' ms (' + (res.chacha16kMs / 16).toFixed(2) + ' ms/KB)');
  console.log('  host wall time for the whole run step: ' + wall.toFixed(0) + ' ms');
} catch (e) {
  console.log('  ERROR: ' + e.message);
  exitCode = 1;
} finally {
  ctx.dispose();
}
console.log(exitCode === 0 ? 'quickjs bench: OK' : 'quickjs bench: FAILED');
process.exit(exitCode);
