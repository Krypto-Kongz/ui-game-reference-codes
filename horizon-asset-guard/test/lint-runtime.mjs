// Static guard for runtime/**/*.ts: fails on any construct Horizon's script engine or its
// TypeScript 4.7 / ES2020 toolchain does not provide (typed arrays, BigInt, bigint literals,
// `**`, logical assignment, Array.prototype.at, Object.hasOwn, replaceAll, TextEncoder /
// TextDecoder, atob / btoa, eval, new Function, Proxy, bare setTimeout / setInterval).
// Comments are stripped before matching; `this.async.setTimeout(` is allowed, and so is the
// string-lookup form `['BigInt']` (contract section 0: BigInt may only be fetched as
// `(g as any)['BigInt']` behind a typeof check, so a missing global is a value, not a
// ReferenceError); the bare `BigInt` token stays forbidden everywhere else.
// Usage: node test/lint-runtime.mjs [dir]   (default dir: runtime/; exit code 1 on any hit)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = process.argv[2] ? resolve(process.argv[2]) : join(root, 'runtime');
const MAX_FILE_BYTES = 25 * 1024;

const FORBIDDEN =
  /Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array|BigInt|\b\d+n\b|\*\*|\?\?=|\|\|=|&&=|\.at\(|Object\.hasOwn|replaceAll|TextEncoder|TextDecoder|atob\(|btoa\(|\beval\(|new Function|Proxy|setTimeout\(|setInterval\(/g;
const ALLOWED_PREFIX = /this\.async\.(setTimeout|setInterval)\($/;
const ALLOWED_LOOKUP = /\[(['"])BigInt\1\]$/; // `['BigInt']` / `["BigInt"]` property lookup

// Replaces comment bodies with spaces (newlines kept) so line numbers survive; string and
// template literal contents are left alone.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && d === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] === undefined ? '' : src[i + 1]);
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      out += quote;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function* tsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* tsFiles(path);
    else if (path.endsWith('.ts')) yield path;
  }
}

let problems = 0;
let files = 0;
for (const file of tsFiles(runtimeDir)) {
  files++;
  const rel = relative(process.cwd(), file);
  const raw = readFileSync(file, 'utf8');
  if (Buffer.byteLength(raw) > MAX_FILE_BYTES) {
    problems++;
    console.log(`${rel}: ${Buffer.byteLength(raw)} bytes exceeds the ${MAX_FILE_BYTES}-byte per-script limit`);
  }
  const lines = stripComments(raw).split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    FORBIDDEN.lastIndex = 0;
    let m;
    while ((m = FORBIDDEN.exec(line)) !== null) {
      const before = line.slice(0, m.index + m[0].length);
      if (ALLOWED_PREFIX.test(before)) continue;
      if (m[0] === 'BigInt' && ALLOWED_LOOKUP.test(line.slice(0, m.index + m[0].length + 2))) continue;
      problems++;
      console.log(`${rel}:${ln + 1}: forbidden construct "${m[0]}": ${line.trim()}`);
    }
  }
}

if (problems > 0) {
  console.log(`lint-runtime: ${problems} problem(s) in ${files} file(s)`);
  process.exit(1);
}
console.log(`lint-runtime: ${files} runtime file(s) clean (no typed arrays, BigInt, ES2021+ or forbidden globals)`);
