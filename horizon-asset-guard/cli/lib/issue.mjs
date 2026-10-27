// issue.mjs
// `hag issue --sku <sku> --buyer <buyerId> --req <HAG-REQ-...> [--req <...> up to 4] [--unbound] [--expires YYYY-MM-DD]`
// Turns the buyer's request code(s) into a signed license: each code's SKU and check
// characters are validated (a typo in the world id is caught before a useless license is
// sent), the payload is built in contract order with the content key wrapped per world,
// signed with the SKU's private key, appended to the ledger, and printed together with the
// activation message (templates/activation-message.md). A license longer than 250 chars is
// shown split into chunks for the license / license2 / license3 props.
import { HagError, UsageError, isSku, need, nowIso, nowSeconds, parseArgs } from './common.mjs';
import { MAX_WORLDS, buildPayload, encodeLicense, parseLicense, parseRequestCode, publicKeyFromEmbedded, verifyLicense } from './formats.mjs';
import { getBuyer, loadKey, loadLedger, privateKeyOf, saveLedger } from './state.mjs';
import { renderTemplate } from './templates.mjs';

export const SPLIT_ABOVE = 250;
export const CHUNK = 200;
export const PROPS = ['license', 'license2', 'license3'];

// <= 250 chars: one prop. Otherwise 200-char chunks; when three of those are not enough
// (a 3- or 4-world license), three equal chunks and a warning (prop limit test T2).
export function splitLicense(license) {
  if (license.length <= SPLIT_ABOVE) return { chunks: [license], oversized: false };
  let size = CHUNK;
  let oversized = false;
  if (Math.ceil(license.length / size) > PROPS.length) {
    size = Math.ceil(license.length / PROPS.length);
    oversized = true;
  }
  const chunks = [];
  for (let i = 0; i < license.length; i += size) chunks.push(license.slice(i, i + size));
  return { chunks, oversized };
}

export function licenseBlock(chunks) {
  if (chunks.length === 1) return 'license: ' + chunks[0];
  return chunks.map((c, i) => PROPS[i] + ': ' + c).join('\n');
}

// End of the given UTC day, as epoch seconds.
export function parseExpiry(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).trim());
  if (!m) throw new UsageError('--expires must be YYYY-MM-DD');
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  if (Number.isNaN(t)) throw new UsageError('--expires is not a valid date');
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) throw new UsageError('--expires is not a valid calendar date');
  return Math.floor(t / 1000);
}

export async function issue(argv) {
  const { opts, positional } = parseArgs(argv, { known: ['sku', 'buyer', 'expires'], multi: ['req'], flags: ['unbound', 'json'] });
  if (positional.length > 0) throw new UsageError('unexpected argument "' + positional[0] + '" (request codes go after --req)');
  const sku = need(opts, 'sku', 'sku');
  const buyerId = need(opts, 'buyer', 'buyerId');
  if (!isSku(sku)) throw new UsageError('invalid SKU "' + sku + '"');

  const ledger = loadLedger();
  const buyer = getBuyer(ledger, buyerId);
  if (buyer.sku !== sku) throw new HagError('buyer "' + buyerId + '" belongs to SKU "' + buyer.sku + '", not "' + sku + '"');
  if (buyer.revoked) throw new HagError('buyer "' + buyerId + '" was revoked on ' + buyer.revoked + (buyer.revokeReason ? ' (' + buyer.revokeReason + ')' : '') + '; no new licenses');
  const keyRec = loadKey(sku);

  // Request codes -> bound world ids.
  const reqs = opts.req || [];
  if (reqs.length > MAX_WORLDS) throw new UsageError('at most ' + MAX_WORLDS + ' request codes (worlds) per license');
  const worlds = [];
  for (const r of reqs) {
    const p = parseRequestCode(r);
    if (!p.ok) throw new HagError('request code "' + p.code + '": ' + p.reason);
    if (p.sku !== sku) throw new HagError('request code ' + p.code + ' is for SKU "' + p.sku + '", not "' + sku + '"');
    if (p.worldId === 'NOWID') {
      if (!opts.unbound) throw new HagError('request code ' + p.code + ' has no world id (the buyer\'s world.id was unreadable, W02). Either ask for a code from a Play session where the console shows a numeric id, or issue --unbound');
      continue;
    }
    if (!worlds.includes(p.worldId)) worlds.push(p.worldId);
  }
  const mode = opts.unbound ? 'U' : 'W';
  if (mode === 'W' && worlds.length === 0) throw new UsageError('--req <HAG-REQ-...> is required (or --unbound for a license that works in any world)');
  const expires = opts.expires === undefined ? 0 : parseExpiry(opts.expires);
  if (expires !== 0 && expires <= nowSeconds()) throw new UsageError('--expires ' + opts.expires + ' is in the past');

  const payload = buildPayload({ sku, buyer: buyerId, mode, worlds, ck: Buffer.from(buyer.ck, 'hex'), wm: buyer.wm, issued: nowSeconds(), expires, name: buyer.name });
  const license = encodeLicense(payload, privateKeyOf(keyRec));
  if (!verifyLicense(parseLicense(license), publicKeyFromEmbedded(keyRec.n, keyRec.e))) throw new HagError('internal: the freshly signed license does not verify under its own public key');

  const entry = { issued: nowIso(), worlds: payload.w.slice(), expires: expires === 0 ? null : new Date(expires * 1000).toISOString(), mode, license, requestCodes: reqs.slice() };
  buyer.licenses.push(entry);
  for (const w of worlds) if (!buyer.worlds.includes(w)) buyer.worlds.push(w);
  saveLedger(ledger);

  const { chunks, oversized } = splitLicense(license);
  const worldsText = mode === 'U' ? 'any world (unbound)' : worlds.join(', ');
  const expiresText = expires === 0 ? '' : entry.expires.slice(0, 10);
  if (opts.json) {
    console.log(JSON.stringify({ license, payload, chunks, worlds: payload.w, expires: entry.expires, buyer: buyerId }, null, 2));
    return;
  }
  const message = renderTemplate('activation-message.md', {
    BUYER_NAME: buyer.name || buyerId,
    SKU: sku,
    WORLDS: worldsText,
    EXPIRES: expiresText,
    LICENSE: license,
    LICENSE_BLOCK: licenseBlock(chunks),
    SPLIT: chunks.length > 1 ? String(chunks.length) : '',
    DATE: entry.issued.slice(0, 10),
  });
  console.log('hag issue: license #' + buyer.licenses.length + ' for ' + buyerId + (buyer.name ? ' (' + buyer.name + ')' : '') + ', SKU ' + sku + ', world(s) ' + worldsText + (expiresText ? ', expires ' + expiresText : ', perpetual'));
  console.log('  ' + license.length + ' chars' + (chunks.length > 1 ? ', shown split into ' + chunks.length + ' props of up to ' + chunks[0].length + ' chars' : ''));
  if (oversized) console.log('  warning: a ' + worlds.length + '-world license needs ' + chunks[0].length + '-char props; confirm the prop limit (test T2) or issue fewer worlds per license');
  console.log('');
  console.log('LICENSE: ' + license);
  console.log('');
  console.log('---- activation message (copy from here) ----');
  console.log(message.trimEnd());
  console.log('---- end ----');
}
