// revoke.mjs
// `hag revoke --buyer <id> [--reason "..."]`
// Marks the buyer revoked in the ledger (no further licenses or builds for that id) and
// prints what the platform actually lets a seller do next: unshare the keystone asset and
// any delivery world, and file the Meta IP report with the trace evidence. Nothing here
// reaches into the buyer's world; existing copies keep running unless the keystone live
// tests (docs/KEYSTONE-TEST.md) showed otherwise.
import { UsageError, need, nowIso, parseArgs } from './common.mjs';
import { getBuyer, loadLedger, saveLedger } from './state.mjs';
import { loadTemplate } from './templates.mjs';

// The checklist section of templates/meta-ip-report.md, shared with `hag report`.
export function ipChecklist() {
  const text = loadTemplate('meta-ip-report.md');
  const m = /<!-- checklist:begin -->([\s\S]*?)<!-- checklist:end -->/.exec(text);
  return m ? m[1].trim() : text;
}

export async function revoke(argv) {
  const { opts, positional } = parseArgs(argv, { known: ['buyer', 'reason'] });
  if (positional.length > 0) throw new UsageError('unexpected argument "' + positional[0] + '"');
  const id = need(opts, 'buyer', 'id');
  const ledger = loadLedger();
  const buyer = getBuyer(ledger, id);
  const already = buyer.revoked;
  buyer.revoked = already || nowIso();
  if (opts.reason !== undefined) buyer.revokeReason = String(opts.reason);
  saveLedger(ledger);

  const skuRec = ledger.skus[buyer.sku] || null;
  console.log('hag revoke: ' + id + (buyer.name ? ' (' + buyer.name + ')' : '') + ', SKU ' + buyer.sku + (already ? ' was already revoked on ' + already.slice(0, 10) : ' revoked ' + buyer.revoked.slice(0, 10)) + (buyer.revokeReason ? ' - ' + buyer.revokeReason : ''));
  console.log('  worlds: ' + (buyer.worlds.length ? buyer.worlds.join(', ') : 'none bound') + '; licenses issued: ' + buyer.licenses.length + '; builds: ' + buyer.builds.length);
  console.log('');
  console.log('Unshare steps (what the platform lets you do; see docs/SELLER-GUIDE.md):');
  console.log('  1. hag issue and hag build now refuse this buyer id. Keep the id; never reuse it.');
  console.log('  2. Keystone asset: in your asset library, remove the share of the seller-owned keystone asset(s) for this buyer' + (skuRec && skuRec.keystoneTests && skuRec.keystoneTests.length ? ' (your keystone-test records: ' + skuRec.keystoneTests.map((t) => t.test + '=' + t.result).join(', ') + ')' : ' (no keystone-test record for this SKU: treat the effect on running copies as unknown)') + '.');
  console.log('     Only if live test T5 passed does unsharing stop the spawned core content in every instance of their copies.');
  console.log('  3. Delivery world: remove the buyer from the collaborators of any Delivery_' + id + ' world and unpublish it.');
  console.log('  4. Shared folders / templates: unshare every asset folder shared with this buyer.');
  console.log('  5. Already-placed instances and scripts in the buyer\'s world survive all of the above (Roblox precedent; Horizon behaviour unconfirmed). Enforcement beyond that is the IP report and the contract.');
  console.log('');
  console.log('Meta IP report checklist:');
  for (const line of ipChecklist().split('\n')) console.log('  ' + line);
  console.log('');
  console.log('Next: hag trace <leaked copy>  (if not done)  then  hag report --buyer ' + id);
}
