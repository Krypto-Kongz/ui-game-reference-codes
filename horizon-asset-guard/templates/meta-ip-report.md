# Evidence packet - {{SKU}} / buyer {{BUYER_ID}}

Prepared {{DATE}} by {{SELLER}} with `hag report`. Source of record: the seller's `.hag/ledger.json` (never shared in full; this packet reproduces the entries that matter).

## 1. Summary

| Item | Value |
|---|---|
| Product (SKU) | {{SKU}} |
| Buyer id | {{BUYER_ID}} |
| Buyer display name | {{BUYER_NAME}} |
| Buyer record created | {{CREATED}} |
| Licensed world id(s) | {{WORLDS}} |
| Watermark seed (wm) | `{{WM}}` |
| Revoked | {{REVOKED_TEXT}} |

{{#if REVOKED}}The license was revoked on {{REVOKED}}.{{/if}}

## 2. Licenses issued

| # | issued | bound world(s) | expires | license (abbreviated) |
|---|---|---|---|---|
{{LICENSE_ROWS}}

The full license strings are in the ledger. Each one is signed with the seller's RSA-2048 key for this SKU; `hag verify <license>` reproduces the check offline.

## 3. Builds delivered (fingerprints)

| # | built | data tables | blob hashes (first 16 hex of SHA-256 of each encrypted blob) |
|---|---|---|---|
{{BUILD_ROWS}}

Per-table watermark inventory recorded at build time:

| table | `_m` marks | slack constants | mangled identifiers |
|---|---|---|---|
{{MARK_ROWS}}

How the marks work: every build of this product is generated per buyer from the seed above. The data tables receive extra `_m` keys and seed-derived constants inside seller-declared ranges, the verify core is copied into each data module with per-buyer identifier names, and each encrypted blob is unique. A copy keeps these marks even after the data is decrypted and the encryption removed, so a match of several kinds of mark is not a coincidence (each `_m` key is a 1-in-65536 chance for any other buyer; each identifier a 1-in-10^9 chance).

## 4. Trace result

{{TRACE_SECTION}}

## 5. Keystone live-test records for this SKU

| date | test | result |
|---|---|---|
{{KEYSTONE_ROWS}}

## 6. Timeline

- {{CREATED}}: buyer record created and the first per-buyer build generated.
- See sections 2 and 3 for license and build dates, and section 4 for the trace date.
{{#if REVOKED}}- {{REVOKED}}: license revoked.
{{/if}}

## 7. Meta IP report checklist

<!-- checklist:begin -->
1. Collect the evidence: this packet, the `hag trace` report, the leaked files exactly as found, the URL and world name of the infringing world, screenshots showing the copied content in it, and the dates you observed it.
2. Collect your proof of ownership: the master world, the original source files with their creation dates, the per-buyer build record (section 3) and the license terms delivered with the package (LICENSE-BUYER.md) plus the activation message you sent.
3. Confirm the match: the trace confidence is "high" or "medium" and the matched buyer is the one you are reporting; if the report flags collusion, name both buyers.
4. File the report with Meta's copyright report form for Horizon Worlds content (Meta Quest Help > Report a copyright or trademark infringement), describing which world copies which of your assets and scripts, and attach the evidence. Also use the in-world report option on the infringing world.
5. Be aware that Meta forwards the reporter's name and contact details to the accused party, and that outcome and speed are not guaranteed.
6. Contract claim: send the buyer the notice of breach under LICENSE-BUYER.md sections 3 and 4 with the trace summary; keep copies of everything.
7. Hygiene afterwards: `hag revoke`, unshare the keystone asset and any delivery world, rotate nothing (the key stays valid for your other buyers), and keep the ledger backed up.
<!-- checklist:end -->
