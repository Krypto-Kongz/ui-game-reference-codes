// Shared QuickJS machinery for test/quickjs.bench.mjs and test/e2e.test.mjs: loads
// quickjs-emscripten (a WASM bytecode interpreter with no JIT, standing in for Horizon's
// script engine), deletes the globals Horizon lacks (every typed array, BigInt, Proxy, eval,
// TextEncoder, atob, Buffer, crypto, the global timers) and bundles compiled ES2020 modules
// into one plain script, since the interpreter has no module loader. Test-only; nothing
// here ships.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// quickjs-emscripten is resolved from this package's node_modules first (it is a
// devDependency), then from $QUICKJS_BENCH_DIR if that is set.
export async function loadQuickJS() {
  const tried = [];
  try {
    return { mod: await import('quickjs-emscripten'), from: 'horizon-asset-guard/node_modules' };
  } catch (e) {
    tried.push('local node_modules: ' + e.message.split('\n')[0]);
  }
  const benchDir = process.env.QUICKJS_BENCH_DIR;
  if (benchDir) try {
    const req = createRequire(join(benchDir, 'package.json'));
    const pkgDir = dirname(req.resolve('quickjs-emscripten/package.json'));
    return { mod: await import(pathToFileURL(join(pkgDir, 'dist', 'index.mjs')).href), from: pkgDir };
  } catch (e) {
    tried.push(benchDir + ': ' + e.message.split('\n')[0]);
  }
  throw new Error('quickjs-emscripten not found. Tried:\n  ' + tried.join('\n  ') + '\nFix: npm install (it is a devDependency), or set QUICKJS_BENCH_DIR to a folder that has it installed.');
}

// Names deleted from the interpreter's global object before any guard code loads. Evaluating
// the preamble returns a JSON report: what could not be deleted, whether `new Uint8Array`
// is really a ReferenceError, and the typeof of BigInt / Proxy / eval afterwards.
export const DELETED_GLOBALS = [
  'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'BigInt', 'Proxy', 'eval', 'TextEncoder',
  'TextDecoder', 'atob', 'btoa', 'Buffer', 'crypto', 'setTimeout', 'setInterval',
];

export const PREAMBLE = `
(function () {
  var names = ${JSON.stringify(DELETED_GLOBALS)};
  var remaining = [];
  for (var i = 0; i < names.length; i++) {
    try { delete globalThis[names[i]]; } catch (e) {}
    if (typeof globalThis[names[i]] !== 'undefined') remaining.push(names[i]);
  }
  var canary;
  try { canary = new Uint8Array(1); canary = 'typed arrays still constructible'; } catch (e) { canary = e.name; }
  return JSON.stringify({ remaining: remaining, canary: canary, bigint: typeof BigInt, proxy: typeof Proxy, evalType: typeof eval });
})()`;

// True when the preamble's report says the sandbox really lacks the globals.
export function sandboxOk(env) {
  return env.remaining.length === 0 && env.canary === 'ReferenceError';
}

export function evalOrThrow(ctx, code, label) {
  const r = ctx.evalCode(code);
  if (r.error) {
    const msg = ctx.dump(r.error);
    r.error.dispose();
    throw new Error(label + ': ' + JSON.stringify(msg));
  }
  const value = ctx.dump(r.value);
  r.value.dispose();
  return value;
}

// Plain concatenation of ES2020 module output files, in order, with imports and export
// keywords stripped, wrapped in one IIFE. `prelude` runs before the first module (stand-ins
// for imports the modules expect, such as a Guard registry stub) and `epilogue` after the last
// one (typically `globalThis.__x = { ... }` to hand functions out). Top-level names must be
// unique across the files, or the concatenation would silently shadow one.
export function bundleModules(files, { prelude = '', epilogue = '' } = {}) {
  const declared = new Map();
  let code = '';
  for (const file of files) {
    const name = basename(file, '.js');
    let src = readFileSync(file, 'utf8');
    src = src.replace(/^import\s[^;]*;[ \t]*$/gm, '');
    src = src.replace(/^export\s+(?=(?:function|const|let|var|class)\b)/gm, '');
    src = src.replace(/^export\s*\{\s*\};?[ \t]*$/gm, '');
    const leftover = src.match(/^\s*(import|export)\b.*$/m);
    if (leftover) throw new Error(name + '.js: cannot strip "' + leftover[0].trim() + '" (the bundler only handles single-line imports and export declarations)');
    for (const m of src.matchAll(/^(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (declared.has(m[1])) throw new Error('top-level name "' + m[1] + '" is declared in both ' + declared.get(m[1]) + ' and ' + name + '; rename one for the concatenated build');
      declared.set(m[1], name);
    }
    code += '// ---- ' + name + '.js ----\n' + src + '\n';
  }
  return '(function () {\n' + prelude + code + epilogue + '\n})();\n';
}
