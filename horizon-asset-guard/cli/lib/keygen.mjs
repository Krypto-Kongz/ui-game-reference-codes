// keygen.mjs
// `hag keygen --sku <sku> [--e 65537|3] [--out <path to GuardKey.ts>] [--force]`
// One RSA-2048 keypair per SKU. The private key stays in .hag/keys/<sku>.json (PKCS#8 PEM,
// encrypted when HAG_KEY_PASSPHRASE is set); the public half is written into GuardKey.ts,
// the generated runtime file that ships with every build. An existing GuardKey.ts keeps its
// policy values (GRACE_MS, KEYSTONE_ID, KEYSTONE_MODE, BAKED_LICENSE): keygen only ever
// replaces SKU, PUB_N and PUB_E. e = 3 is the Quest-friendly option (5 ms instead of 22 ms
// per verify in a slow interpreter; safe here because the runtime compares the full
// encoded message, so the e = 3 forgeries do not apply).
import { generateKeyPairSync } from 'node:crypto';
import { join, resolve } from 'node:path';
import { HagError, RUNTIME_DIR, UsageError, isSku, need, nowIso, parseArgs, writeFileAtomic } from './common.mjs';
import { embeddedFromKey } from './formats.mjs';
import { POLICY_DEFAULTS, parseGuardKey, policyOf, renderGuardKey } from './guardkey.mjs';
import { getSkuRecord, hasKey, keyPath, loadLedger, readTextIfExists, saveKey, saveLedger } from './state.mjs';

export async function keygen(argv) {
  const { opts, positional } = parseArgs(argv, { known: ['sku', 'e', 'out'], flags: ['force'] });
  if (positional.length > 0) throw new UsageError('unexpected argument "' + positional[0] + '"');
  const sku = need(opts, 'sku', 'sku');
  if (!isSku(sku)) throw new UsageError('invalid SKU "' + sku + '" (letters, digits and _ only, up to 32 characters, no "-")');
  const e = opts.e === undefined ? 65537 : Number(opts.e);
  if (e !== 65537 && e !== 3) throw new UsageError('--e must be 65537 (default) or 3');
  const outPath = resolve(opts.out || join(RUNTIME_DIR, 'GuardKey.ts'));

  if (hasKey(sku) && !opts.force) {
    throw new HagError(
      'a key for SKU "' + sku + '" already exists at ' + keyPath(sku) + '. Replacing it would invalidate every license issued for this SKU so far; ' +
        'if that is intended, re-run with --force.',
    );
  }

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: e });
  const passphrase = process.env.HAG_KEY_PASSPHRASE;
  const pem = privateKey.export(passphrase ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase } : { type: 'pkcs8', format: 'pem' });
  const pub = embeddedFromKey(privateKey);
  saveKey({ sku, created: nowIso(), e: pub.e, n: pub.n, privateKeyPem: pem, encrypted: Boolean(passphrase), guardKey: outPath });

  // GuardKey.ts: policy survives, the key part is replaced.
  const existing = readTextIfExists(outPath);
  let policy = { ...POLICY_DEFAULTS };
  let kept = null;
  if (existing !== null) {
    const parsed = parseGuardKey(existing);
    policy = policyOf(parsed);
    kept = parsed;
  }
  writeFileAtomic(outPath, renderGuardKey({ sku, pubN: pub.n, pubE: pub.e, ...policy }));

  const ledger = loadLedger();
  const rec = getSkuRecord(ledger, sku, true);
  rec.e = pub.e;
  rec.n = pub.n;
  rec.guardKey = outPath;
  rec.keyCreated = nowIso();
  saveLedger(ledger);

  console.log('hag keygen: RSA-2048 key for SKU "' + sku + '" (e = ' + pub.e + ')');
  console.log('  private key: ' + keyPath(sku) + (passphrase ? ' (encrypted with HAG_KEY_PASSPHRASE)' : ' (NOT encrypted; set HAG_KEY_PASSPHRASE before keygen to encrypt)'));
  console.log('  GuardKey.ts: ' + outPath + (kept ? ' (policy kept' + (kept.sku && kept.sku !== sku ? ', previous SKU "' + kept.sku + '" replaced' : '') + ')' : ' (new, default policy)'));
  console.log('  policy: GRACE_MS=' + policy.graceMs + ' KEYSTONE_ID=' + policy.keystoneId + " KEYSTONE_MODE='" + policy.keystoneMode + "'" + (policy.bakedLicense ? ' BAKED_LICENSE set' : ''));
  console.log('Back up .hag/ now; a lost private key means no more licenses for this SKU.');
}
