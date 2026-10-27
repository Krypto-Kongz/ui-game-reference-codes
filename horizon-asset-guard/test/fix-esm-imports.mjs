// Rewrites the import specifiers in a tsc output tree so Node's ESM loader can resolve
// them. The TypeScript sources import sibling scripts by bare basename
// (`import { sha256 } from 'Sha256'`), the form Horizon's flat script namespace uses, and
// tsc copies those specifiers through unchanged. The output keeps the source layout
// (test/out/runtime/GuardCore.js, test/out/runtime/crypto/Sha256.js,
// test/out/examples/ArenaExample.js, ...), so a bare name is resolved to wherever that module
// was emitted, mirroring tsconfig.test.json's `paths` order (siblings first, then the
// shallowest match). This only touches test builds, never shipped code:
//   'Sha256'        -> './crypto/Sha256.js' or '../runtime/crypto/Sha256.js' (wherever it is)
//   './Sha256'      -> './Sha256.js'        (extensionless relative imports)
//   'horizon/core'  -> relative path to <out>/horizon-core.js, a copy of the Node mock
//                      test/mocks/horizon-core.mjs (the runtime stub Horizon itself provides)
// Usage: node test/fix-esm-imports.mjs [outDir]   (default: test/out; the e2e test runs it on
// the compiled buyer package, which is flat, so the same rules apply there)
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ? resolve(process.argv[2]) : join(here, 'out');
const MOCK_SRC = join(here, 'mocks', 'horizon-core.mjs');
const MOCK_OUT = join(outDir, 'horizon-core.js');
const HORIZON_SPEC = 'horizon/core';
const IMPORT_SPEC = /((?:import|export)\s[^'"]*?from\s+['"])([^'"]+)(['"])/g;

if (!existsSync(outDir)) {
  console.error('fix-esm-imports: ' + outDir + ' does not exist; run tsc first');
  process.exit(1);
}

// The mock is hand-written for Node, so it is copied as-is and never rewritten.
if (existsSync(MOCK_SRC)) copyFileSync(MOCK_SRC, MOCK_OUT);

function listJs(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...listJs(path));
    else if (path.endsWith('.js')) files.push(path);
  }
  return files;
}

// Basename -> emitted file(s), shallowest first (top-level entries before subfolders).
const modules = new Map();
const all = listJs(outDir).sort((a, b) => {
  const da = relative(outDir, a).split(sep).length;
  const db = relative(outDir, b).split(sep).length;
  return da !== db ? da - db : a.localeCompare(b);
});
for (const file of all) {
  const name = basename(file, '.js');
  if (!modules.has(name)) modules.set(name, []);
  modules.get(name).push(file);
}

function relativeSpec(fromFile, toFile) {
  let spec = relative(dirname(fromFile), toFile).split(sep).join('/');
  if (!spec.startsWith('.')) spec = './' + spec;
  return spec;
}

let warned = 0;
function resolveBare(file, spec) {
  const candidates = modules.get(spec);
  if (!candidates || candidates.length === 0) return null;
  // Prefer a sibling (what Horizon would see), else the first in tsconfig paths order.
  const sibling = candidates.find((c) => dirname(c) === dirname(file));
  return sibling || candidates[0];
}

function fix(file) {
  if (file === MOCK_OUT) return;
  const src = readFileSync(file, 'utf8');
  const fixed = src.replace(IMPORT_SPEC, (whole, open, spec, close) => {
    if (/\.[cm]?js$/.test(spec)) return whole;
    if (spec === HORIZON_SPEC) {
      if (!existsSync(MOCK_OUT)) {
        warned++;
        console.log('fix-esm-imports: ' + relative(outDir, file) + " imports 'horizon/core' but " + relative(here, MOCK_SRC) + ' is missing');
      }
      return open + relativeSpec(file, MOCK_OUT) + close;
    }
    if (spec.startsWith('./') || spec.startsWith('../')) return open + spec + '.js' + close;
    if (/^[A-Za-z0-9_]+$/.test(spec)) {
      const target = resolveBare(file, spec);
      if (target) return open + relativeSpec(file, target) + close;
      warned++;
      console.log('fix-esm-imports: ' + relative(outDir, file) + " imports '" + spec + "' but no " + spec + '.js was emitted under ' + relative(process.cwd(), outDir));
    }
    return whole;
  });
  if (fixed !== src) writeFileSync(file, fixed);
}

for (const file of all) fix(file);
if (warned > 0) console.log('fix-esm-imports: ' + warned + ' unresolved import(s); the affected test modules will fail to load');
