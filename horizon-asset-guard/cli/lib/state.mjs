// state.mjs
// The seller's private state under .hag/ (or $HAG_HOME): one key file per SKU and the
// ledger. Back it up; never ship it. Nothing here is ever copied into a buyer package.
//
//   .hag/keys/<sku>.json   { sku, created, e, n, privateKeyPem, encrypted }  (PKCS#8 PEM,
//                          encrypted with HAG_KEY_PASSPHRASE when that was set at keygen)
//   .hag/ledger.json       { version, skus: { <sku>: {...} }, buyers: { <id>: {...} }, traces: [] }
//
// Buyer record (contract section 9): { id, name, sku, wm, ck (hex), created, worlds: [],
// licenses: [{ issued, worlds, expires, license }], blobs: { name: hash }, marks: {...},
// names: {...}, revoked: null | date, keystoneTests: [] } plus `builds`, `revokeReason`.
import { existsSync, readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { join, resolve } from 'node:path';
import { HagError, isBuyerId, isSku, nowIso, readJson, writeFileAtomic } from './common.mjs';

export function hagHome() {
  return process.env.HAG_HOME ? resolve(process.env.HAG_HOME) : resolve(process.cwd(), '.hag');
}

export const ledgerPath = () => join(hagHome(), 'ledger.json');
export const keyPath = (sku) => join(hagHome(), 'keys', sku + '.json');

export function emptyLedger() {
  return { version: 1, skus: {}, buyers: {}, traces: [] };
}

export function loadLedger() {
  const path = ledgerPath();
  if (!existsSync(path)) return emptyLedger();
  const l = readJson(path, 'ledger');
  if (!l || typeof l !== 'object') throw new HagError('ledger ' + path + ' is not an object');
  if (!l.skus) l.skus = {};
  if (!l.buyers) l.buyers = {};
  if (!l.traces) l.traces = [];
  if (!l.version) l.version = 1;
  return l;
}

export function saveLedger(ledger) {
  writeFileAtomic(ledgerPath(), JSON.stringify(ledger, null, 2) + '\n');
}

export function loadKey(sku) {
  if (!isSku(sku)) throw new HagError('invalid SKU "' + sku + '" (letters, digits and _ only, up to 32)');
  const path = keyPath(sku);
  if (!existsSync(path)) throw new HagError('no key for SKU "' + sku + '" (' + path + '); run: hag keygen --sku ' + sku);
  const rec = readJson(path, 'key file');
  if (!rec || typeof rec.privateKeyPem !== 'string' || typeof rec.n !== 'string' || typeof rec.e !== 'number') throw new HagError('key file ' + path + ' is incomplete');
  return rec;
}

export function hasKey(sku) {
  return isSku(sku) && existsSync(keyPath(sku));
}

export function saveKey(rec) {
  writeFileAtomic(keyPath(rec.sku), JSON.stringify(rec, null, 2) + '\n');
}

// The private key for signing. An encrypted key needs HAG_KEY_PASSPHRASE in the environment.
export function privateKeyOf(rec) {
  const passphrase = process.env.HAG_KEY_PASSPHRASE;
  if (rec.encrypted && !passphrase) throw new HagError('the key for SKU "' + rec.sku + '" is passphrase-protected: set HAG_KEY_PASSPHRASE');
  try {
    return createPrivateKey(rec.encrypted ? { key: rec.privateKeyPem, format: 'pem', passphrase } : { key: rec.privateKeyPem, format: 'pem' });
  } catch (e) {
    throw new HagError('cannot load the private key for SKU "' + rec.sku + '": ' + (e && e.message ? e.message : e) + (rec.encrypted ? ' (wrong HAG_KEY_PASSPHRASE?)' : ''));
  }
}

export function newBuyer({ id, name, sku, wm, ck }) {
  return {
    id,
    name: name || '',
    sku,
    wm,
    ck,
    created: nowIso(),
    worlds: [],
    licenses: [],
    blobs: {},
    marks: {},
    names: {},
    revoked: null,
    revokeReason: '',
    keystoneTests: [],
    builds: [],
  };
}

export function getBuyer(ledger, id) {
  if (!isBuyerId(id)) throw new HagError('invalid buyer id "' + id + '" (letters, digits, _ and - only, up to 32)');
  const b = ledger.buyers[id];
  if (!b) throw new HagError('unknown buyer "' + id + '"; run: hag buyer add --sku <sku> --id ' + id);
  if (!b.worlds) b.worlds = [];
  if (!b.licenses) b.licenses = [];
  if (!b.blobs) b.blobs = {};
  if (!b.marks) b.marks = {};
  if (!b.names) b.names = {};
  if (!b.keystoneTests) b.keystoneTests = [];
  if (!b.builds) b.builds = [];
  return b;
}

export function getSkuRecord(ledger, sku, create = false) {
  let s = ledger.skus[sku];
  if (!s && create) {
    s = { sku, created: nowIso(), e: 0, n: '', guardKey: '', keystoneTests: [] };
    ledger.skus[sku] = s;
  }
  if (s && !s.keystoneTests) s.keystoneTests = [];
  return s || null;
}

export function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
