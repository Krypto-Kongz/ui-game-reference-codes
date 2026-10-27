// verify.mjs
// `hag verify <license> [--sku <sku>] [--key <GuardKey.ts>] [--json]`
// Offline check with node:crypto and the decoded payload: structure (E10 with the offset),
// signature under the SKU's public key (E11), SKU (E14), expiry (E13). The public key comes
// from .hag/keys/<sku>.json or, with --key, from any GuardKey.ts (useful to confirm which key
// a shipped package carries). When the ledger knows the buyer, the wrapped key is unwrapped
// and compared with the ledger ck, which catches a build and a license that do not belong
// together. Exit 0 only when the license would be LICENSED in the right world.
import { HagError, UsageError, abbreviate, isSku, nowSeconds, parseArgs, readText } from './common.mjs';
import { parseLicense, publicKeyFromEmbedded, unwrapKey, verifyLicense } from './formats.mjs';
import { parseGuardKey } from './guardkey.mjs';
import { hasKey, loadKey, loadLedger } from './state.mjs';

export async function verify(argv) {
  const { opts, positional } = parseArgs(argv, { known: ['sku', 'key'], flags: ['json'] });
  if (positional.length === 0) throw new UsageError('hag verify <license> [--sku <sku>] [--key <GuardKey.ts>]');
  const raw = positional.join('');
  const p = parseLicense(raw);
  const lines = [];
  const result = { ok: false, state: 'INVALID', code: p.code, detail: p.detail, payload: p.payload };
  const finish = (exitCode) => {
    if (opts.json) console.log(JSON.stringify(result, null, 2));
    else for (const l of lines) console.log(l);
    if (exitCode !== 0) throw new HagError('', exitCode);
  };
  if (!p.ok) {
    lines.push('E10 malformed license: ' + p.detail);
    return finish(1);
  }
  const pl = p.payload;
  const sku = opts.sku || pl.s; // the SKU this license is expected to be for (E14 otherwise)
  if (!isSku(sku)) throw new HagError('invalid SKU "' + sku + '"');

  // The public key: --key wins; else the .hag key of the license's own SKU (so a license for
  // another SKU still gets its signature checked before E14 is reported); else of --sku.
  let pubN;
  let pubE;
  let keySource;
  if (opts.key) {
    const g = parseGuardKey(readText(opts.key));
    if (!g.pubN || g.pubE === null) throw new HagError(opts.key + ' has no PUB_N / PUB_E');
    pubN = g.pubN;
    pubE = g.pubE;
    keySource = opts.key + (g.sku ? ' (SKU ' + g.sku + ')' : '');
  } else {
    const keySku = isSku(pl.s) && hasKey(pl.s) ? pl.s : sku;
    if (!hasKey(keySku)) throw new HagError('no key for SKU "' + keySku + '" in .hag; pass --key <GuardKey.ts> to verify against a shipped public key');
    const rec = loadKey(keySku);
    pubN = rec.n;
    pubE = rec.e;
    keySource = '.hag key for SKU ' + keySku;
  }

  const sigOk = verifyLicense(p, publicKeyFromEmbedded(pubN, pubE));
  const now = nowSeconds();
  const expired = pl.e > 0 && now > pl.e;
  const ledger = loadLedger();
  const buyer = ledger.buyers[pl.b] || null;
  let ckMatch = null;
  if (buyer && buyer.ck && buyer.wm === pl.wm) {
    try {
      ckMatch = unwrapKey(pl.kw[0], pl.w[0], pl.s, pl.wm).toString('hex') === buyer.ck;
    } catch (e) {
      ckMatch = false;
    }
  }

  lines.push('license: ' + abbreviate(p.raw, 40));
  lines.push('key: ' + keySource);
  lines.push('payload: ' + JSON.stringify(pl, null, 2));
  lines.push('buyer: ' + pl.b + (pl.n ? ' (' + pl.n + ')' : '') + (buyer ? ' - in ledger' + (buyer.revoked ? ', REVOKED ' + buyer.revoked : '') : ' - not in this ledger'));
  lines.push('binding: ' + (pl.m === 'U' ? 'unbound (any world)' : 'world id(s) ' + pl.w.join(', ')));
  lines.push('issued: ' + new Date(pl.i * 1000).toISOString() + '; expires: ' + (pl.e === 0 ? 'never' : new Date(pl.e * 1000).toISOString() + (expired ? ' (EXPIRED)' : '')));
  if (ckMatch !== null) lines.push('content key: ' + (ckMatch ? 'unwraps to the ledger ck (license and builds for ' + pl.b + ' belong together)' : 'does NOT unwrap to the ledger ck (license and ledger disagree)'));
  result.ckMatch = ckMatch;

  if (!sigOk) {
    result.code = 'E11';
    result.detail = 'signature does not verify under ' + keySource;
    lines.push('E11 signature: FAILED (' + result.detail + ')');
    return finish(1);
  }
  lines.push('signature: OK (RSA-2048 PKCS#1 v1.5 / SHA-256 over "HAG1.<payload>")');
  if (pl.s !== sku) {
    result.code = 'E14';
    result.detail = 'license is for SKU "' + pl.s + '", not "' + sku + '"';
    lines.push('E14 sku: ' + result.detail);
    return finish(1);
  }
  if (expired) {
    result.state = 'EXPIRED';
    result.code = 'E13';
    result.detail = 'expired ' + new Date(pl.e * 1000).toISOString();
    lines.push('E13 expired (the runtime still unlocks data; policy only)');
    return finish(1);
  }
  result.ok = true;
  result.state = 'LICENSED';
  result.code = 'I00';
  result.detail = 'licensed to ' + (pl.n || pl.b);
  lines.push('I00 OK: ' + result.detail + (pl.m === 'U' ? '' : ' in world ' + pl.w.join(' / ')));
  return finish(0);
}
