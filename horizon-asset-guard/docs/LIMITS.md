# Limits and threat model

Read this before you promise anything to a buyer. It is deliberately blunt.

## The two rules every file obeys (verbatim from the design spec)

> Two rules bind every file. **Never brick a paying buyer**: every failure path ends in trial content or full function with a logged reason, never a crash and never garbage. **No buyer-editable prop may carry policy**: grace, keystone ids and mode live only in generated source. A false negative (unprotected play) is always preferred to a false positive (degrading a real buyer).

In practice: an internal error of any kind (a missing API, a changed engine, a timer that fails) leaves the guard in state `UNVERIFIED` at tier 0, prints `W00`, and the game keeps full function on its fallbacks. Only a license that is *present but invalid*, *valid but for another world*, or *absent* ever changes what a player sees, and what they see is then the trial content you chose.

## What the product is, and what it can never be

Horizon ships readable, editable TypeScript to every buyer and every Editor collaborator. Scripts cannot veto any editor operation. There is no outbound network. There is no account API. So this is **binding + deterrence + traceability + revocation-if-the-platform-allows**, not DRM. It makes three promises and nothing more:

1. A copy moved to another world drops to a playable trial build unless the seller issues a license for that world.
2. Every leaked copy names the buyer it was sold to.
3. If and only if the live tests in `KEYSTONE-TEST.md` pass, the seller can switch off core content from their own library.

Forgery resistance applies **only to unmodified builds**: swapping the public modulus in `GuardKey.ts` takes two minutes, so the signature's real value is for the seller's ledger, `hag trace`, and (later) a signed revocation manifest, not for stopping the buyer. Say so in your sales copy.

## Threat model

| Attacker | Stopped by | Not stopped | Residual risk |
|---|---|---|---|
| Casual buyer (duplicates the world, Create Asset into a second world, hands a copy to a friend) | The content key depends on the live world id, so the copy decrypts nothing and runs the trial tables; the request code tells them a license is needed | Reading the source | Low: they buy a second license or keep a demo |
| Buyer's Editor collaborator | Same binding, so a copy is a trial; the watermark names the buyer, who is liable under the license terms | Reads everything the buyer can | Medium: the buyer is accountable |
| Determined cracker (hours) | The guard network (every data module re-verifies on its own), sentinels in game components, per-buyer identifier mangling and the runtime-id-keyed content key raise the cost; data-domain marks survive a plaintext dump; keystone revocation if the live tests passed | Nothing in the world stops a full crack; the world id can be hard-coded in N places; **the licensed buyer's own world hands over the key at runtime**: key-gating resists *unlicensed copies*, not the buyer | High, mitigated only by tracing and a Meta IP report |
| Colluding buyers (diff two builds) | Shared data-domain marks and blob hashes name both candidates | They can scrub the marks that differ; they cannot forge a license for a new world | Medium: partial attribution; three or more colluders degrade random marks |
| Forger minting a license | RSA-2048 signature; the private key never leaves the seller's machine | **Only true for unmodified builds: swapping `PUB_N` takes two minutes** | None against an unmodified build; otherwise the signature's value is the ledger, trace and manifest |

**Honest residual:** the platform ships readable source, so a skilled, motivated editor wins; this product cannot prevent that. Its real leverage is per-world binding that costs hours to remove and near-certain attribution of any leak, which is what a contract claim or a Meta IP report needs. Revocation stays a bonus until the live tests say otherwise.

## Hard limits: things no TypeScript in Horizon can do

1. **It cannot stop the buyer from opening, reading, editing or deleting a script.** The delivery model is editable source in the buyer's world; Editor collaborators get the same. Whatever check is written, the buyer can delete it, swap the public key, or hard-code success.
2. **It cannot block editor operations.** Select, move, copy, Create Asset, Import World, Duplicate and Open in External Editor do not need simulation. The buyer can press Stop first. No editor-action event or veto API exists.
3. **It cannot reliably know it is being edited.** `isInBuildMode` is community-attested, undocumented on desktop and plausibly never true in Horizon Studio. Nothing here gates on it.
4. **It cannot phone home.** No outbound network, so no license server, no telemetry to the seller, no remote kill switch other than what the asset library itself may provide.
5. **It cannot identify the buyer's account.** There is no world-owner API; `Player.id` is believed per-session. A license binds to the world id, not to a person.
6. **It cannot keep a secret.** Anything in a script is readable by the buyer. Only the asymmetric signature keeps the signing key off the buyer's machine, and that prevents forgery, not removal.
7. **It cannot hold seller-controlled state inside the buyer's world.** Persistent variables, leaderboards, entitlements and analytics belong to the world owner's account.
8. **It cannot rely on the scripts inside a spawned seller asset being the seller's.** With file-backed scripts, a same-id script already in the buyer's world overrides the one shipped in the asset. The keystone therefore carries meshes, props, VFX and audio, never logic.
9. **It cannot use eval, typed arrays, Proxy, Web Crypto, TextEncoder, global timers, bundler output or TypeScript newer than 4.7.4.** All crypto here is hand-written over `number[]` and fits the per-script size limit.
10. **It cannot prevent a licensed buyer from re-sharing.** A buyer with a valid license has the key at runtime. Only per-buyer watermarking gives recourse after the fact.
11. **It cannot assume the platform is stable.** Engine, editor and VR tooling all changed in 2025 and 2026. Every Horizon call in the runtime is feature-detected and wrapped; if the platform changes under it, the result is `W00` and full function, not a broken world.

## What each guard state means for a player

| State | Tier | What the game serves | Why |
|---|---|---|---|
| `UNVERIFIED` | 0 | Full function on fallbacks (real tables cannot be unlocked without a key) | Verify has not run yet, or an internal error (`W00`) stopped it |
| `LICENSED` | 0 | Real tables | License verified for this world (`I00`) |
| `TRIAL` | 0 during `GRACE_MS`, then 1 | Trial tables | No license (`I01`) |
| `MISMATCH` | 1 | Trial tables | Valid license for another world (`E12`) |
| `INVALID` | 1 | Trial tables | Malformed (`E10`), bad signature (`E11`) or wrong SKU (`E14`) |
| `EXPIRED` | 1 | Real tables (data still unlocks); policy only | Timed license ran out (`E13`) |
| any, tier 2 | 2 | Mostly real tables with seed-jittered trial substitutions, after a 3 to 20 minute delay | A tampered build (a sentinel found two modules disagreeing, `W20`) or a revoked keystone in `degrade` mode (`W21`) |

Tier 2 is the only "graduated failure" path and it never happens at launch, so a cracker gets no clean "done" signal and a legitimate buyer never meets it. There is no idle or bricked tier.

## Other things to disclose

- **The blob integrity tag is a check against the seller's own build mistakes, not against an attacker.** Anyone with the key can re-encrypt.
- **Console output is visible to the world owner and every collaborator, never to visitors.** Request codes and diagnostics are safe to print; the license and keys are never printed in full (first 12 characters at most).
- **Builds are watermarked, and the license terms say so.** `templates/LICENSE-BUYER.md` discloses the marks and that three or more colluding buyers can degrade random marks.
- **A keystone that spawns while unshared can never revoke anything.** If live test T4 shows the asset spawns without a share, leave `KEYSTONE_MODE` at `off` forever for that asset.
- **Time never bricks anyone.** Expiry is policy only: an expired license still unlocks data; a world with no readable clock never expires.
