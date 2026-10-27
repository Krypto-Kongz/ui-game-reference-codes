# horizon-asset-guard

> **Status: work in progress.** Review fixes are still pending (see the top of [CHANGELOG.md](CHANGELOG.md)) and nothing has been tested inside Horizon yet. Do not use it for real sales until both are done.

You sell a game (asset template plus TypeScript) to other Meta Horizon Worlds creators, and the platform hands every buyer your readable source. This package binds each sold copy to the buyer's world, keeps the real game data encrypted until a license you signed for that world is pasted in, and watermarks every build so a leaked copy names the buyer it was sold to. It is a licensing, anti-copy and traceability kit for creator-to-creator sales, not DRM.

## The three honest promises

1. **Per-world binding.** A copy moved to another world (duplicated, re-created from an asset, handed to a friend) runs as a playable **trial** build until you issue a license for that world. The buyer sees a request code in the console; you turn it into a license in one command.
2. **Every leaked copy names its buyer.** Each sale is a distinct build: different encrypted blobs, different hidden marks inside the data tables, different identifier names in the generated scripts. `hag trace <folder>` scores a leaked copy against your ledger and writes the evidence packet a contract claim or a Meta IP report needs.
3. **Revocation, only if the live tests pass.** Optionally, the game depends on a "keystone" asset that you own and only *share* with the buyer. If, and only if, the live tests in `docs/KEYSTONE-TEST.md` show that Horizon stops a spawn after you unshare the asset, you can switch off that core content from your own library. Until your tests say so, this is "best effort" in your sales copy.

## The hard limits (read before you sell anything)

- **A buyer can read and edit every line of TypeScript you ship.** There is no hidden, compiled, read-only or obfuscated script mode in Horizon. Anyone the buyer makes an Editor collaborator gets the same access.
- **Nothing stops editor actions.** Scripts cannot veto Select, Copy, Create Asset, Import World, Duplicate or Open in External Editor. The buyer can press Stop and then nothing you wrote is running.
- **No phone-home, no kill switch, no account identity.** Scripts have no outbound network and no API for the world owner's account. Everything here works offline, bound to the world id.
- **A determined editor wins.** Removing this protection is hours of work, not minutes: the check is spread across every data module, the key depends on the live world id, and nothing surfaces as a single boolean to flip. But it is removable, and the package does not pretend otherwise.
- **Forgery resistance holds only for an unmodified build.** Swapping the public key in `GuardKey.ts` takes two minutes. The signature's lasting value is your ledger, `hag trace` and the fact that a tampered build is still watermarked.
- **A licensed buyer has the key at runtime.** Key-gating stops *unlicensed copies*; it cannot stop the buyer re-sharing a licensed world. Only the watermark gives you recourse after the fact.

The value, stated plainly: per-world binding that costs hours to remove, near-certain tracing of any leak, and revocation only when Horizon's spawn permissions behave as hoped. `docs/LIMITS.md` has the full threat model and the rules every file obeys (never brick a paying buyer; no buyer-editable prop carries policy; a false negative beats a false positive).

## Quick start: seller

`hag` below means `node cli/hag.mjs`, run from this folder. State lives in `.hag/` next to it (or wherever `HAG_HOME` points); back that folder up and never ship or commit it.

```
npm install                                   # TypeScript 4.7.4 + quickjs-emscripten for the checks and tests; no runtime dependencies
hag keygen --sku mygame --out runtime/GuardKey.ts     # RSA-2048 keypair; private half in .hag/keys/mygame.json
hag doctor                                    # lint, size caps, TS 4.7.4 syntax on runtime/
```

Then, per sale (details in `docs/SELLER-GUIDE.md`):

```
hag buyer add --sku mygame --id b017 --name "Ana"
hag build --sku mygame --buyer b017 --config hag.config.json --out builds/b017
# deliver builds/b017/scripts/* with the asset (see docs/HYGIENE.md), buyer presses Play and sends you:
#   HAG-REQ-mygame-1234567890123456-QK42
hag issue --sku mygame --buyer b017 --req HAG-REQ-mygame-1234567890123456-QK42
# paste the printed activation message to the buyer
```

## Quick start: buyer

1. Put the delivered scripts in the world and drop `AssetGuard.ts` on an empty object under the game root (execution mode Default).
2. Press Play. The Editor Console shows `[AssetGuard] I01 no license, trial mode. Activation request code: HAG-REQ-...`. Send that code to the seller.
3. Paste the license you get back into the `license` prop of that object (long licenses come in three pieces: `license`, `license2`, `license3`). Press Reset or Play again. The console shows `[AssetGuard] I00 licensed to Ana`.

Full walkthrough and troubleshooting in `docs/BUYER-ACTIVATION.md`.

## Integrating your game (10 minutes)

Your scripts stop holding the real tables and ask the guard for them instead:

```ts
class Arena extends GuardedComponent<typeof Arena> {
  start(): void {
    this.guard.onReady(() => {
      const waves = this.guard.data<Wave[]>('waves', TRIAL_WAVES); // real table, or the trial fallback
      const rate = this.guard.tune('spawnRate', 1.0);               // always a finite number
      this.startWave(waves[0], rate);
    });
  }
}
```

`docs/INTEGRATION.md` shows a real component before and after, and `examples/ArenaExample.ts` is the complete, compilable version.

## What you will see in the console

| Line | Meaning |
|---|---|
| `[AssetGuard] I00 licensed to Ana` | License verified for this world. Real data unlocked. |
| `[AssetGuard] I01 no license, trial mode. Activation request code: HAG-REQ-demo-456-67W9` | No license pasted. Trial tables. Send the code to the seller. |
| `[AssetGuard] E12 license is for another world. live world: 456, licensed: 123` | The license is for a different world id (duplicated world?). A fresh request code follows on the next line. |
| `[AssetGuard] E11 license rejected: signature does not verify ...` | The pasted text is not a license this seller signed (or `GuardKey.ts` was changed). |
| `[AssetGuard] E10 truncated: signature ends at offset 300 (84 of 342 characters) ...` | The license was cut when pasting; the offset says where. Use `license2` / `license3`. |
| `[AssetGuard] E13 license expired at ...; data stays unlocked, policy tier 1` | A timed license ran out. Data is still readable; policy drops to tier 1. |
| `[AssetGuard] W00 internal error, running unverified at tier 0: ...` | Something unexpected in the runtime. The game keeps full function and logs why. |
| `[GuardKeystone] W03 ...` | Keystone asset not available; shipped placeholders are used. Never a license problem. |

## Files

| Path | What |
|---|---|
| `runtime/AssetGuard.ts` | The one component the seller drops in. Props: `license`, `license2`, `license3`, `statusText`. |
| `runtime/Guard.ts` | Registry and game-facing API: `Guard.data`, `Guard.tune`, `GuardedComponent`. |
| `runtime/GuardCore.ts` | Pure license logic (parse, verify, world binding, key unwrap, blob open). The marked region is copied into every generated data module. |
| `runtime/GuardKeystone.ts` | Optional seller-owned spawn with retry policy. |
| `runtime/GuardProbe.ts` | Feature probe for support and the live tests. Prints a table, never gates. |
| `runtime/GuardKey.ts` | Generated per SKU by `hag keygen`: public key, SKU, grace, keystone settings. The checked-in copy is the `demo` sample (its private key is public in `examples/demo-keys/`). |
| `runtime/crypto/` | SHA-256, big-number RSA verify, ChaCha20, byte helpers, all over plain `number[]` (Horizon has no typed arrays). |
| `cli/hag.mjs` | Seller tool: keygen, buyer, build, issue, verify, list, trace, revoke, report, doctor, keystone-test (`cli/lib/` holds one module per command plus the shared formats). |
| `examples/` | `hag.config.json`, the demo data tables and trial fallback, `ArenaExample.ts` (compiled by the test build), the public demo key in `demo-keys/`. |
| `examples/build-sample/` | A checked-in buyer package exactly as `hag build` writes it (buyer `b001`, demo key): `scripts/GuardData_*.ts`, the runtime copy with its `GuardKey.ts`, `BUYER-README.md`, `LICENSE-BUYER.md`, and `ACTIVATION-EXAMPLE.md` with the printed activation message. `npm run build:sample` regenerates it. |
| `docs/` | `INTEGRATION.md`, `SELLER-GUIDE.md`, `BUYER-ACTIVATION.md`, `HYGIENE.md`, `KEYSTONE-TEST.md`, `LIMITS.md`. |
| `templates/` | Activation message, buyer license terms, Meta IP report packet. |
| `types/horizon-core.d.ts` | Local typing stub of the `horizon/core` subset the runtime uses, for type-checking outside the editor; never shipped. |
| `test/` | Node tests (`npm test`): `lint-runtime.mjs` (the forbidden-token lint `hag doctor` also runs), `crypto`, `chacha`, `core`, `assetguard` (lifecycle on `mocks/horizon-core.mjs`), `cli`, `e2e` (keygen to activation, built package compiled with TypeScript 4.7.4, unlock inside QuickJS), `quickjs.bench.mjs`. |
| `CHANGELOG.md` | What each release contains. |

## Development

```
npm test                 # lint runtime/ and examples/, compile with TypeScript 4.7.4, then crypto, chacha, core, assetguard, cli, e2e
npm run build:test       # just the compile: runtime/** and examples/ArenaExample.ts -> test/out/runtime/, test/out/examples/
npm run test:e2e         # the whole product on the real CLI, incl. the unlock inside QuickJS-wasm (about 3 s)
npm run bench:quickjs    # the crypto in a no-JIT interpreter with Horizon's missing globals deleted
npm run doctor           # hag doctor on runtime/; `node cli/hag.mjs doctor --dir <build dir>` checks a buyer package
npm run build:sample     # regenerate examples/build-sample/ with the demo key
```

`npm test` runs lint, build and the six suites (about 830 checks, 15 s). The test build compiles `runtime/**/*.ts` and `examples/ArenaExample.ts` together (`tsconfig.test.json`, strict, `noEmitOnError`) and `test/fix-esm-imports.mjs` rewrites the bare imports for Node and maps `horizon/core` to the mock. The e2e test needs `quickjs-emscripten` (installed by `npm install`).

Runtime rules every file under `runtime/` obeys (enforced by `test/lint-runtime.mjs`): TypeScript 4.7.4 syntax, ES2020 minus eval, Proxy and typed arrays, no `BigInt` token, byte work as `number[]`, timers only through `this.async`, every Horizon call feature-detected, 25 KB per file. Imports between scripts use flat bare names (`from 'Sha256'`), the form Horizon's single script namespace uses.
