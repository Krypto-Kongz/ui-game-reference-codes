// doctor.mjs
// `hag doctor [--dir <package dir>] [--skip-tsc]`
// Pre-ship checks on a runtime tree (the package's runtime/ by default, or a build's
// <out>/scripts/): the shared lint (test/lint-runtime.mjs: forbidden globals, ES2021+
// syntax, 25 KB per file), the 64 KB hard cap, a TypeScript 4.7.4 --noEmit compile when
// that compiler is installed (strict, ES2020, the local horizon/core stub), and the keystone
// gate: GuardKey.ts with KEYSTONE_MODE 'degrade' is refused unless the ledger holds a
// keystone-test record for that SKU newer than 90 days (contract section 9). Exit 1 on any
// problem; warnings alone exit 0.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { HagError, LINT_SCRIPT, PKG_ROOT, RUNTIME_DIR, TYPES_STUB, UsageError, daysSince, parseArgs, readText } from './common.mjs';
import { parseGuardKey } from './guardkey.mjs';
import { KEYSTONE_GATE_TESTS } from './keystone.mjs';
import { loadLedger } from './state.mjs';

export const KEYSTONE_MAX_AGE_DAYS = 90;
const HARD_CAP = 64 * 1024;

function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

export function findTypescript(dir) {
  const req = createRequire(import.meta.url);
  for (const base of [PKG_ROOT, dir, process.cwd()]) {
    try {
      const pkg = req.resolve('typescript/package.json', { paths: [base] });
      const version = req(pkg).version;
      return { tsc: join(dirname(pkg), 'bin', 'tsc'), version };
    } catch (e) {
      // keep looking
    }
  }
  return null;
}

// Freshest keystone (spawn / revocation) test record for the SKU, or null. Only the tests
// that exercise the keystone itself (T4, T5, erase, placed, T9) count for the 90-day gate;
// the other live tests (T0, T1, T2, T7, T11, T12) are recorded for the ledger but say nothing
// about whether unsharing an asset really stops a spawn.
export function latestKeystoneTest(ledger, sku) {
  const rec = ledger.skus[sku];
  const tests = ((rec && rec.keystoneTests) || []).filter((t) => KEYSTONE_GATE_TESTS.includes(t.test));
  let best = null;
  for (const t of tests) if (!best || t.date > best.date) best = t;
  return best;
}

export async function doctor(argv) {
  const { opts, positional } = parseArgs(argv, { known: ['dir'], flags: ['skip-tsc'] });
  if (positional.length > 0) throw new UsageError('unexpected argument "' + positional[0] + '"');
  let dir = resolve(opts.dir || RUNTIME_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new HagError(dir + ' is not a directory');
  // A build output folder (<out>/ as `hag build` writes it, with the scripts under
  // <out>/scripts/) is checked at its scripts root, where the bare imports resolve.
  if (!existsSync(join(dir, 'GuardKey.ts')) && existsSync(join(dir, 'scripts', 'GuardKey.ts'))) dir = join(dir, 'scripts');
  const rel = (p) => relative(process.cwd(), p) || '.';
  const problems = [];
  const warnings = [];
  console.log('hag doctor: ' + rel(dir));

  // 1. Shared lint (the same rules npm test enforces on runtime/).
  if (!existsSync(LINT_SCRIPT)) {
    problems.push('lint script ' + LINT_SCRIPT + ' is missing; cannot check forbidden constructs');
  } else {
    const lint = spawnSync(process.execPath, [LINT_SCRIPT, dir], { encoding: 'utf8' });
    const text = (lint.stdout || '') + (lint.stderr || '');
    for (const line of text.trim().split('\n')) if (line) console.log('  lint: ' + line);
    if (lint.status !== 0) problems.push('lint-runtime found forbidden constructs or oversized files (see above)');
  }

  // 2. Size caps beyond the lint's 25 KB: the platform's 64 KB per script.
  const files = tsFiles(dir);
  if (files.length === 0) problems.push('no .ts files under ' + dir);
  let total = 0;
  for (const f of files) {
    const size = statSync(f).size;
    total += size;
    if (size > HARD_CAP) problems.push(rel(f) + ' is ' + size + ' bytes, over the 64 KB per-script limit of non-FBS worlds');
  }
  console.log('  size: ' + files.length + ' .ts file(s), ' + total + ' bytes total');

  // 3. GuardKey.ts and the keystone gate.
  const guardKeyPath = join(dir, 'GuardKey.ts');
  let guardKey = null;
  if (!existsSync(guardKeyPath)) {
    warnings.push('no GuardKey.ts in ' + rel(dir) + ' (run hag keygen, or check a build output dir <out>/scripts); a package without it cannot compile or ship');
  } else {
    guardKey = parseGuardKey(readText(guardKeyPath));
    if (!guardKey.sku || !guardKey.pubN || guardKey.pubE === null) problems.push('GuardKey.ts is missing SKU / PUB_N / PUB_E');
    if (guardKey.keystoneMode === null) problems.push("GuardKey.ts KEYSTONE_MODE must be 'off', 'warn' or 'degrade'");
    if (guardKey.keystoneMode === 'degrade' || guardKey.keystoneMode === 'warn') {
      if (!guardKey.keystoneId || guardKey.keystoneId === '0') problems.push("GuardKey.ts KEYSTONE_MODE '" + guardKey.keystoneMode + "' needs a KEYSTONE_ID (currently '0' = none)");
    }
    if (guardKey.keystoneMode === 'degrade') {
      const ledger = loadLedger();
      const latest = latestKeystoneTest(ledger, guardKey.sku);
      const age = latest ? daysSince(latest.date) : null;
      if (!latest) {
        problems.push("KEYSTONE_MODE 'degrade' for SKU " + guardKey.sku + ' refused: no keystone-test record (' + KEYSTONE_GATE_TESTS.join(', ') + ') in the ledger. Run the live tests (docs/KEYSTONE-TEST.md) and record them: hag keystone-test --sku ' + guardKey.sku + ' --record T5=pass');
      } else if (age > KEYSTONE_MAX_AGE_DAYS) {
        problems.push("KEYSTONE_MODE 'degrade' for SKU " + guardKey.sku + ' refused: the newest keystone-test record (' + latest.test + '=' + latest.result + ', ' + latest.date.slice(0, 10) + ') is ' + age + ' days old, over ' + KEYSTONE_MAX_AGE_DAYS + '. Re-run the live tests and record them.');
      } else {
        console.log("  keystone: 'degrade' allowed; newest test record " + latest.test + '=' + latest.result + ' is ' + age + ' day(s) old');
        const t5 = ((ledger.skus[guardKey.sku] || {}).keystoneTests || []).filter((t) => t.test === 'T5');
        if (t5.length === 0) warnings.push("KEYSTONE_MODE 'degrade' without a T5 record (unshare -> re-spawn fails); T5 is the pass criterion for revocable core content");
        else if (!/pass|ok|true|yes/i.test(t5[t5.length - 1].result)) warnings.push("the latest T5 record is '" + t5[t5.length - 1].result + "': 'degrade' will punish a buyer on a signal the live test did not confirm");
      }
    } else if (guardKey.keystoneMode) {
      console.log("  keystone: mode '" + guardKey.keystoneMode + "'" + (guardKey.keystoneId && guardKey.keystoneId !== '0' ? ', asset ' + guardKey.keystoneId : ''));
    }
    if (guardKey.bakedLicense && !guardKey.bakedLicense.startsWith('HAG1.')) problems.push('GuardKey.ts BAKED_LICENSE is set but does not start with HAG1.');
  }

  // 4. TypeScript 4.7.4 compile, strict, with the local horizon/core stub.
  if (opts['skip-tsc']) {
    console.log('  tsc: skipped (--skip-tsc)');
  } else {
    const ts = findTypescript(dir);
    if (!ts) {
      warnings.push('typescript is not installed; compile check skipped (npm install in horizon-asset-guard/ provides 4.7.4)');
    } else {
      if (ts.version !== '4.7.4') warnings.push('typescript ' + ts.version + ' found; Horizon compiles with 4.7.4 exactly, so a pass here is not conclusive');
      const tmp = mkdtempSync(join(tmpdir(), 'hag-doctor-'));
      const paths = { '*': ['*', 'crypto/*'] };
      if (existsSync(TYPES_STUB)) paths['horizon/core'] = [relative(dir, TYPES_STUB).split('\\').join('/')];
      else warnings.push('types/horizon-core.d.ts stub missing; horizon/core imports will not resolve in the compile check');
      writeFileSync(
        join(tmp, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { target: 'ES2020', module: 'ES2020', moduleResolution: 'node', lib: ['ES2020'], types: [], strict: true, noEmit: true, baseUrl: dir, paths },
          files: files,
        }),
      );
      const run = spawnSync(process.execPath, [ts.tsc, '-p', join(tmp, 'tsconfig.json')], { encoding: 'utf8' });
      rmSync(tmp, { recursive: true, force: true });
      const out = ((run.stdout || '') + (run.stderr || '')).trim();
      if (run.status === 0) console.log('  tsc ' + ts.version + ': clean');
      else {
        for (const line of out.split('\n').slice(0, 30)) console.log('  tsc: ' + line);
        problems.push('TypeScript ' + ts.version + ' reported errors (see above)');
      }
    }
  }

  for (const w of warnings) console.log('  warning: ' + w);
  for (const p of problems) console.log('  PROBLEM: ' + p);
  if (problems.length > 0) throw new HagError('hag doctor: ' + problems.length + ' problem(s)');
  console.log('hag doctor: OK' + (warnings.length ? ' with ' + warnings.length + ' warning(s)' : ''));
}
