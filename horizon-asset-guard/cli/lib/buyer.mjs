// buyer.mjs
// `hag buyer add --sku <sku> --id <buyerId> [--name "<display>"]`
// One ledger entry per sale: a random 16-hex watermark seed `wm` (every mark in the buyer's
// build derives from it) and a random 32-byte content key `ck` (ledger-only; the license
// carries it wrapped per world). A buyer who purchases a second SKU gets a second entry.
import { HagError, UsageError, isBuyerId, isSku, need, parseArgs } from './common.mjs';
import { randomHex } from './formats.mjs';
import { hasKey, loadLedger, newBuyer, saveLedger } from './state.mjs';

export async function buyer(argv) {
  const sub = argv[0];
  if (sub !== 'add') throw new UsageError('hag buyer add --sku <sku> --id <buyerId> [--name "<display>"]');
  const { opts, positional } = parseArgs(argv.slice(1), { known: ['sku', 'id', 'name'] });
  if (positional.length > 0) throw new UsageError('unexpected argument "' + positional[0] + '"');
  const sku = need(opts, 'sku', 'sku');
  const id = need(opts, 'id', 'buyerId');
  if (!isSku(sku)) throw new UsageError('invalid SKU "' + sku + '"');
  if (!isBuyerId(id)) throw new UsageError('invalid buyer id "' + id + '" (letters, digits, _ and - only, up to 32 characters)');
  if (!hasKey(sku)) throw new HagError('no key for SKU "' + sku + '"; run: hag keygen --sku ' + sku);
  const name = opts.name === undefined ? '' : String(opts.name).trim();

  const ledger = loadLedger();
  if (ledger.buyers[id]) throw new HagError('buyer "' + id + '" already exists (SKU ' + ledger.buyers[id].sku + '); pick another id');
  const rec = newBuyer({ id, name, sku, wm: randomHex(8), ck: randomHex(32) });
  ledger.buyers[id] = rec;
  saveLedger(ledger);

  console.log('hag buyer add: ' + id + (name ? ' (' + name + ')' : '') + ' for SKU ' + sku);
  console.log('  wm ' + rec.wm + ' (watermark seed), ck set (content key, ledger only)');
  console.log('Next: hag build --sku ' + sku + ' --buyer ' + id + ' --config hag.config.json --out out/' + id);
}
