# Changelog

## Unreleased: review fixes pending (do not sell with this version yet)

An adversarial review of 1.0.0 is done but its fixes are not applied yet. The serious findings as reported (each gets checked against the code before it is fixed):

- `runtime/Guard.ts`: one shared registry `world` means a single edited line can unlock every data module in any world.
- `runtime/Guard.ts`: `data()` / `tune()` unlock real tables whatever `Guard.state` is (UNVERIFIED, MISMATCH, INVALID, TRIAL), which is weaker than the design.
- `runtime/Guard.ts`: sentinels re-unlock through the same registry world and license and only flag while LICENSED, so the registry-level patch above also silences them.
- `runtime/crypto/Bytes.ts`: `bytesToUtf8` builds the plaintext one character at a time (about 100-200 ms per table unlock in a no-JIT interpreter); this needs chunked decoding.
- `templates/LICENSE-BUYER.md`: says a timed license degrades to trial after a warning period; the runtime does not do that yet.

The review also raised 21 medium and 40 low findings (docs/CLI flag mismatches, test gaps, wording). All tests below pass; the issues above are design or performance gaps the tests do not cover yet. Nothing has been run inside Horizon itself; see `docs/KEYSTONE-TEST.md` for the live checks.

## 1.0.0 (2026-10-26)

First complete release: the runtime a seller ships, the Node CLI the seller runs, the docs, and a test suite that proves the two halves agree byte for byte.

### Runtime (`runtime/`, ships into the buyer's world)

- `crypto/ChaCha20.ts`: RFC 8439 ChaCha20 over `number[]` (no typed arrays, no `Math.imul`), the data cipher for the encrypted tables. Joins the existing `Bytes`, `Sha256`, `BigNum` (25-bit limb modpow) and `Rsa` (PKCS#1 v1.5 / SHA-256 verify) files, whose APIs are unchanged.
- `GuardCore.ts`: pure license logic with no Horizon import: `HAG1.` license parse with E10 offsets, RSA verify, SKU / world / expiry evaluation (I00, E11, E12, E13, E14), per-world content-key unwrap, `HAGD1.` blob open with a SHA-256 tag, request codes (`HAG-REQ-<sku>-<world>-<check4>`). Every export is wrapped so it never throws. The region between `// @hag-core-begin` and `// @hag-core-end` (all `g_*` names, 11.9 KB) is what `hag build` copies, renamed per buyer, into every generated data module.
- `Guard.ts`: the registry and the game-facing API (`Guard.data`, `Guard.tune`, `onReady`, `onTier`, `onKeystone`, `ready()`, `sentinel`, `for()`, `GuardedComponent`). Data is served real-or-fallback, never as a boolean; unlocks are cached per table and failures remembered so trial mode never pays an RSA verify per frame; tier 2 (half-patched or revoked) substitutes fallbacks on a seed-jittered schedule.
- `AssetGuard.ts`: the one server component the seller drops in. Props are exactly `license`, `license2`, `license3`, `statusText`. Parse at 300 ms, RSA verify on the next timer, one table warmed per 40 ms tick, keystone at 2 s, ten-minute re-check on chained `this.async.setTimeout`, grace tier, status text, `hag:req` / `hag:res` for client scripts. `start()` never throws; any internal error leaves the guard UNVERIFIED at tier 0.
- `GuardKeystone.ts`: optional seller-owned spawn with the retry policy (three retries, 5 / 15 / 45 s), hard-vs-transient error classification, `warn` / `degrade` modes and a seed-jittered 3-20 minute degrade clock.
- `GuardProbe.ts`: the runtime feature table for support and the live tests (T0, T12), including an RSA timing line.
- `GuardKey.ts`: the generated per-SKU settings file; the checked-in copy is the `demo` sample whose private half is public in `examples/demo-keys/`.
- Rules enforced by `test/lint-runtime.mjs` on every runtime file: TypeScript 4.7.4 / ES2020 only, no typed arrays, no `BigInt` token (the `['BigInt']` lookup behind a `typeof` check is the one allowance), no `eval` / `Proxy` / `TextEncoder`, timers only through `this.async`, 25 KB per file.

### Seller CLI (`cli/hag.mjs`, Node 18+, no npm dependencies)

- `keygen`, `buyer add`, `build`, `issue`, `verify`, `list`, `trace`, `revoke`, `report`, `doctor`, `keystone-test`, with state in `.hag/` (or `HAG_HOME`) and an optional `HAG_KEY_PASSPHRASE` for the private key.
- `build` writes a complete buyer package: `<out>/scripts/` holds the per-buyer `GuardData_<name>.ts` modules (watermarked data: `_m` keys at about 35 % of objects, seed-derived slack constants from `hag.config.json`, a fresh nonce per buyer; the inlined verify core with every `g_*` name mangled to `_` + 6 base32 chars from `SHA256(wm | table | name)`), the whole runtime tree, and a `GuardKey.ts` composed for the SKU; plus `BUYER-README.md` and `LICENSE-BUYER.md`. Everything `trace` needs goes to the ledger.
- `issue` validates the request codes, signs the payload in the contract's key order, and prints the activation message with the license split into `license` / `license2` / `license3` chunks of at most 200 characters.
- `trace` scores a leaked folder (TypeScript files or plain JSON dumps) against every buyer by blob hash, mangled names, `_m` marks and slack constants, flags collusion, and writes `trace-report.md`.
- `doctor` runs the shared lint, the size caps and a TypeScript 4.7.4 compile with the local `horizon/core` stub; it accepts a build folder (`--dir <out>`, descending into `scripts/`) as well as `runtime/`, and refuses `KEYSTONE_MODE: 'degrade'` without a keystone-test record (T4, T5, erase, placed or T9) newer than 90 days.
- `keystone-test` records all eleven live tests of `docs/KEYSTONE-TEST.md` (T0, T1, T2, T4, T5, erase, placed, T7, T9, T11, T12); only the five keystone tests count for the `degrade` gate.

### Examples, docs, templates

- `examples/`: `hag.config.json`, the demo data tables and trial fallback, `ArenaExample.ts` (a `GuardedComponent` compiled by the test build), the public demo key, and `build-sample/`: a checked-in buyer package for buyer `b001` built with the demo key, with `ACTIVATION-EXAMPLE.md` showing the printed activation message. `node examples/make-build-sample.mjs` regenerates it.
- `docs/`: `INTEGRATION.md`, `SELLER-GUIDE.md`, `BUYER-ACTIVATION.md`, `HYGIENE.md`, `KEYSTONE-TEST.md`, `LIMITS.md`; `templates/`: activation message, buyer license terms, Meta IP report packet.
- `types/horizon-core.d.ts`: a local typing stub of the `horizon/core` subset the runtime touches, for type-checking outside the editor only.

### Tests (`npm test`, about 15 s)

- `test/lint-runtime.mjs` on `runtime/` and `examples/` (incl. the build sample), then `tsc -p tsconfig.test.json` (TypeScript 4.7.4, strict, `noEmitOnError`, compiles `runtime/**` and `examples/ArenaExample.ts` into `test/out/runtime/` and `test/out/examples/`) and `test/fix-esm-imports.mjs` (bare names and `horizon/core` rewritten for Node, the mock copied to `test/out/horizon-core.js`).
- `crypto.test.mjs` (250 checks), `chacha.test.mjs` (35: RFC 8439 vectors and `node:crypto` cross-checks), `core.test.mjs` (166: every evaluate state and code, blobs, request codes, fail-open rules, a 500-string fuzz pass, and the builder contract on the core region), `assetguard.test.mjs` (123: the full lifecycle on the mock with manual timer flushing), `cli.test.mjs` (164: every command against `node:crypto` as the oracle, trace among five buyers, the doctor gates), `e2e.test.mjs` (93: keygen to activation on the real CLI, the built package compiled with TypeScript 4.7.4 and run in the mock, the arena playing the real waves, trace naming the buyer among two, and the generated module's own mangled unlock executed inside QuickJS-wasm with typed arrays, BigInt, Proxy, eval and TextEncoder deleted: plaintext byte-identical to Node).
- `npm run bench:quickjs`: RSA-2048 e=65537 verify 22 ms, e=3 5.4 ms, ChaCha20 0.44 ms/KB in the no-JIT interpreter.
- `quickjs-emscripten` is a devDependency (tests and bench only); `typescript` 4.7.4 is the other one. Nothing is a runtime dependency.
