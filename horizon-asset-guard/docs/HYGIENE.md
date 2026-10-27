# Distribution hygiene

The protection in the scripts is the weaker half. These habits remove the leak paths that no script can close.

## Rules

1. **No buyer ever holds a role on your master world.** Not Editor, not Tester. Editors can copy anything in a world they collaborate on and may be able to Import World it. Keep the master in a world nobody but you can open.
2. **A per-buyer build for every sale, friends included.** Never hand out a generic build. `hag build --buyer <id>` is cheap; a leak you cannot attribute is not.
3. **Keys stay on your machine.** `.hag/keys/<sku>.json` holds the private key. Never put it in a world, a shared drive, a Discord message or a git repository. Set `HAG_KEY_PASSPHRASE` so the file is encrypted at rest; back up `.hag/` somewhere private (losing it means you can never issue another license for that SKU).
4. **Build for the buyer's world type.** File-backed-script (FBS) worlds and legacy worlds are incompatible; ask the buyer which they have before building and delivering.
5. **Deliver through a throwaway, never the master.** Two acceptable paths:
   - A `Delivery_b017` world you create for this sale: place the asset and scripts there, add the buyer as Tester or Editor for a day so they can Create Asset it into their own library, then remove them and delete the world.
   - An asset-library share (reported to work only between MHCP members).
   Either way, the delivered copy is the per-buyer build from `hag build`, nothing else.
6. **Ship the license terms with the build.** `hag build` writes `LICENSE-BUYER.md` into the output folder: single world, non-transferable, no re-sharing, watermark disclosure, "licensed, not sold". Make the buyer acknowledge it before delivery.
7. **Keep the ledger current.** Every `hag issue`, `hag revoke` and `hag keystone-test --record` writes to `.hag/ledger.json`. Record the buyer's probe output (`GuardProbe.ts`) with the sale when you can; it tells you what runtime they were on if a support question comes later.
8. **Never paste a buyer's license in public.** It is bound to their world and useless elsewhere, but it identifies the buyer and encourages copy-and-try. Send activation messages privately.
9. **Do not edit generated files by hand.** `GuardKey.ts` (per SKU) and `GuardData_*.ts` (per buyer) come from `hag`. Re-run the tool instead; a hand edit silently desynchronizes the ledger and `hag trace`.
10. **Re-run the live tests after each Horizon Studio release** if you rely on the keystone. `hag doctor` refuses `KEYSTONE_MODE: 'degrade'` without a record newer than 90 days.

## What the buyer's side looks like

Inside the buyer's world the scripts are world-level assets synced as `.ts` files to the External Editor Directory of every account with edit access. Assume everything you deliver is read by the buyer and by all of their Editors, and put nothing in a build you would not hand over in plain text. The real tables are encrypted; the trial tables, the game logic and the verify code are not, by design.

## Keystone hygiene (only if you use one)

- The keystone asset holds meshes, props, VFX and audio, never scripts: with FBS a same-id script already in the buyer's world overrides the one in your asset.
- Share the asset with the buyer; never give them the asset itself to re-save under their own account.
- Keep a list of which buyers the asset is shared with (the ledger's `worlds` and `revoked` fields cover the licenses; sharing is a Studio action and lives in your library's share list).
- Spawned at runtime by id only (`KEYSTONE_ID` in `GuardKey.ts`), never dragged in as a placed instance: placed instances most likely survive an unshare.

## When something goes wrong

- A buyer duplicated their world and lost activation: that is `E12` in their console with a fresh request code. Re-issue for free with both codes (`hag issue ... --req <old> --req <new>`); a license carries up to four world ids.
- A buyer's props truncate the license (`E10` with an offset): use the three props, or bake the license into `BAKED_LICENSE` in a rebuilt `GuardKey.ts`.
- You suspect a leak: `hag trace <copy>`, then `hag revoke --buyer <id>`, then `hag report --buyer <id>`. The report is the Meta IP packet. Note that Meta forwards the reporter's details to the accused party.
