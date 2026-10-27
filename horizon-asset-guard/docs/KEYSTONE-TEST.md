# Live-test checklist

Several platform behaviours this package depends on are documented nowhere and can change with any Horizon Studio release. Each test below unlocks exactly one promise. Until you have run a test and recorded it, the promise it unlocks is "best effort" in your sales copy, and `hag doctor` refuses `KEYSTONE_MODE: 'degrade'` without a keystone record newer than 90 days.

Record every result, pass or fail, with the exact lines given. Re-run the whole list after each Studio release.

## Setup

- Two accounts: **S** (you, the seller) and **B** (a second account that plays the buyer). B must not be a collaborator on S's master world.
- **WB**: a draft world owned by B. **WS**: S's master or any S-owned world.
- A build of the demo in WB: copy `runtime/` (with `crypto/`) and `examples/ArenaExample.ts` into WB's scripts, an empty object with `AssetGuard.ts`, another with `GuardProbe.ts`, a Text gizmo wired to `statusText` if you want to see the status line.
- A Debug Console gizmo set to "Edit and Preview" (or read the Editor Console).
- For T4 to T7: a small S-owned asset (a mesh with a visible color is enough) saved in S's library; its id goes into `KEYSTONE_ID` in `GuardKey.ts` with `KEYSTONE_MODE: 'warn'`, then re-copy `GuardKey.ts` into WB. `warn` logs everything and changes nothing, which is what a test wants.

The console lines to look for all start with `[probe]`, `[AssetGuard]` or `[GuardKeystone]`.

---

## T0: runtime probe

**Unlocks:** nothing by itself; every other test reads its output, and support needs it.

1. Press Play in WB with `GuardProbe.ts` attached. About half a second later the console prints `[probe] ---- runtime feature table (SKU demo) ----` followed by one line per check, then the timing lines about a second after that.
2. Save the whole block with the build (and with the ledger when you sell).

**Pass:** the table prints to the end (`[probe] ---- end of feature table ----`). Lines reading `THROWS(...)` are results, not failures.

What to look at: `Uint8Array = undefined` confirms byte work must stay `number[]` (expected). `BigInt = function` plus a 20-digit shift result means the keystone can build asset ids; `BigInt = undefined` means the keystone will log `W03 keystone skipped` and you must leave `KEYSTONE_MODE` at `off`. `fn.toString()` containing `return a + 41` means real source is available; `[bytecode]` or `[native code]` means it is not (either is fine for this version). If the editor's compile step refuses the two `eval` / `Function` lines, delete them in `GuardProbe.ts` and run again.

```
hag keystone-test --sku demo --record "T0=pass bigint=function uint8=undefined fn=source"
```

(replace the values with what you saw; the free text after `pass` or `fail` is yours).

---

## T1: the world id is real and changes on duplication

**Unlocks:** promise 1, per-world binding. Everything rests on this test.

1. In WB, read `[probe] this.world.id.get() = <number>` and `[probe] typeof this.world.id = object`.
2. Open WB in the Creator Portal and compare the number in the URL (or the world's id field) with the probe line.
3. As B, duplicate WB (Create > Drafts > Duplicate; only the owner can). Open the copy, press Play, read the probe line again.
4. Also press Play in WB from a **published** instance if you can (publish, visit, read the Debug Console gizmo set to "In Published World"), to confirm the id does not differ between draft and published.

**Pass:** the probe id equals the portal id for WB; the duplicate prints a different id; draft and published print the same id.

**If it fails:** same id after duplication means a duplicated world keeps its license, so binding is per-creator rather than per-world; say so in your terms and lean on tracing. A `THROWS` or `undefined` on `this.world.id` means every world runs as `W02` fail-open (the license's first world id is used), which is full function for a legitimate buyer and no binding at all for copies; do not sell binding until the next Studio release fixes it.

```
hag keystone-test --sku demo --record "T1=pass portal=match dup=changes published=same"
```

---

## T2: how long a string prop can hold

**Unlocks:** the three-prop activation path (and whether `hag issue` should print the license in pieces).

1. Paste a 600-character string of visible characters (for instance the demo license from `hag issue`, or 600 x `A`) into the `license` prop of the AssetGuard object. Press Play.
2. The console prints `[AssetGuard] E10 ... at offset N` if the string was cut, where N is the number of characters that survived; `E11` (signature does not verify) means the whole string arrived and simply is not a license.

**Pass:** at least 200 characters survive per prop (a real license is about 560 characters; `hag issue` splits it into three pieces of at most 200 characters when it is longer than 250).

**If it fails** (fewer than 200 survive): activation goes through `BAKED_LICENSE` in `GuardKey.ts` instead; the seller bakes the license into the buyer's `GuardKey.ts` and re-delivers that one file, or the buyer pastes it there (it is their source).

```
hag keystone-test --sku demo --record "T2=pass maxchars=600"
```

---

## T4: an unshared asset of S, spawned by B

**Unlocks:** whether a keystone can mean anything at all.

1. In WB, with `KEYSTONE_ID` set to S's asset and `KEYSTONE_MODE: 'warn'`, make sure the asset is **not** shared with B.
2. Press Play. About two seconds in: `[GuardKeystone] spawn attempt 1/4 for keystone <id>`, then either `[GuardKeystone] keystone spawned, N root entities` or `[GuardKeystone] W03 spawn attempt 1 failed: <error>`. Wait for the retries (5, 15 and 45 seconds later) and the final `W03 keystone unavailable (...)` line.

**Pass (for revocation to be possible):** every attempt fails with `UnauthorizedContent` or `InvalidAsset`.

**If it spawns unshared:** anyone with the id can spawn your asset; a keystone can never revoke anything. Leave `KEYSTONE_MODE: 'off'` and `KEYSTONE_ID: '0'` for good and sell on binding and tracing only.

```
hag keystone-test --sku demo --record "T4=UnauthorizedContent"
hag keystone-test --sku demo --record "T4=spawned"
```

(one of the two, with the exact error name the console printed).

---

## T5: share, spawn, unshare, re-spawn

**Unlocks:** promise 3, revocable core content. This is the pass criterion for anything you say about switching off a copy.

1. As S, share the asset with B. As B, press Play in WB: expect `[GuardKeystone] keystone spawned, N root entities` (state `Active`).
2. As S, unshare the asset.
3. As B, re-spawn in a **fresh instance**: stop the simulation, close WB completely, reopen it (or visit a freshly published instance), press Play. Record what the console prints, including which error.
4. Repeat step 3 in three separate fresh instances; cached permissions may let the first one through.

**Pass:** shared spawns `Active`; after unsharing, every fresh instance fails every attempt with `UnauthorizedContent` or `InvalidAsset` (the only errors the runtime treats as "unavailable"; `ExceedsCapacity`, `Unknown` and `Cancelled` are retried and never count).

**If it fails** (spawns after unshare, or fails only sometimes): revocation is not real on this platform version. Keep `KEYSTONE_MODE` at `off` or `warn`; never `degrade`.

```
hag keystone-test --sku demo --record "T5=pass shared=Active unshared=UnauthorizedContent x3"
hag keystone-test --sku demo --record "T5=fail unshared=spawned"
```

---

## erase: a permanently erased asset

**Unlocks:** the last-resort revocation path (erase instead of unshare).

1. As S, make a throwaway copy of the asset, share it with B, confirm B can spawn it (as in T5 step 1).
2. As S, remove it and then erase it permanently from Removed Assets.
3. As B, re-spawn in a fresh instance (as in T5 step 3). Record the error.

**Pass:** fails on every attempt with `InvalidAsset` or `UnauthorizedContent`.

```
hag keystone-test --sku demo --record "erase=InvalidAsset"
```

---

## placed-instance: does a dragged-in copy survive?

**Unlocks:** nothing you can sell; it tells you what the keystone must never be. Record it separately from the runtime-spawn result.

1. As S, share the (throwaway) asset with B. As B, drag a **static** instance of it into WB from the asset browser and save.
2. As S, unshare it. As B, reopen WB in a fresh instance: is the placed instance still there? Publish WB and visit: still there?
3. As S, erase the asset. As B, repeat the check.

**Expected:** the placed instance survives both (the Roblox precedent says yes). That is why `GuardKeystone` spawns at runtime by id and the hygiene rules forbid delivering the keystone as a placed instance.

```
hag keystone-test --sku demo --record "placed=survives unshare+erase"
hag keystone-test --sku demo --record "placed=removed-on-unshare"
```

---

## T7: id-only spawn vs prop-pinned asset version

**Unlocks:** republish as a remote patch for spawned keystone content.

1. As S, publish a new version of the shared asset with a visible change (a different color).
2. As B, in WB: the keystone (spawned by id only, no version) and an `enemyAsset` prop on `ArenaExample` pointing at the same asset (spawned through `world.spawnAsset` from the prop). Press Play.
3. Which of the two shows the new color?

**Pass:** the id-only spawn shows the latest published version. Record what the prop-spawned one did as well.

```
hag keystone-test --sku demo --record "T7=idonly:latest prop:pinned"
```

---

## T9: `fetchAsData` on a text asset of S, shared and unshared

**Unlocks:** a future manifest-based revocation mode (reading a signed revocation list from a seller-owned text asset). This version of the runtime does not read manifests; record the result so the next version can.

1. As S, upload a small text asset (a few lines of JSON), share it with B.
2. In WB, a throwaway script calls `new hz.Asset(BigInt(id)).fetchAsData({ skipCache: true })` in `start()` (wrapped in try/catch, result to `console.log`). Note: this throwaway script is the one place a bare `BigInt` is acceptable; do not ship it.
3. As S, edit the text and republish; as B, run again in a fresh instance: new content or old?
4. As S, unshare; as B, run again: rejected, or old content?

```
hag keystone-test --sku demo --record "T9=shared:ok refetch:new unshared:rejected"
```

---

## T11: `setInterval` reliability over ten minutes

**Unlocks:** nothing to sell; it confirms the runtime's choice of chained `setTimeout` (there is an unresolved report of `this.async.setInterval` never firing).

1. A throwaway script in WB with both timers:

```ts
start(): void {
  let a = 0, b = 0;
  this.async.setInterval(() => console.log('[T11] interval ' + (++a)), 60000);
  const tick = (): void => { console.log('[T11] timeout ' + (++b)); this.async.setTimeout(tick, 60000); };
  this.async.setTimeout(tick, 60000);
}
```

2. Leave WB running for eleven minutes in Preview and, separately, in a published instance with a Debug Console gizmo. Count the lines.

**Pass:** `timeout` fires 10 of 10 in both. Record the `interval` count next to it.

```
hag keystone-test --sku demo --record "T11=timeout:10/10 interval:10/10 published:10/10"
```

---

## T12: verify timing on a headset

**Unlocks:** the default key size and exponent (whether `e = 65537` stays within a frame on Quest).

1. Publish WB with `GuardProbe.ts` and a Debug Console gizmo set to "In Published World"; visit it on a Quest headset as a collaborator (visitors never see the console).
2. Read `[probe] sha256 of 64 KiB (ms) = N` and `[probe] rsa-65537 verify, full modpow (ms) = N`. Also run it on desktop for comparison. (Reference: 22 ms for the RSA line in a no-JIT interpreter on a desktop CPU; a headset is expected to be two to four times slower.)

**Pass:** the RSA line is at or below about 60 ms on the headset. The verify runs once on its own timer, never per frame, so a single long frame at start is the worst case.

**If it fails** (the line stalls visibly or reads above ~100 ms): re-key with `hag keygen --sku <sku> --e 3` (about four times faster; safe here because the verifier compares the full encoded message) and rebuild for every buyer.

```
hag keystone-test --sku demo --record "T12=quest:rsa=48ms sha=9ms desktop:rsa=6ms"
```

---

## After the tests

- `hag list` shows every SKU's records and their age.
- Only after `T4` and `T5` pass (and `erase`, if you intend to use it) may `KEYSTONE_MODE` be set to `degrade` in `GuardKey.ts`; `hag doctor` checks for a record younger than 90 days and refuses otherwise. `warn` is always allowed.
- Repeat the list after every Horizon Studio release, and whenever a buyer's probe output shows a different engine fingerprint than the one you recorded.
