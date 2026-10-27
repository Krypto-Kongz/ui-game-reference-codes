# Seller guide: the per-sale workflow

Exact commands for one SKU (a product you sell) across its life: setup once, a few commands per sale, three commands on a leak.

## Conventions

- `hag` means `node cli/hag.mjs`, run inside the `horizon-asset-guard` folder. Node 18 or newer; no npm packages at runtime (`npm install` fetches only TypeScript 4.7.4 for `hag doctor` and the tests, and quickjs-emscripten for the tests).
- State lives in `.hag/` in the current folder, or wherever `HAG_HOME` points: `.hag/keys/<sku>.json` (your private key) and `.hag/ledger.json` (buyers, worlds, licenses, watermark records, test records). Back it up privately; never ship or commit it (`.gitignore` already excludes it if you keep `.hag/` here).
- Set `HAG_KEY_PASSPHRASE` in your shell to keep the private key encrypted on disk. The same variable unlocks it for `hag issue`.
- Buyer ids are short ledger keys you choose (`b017`); display names are for status text and the ledger.

## One-time setup per SKU

```
npm install
hag keygen --sku mygame --out runtime/GuardKey.ts
```

`keygen` makes an RSA-2048 keypair, stores the private half in `.hag/keys/mygame.json`, and writes the public half plus `SKU` into `runtime/GuardKey.ts`. If `GuardKey.ts` already exists it keeps your `GRACE_MS`, `KEYSTONE_ID`, `KEYSTONE_MODE` and `BAKED_LICENSE` values. Options: `--e 3` for a verify that is about four times faster on slow devices (see `KEYSTONE-TEST.md`, T12).

Then open `runtime/GuardKey.ts` and decide:

| Setting | Default | Meaning |
|---|---|---|
| `GRACE_MS` | `0` | How long an unlicensed world stays at tier 0 policy before tier 1. Data is trial either way. `0` is right for most games. |
| `KEYSTONE_ID` | `'0'` | Your keystone asset id as a decimal string, or `'0'` for none. |
| `KEYSTONE_MODE` | `'off'` | `'warn'` logs, `'degrade'` acts (only after the live tests; `hag doctor` enforces this). |
| `BAKED_LICENSE` | `''` | A license baked in at build time (zero-step activation when you collected the request code at checkout). |

Write `hag.config.json` next to your data (`examples/hag.config.json` is the pattern):

```json
{
  "sku": "mygame",
  "data": { "waves": "data/waves.json", "tunables": "data/tunables.json" },
  "marks": { "tunables.respawnDelay": [1.9, 2.1] }
}
```

Integrate the game (`INTEGRATION.md`), then check the package:

```
hag doctor
```

`doctor` runs the runtime lint, the size caps and a TypeScript 4.7.4 compile over `runtime/`, and refuses `KEYSTONE_MODE: 'degrade'` without a fresh keystone-test record (one of T4, T5, erase, placed or T9 newer than 90 days). Fix everything it prints before the first sale. The same command checks a finished buyer package: `hag doctor --dir builds/b017` (it descends into `scripts/`).

Optional but recommended before you promise anything: run the live tests in `KEYSTONE-TEST.md` (T0, T1 and T2 at least; T4 and T5 if you use a keystone) and record them.

## Per sale

### 1. Register the buyer

```
hag buyer add --sku mygame --id b017 --name "Ana"
```

Creates the ledger entry with a random watermark seed and a random 32-byte content key for this buyer. Both stay in the ledger; neither is ever printed in full.

### 2. Build their copy

```
hag build --sku mygame --buyer b017 --config hag.config.json --out builds/b017
```

What it does: applies the data-domain watermarks (hidden `_m` keys in about a third of the JSON objects, the `marks` values nudged inside their slack), encrypts each table under Ana's content key with a fresh nonce, inlines a copy of the verify-and-derive core with every internal name renamed from Ana's seed, and writes:

- `builds/b017/scripts/` : the whole `runtime/` tree (with `crypto/`) plus `GuardData_waves.ts`, `GuardData_tunables.ts`, ... one per table.
- `builds/b017/BUYER-README.md` : which files to copy and where to attach `AssetGuard.ts`.
- `builds/b017/LICENSE-BUYER.md` : the terms (single world, non-transferable, no re-sharing, watermark disclosure).

The ledger records the blob hashes, the renamed identifiers and the mark values so `hag trace` can recognise this copy later.

Build for the buyer's world type (file-backed scripts or legacy; they are incompatible) and never reuse one buyer's build for another.

### 3. Apply the Studio marks (manual, 5 minutes)

Nothing outside Horizon Studio can edit a world, so these per-buyer marks on the asset itself are a checklist you apply by hand before Create Asset, in a throwaway delivery world (never the master):

- Rename two or three entities with a per-buyer suffix (`Spawner_A3`, `Spawner_K7`).
- Nudge two decorative children by 0.0007 m on one axis.
- Add a per-buyer tag string to one entity.
- Save the result as a per-buyer asset template (its id is itself a mark).

Write down what you chose in a file next to the build (for example `builds/b017/studio-marks.md`). These survive a full script rewrite, which the data marks do not.

### 4. Deliver

Per `HYGIENE.md`: a throwaway `Delivery_b017` world with Ana as Tester or Editor for a day, or an asset-library share. Ana copies the asset and the scripts into her own world. Remove her role and delete the delivery world afterwards.

### 5. Issue the license

Ana presses Play, reads the console (`[AssetGuard] I01 no license, trial mode. Activation request code: HAG-REQ-mygame-1234567890123456-QK42`) or the status text, and sends you the code.

```
hag issue --sku mygame --buyer b017 --req HAG-REQ-mygame-1234567890123456-QK42
```

`issue` checks the code's SKU and check characters (a typo is caught here, not at the buyer's end), builds the signed license bound to that world id, appends it to the ledger, and prints the license plus the activation message from `templates/activation-message.md`, with the license already split into pieces of at most 200 characters for the `license`, `license2` and `license3` props when it is longer than 250 characters. Paste the message to Ana privately.

Options:

- `--req <code>` up to four times: one license for a staging world, the published world and a backup copy.
- `--unbound`: a license that works in any world (for a trusted buyer; the binding promise is off for this sale).
- `--expires 2027-12-31`: a timed license. Expiry is policy only (tier 1); data stays unlocked, so a buyer is never bricked by the calendar.

### 6. Confirm

Ana pastes, presses Reset or Play, and sees `[AssetGuard] I00 licensed to Ana`. Ask her for the `GuardProbe.ts` table once (the runtime fingerprint for later support) and keep it with the sale.

```
hag list
```

shows buyers, bound worlds, issue dates, expiries, revocations and the age of your keystone-test records.

### Re-issues

- **Duplicated world** (`E12` on Ana's side with a fresh code): free re-issue with both world ids so both copies work:

  ```
  hag issue --sku mygame --buyer b017 --req HAG-REQ-mygame-1234567890123456-QK42 --req HAG-REQ-mygame-9876543210987654-3FZ8
  ```

- **Truncated paste** (`E10 ... at offset N`): resend the three-piece message; if the props cannot hold 200 characters, set `BAKED_LICENSE` in a copy of `GuardKey.ts` for this buyer and send that file.
- **Lost license:** `hag list` shows it; `hag verify <license>` confirms it still checks out offline and prints the decoded payload.

## On a leak

You find your game in a world you did not license, or a copy of the scripts is posted somewhere.

```
hag trace <folder-or-file>
```

Point it at the leaked `GuardData_*.ts` files, at a plain JSON dump of the tables, or at a folder with either. It scores the copy against every buyer in the ledger (renamed identifiers, `_m` keys, nudged mark values, blob hashes), prints the ranked candidates with the evidence for each, and writes `trace-report.md`. Two buyers scoring high together means they compared copies; both are named.

```
hag revoke --buyer b017 --reason "copy found in world 5555555555555555"
hag report --buyer b017
```

`revoke` marks the ledger entry, prints the unshare steps for the keystone asset (if you use one and T5 passed) and the Meta IP report checklist. `report` writes the evidence packet (buyer record, issue dates, bound worlds, the trace report, the license terms they accepted) in Markdown for the Meta copyright form and for a private claim. Meta forwards the reporter's details to the accused party; decide whether that is acceptable before filing.

What revocation does and does not do: a revoked buyer's existing license still verifies (there is no phone-home); the keystone, if the live tests passed, stops spawning in every copy after you unshare; the watermark and the ledger are the evidence. See `LIMITS.md`.

## Keeping the ledger honest

`.hag/ledger.json` holds, per buyer: id, name, SKU, watermark seed, content key, creation date, bound worlds, every issued license with its date and expiry, blob hashes, mark values, renamed-identifier map, revocation date and reason. It is the only record that ties a copy to a person. Back it up after every `issue`, and never edit it by hand.

`hag keystone-test --sku mygame --record "T5=pass ..."` adds a dated test record per SKU; `hag doctor` and `hag list` read them.
