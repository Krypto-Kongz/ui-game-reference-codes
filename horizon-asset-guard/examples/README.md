# examples/

A complete small game integration you can build, trace and activate end to end with the seller tool.

| File | What |
|---|---|
| `hag.config.json` | The seller config for SKU `demo`: two data tables (`waves`, `tunables`), four watermark slacks on tunables whose exact value does not matter to play, and the optional `"seller"` name used in `LICENSE-BUYER.md`. |
| `data/waves.json` | The real wave table (8 waves, boss at the end). Ships only encrypted, inside `GuardData_waves.ts`. |
| `data/tunables.json` | The real tunables (`spawnRate`, `waveDelayMs`, `respawnDelay`, ...). Ships only encrypted, inside `GuardData_tunables.ts`. |
| `data/waves-trial.json` | The trial fallback: two waves, no boss. This is the content a copy plays without a license; it is embedded in `ArenaExample.ts` as `TRIAL_WAVES` because a fallback must work with no key at all. |
| `ArenaExample.ts` | A wave arena written as a `GuardedComponent`: reads `waves` through `this.guard.data`, tunables through `this.guard.tune`, reacts to `onReady`, `onTier` and `onKeystone`. Compiles under TypeScript 4.7.4 with the runtime's rules and passes `node test/lint-runtime.mjs examples/`. The before/after walkthrough is `docs/INTEGRATION.md`. |
| `demo-keys/demo-private.json` | The private half of the sample key in `runtime/GuardKey.ts`. **Demo only; public; never for real sales.** |
| `build-sample/` | What `hag build` hands a buyer, checked in as documentation: built for buyer `b001` with the demo key from this config. `scripts/` is the complete drop-in set (`GuardData_waves.ts`, `GuardData_tunables.ts`, `GuardKey.ts`, the runtime copy); `BUYER-README.md` and `LICENSE-BUYER.md` are the generated readmes; `ACTIVATION-EXAMPLE.md` is the activation message `hag issue` printed for world 123. `hag doctor --dir examples/build-sample` passes. |
| `make-build-sample.mjs` | Regenerates `build-sample/` in a throwaway `HAG_HOME` (`npm run build:sample`); run it after changing `runtime/GuardCore.ts`, the data files or the templates. |

## Build the demo for a pretend buyer

From the package folder (`hag` = `node cli/hag.mjs`):

```
export HAG_HOME=/tmp/hag-demo                                  # keep the demo ledger out of your real one
hag keygen --sku demo --out runtime/GuardKey.ts                # fresh key; overwrites the sample key
hag buyer add --sku demo --id b001 --name "Ana"
hag build --sku demo --buyer b001 --config examples/hag.config.json --out /tmp/hag-demo/b001
ls /tmp/hag-demo/b001/scripts                                  # runtime tree + GuardData_waves.ts + GuardData_tunables.ts
```

Put `/tmp/hag-demo/b001/scripts/*` and `examples/ArenaExample.ts` in a test world with an empty object carrying `AssetGuard.ts` and another carrying `ArenaExample.ts`, press Play, read the console:

```
[AssetGuard] I01 no license, trial mode. Activation request code: HAG-REQ-demo-123-QK42
[Arena] guard TRIAL (I01), 2 waves [trial table]
[Arena] activation code for the seller: HAG-REQ-demo-123-QK42
```

Issue a license for that code and paste it:

```
hag issue --sku demo --buyer b001 --req HAG-REQ-demo-123-QK42
```

```
[AssetGuard] I00 licensed to Ana
[Arena] guard LICENSED (I00), 8 waves
[Arena] wave 1/8: Scouts, 4 enemies
```

Then prove the watermark: `hag trace /tmp/hag-demo/b001/scripts` names `b001`.

## The ArenaExample props

| Prop | Type | Use |
|---|---|---|
| `banner` | Entity | Optional Text gizmo for the wave line. |
| `enemyAsset` | Asset | Optional. Spawned once per enemy through `world.spawnAsset`; left empty, the arena logs `would spawn ...` instead. |
| `spawnPoint` | Entity | Optional spawn position (default: the arena entity). |
| `autoStart` | Boolean | Start wave 1 when the guard reports ready (default true). |

Enemy scripts report a kill with a local broadcast `Arena_EnemyDown` carrying `{ by: playerId }`; the arena broadcasts `Arena_Wave` (`{ index, name, enemies, boss }`) over the network at every wave start for UI and spawner scripts.

## The demo private key

`runtime/GuardKey.ts` is checked in with a real RSA-2048 public key for SKU `demo` so that the package compiles and the tests have a sample to replace. Its private half is `demo-keys/demo-private.json` (PKCS#8 PEM plus the same `n` / `e` as `GuardKey.ts`), published so that docs and scripts can sign a `demo` license without running `keygen`. Because it is public, a `demo` license proves nothing; every real SKU gets its own key from `hag keygen`, which stays in `.hag/keys/`.

The file has the same fields as a `.hag/keys/<sku>.json` record, so to use the checked-in `GuardKey.ts` as it is (instead of the `keygen` line above), copy it into the demo state folder:

```
mkdir -p $HAG_HOME/keys && cp examples/demo-keys/demo-private.json $HAG_HOME/keys/demo.json
```

Signing a `demo` license yourself in Node, if you want to see the format without the CLI:

```js
import { constants, createHash, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
const key = JSON.parse(readFileSync('examples/demo-keys/demo-private.json', 'utf8'));
const ck = randomBytes(32), wm = 'abcdef0123456789', world = '123';
const mask = createHash('sha256').update(Buffer.concat(['HAGKW1', world, key.sku, wm].map((s) => Buffer.from(s)))).digest();
const kw = Buffer.from(ck.map((c, i) => c ^ mask[i])).toString('base64url');
const payload = { v: 1, s: key.sku, b: 'b001', m: 'W', w: [world], kw: [kw], i: Math.floor(Date.now() / 1000), e: 0, wm, n: 'Ana' };
const signed = 'HAG1.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = sign('sha256', Buffer.from(signed), { key: key.privateKeyPem, padding: constants.RSA_PKCS1_PADDING });
console.log(signed + '.' + sig.toString('base64url'));   // about 560 characters
```

(The content key `ck` must be the one the data blobs were encrypted with; the CLI keeps it in the ledger.)
