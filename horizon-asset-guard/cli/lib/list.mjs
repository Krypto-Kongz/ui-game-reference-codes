// list.mjs
// `hag list [--json]` - the ledger at a glance: SKUs with key dates and keystone-test ages,
// then every buyer with worlds, license count, last issue date, builds and revocation.
import { UsageError, daysSince, pad, parseArgs } from './common.mjs';
import { loadLedger } from './state.mjs';

function keystoneSummary(rec) {
  const tests = (rec && rec.keystoneTests) || [];
  if (tests.length === 0) return 'no keystone tests';
  const latest = new Map();
  for (const t of tests) if (!latest.has(t.test) || t.date > latest.get(t.test).date) latest.set(t.test, t);
  return [...latest.values()].map((t) => t.test + '=' + t.result + ' (' + daysSince(t.date) + ' d)').join(', ');
}

export async function list(argv) {
  const { opts, positional } = parseArgs(argv, { flags: ['json'] });
  if (positional.length > 0) throw new UsageError('unexpected argument "' + positional[0] + '"');
  const ledger = loadLedger();
  if (opts.json) {
    const buyers = Object.values(ledger.buyers).map((b) => ({ ...b, ck: undefined, licenses: (b.licenses || []).map((l) => ({ ...l, license: undefined })) }));
    console.log(JSON.stringify({ skus: ledger.skus, buyers }, null, 2));
    return;
  }
  const skus = Object.values(ledger.skus);
  console.log('SKUs (' + skus.length + ')');
  for (const s of skus) console.log('  ' + pad(s.sku, 12) + ' key ' + (s.keyCreated || s.created || '?').slice(0, 10) + '  e=' + s.e + '  ' + keystoneSummary(s));
  const buyers = Object.values(ledger.buyers);
  console.log('Buyers (' + buyers.length + ')');
  if (buyers.length === 0) {
    console.log('  none yet: hag buyer add --sku <sku> --id <buyerId>');
    return;
  }
  console.log('  ' + pad('id', 10) + pad('name', 18) + pad('sku', 10) + pad('worlds', 26) + pad('lic', 5) + pad('last issued', 12) + pad('builds', 7) + 'revoked');
  for (const b of buyers) {
    const lic = b.licenses || [];
    const last = lic.length ? lic[lic.length - 1].issued.slice(0, 10) : '-';
    const worlds = (b.worlds || []).length ? b.worlds.join(',') : lic.some((l) => l.mode === 'U') ? '* (unbound)' : '-';
    console.log('  ' + pad(b.id, 10) + pad(b.name || '-', 18) + pad(b.sku, 10) + pad(worlds, 26) + pad(lic.length, 5) + pad(last, 12) + pad((b.builds || []).length, 7) + (b.revoked ? b.revoked.slice(0, 10) + (b.revokeReason ? ' ' + b.revokeReason : '') : '-'));
  }
  if (ledger.traces && ledger.traces.length) {
    const t = ledger.traces[ledger.traces.length - 1];
    console.log('Last trace: ' + t.date.slice(0, 10) + ' ' + t.path + ' -> ' + (t.top && t.top.length ? t.top[0].id + ' (' + t.top[0].confidence + ')' : 'no match') + '; report ' + t.report);
  }
}
