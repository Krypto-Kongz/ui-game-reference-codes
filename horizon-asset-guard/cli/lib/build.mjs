// build.mjs
// `hag build --sku <sku> --buyer <buyerId> --config <hag.config.json> --out <dir>`
// Produces one complete, per-buyer package:
//   <out>/scripts/GuardData_<name>.ts   one per data table: watermarked (section 8), encrypted
//                                       under the buyer's ck (section 2 blob), with the
//                                       GuardCore region inlined and g_* names mangled (section 7)
//   <out>/scripts/...                   the whole runtime/ tree (incl. crypto/), so the buyer
//                                       package is complete, plus GuardKey.ts composed for this
//                                       SKU (public key from .hag, policy from the seller's file)
//   <out>/BUYER-README.md               which files to copy and how to activate
//   <out>/LICENSE-BUYER.md              the terms, from templates/LICENSE-BUYER.md
// The ledger records blob hashes, mark keys, slack values and the name map so `hag trace`
// can match a leaked copy (TypeScript files or a plaintext dump) to this buyer.
//
// Config: { "sku": "...", "seller": "...", "data": { "<name>": "<path.json>" },
//           "marks": { "<name>.<json.path>": [min, max] } }   (paths relative to the config)
import { existsSync, readdirSync, statSync, copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { HagError, RUNTIME_DIR, UsageError, isDataName, isSku, isoDay, need, nowIso, parseArgs, readJson, readText, writeFileAtomic } from './common.mjs';
import { blobHash, sealBlob } from './formats.mjs';
import { parseGuardKey, policyOf, renderGuardKey } from './guardkey.mjs';
import { checkRegion, extractRegion, mangleMap, mangledName, renameRegion, renderModule, stripComments } from './mangle.mjs';
import { getBuyer, loadKey, loadLedger, readTextIfExists, saveLedger } from './state.mjs';
import { renderTemplate } from './templates.mjs';
import { watermarkTable } from './watermark.mjs';

const LINT_CAP = 25 * 1024; // test/lint-runtime.mjs per-file cap
const HARD_CAP = 62 * 1024; // non-FBS worlds cap a script at 64 KB (digest section 1)

export function loadConfig(path) {
  const cfg = readJson(path, 'config');
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new HagError('config ' + path + ' must be a JSON object');
  if (!cfg.data || typeof cfg.data !== 'object' || Array.isArray(cfg.data) || Object.keys(cfg.data).length === 0) throw new HagError('config ' + path + ' needs "data": { "<name>": "<path.json>" } with at least one table');
  for (const name of Object.keys(cfg.data)) {
    if (!isDataName(name)) throw new HagError('config data name "' + name + '" must be a letter followed by letters, digits or _ (it becomes GuardData_' + name + '.ts)');
    if (typeof cfg.data[name] !== 'string') throw new HagError('config data "' + name + '" must be a path string');
  }
  if (cfg.marks !== undefined && (typeof cfg.marks !== 'object' || Array.isArray(cfg.marks) || cfg.marks === null)) throw new HagError('config "marks" must be an object');
  return cfg;
}

// Copies every file of the runtime tree except the generated-per-SKU / per-buyer ones.
function copyRuntime(srcDir, dstDir) {
  const copied = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry.startsWith('.')) continue;
      const path = join(dir, entry);
      const rel = relative(srcDir, path);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry === 'GuardKey.ts' || /^GuardData_.*\.ts$/.test(entry)) continue;
      const dst = join(dstDir, rel);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(path, dst);
      copied.push(rel);
    }
  };
  walk(srcDir);
  return copied;
}

// Where the seller's policy (GRACE_MS, KEYSTONE_*, BAKED_LICENSE) comes from, in order:
// --guard-key, the file keygen wrote for this SKU, <runtime>/GuardKey.ts if it is this SKU.
function findPolicy(sku, keyRec, runtimeDir, explicit) {
  const candidates = [];
  if (explicit) candidates.push({ path: resolve(explicit), must: true });
  if (keyRec.guardKey) candidates.push({ path: keyRec.guardKey, must: false });
  candidates.push({ path: join(runtimeDir, 'GuardKey.ts'), must: false });
  for (const c of candidates) {
    const text = readTextIfExists(c.path);
    if (text === null) {
      if (c.must) throw new HagError('--guard-key ' + c.path + ' does not exist');
      continue;
    }
    const parsed = parseGuardKey(text);
    if (parsed.sku !== sku && !c.must) continue;
    if (parsed.sku !== sku) throw new HagError('--guard-key ' + c.path + ' is for SKU "' + parsed.sku + '", not "' + sku + '"');
    return { policy: policyOf(parsed), source: c.path };
  }
  return { policy: policyOf(null), source: null };
}

// Paths in the summary: relative when inside the cwd, absolute otherwise (a chain of ../ is
// unreadable).
function show(path) {
  const rel = relative(process.cwd(), path);
  return rel === '' ? '.' : rel.startsWith('..') ? path : rel;
}

function fileList(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...fileList(path, prefix + entry + '/'));
    else out.push(prefix + entry);
  }
  return out;
}

function renderBuyerReadme({ sku, buyerName, buyerId, seller, tables, scripts, when }) {
  const lines = [];
  lines.push('# ' + sku + ' — buyer package' + (buyerName ? ' for ' + buyerName : ''));
  lines.push('');
  lines.push('Built ' + when + ' for buyer ' + buyerId + ' by ' + seller + '. This package is licensed to one world (see LICENSE-BUYER.md)');
  lines.push('and is watermarked: every copy is traceable to the buyer it was built for.');
  lines.push('');
  lines.push('## 1. Copy the scripts');
  lines.push('');
  lines.push('Copy every `.ts` file under `scripts/` (including the ones in `scripts/crypto/`) into your');
  lines.push("world's scripts folder (Horizon Studio: Scripts panel > Open in External Editor; the folder is");
  lines.push('flat, so the files from `scripts/crypto/` go next to the others). Files:');
  lines.push('');
  for (const f of scripts) lines.push('- `scripts/' + f + '`');
  lines.push('');
  lines.push('The `GuardData_*.ts` files hold your encrypted game data; the other files are the guard runtime.');
  lines.push('Do not rename, edit or reformat any of them: a changed file only yields trial data.');
  lines.push('');
  lines.push('## 2. Place the guard');
  lines.push('');
  lines.push('1. Add an empty object under the game root and attach the `AssetGuard` script (execution mode: default / server).');
  lines.push('2. Optional: point its `statusText` prop at a Text gizmo to see the activation status in-world.');
  lines.push('3. Press Play. The console prints a line like `I01 ... HAG-REQ-' + sku + '-<world id>-XXXX`.');
  lines.push('');
  lines.push('## 3. Activate');
  lines.push('');
  lines.push('Send that `HAG-REQ-...` code to ' + seller + '. You get back a license that starts with `HAG1.`');
  lines.push('and a short activation message. Paste the license into the `license` prop of the AssetGuard');
  lines.push('entity (split across `license`, `license2`, `license3` exactly as the message shows) and press');
  lines.push('Reset. The console then prints `I00 licensed to ...`.');
  lines.push('');
  lines.push('Until then the game runs in trial mode: everything works, but the data tables (' + tables.join(', ') + ')');
  lines.push('are the trial versions. Duplicated or moved the world? Press Play there, send the new code, and');
  lines.push('ask for a re-issue (free for your own worlds, up to 4 per license).');
  lines.push('');
  lines.push('## Console codes');
  lines.push('');
  lines.push('| Code | Meaning | What to do |');
  lines.push('|---|---|---|');
  lines.push('| I01 | no license, trial mode | send the request code to the seller |');
  lines.push('| I00 | licensed | nothing |');
  lines.push('| E10 | license text malformed or cut (the offset is printed) | re-paste; check every prop holds its whole chunk |');
  lines.push('| E11 | signature does not verify | the license was altered or is for another seller key; ask for a re-issue |');
  lines.push('| E12 | license is for another world | send the new HAG-REQ code for a re-issue |');
  lines.push('| E13 | license expired | ask the seller for a renewal |');
  lines.push('| E14 | license is for another product | ask the seller |');
  lines.push('| E20 | a data file was altered | restore the original GuardData file |');
  lines.push('| W02 | world id unreadable (platform change); the guard fails open | tell the seller |');
  lines.push('');
  return lines.join('\n') + '\n';
}

export async function build(argv) {
  const { opts, positional } = parseArgs(argv, { known: ['sku', 'buyer', 'config', 'out', 'runtime', 'core', 'guard-key'], flags: ['keep-comments', 'force'] });
  if (positional.length > 0) throw new UsageError('unexpected argument "' + positional[0] + '"');
  const sku = need(opts, 'sku', 'sku');
  const buyerId = need(opts, 'buyer', 'buyerId');
  const configPath = resolve(need(opts, 'config', 'hag.config.json'));
  const outDir = resolve(need(opts, 'out', 'dir'));
  if (!isSku(sku)) throw new UsageError('invalid SKU "' + sku + '"');
  const runtimeDir = resolve(opts.runtime || RUNTIME_DIR);
  const corePath = resolve(opts.core || join(runtimeDir, 'GuardCore.ts'));

  const ledger = loadLedger();
  const buyer = getBuyer(ledger, buyerId);
  if (buyer.sku !== sku) throw new HagError('buyer "' + buyerId + '" belongs to SKU "' + buyer.sku + '", not "' + sku + '"');
  if (buyer.revoked && !opts.force) throw new HagError('buyer "' + buyerId + '" was revoked on ' + buyer.revoked + '; add a new buyer id for a new sale (or --force)');
  const keyRec = loadKey(sku);
  const cfg = loadConfig(configPath);
  if (cfg.sku !== undefined && cfg.sku !== sku) throw new HagError('config ' + configPath + ' is for SKU "' + cfg.sku + '", not "' + sku + '"');
  const seller = typeof cfg.seller === 'string' && cfg.seller.trim() ? cfg.seller.trim() : process.env.HAG_SELLER || 'the seller';
  if (!existsSync(runtimeDir) || !statSync(runtimeDir).isDirectory()) throw new HagError('runtime directory ' + runtimeDir + ' does not exist (pass --runtime <dir>)');
  if (!existsSync(corePath)) throw new HagError('cannot inline the verify core: ' + corePath + ' does not exist. The build needs runtime/GuardCore.ts with its "// @hag-core-begin" / "// @hag-core-end" markers (contract section 3).');

  // The verify core, checked and comment-stripped once; mangled per table below.
  const coreText = readText(corePath);
  const regionRaw = extractRegion(coreText, corePath);
  checkRegion(regionRaw, corePath);
  const region = opts['keep-comments'] ? regionRaw : stripComments(regionRaw);
  if (!/\bfunction\s+g_unlock\s*\(/.test(region)) throw new HagError('internal: comment stripping lost g_unlock in ' + corePath);

  const ck = Buffer.from(buyer.ck, 'hex');
  if (ck.length !== 32) throw new HagError('ledger entry for "' + buyerId + '" has a malformed ck');
  const scriptsDir = join(outDir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });

  const tables = [];
  const warnings = [];
  for (const name of Object.keys(cfg.data)) {
    const dataPath = resolve(dirname(configPath), cfg.data[name]);
    const data = readJson(dataPath, 'data file');
    const wmk = watermarkTable(data, buyer.wm, name, cfg.marks || {});
    const sealed = sealBlob(ck, name, buyerId, wmk.data);
    const hash = blobHash(sealed.blob);
    const blobConst = mangledName(buyer.wm, name, 'g_BLOB') + '_BLOB';
    const map = mangleMap(region, buyer.wm, name, [blobConst, 'Guard', 'PUB_N', 'PUB_E', 'SKU', 'sha256', 'chacha20', 'rsaVerifyPkcs1Sha256', 'rsaPublicKeyFromBase64Url', 'utf8ToBytes', 'base64UrlToBytes', 'bytesToBase64Url', 'concatBytes', 'bytesEqual']);
    const text = renderModule({ name, blob: sealed.blob, blobHash: hash, region: renameRegion(region, map), map, blobConst });
    const file = join(scriptsDir, 'GuardData_' + name + '.ts');
    const bytes = Buffer.byteLength(text);
    if (bytes > HARD_CAP && !opts.force) throw new HagError('GuardData_' + name + '.ts would be ' + bytes + ' bytes, over the 64 KB script limit of non-FBS worlds; split the table into smaller data files (or --force)');
    if (bytes > LINT_CAP) warnings.push('GuardData_' + name + '.ts is ' + bytes + ' bytes, over the 25 KB lint cap (hag doctor flags it); consider splitting the table');
    writeFileAtomic(file, text);
    const names = {};
    for (const [k, v] of map) names[k] = v;
    names.g_BLOB = blobConst;
    tables.push({ name, file, bytes, hash, plainBytes: sealed.plain.length, marks: wmk.keys, slack: wmk.slack, names, dataPath });
  }

  // Runtime tree + a GuardKey.ts for this SKU.
  const copied = copyRuntime(runtimeDir, scriptsDir);
  const { policy, source: policySource } = findPolicy(sku, keyRec, runtimeDir, opts['guard-key']);
  writeFileAtomic(join(scriptsDir, 'GuardKey.ts'), renderGuardKey({ sku, pubN: keyRec.n, pubE: keyRec.e, ...policy }));
  if (!policySource) warnings.push('no GuardKey.ts for SKU "' + sku + '" found; the buyer copy uses the default policy (GRACE_MS 0, keystone off). Run hag keygen --sku ' + sku + ' or pass --guard-key');

  const when = isoDay();
  const scripts = fileList(scriptsDir);
  writeFileAtomic(join(outDir, 'BUYER-README.md'), renderBuyerReadme({ sku, buyerName: buyer.name, buyerId, seller, tables: tables.map((t) => t.name), scripts, when }));
  writeFileAtomic(
    join(outDir, 'LICENSE-BUYER.md'),
    renderTemplate('LICENSE-BUYER.md', { SKU: sku, BUYER_ID: buyerId, BUYER_NAME: buyer.name || buyerId, SELLER: seller, DATE: when, WORLDS: buyer.worlds.length ? buyer.worlds.join(', ') : 'the world named in the license' }),
  );

  // Ledger: everything trace needs, replacing earlier records for the same table names.
  for (const t of tables) {
    buyer.blobs[t.name] = t.hash;
    buyer.marks[t.name] = { keys: t.marks, slack: t.slack };
    buyer.names[t.name] = t.names;
  }
  buyer.builds.push({ date: nowIso(), out: outDir, config: configPath, tables: tables.map((t) => t.name), blobs: Object.fromEntries(tables.map((t) => [t.name, t.hash])) });
  saveLedger(ledger);

  console.log('hag build: SKU ' + sku + ', buyer ' + buyerId + (buyer.name ? ' (' + buyer.name + ')' : '') + ', config ' + show(configPath));
  for (const t of tables) {
    console.log('  ' + t.name + ': ' + t.plainBytes + ' plaintext bytes, ' + t.marks.length + ' _m marks, ' + Object.keys(t.slack).length + ' slack constants, blob ' + t.hash + ' -> scripts/' + basename(t.file) + ' (' + t.bytes + ' bytes)');
  }
  console.log('  scripts/: ' + copied.length + ' runtime files copied from ' + show(runtimeDir) + ' (incl. crypto/), GuardKey.ts for SKU ' + sku + (policySource ? ' (policy from ' + show(policySource) + ')' : ' (default policy)'));
  console.log('  BUYER-README.md, LICENSE-BUYER.md written to ' + show(outDir));
  console.log('  ledger: blobs, marks and names recorded for ' + buyerId);
  for (const w of warnings) console.log('  warning: ' + w);
  console.log('Next: hag issue --sku ' + sku + ' --buyer ' + buyerId + ' --req <HAG-REQ-... from the buyer>');
}
