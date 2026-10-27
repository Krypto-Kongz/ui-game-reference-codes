# runtime/crypto

Pure TypeScript RSA signature *verification* for Meta Horizon Worlds scripts; the asset-guard license check uses it to confirm a license blob was signed by the seller's key. Verification only: no private keys, nothing secret, so no constant-time care is needed.

| File | Lines | Bytes | What |
| --- | ---: | ---: | --- |
| `Bytes.ts` | 164 | 5.5 KB | `utf8ToBytes`, `bytesToUtf8`, `bytesToHex`/`hexToBytes`, `bytesToBase64Url`/`base64UrlToBytes` (unpadded output; accepts `=` padding and the `+/` alphabet), `concatBytes`, `bytesEqual` |
| `Sha256.ts` | 108 | 4.5 KB | `sha256(data: number[]): number[]`, FIPS 180-4, one reused message schedule, blocks hashed straight from the input |
| `BigNum.ts` | 280 | 10.2 KB | `modPow(base, exp, mod)` over big-endian byte arrays plus `limbsFromBytes`/`limbsToBytes`, `compareBytes`, `compareLimbs`, `modReduce` |
| `Rsa.ts` | 73 | 3.3 KB | `rsaVerifyPkcs1Sha256(signature, message, modulus, exponent): boolean`, `rsaPublicKeyFromBase64Url(nB64, e)` |

All byte arrays are plain `number[]` of integers 0..255. The only imports are `Rsa.ts -> 'Bytes'`, `'BigNum'`, `'Sha256'` (bare basenames, the form the other scripts in this repo use, e.g. `horizon-kjv-reader/scripts/BibleIndex.ts`).

## Constraints obeyed (Horizon script runtime)

- No typed arrays anywhere (`Uint8Array` and friends are not exposed by the runtime), no `ArrayBuffer`/`DataView` either.
- No `BigInt`, no bigint literals: big numbers are `number[]` of 25-bit limbs in plain doubles.
- No `Math.imul`, no `TextEncoder`/`TextDecoder`, `atob`/`btoa`, `Buffer`, `crypto`, `eval`, `Proxy`, timers.
- TypeScript 4.7.4 / ES2020 only: no `satisfies`, `??=`, `||=`, `.at()`, `Object.hasOwn`, `replaceAll`, `**`.
- Every file is well under the 64 KB script limit (largest is 10.2 KB); `test/lint-runtime.mjs` enforces all of the above plus a 25 KB per-file cap, and `npm test` runs it first.

## How it works

`rsaVerifyPkcs1Sha256` implements RSASSA-PKCS1-v1_5 verification (RFC 8017 section 8.2.2): it requires `signature.length == k` (the modulus length after stripping leading zero bytes), `0 <= s < n`, an odd modulus of at least 62 bytes and an odd integer exponent >= 3, computes `EM = s^e mod n` as k bytes, builds the full expected `EM = 00 01 FF..FF 00 || DigestInfo(SHA-256) || SHA-256(message)` and compares all k bytes. The recovered EM is never parsed, so the lax-padding forgeries of the Bleichenbacher '06 family cannot apply even with e = 3. Malformed input returns `false`; nothing throws.

`modPow` keeps the modulus as L limbs of 25 bits (L = 82 for RSA-2048, 123 for 3072, 164 for 4096). With 25-bit limbs the merged Montgomery step `t[j] + a[j]*b_i + m*n[j] + carry` stays below 2^53, so one carry split per limb (`(v * 2^-25) | 0`, then `v - carry * 2^25`) is exact in double arithmetic. Square-and-multiply runs in Montgomery form (CIOS with the multiply and reduce passes merged into one loop per row; 16 squarings + 1 multiply for e = 65537, then one more multiply by 1 to leave Montgomery form). The base enters Montgomery form through a single Knuth algorithm D remainder (`modReduce`) of `x * 2^(25L)`, so no per-key constants (`R^2 mod n`) need to be precomputed or embedded. The modulus must be odd (Montgomery), which RSA moduli always are.

Written for this project from FIPS 180-4, RFC 8017 and TAOCP vol. 2 (not copied from a library).

## Key format for the seller tool

Embed the public key as the JWK fields: `n` = unpadded base64url of the big-endian modulus bytes, `e` = the exponent as a number (`AQAB` = 65537). `rsaPublicKeyFromBase64Url(n, e)` turns that into `{ n: number[], e: number }` for `rsaVerifyPkcs1Sha256`. Signatures are the raw PKCS#1 v1.5 signature bytes (`crypto.sign('sha256', msg, { key, padding: RSA_PKCS1_PADDING })` in Node), k bytes long.

## Tests

```
cd horizon-asset-guard && npm install && npm test        # lint + build (TypeScript 4.7.4) + unit tests
npm run bench:quickjs                                     # no-JIT run with Horizon's missing globals deleted
```

`npm test` compiles `runtime/` with TypeScript 4.7.4 exactly (`tsconfig.test.json`: ES2020 target/module/lib, strict, noEmitOnError, `types: []`) into `test/out/`, rewrites the bare imports to `./X.js` for Node, and runs `test/crypto.test.mjs` (250 checks, Node 18+):

- SHA-256 against `node:crypto` for 26 lengths (0..70000, around every block boundary) plus the empty, "abc" and 56-byte NIST answers.
- Bytes helpers against `Buffer`: UTF-8 both ways (including astral and lone surrogates), hex, base64url (padded/standard alphabet accepted), concat, equality.
- BigNum against BigInt: limb round trips, exhaustive `modPow` for every odd modulus < 300 with every base < 2n and e in {1, 2, 3, 17, 65537}, 200 random (base, mod) pairs of 1..512 bytes with e in {3, 17, 65537} (bases shorter and longer than the modulus, moduli with leading zero bytes and tiny top limbs), edge bases 0, 1, 2, n-2, n-1, n, n+1, 2n-1, 2n+1 for a 2048-bit modulus, and `modReduce` directly.
- RSA against Node-generated keys: 2048-bit (e = 65537) signatures of messages of 0, 1, 31, 32, 33, 55, 56, 63, 64, 65, 100 and 5000 bytes; 3072, 4096, e = 3 and e = 17 keys; a modulus with leading zero bytes. Negatives: flipped bits in signature/message/modulus, wrong key, signature from the wrong key, all-zero and all-0xff signatures, s = n, n+1, n-1, length off by one either way, empty signature, wrong/even/1/0/NaN/fractional exponent, short/empty modulus, non-byte values, 2048-bit signature against a 3072-bit key, and an e = 3 cube-root forgery with short padding.
- `lint-runtime.mjs` self-test: passes a clean file, rejects each forbidden construct, allows `this.async.setTimeout(`, flags names inside strings, flags files over 25 KB.

`npm run bench:quickjs` (`test/quickjs.bench.mjs`) concatenates the compiled ES2020 output into one plain script (test-only; the shipped files are the four `.ts` sources), loads it in QuickJS via `quickjs-emscripten` (a WASM bytecode interpreter with no JIT, standing in for Horizon's engine) after `delete globalThis.Uint8Array` (and every other typed array), `BigInt`, `Proxy`, `eval`, `TextEncoder`/`TextDecoder`, `atob`/`btoa`, `Buffer`, `crypto`, `setTimeout`/`setInterval`, then checks 18 RSA vectors (positive and negative) and 8 SHA-256 vectors generated with Node's crypto and times the verifies. It exits non-zero if any vector or the global deletion fails. The package is resolved from `node_modules` first, then from the research bench folder (`QUICKJS_BENCH_DIR`); `npm i -D quickjs-emscripten` if neither is available.

## Measured speed

| Environment | RSA-2048, e = 65537 | RSA-2048, e = 3 | RSA-3072, e = 65537 |
| --- | ---: | ---: | ---: |
| Node 22 (V8 JIT), mean of 100 | 0.75 ms | | 1.6 ms |
| QuickJS-wasm, no JIT, typed arrays/BigInt deleted, mean of 20 | 22 ms | 5.4 ms | 49 ms |

For scale, in the same QuickJS build a native-BigInt RSA verify is 2.0 ms and tweetnacl's no-BigInt Ed25519 verify (which also needs typed arrays) is 125 ms. The first 26-bit-limb version took 46 ms; merging the Montgomery multiply and reduce loops and moving to 25-bit limbs with a single carry split halved it. The 15 ms target is not met in QuickJS-wasm for e = 65537; a seller key with e = 3 verifies in about 5 ms (and is safe here because the full EM is compared), and the check runs once per world load, not per frame. SHA-256 runs at about 1.6 MB/s in QuickJS-wasm (64 KiB in 41 ms) and 65 MB/s in Node.
