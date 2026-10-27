# demo — buyer package for Ana

Built 2026-10-26 for buyer b001 by Demo Seller. This package is licensed to one world (see LICENSE-BUYER.md)
and is watermarked: every copy is traceable to the buyer it was built for.

## 1. Copy the scripts

Copy every `.ts` file under `scripts/` (including the ones in `scripts/crypto/`) into your
world's scripts folder (Horizon Studio: Scripts panel > Open in External Editor; the folder is
flat, so the files from `scripts/crypto/` go next to the others). Files:

- `scripts/AssetGuard.ts`
- `scripts/Guard.ts`
- `scripts/GuardCore.ts`
- `scripts/GuardData_tunables.ts`
- `scripts/GuardData_waves.ts`
- `scripts/GuardKey.ts`
- `scripts/GuardKeystone.ts`
- `scripts/GuardProbe.ts`
- `scripts/crypto/BigNum.ts`
- `scripts/crypto/Bytes.ts`
- `scripts/crypto/ChaCha20.ts`
- `scripts/crypto/README.md`
- `scripts/crypto/Rsa.ts`
- `scripts/crypto/Sha256.ts`

The `GuardData_*.ts` files hold your encrypted game data; the other files are the guard runtime.
Do not rename, edit or reformat any of them: a changed file only yields trial data.

## 2. Place the guard

1. Add an empty object under the game root and attach the `AssetGuard` script (execution mode: default / server).
2. Optional: point its `statusText` prop at a Text gizmo to see the activation status in-world.
3. Press Play. The console prints a line like `I01 ... HAG-REQ-demo-<world id>-XXXX`.

## 3. Activate

Send that `HAG-REQ-...` code to Demo Seller. You get back a license that starts with `HAG1.`
and a short activation message. Paste the license into the `license` prop of the AssetGuard
entity (split across `license`, `license2`, `license3` exactly as the message shows) and press
Reset. The console then prints `I00 licensed to ...`.

Until then the game runs in trial mode: everything works, but the data tables (waves, tunables)
are the trial versions. Duplicated or moved the world? Press Play there, send the new code, and
ask for a re-issue (free for your own worlds, up to 4 per license).

## Console codes

| Code | Meaning | What to do |
|---|---|---|
| I01 | no license, trial mode | send the request code to the seller |
| I00 | licensed | nothing |
| E10 | license text malformed or cut (the offset is printed) | re-paste; check every prop holds its whole chunk |
| E11 | signature does not verify | the license was altered or is for another seller key; ask for a re-issue |
| E12 | license is for another world | send the new HAG-REQ code for a re-issue |
| E13 | license expired | ask the seller for a renewal |
| E14 | license is for another product | ask the seller |
| E20 | a data file was altered | restore the original GuardData file |
| W02 | world id unreadable (platform change); the guard fails open | tell the seller |

