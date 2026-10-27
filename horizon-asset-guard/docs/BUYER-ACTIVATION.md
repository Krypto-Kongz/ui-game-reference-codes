# Activating your copy (for the buyer)

You bought a game built with horizon-asset-guard. Your copy runs right away as a **trial** build; activating it for your world takes one message to the seller and one paste. Nothing phones home and nothing is installed outside your world.

## What you received

- A folder of scripts (`AssetGuard.ts`, `Guard.ts`, `GuardCore.ts`, `GuardKey.ts`, `GuardKeystone.ts`, `GuardProbe.ts`, a `crypto/` folder, and one `GuardData_<name>.ts` per data table), plus the game's own scripts and the asset itself.
- `BUYER-README.md` (which files go where) and `LICENSE-BUYER.md` (the terms: one world, non-transferable, no re-sharing, and your copy is watermarked).

## Steps

1. **Put everything in your world.** Copy all the scripts into your world's scripts folder, including the `crypto/` folder. The scripts find each other by name; do not rename them.
2. **Find the guard object.** The asset has an empty object with `AssetGuard.ts` attached (execution mode Default). If you built the hierarchy yourself, create one under the game root and attach `AssetGuard.ts`. Optionally point its `statusText` prop at a Text gizmo so the status shows in the world.
3. **Press Play and read the console** (Editor Console, or a Debug Console gizmo). You will see:

   ```
   [AssetGuard] I01 no license, trial mode. Activation request code: HAG-REQ-mygame-1234567890123456-QK42
   ```

   The Text gizmo, if wired, shows `Trial — activation code: HAG-REQ-mygame-1234567890123456-QK42`.
4. **Send the code to the seller** (the whole `HAG-REQ-...` line). It contains your world id and a check; it contains nothing private.
5. **Paste the license you get back** into the guard object's props. The seller's message gives it in up to three pieces: `license`, `license2`, `license3`. Paste each piece into the prop with the same name, in order, with no spaces added or removed. A short license fits in `license` alone.
6. **Press Reset, or Play again.** The console shows:

   ```
   [AssetGuard] I00 licensed to Ana
   ```

   and the Text gizmo shows `Licensed to Ana`. Done. The license is bound to this world and keeps working offline, forever unless the seller sold you a timed one.

## If something else shows

| Console line | What it means | What to do |
|---|---|---|
| `E10 truncated: signature ends at offset 300 (84 of 342 characters) ...` | The license was cut when pasting; the number is where. | Use `license2` / `license3` for the rest, exactly as the seller split it. |
| `E10 invalid character """ at offset N` | A quote or another stray character got in (spaces and line breaks are ignored). | Re-paste the piece without the quotes. |
| `E11 license rejected: signature does not verify ...` | Not a license from this seller for this product, or a script was edited. | Re-paste from the seller's message; make sure `GuardKey.ts` is the delivered one. |
| `E12 license is for another world. live world: 456, licensed: 123` and a new `HAG-REQ-...` | This license is for a different world id (you duplicated or re-created the world). | Send the new code to the seller; re-issues for a duplicated world are free and one license can cover up to four of your worlds. |
| `E13 license expired at ...` | A timed license ran out. The game keeps its real data; some policy features drop. | Ask the seller for a renewal. |
| `E14 ... license is for SKU "x" but this build is SKU "y"` | A license for a different product. | Ask the seller for the right one. |
| `W02 world id unreadable; binding falls open to the licensed world` | Your runtime does not expose the world id. The game runs fully. | Nothing. Tell the seller so they know. |
| `W00 internal error, running unverified at tier 0: ...` | Something unexpected in the runtime. The game runs fully on its fallbacks. | Copy the line to the seller. |
| `[GuardKeystone] W03 ...` | An optional seller-owned asset could not be spawned (often a world-type mismatch). Placeholders are used. | Tell the seller which error it printed; it is not a license problem. |

What "trial" means: everything runs, but the data tables (levels, waves, loot, tuning) are the seller's trial versions. Nothing crashes, nothing is hidden behind an error; it is the same game with less content until the license is in.

## Things not to do

- Do not edit `GuardKey.ts` or any `GuardData_*.ts`; they are generated for your copy, and the license terms you accepted cover them.
- Do not give your scripts to anyone. Your copy carries marks that identify it as yours even after edits, and the terms make you responsible for copies that come from it.
- Do not add the seller as a collaborator on your world to "help activate"; they do not need it and the seller's own hygiene rules forbid it.

## Message template the seller sends you

(`hag issue` prints this filled in; it is the text in `templates/activation-message.md`.)

```
Hi Ana,

Here is your license for <game> in world <world id>. Paste the pieces into the AssetGuard object's props, exactly as shown, then press Reset:

license:  HAG1.eyJ2IjoxLCJzIjoi...
license2: ...
license3: ...

You should see "Licensed to Ana" in the console. If you duplicate the world later, send me the new HAG-REQ code from the console and I will re-issue for free. The license is for your world only and the copy is watermarked, as in LICENSE-BUYER.md.
```
