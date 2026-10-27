// report.mjs
// `hag report --buyer <id> [--out <file>]`
// Writes the Markdown evidence packet for one buyer from the ledger and the last trace
// report: identity, licenses and their issue dates, every build's blob hashes and mark
// counts, the revocation, the keystone-test records, and the trace result. It fills
// templates/meta-ip-report.md, which also carries the Meta report checklist and the note
// that Meta forwards the reporter's details to the accused party.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UsageError, abbreviate, isoDay, need, parseArgs, writeFileAtomic } from './common.mjs';
import { getBuyer, loadLedger } from './state.mjs';
import { renderTemplate } from './templates.mjs';

function licenseRows(buyer) {
  if (buyer.licenses.length === 0) return '| - | no license issued | | |';
  return buyer.licenses.map((l, i) => '| ' + (i + 1) + ' | ' + l.issued.slice(0, 10) + ' | ' + (l.mode === 'U' ? 'unbound' : (l.worlds || []).join(', ')) + ' | ' + (l.expires ? l.expires.slice(0, 10) : 'never') + ' | `' + abbreviate(l.license, 24) + '` |').join('\n');
}

function buildRows(buyer) {
  if (buyer.builds.length === 0) return '| - | no build recorded | | |';
  return buyer.builds.map((b, i) => '| ' + (i + 1) + ' | ' + b.date.slice(0, 10) + ' | ' + (b.tables || []).join(', ') + ' | ' + Object.entries(b.blobs || {}).map(([n, h]) => n + ': `' + h + '`').join('; ') + ' |').join('\n');
}

function markRows(buyer) {
  const names = Object.keys(buyer.marks || {});
  if (names.length === 0) return '| - | | | |';
  return names.map((n) => {
    const m = buyer.marks[n] || {};
    return '| ' + n + ' | ' + ((m.keys || []).length) + ' | ' + Object.keys(m.slack || {}).length + ' | ' + Object.keys(buyer.names && buyer.names[n] ? buyer.names[n] : {}).length + ' |';
  }).join('\n');
}

function keystoneRows(rec) {
  const tests = (rec && rec.keystoneTests) || [];
  if (tests.length === 0) return '| - | no live-test record for this SKU | |';
  return tests.map((t) => '| ' + t.date.slice(0, 10) + ' | ' + t.test + ' | ' + t.result + (t.note ? ' (' + t.note + ')' : '') + ' |').join('\n');
}

function traceSection(ledger, buyer) {
  const traces = (ledger.traces || []).filter((t) => (t.top || []).some((c) => c.id === buyer.id));
  const t = traces.length ? traces[traces.length - 1] : null;
  if (!t) return 'No trace run has named this buyer yet. Run `hag trace <leaked copy>` and re-run `hag report`.';
  const head = 'Last trace naming this buyer: ' + t.date + ', scanned `' + t.path + '`, confidence **' + t.confidence + '**' + (t.collusion ? ' (collusion candidate flagged)' : '') + '.';
  if (t.report && existsSync(t.report)) {
    const body = readFileSync(t.report, 'utf8').replace(/^# hag trace report\s*/, '');
    return head + '\n\n---\n\n' + body.trim() + '\n\n---';
  }
  return head + '\n\nThe report file `' + t.report + '` is no longer at that path; the ranking recorded in the ledger was: ' + (t.top || []).map((c) => c.id + ' (' + c.score + ')').join(', ') + '.';
}

export async function report(argv) {
  const { opts, positional } = parseArgs(argv, { known: ['buyer', 'out'] });
  if (positional.length > 0) throw new UsageError('unexpected argument "' + positional[0] + '"');
  const id = need(opts, 'buyer', 'id');
  const ledger = loadLedger();
  const buyer = getBuyer(ledger, id);
  const skuRec = ledger.skus[buyer.sku] || null;
  const outPath = resolve(opts.out || 'report-' + id + '.md');
  const text = renderTemplate('meta-ip-report.md', {
    DATE: isoDay(),
    SELLER: process.env.HAG_SELLER || '(seller name)',
    SKU: buyer.sku,
    BUYER_ID: buyer.id,
    BUYER_NAME: buyer.name || '(no display name)',
    CREATED: buyer.created ? buyer.created.slice(0, 10) : '?',
    WM: buyer.wm,
    WORLDS: buyer.worlds.length ? buyer.worlds.join(', ') : 'none bound (unbound license or none issued)',
    LICENSE_ROWS: licenseRows(buyer),
    BUILD_ROWS: buildRows(buyer),
    MARK_ROWS: markRows(buyer),
    KEYSTONE_ROWS: keystoneRows(skuRec),
    REVOKED: buyer.revoked ? buyer.revoked.slice(0, 10) + (buyer.revokeReason ? ' - ' + buyer.revokeReason : '') : '',
    REVOKED_TEXT: buyer.revoked ? buyer.revoked.slice(0, 10) + (buyer.revokeReason ? ' - ' + buyer.revokeReason : '') : 'no',
    TRACE_SECTION: traceSection(ledger, buyer),
  });
  writeFileAtomic(outPath, text);
  console.log('hag report: evidence packet for ' + id + ' written to ' + outPath);
  console.log('  attach: the leaked files, the trace report, LICENSE-BUYER.md as delivered, and the activation message you sent.');
}
