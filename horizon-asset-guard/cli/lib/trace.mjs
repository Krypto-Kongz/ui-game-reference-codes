// trace.mjs
// `hag trace <path> [--out <trace-report.md>] [--top <n>] [--json]`
// Scores a leaked copy against every buyer in the ledger. The copy may be a whole package,
// a single GuardData_*.ts, or a plaintext dump (JSON, or tables pasted into other scripts):
//
//   blob hash     SHA-256 of a `HAGD1....` string found in a file, or the 16-hex blobHash
//                 literal of the register() call, equals a ledger blob hash   (100 / 60 pts)
//   mangled names `_xxxxxx` identifiers equal the buyer's recorded g_* renames      (4 each)
//   _m marks      `_mXXXX: value` pairs from the data-domain watermark (6 each; 2 for a key
//                 without its value)
//   slack         a 4-decimal seed-derived constant appears as a number token           (5 each)
//   header        the plaintext header `"n":"<table>","b":"<buyer>"` names the buyer      (40)
//
// Chance collisions are rare by construction (30-bit names, 16-bit keys at ~35 % of objects,
// 1-in-10^4 slack values), so a clear leader with several kinds of evidence is a strong
// result; two buyers scoring high together is the collusion signature (they diffed their
// copies and scrubbed what differed; what they share still names both).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { HagError, UsageError, nowIso, parseArgs, writeFileAtomic } from './common.mjs';
import { blobHash } from './formats.mjs';
import { loadLedger, saveLedger } from './state.mjs';

export const WEIGHTS = { blob: 100, hashLiteral: 60, name: 4, markPair: 6, markKey: 2, slack: 5, header: 40 };
const MAX_FILE = 32 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.hag']);

export function listTextFiles(target) {
  if (!existsSync(target)) throw new HagError(target + ' does not exist');
  const out = [];
  const consider = (path) => {
    const st = statSync(path);
    if (st.size === 0 || st.size > MAX_FILE) return;
    const buf = readFileSync(path);
    if (buf.subarray(0, 8192).includes(0)) return; // binary
    out.push({ path, size: st.size, text: buf.toString('utf8') });
  };
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else consider(path);
    }
  };
  if (statSync(target).isDirectory()) walk(target);
  else consider(target);
  return out;
}

const add = (map, key, file) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(file);
};

// One pass over every file collecting every token kind the ledger can be matched against.
export function scanFiles(files) {
  const found = { blobs: new Map(), hashLiterals: new Map(), idents: new Map(), markPairs: new Map(), markKeys: new Map(), headers: new Map(), files };
  for (const f of files) {
    const t = f.text;
    for (const m of t.matchAll(/HAGD1\.[A-Za-z0-9_-]{40,}/g)) add(found.blobs, blobHash(m[0]), f.path);
    for (const m of t.matchAll(/\b[0-9a-f]{16}\b/g)) add(found.hashLiterals, m[0], f.path);
    for (const m of t.matchAll(/\b_[a-z2-7]{6,9}(?:_BLOB)?\b/g)) add(found.idents, m[0], f.path);
    for (const m of t.matchAll(/["']?(_m[0-9a-f]{4})["']?\s*:\s*(-?\d+)\b/g)) add(found.markPairs, m[1] + '=' + m[2], f.path);
    for (const m of t.matchAll(/\b_m[0-9a-f]{4}\b/g)) add(found.markKeys, m[0], f.path);
    for (const m of t.matchAll(/"n"\s*:\s*"([A-Za-z0-9_]+)"\s*,\s*"b"\s*:\s*"([A-Za-z0-9_-]+)"\s*,\s*"d"\s*:/g)) add(found.headers, m[1] + '|' + m[2], f.path);
  }
  return found;
}

const files = (set, root) => [...set].slice(0, 3).map((p) => relative(root, p) || basename(p)).join(', ');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scoreBuyer(b, found, root) {
  let score = 0;
  const evidence = [];
  const counts = { blobs: 0, blobsExpected: 0, names: 0, namesExpected: 0, marks: 0, marksExpected: 0, slack: 0, slackExpected: 0, headers: 0 };
  for (const [table, hash] of Object.entries(b.blobs || {})) {
    counts.blobsExpected++;
    if (found.blobs.has(hash)) {
      score += WEIGHTS.blob;
      counts.blobs++;
      evidence.push('blob of table "' + table + '" (hash ' + hash + ') found verbatim in ' + files(found.blobs.get(hash), root));
    } else if (found.hashLiterals.has(hash)) {
      score += WEIGHTS.hashLiteral;
      counts.blobs++;
      evidence.push('blobHash literal ' + hash + ' of table "' + table + '" found in ' + files(found.hashLiterals.get(hash), root));
    }
  }
  for (const [table, names] of Object.entries(b.names || {})) {
    const values = Object.values(names);
    counts.namesExpected += values.length;
    const hits = values.filter((n) => found.idents.has(n));
    if (hits.length > 0) {
      score += WEIGHTS.name * hits.length;
      counts.names += hits.length;
      evidence.push(hits.length + '/' + values.length + ' mangled identifiers of table "' + table + '" (' + hits.slice(0, 3).join(', ') + (hits.length > 3 ? ', ...' : '') + ') in ' + files(found.idents.get(hits[0]), root));
    }
  }
  for (const [table, marks] of Object.entries(b.marks || {})) {
    const keys = (marks && marks.keys) || [];
    counts.marksExpected += keys.length;
    const pairs = [];
    const keyOnly = [];
    for (const [, key, value] of keys) {
      if (found.markPairs.has(key + '=' + value)) pairs.push(key + ': ' + value);
      else if (found.markKeys.has(key)) keyOnly.push(key);
    }
    if (pairs.length > 0) {
      score += WEIGHTS.markPair * pairs.length;
      counts.marks += pairs.length;
      evidence.push(pairs.length + '/' + keys.length + ' _m marks of table "' + table + '" with matching values (' + pairs.slice(0, 3).join(', ') + (pairs.length > 3 ? ', ...' : '') + ')');
    }
    if (keyOnly.length > 0) {
      score += WEIGHTS.markKey * keyOnly.length;
      evidence.push(keyOnly.length + ' _m key(s) of table "' + table + '" present with a changed value (' + keyOnly.slice(0, 3).join(', ') + ')');
    }
    const slack = (marks && marks.slack) || {};
    const slackHits = [];
    for (const [path, value] of Object.entries(slack)) {
      counts.slackExpected++;
      const s = String(value);
      if (!/\.\d{2,}$/.test(s)) continue; // too few decimals to be distinctive
      const re = new RegExp('(?<![\\w.])' + escapeRe(s) + '(?![\\w.])');
      const hit = found.files.find((f) => re.test(f.text));
      if (hit) slackHits.push({ path, s, file: hit.path });
    }
    if (slackHits.length > 0) {
      score += WEIGHTS.slack * slackHits.length;
      counts.slack += slackHits.length;
      evidence.push(slackHits.length + '/' + Object.keys(slack).length + ' slack constants of table "' + table + '" (' + slackHits.slice(0, 3).map((h) => h.path + ' = ' + h.s).join(', ') + ') in ' + (relative(root, slackHits[0].file) || basename(slackHits[0].file)));
    }
  }
  for (const table of Object.keys(b.blobs || {})) {
    if (found.headers.has(table + '|' + b.id)) {
      score += WEIGHTS.header;
      counts.headers++;
      evidence.push('decrypted plaintext header names buyer ' + b.id + ' for table "' + table + '" in ' + files(found.headers.get(table + '|' + b.id), root));
    }
  }
  return { id: b.id, name: b.name || '', sku: b.sku, revoked: b.revoked || null, score, evidence, counts };
}

export function judge(ranked) {
  const top = ranked[0] || { score: 0 };
  const second = ranked[1] || { score: 0 };
  let confidence = 'none';
  if (top.score > 0) {
    if (top.score >= 30 && top.score >= 3 * second.score) confidence = 'high';
    else if (top.score >= 12 && top.score > second.score) confidence = 'medium';
    else confidence = 'low';
  }
  const collusion = top.score > 0 && second.score >= 12 && second.score >= 0.5 * top.score;
  return { confidence, collusion };
}

function renderReport({ target, when, scanned, ranked, verdict, topN }) {
  const l = [];
  l.push('# hag trace report');
  l.push('');
  l.push('- date: ' + when);
  l.push('- scanned: `' + target + '` (' + scanned.length + ' text file(s), ' + scanned.reduce((a, f) => a + f.size, 0) + ' bytes)');
  l.push('- buyers in ledger: ' + ranked.length);
  l.push('');
  l.push('## Verdict');
  l.push('');
  const top = ranked[0];
  if (!top || top.score <= 0) {
    l.push('No buyer matches anything in the scanned files. Either the copy carries none of the recorded marks (a rewrite from scratch, or a build not recorded in this ledger) or the files are not from this product.');
  } else {
    l.push('Top candidate: **' + top.id + '**' + (top.name ? ' (' + top.name + ')' : '') + ', SKU ' + top.sku + ', score ' + top.score + ', confidence **' + verdict.confidence + '**' + (top.revoked ? ' (already revoked ' + top.revoked.slice(0, 10) + ')' : '') + '.');
    if (verdict.collusion) l.push('');
    if (verdict.collusion) l.push('Possible collusion: **' + ranked[1].id + '** also scores ' + ranked[1].score + '. Two buyers who diffed their copies can scrub the marks that differ; the marks they share still name both. Treat both as candidates.');
  }
  l.push('');
  l.push('## Ranking');
  l.push('');
  l.push('| # | buyer | name | sku | score | blobs | names | _m marks | slack | header |');
  l.push('|---|---|---|---|---|---|---|---|---|---|');
  ranked.slice(0, Math.max(topN, 5)).forEach((c, i) => {
    const k = c.counts;
    l.push('| ' + (i + 1) + ' | ' + c.id + ' | ' + (c.name || '-') + ' | ' + c.sku + ' | ' + c.score + ' | ' + k.blobs + '/' + k.blobsExpected + ' | ' + k.names + '/' + k.namesExpected + ' | ' + k.marks + '/' + k.marksExpected + ' | ' + k.slack + '/' + k.slackExpected + ' | ' + k.headers + ' |');
  });
  l.push('');
  l.push('## Evidence');
  l.push('');
  for (const c of ranked.slice(0, topN)) {
    if (c.score <= 0) continue;
    l.push('### ' + c.id + (c.name ? ' (' + c.name + ')' : '') + ' - score ' + c.score);
    l.push('');
    for (const e of c.evidence) l.push('- ' + e);
    l.push('');
  }
  l.push('## How to read this');
  l.push('');
  l.push('- A verbatim blob (100) or its blobHash literal (60) means the leaked file is the buyer\'s GuardData module itself.');
  l.push('- Mangled identifiers (4 each) are the per-buyer renames of the inlined verify core; a copy that still runs carries all of them.');
  l.push('- `_m` marks (6 each) and slack constants (5 each) live inside the data tables and survive a plaintext dump; each key is a 1-in-65536 coincidence for any other buyer.');
  l.push('- "high" = a clear leader with at least three times the runner-up\'s score; "medium" = a leader above 12 points; "low" = weak or tied evidence.');
  l.push('');
  l.push('## Next steps');
  l.push('');
  l.push('1. Keep the leaked files and this report together (they are the evidence packet input).');
  if (top && top.score > 0) {
    l.push('2. `hag revoke --buyer ' + top.id + ' --reason "..."` marks the buyer and prints the unshare steps.');
    l.push('3. `hag report --buyer ' + top.id + '` writes the Markdown evidence packet for the Meta IP report and the contract claim.');
  } else {
    l.push('2. If this is a copy of your product, check that the ledger in use is the one the build was recorded in (HAG_HOME).');
  }
  l.push('');
  return l.join('\n');
}

export async function trace(argv) {
  const { opts, positional } = parseArgs(argv, { known: ['out', 'top'], flags: ['json'] });
  if (positional.length !== 1) throw new UsageError('hag trace <path> [--out <trace-report.md>] [--top <n>]');
  const target = resolve(positional[0]);
  const topN = opts.top === undefined ? 3 : Math.max(1, Number(opts.top) || 3);
  const ledger = loadLedger();
  const buyers = Object.values(ledger.buyers);
  if (buyers.length === 0) throw new HagError('the ledger has no buyers; nothing to score against (HAG_HOME=' + (process.env.HAG_HOME || '.hag') + ')');
  const scanned = listTextFiles(target);
  if (scanned.length === 0) throw new HagError('no text files under ' + target);
  const root = statSync(target).isDirectory() ? target : resolve(target, '..');
  const found = scanFiles(scanned);
  const ranked = buyers.map((b) => scoreBuyer(b, found, root)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const verdict = judge(ranked);
  const when = nowIso();
  const reportPath = resolve(opts.out || 'trace-report.md');
  writeFileAtomic(reportPath, renderReport({ target, when, scanned, ranked, verdict, topN }));

  ledger.traces.push({ date: when, path: target, report: reportPath, files: scanned.length, confidence: verdict.confidence, collusion: verdict.collusion, top: ranked.slice(0, 3).filter((c) => c.score > 0).map((c) => ({ id: c.id, score: c.score, confidence: verdict.confidence })) });
  if (ledger.traces.length > 50) ledger.traces.splice(0, ledger.traces.length - 50);
  saveLedger(ledger);

  if (opts.json) {
    console.log(JSON.stringify({ target, files: scanned.length, confidence: verdict.confidence, collusion: verdict.collusion, report: reportPath, candidates: ranked.slice(0, Math.max(topN, 5)) }, null, 2));
    return;
  }
  console.log('hag trace: ' + scanned.length + ' text file(s) under ' + target + ', ' + buyers.length + ' buyer(s) scored');
  const top = ranked[0];
  if (!top || top.score <= 0) {
    console.log('TOP: none (no recorded mark found in the scanned files)');
  } else {
    console.log('TOP: ' + top.id + (top.name ? ' (' + top.name + ')' : '') + ' score=' + top.score + ' confidence=' + verdict.confidence + (verdict.collusion ? ' collusion-candidate=' + ranked[1].id : ''));
    ranked.slice(0, topN).forEach((c, i) => {
      if (c.score <= 0) return;
      console.log('  ' + (i + 1) + '. ' + c.id + ' score ' + c.score);
      for (const e of c.evidence) console.log('     - ' + e);
    });
  }
  console.log('report: ' + reportPath);
}
