// keystone.mjs
// `hag keystone-test --sku <sku> --record "<test>=<result>" [--record ...] [--note "..."]`
// Stores dated live-test records (docs/KEYSTONE-TEST.md) for a SKU. The keystone tests
// proper (spec section 7) gate KEYSTONE_MODE 'degrade': `hag doctor` refuses it without one
// of them newer than 90 days, so a seller re-runs them per Studio release and records them:
//   T4      buyer spawns the UNSHARED seller asset -> which SpawnError
//   T5      shared -> Active; unshared -> re-spawn in a fresh instance fails? (pass criterion)
//   erase   seller erases the asset -> buyer spawn result
//   placed  a dragged static instance survives unshare / erase? (recorded separately)
//   T9      fetchAsData on the seller's text asset, shared and unshared; edit-then-refetch
// The other live tests of the checklist (T0 probe, T1 world id, T2 prop length, T7 version
// resolution, T11 timers, T12 verify timing) are recorded the same way for the ledger but do
// not count for the gate.
import { UsageError, daysSince, isSku, need, nowIso, parseArgs } from './common.mjs';
import { getSkuRecord, loadLedger, saveLedger } from './state.mjs';

export const KEYSTONE_GATE_TESTS = ['T4', 'T5', 'erase', 'placed', 'T9'];
export const KEYSTONE_TESTS = ['T0', 'T1', 'T2', 'T4', 'T5', 'erase', 'placed', 'T7', 'T9', 'T11', 'T12'];
const RECORD_RE = new RegExp('^\\s*(' + KEYSTONE_TESTS.join('|') + ')\\s*=\\s*(.+?)\\s*$', 'i');

export function parseRecord(text) {
  const m = RECORD_RE.exec(String(text));
  if (!m) throw new UsageError('--record must be "<' + KEYSTONE_TESTS.join('|') + '>=<result>", got "' + text + '"');
  const test = KEYSTONE_TESTS.find((t) => t.toLowerCase() === m[1].toLowerCase());
  return { test, result: m[2] };
}

export async function keystoneTest(argv) {
  const { opts, positional } = parseArgs(argv, { known: ['sku', 'note'], multi: ['record'], flags: ['list'] });
  if (positional.length > 0) throw new UsageError('unexpected argument "' + positional[0] + '"');
  const sku = need(opts, 'sku', 'sku');
  if (!isSku(sku)) throw new UsageError('invalid SKU "' + sku + '"');
  const ledger = loadLedger();
  const rec = getSkuRecord(ledger, sku, true);
  const records = opts.record || [];
  if (records.length === 0 && !opts.list) throw new UsageError('--record "<' + KEYSTONE_TESTS.join('|') + '>=<result>" is required (or --list)');
  const date = nowIso();
  for (const r of records) {
    const parsed = parseRecord(r);
    rec.keystoneTests.push({ test: parsed.test, result: parsed.result, date, note: opts.note || '' });
  }
  if (records.length > 0) saveLedger(ledger);
  console.log('hag keystone-test: SKU ' + sku + ', ' + records.length + ' record(s) added' + (opts.note ? ' (' + opts.note + ')' : ''));
  for (const t of rec.keystoneTests) console.log('  ' + t.date.slice(0, 10) + '  ' + t.test + ' = ' + t.result + '  (' + daysSince(t.date) + ' d ago)' + (t.note ? '  ' + t.note : ''));
  const missing = KEYSTONE_GATE_TESTS.filter((t) => !rec.keystoneTests.some((r) => r.test === t));
  if (missing.length) console.log('  keystone tests not yet recorded: ' + missing.join(', '));
}
