// common.mjs
// Shared plumbing for the hag CLI: error classes with exit codes, the package paths the
// commands read from (runtime/, templates/, test/lint-runtime.mjs, types/), a tiny argv
// parser (no npm dependencies, Node 18+) and small file / date helpers.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A HagError is a failure the seller can act on (exit 1); a UsageError is a bad command
// line (exit 2, the usage block for that command is printed after the message).
export class HagError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}
export class UsageError extends HagError {
  constructor(message) {
    super(message, 2);
  }
}

// horizon-asset-guard/ (this file lives in cli/lib/).
export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUNTIME_DIR = join(PKG_ROOT, 'runtime');
export const TEMPLATES_DIR = join(PKG_ROOT, 'templates');
export const LINT_SCRIPT = join(PKG_ROOT, 'test', 'lint-runtime.mjs');
export const TYPES_STUB = join(PKG_ROOT, 'types', 'horizon-core.d.ts');

// SKU and buyer ids are embedded in file names, identifiers and request codes, so they are
// kept to a conservative alphabet (a SKU may not contain '-': the request code uses '-' as
// its separator).
export const isSku = (s) => typeof s === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(s);
export const isBuyerId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(s);
export const isDataName = (s) => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(s);

export const nowIso = () => new Date().toISOString();
export const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const nowSeconds = () => Math.floor(Date.now() / 1000);

// Whole days between an ISO timestamp and now (negative if the stamp is in the future).
export function daysSince(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((now - t) / 86400000);
}

export function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new HagError('cannot read ' + path + ': ' + (e && e.message ? e.message : e));
  }
}

export function readJson(path, what = 'file') {
  const text = readText(path);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HagError(what + ' ' + path + ' is not valid JSON: ' + (e && e.message ? e.message : e));
  }
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// Write-then-rename so a crash never leaves a half-written ledger or key file.
export function writeFileAtomic(path, text) {
  ensureDir(dirname(path));
  const tmp = path + '.tmp-' + process.pid;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

// ---- argv parsing ---------------------------------------------------------------------------
// parseArgs(['--sku', 'dba', '--req', 'A', '--req', 'B', 'x'], { known: ['sku'], multi: ['req'] })
//   -> { opts: { sku: 'dba', req: ['A', 'B'] }, positional: ['x'] }
// Options are `--key value` or `--key=value`; `flags` take no value; `multi` may repeat;
// anything not in `known`/`flags`/`multi` is a UsageError (typos must not pass silently).
export function parseArgs(argv, spec = {}) {
  const flags = new Set(spec.flags || []);
  const multi = new Set(spec.multi || []);
  const known = new Set([...(spec.known || []), ...flags, ...multi]);
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    let key = a.slice(2);
    let value;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    if (!known.has(key)) throw new UsageError('unknown option --' + key);
    if (flags.has(key)) {
      if (value !== undefined) throw new UsageError('--' + key + ' takes no value');
      opts[key] = true;
      continue;
    }
    if (value === undefined) {
      if (i + 1 >= argv.length) throw new UsageError('--' + key + ' needs a value');
      value = argv[++i];
    }
    if (multi.has(key)) {
      (opts[key] = opts[key] || []).push(value);
    } else {
      if (key in opts) throw new UsageError('--' + key + ' was given twice');
      opts[key] = value;
    }
  }
  return { opts, positional };
}

export function need(opts, key, what) {
  if (opts[key] === undefined || opts[key] === '') throw new UsageError('--' + key + ' <' + what + '> is required');
  return opts[key];
}

// Pads a table cell for the plain-text tables `hag list` prints.
export function pad(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

// A license is never printed in full by the runtime (contract section 0); the CLI prints
// it in full only where the seller needs to copy it, and abbreviates it everywhere else.
export function abbreviate(text, keep = 24) {
  const s = String(text);
  return s.length <= keep ? s : s.slice(0, keep) + '...(' + s.length + ' chars)';
}
