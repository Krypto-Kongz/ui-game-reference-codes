// The whole product end to end, as a seller and a buyer would use it (contract section 10,
// bullet 3). In a temporary HAG_HOME:
//   hag keygen -> hag buyer add -> hag build (examples/hag.config.json) -> hag issue for
//   world 123 -> the built package (+ examples/ArenaExample.ts) compiled with TypeScript
//   4.7.4 -> the generated GuardData_* modules loaded in Node with the horizon/core mock ->
//   Guard.data('waves', fallback) equals the watermarked table, world 456 and a tampered
//   license give the fallback -> hag trace names the buyer (among two) -> hag verify OK ->
//   hag doctor on the build -> the AssetGuard lifecycle on the built package (license in
//   the props -> I00/LICENSED, tables warmed one per tick, the arena plays the real waves)
//   -> the same unlock inside QuickJS-wasm with typed arrays, BigInt, Proxy, eval and
//   TextEncoder deleted (test/quickjs-host.mjs), plaintext identical to Node's.
// Needs: npm install (typescript 4.7.4, quickjs-emscripten). No prior build is required;
// everything is compiled from the package `hag build` writes. KEEP_E2E=1 keeps the temp dir.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openBlob, requestCode } from '../cli/lib/formats.mjs';
import { parseGuardKey } from '../cli/lib/guardkey.mjs';
import { PREAMBLE, bundleModules, evalOrThrow, loadQuickJS, sandboxOk } from './quickjs-host.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, '..');
const HAG = join(PKG, 'cli', 'hag.mjs');
const TSC = join(PKG, 'node_modules', 'typescript', 'bin', 'tsc');
const STUB = join(PKG, 'types', 'horizon-core.d.ts');
const LINT = join(here, 'lint-runtime.mjs');
const FIX = join(here, 'fix-esm-imports.mjs');
const CONFIG = join(PKG, 'examples', 'hag.config.json');
const ARENA = join(PKG, 'examples', 'ArenaExample.ts');
const SAMPLE_KEY = join(PKG, 'runtime', 'GuardKey.ts');

let passed = 0;
let failed = 0;
let section = '';
function check(name, condition, detail) {
  if (condition) passed++;
  else {
    failed++;
    console.log('  FAIL [' + section + '] ' + name + (detail ? '\n        ' + String(detail).split('\n').slice(0, 15).join('\n        ') : ''));
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));

for (const [what, path] of [['typescript 4.7.4', TSC], ['the horizon/core typing stub', STUB], ['the runtime lint', LINT], ['examples/hag.config.json', CONFIG], ['examples/ArenaExample.ts', ARENA]]) {
  if (!existsSync(path)) {
    console.error('e2e: ' + what + ' missing (' + path + '); run npm install in horizon-asset-guard/');
    process.exit(1);
  }
}

const work = mkdtempSync(join(tmpdir(), 'hag-e2e-'));
const HOME = join(work, '.hag');
const ledger = () => readJson(join(HOME, 'ledger.json'));

// The CLI as a seller runs it, in `work`, against the temp ledger. Never the package's own
// .hag or runtime/GuardKey.ts (keygen gets an explicit --out).
function hag(args) {
  const env = { ...process.env, HAG_HOME: HOME };
  delete env.HAG_KEY_PASSPHRASE;
  const r = spawnSync(process.execPath, [HAG, ...args], { encoding: 'utf8', cwd: work, env });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}
const lintOk = (dir) => spawnSync(process.execPath, [LINT, dir], { encoding: 'utf8' }).status === 0;
const sampleKeyBefore = read(SAMPLE_KEY);
const t0 = performance.now();

// ---- 1. keygen, buyers, builds -------------------------------------------------------------
section = 'seller: keygen / buyer add / build';
const GK = join(work, 'GuardKey.ts');
{
  const r = hag(['keygen', '--sku', 'demo', '--out', GK]);
  check('hag keygen --sku demo writes the key and GuardKey.ts', r.status === 0 && existsSync(join(HOME, 'keys', 'demo.json')) && existsSync(GK), r.all);
  check('runtime/GuardKey.ts (the checked-in sample) is untouched', read(SAMPLE_KEY) === sampleKeyBefore);
  check('hag buyer add b001 (Ana)', hag(['buyer', 'add', '--sku', 'demo', '--id', 'b001', '--name', 'Ana']).status === 0);
  check('hag buyer add b002 (Bo, the decoy for trace)', hag(['buyer', 'add', '--sku', 'demo', '--id', 'b002', '--name', 'Bo']).status === 0);
}
const OUT1 = join(work, 'b001');
const OUT2 = join(work, 'b002');
const S1 = join(OUT1, 'scripts');
{
  const r = hag(['build', '--sku', 'demo', '--buyer', 'b001', '--config', CONFIG, '--out', OUT1]);
  check('hag build for b001 from examples/hag.config.json', r.status === 0, r.all);
  check('hag build for b002 (decoy)', hag(['build', '--sku', 'demo', '--buyer', 'b002', '--config', CONFIG, '--out', OUT2]).status === 0);
  const want = ['scripts/GuardData_waves.ts', 'scripts/GuardData_tunables.ts', 'scripts/GuardKey.ts', 'scripts/AssetGuard.ts', 'scripts/Guard.ts', 'scripts/GuardCore.ts', 'scripts/GuardKeystone.ts', 'scripts/GuardProbe.ts', 'scripts/crypto/Bytes.ts', 'scripts/crypto/Sha256.ts', 'scripts/crypto/BigNum.ts', 'scripts/crypto/Rsa.ts', 'scripts/crypto/ChaCha20.ts', 'BUYER-README.md', 'LICENSE-BUYER.md'];
  check('the package has the generated modules, GuardKey.ts, the whole runtime tree and the two readmes', want.every((f) => existsSync(join(OUT1, f))), want.filter((f) => !existsSync(join(OUT1, f))).join(', '));
  check('no GuardManifest, no ledger, no private key in the package', !existsSync(join(S1, 'GuardManifest.ts')) && !existsSync(join(OUT1, 'ledger.json')) && !read(join(S1, 'GuardKey.ts')).includes('PRIVATE'));
  const gk = parseGuardKey(read(join(S1, 'GuardKey.ts')));
  check("the package's GuardKey.ts carries the SKU and the freshly generated public key", gk.sku === 'demo' && gk.pubN === readJson(join(HOME, 'keys', 'demo.json')).n && gk.pubE === 65537 && gk.keystoneMode === 'off');
  for (const name of ['waves', 'tunables']) {
    const bytes = Buffer.byteLength(read(join(S1, 'GuardData_' + name + '.ts')));
    check('GuardData_' + name + '.ts is under the 25 KB script cap (' + bytes + ' bytes)', bytes < 25 * 1024);
  }
  check('the built scripts pass test/lint-runtime.mjs', lintOk(S1));
  check('BUYER-README.md lists the data modules and the activation steps', (() => { const t = read(join(OUT1, 'BUYER-README.md')); return t.includes('GuardData_waves.ts') && t.includes('GuardData_tunables.ts') && t.includes('HAG-REQ-demo') && t.includes('Ana'); })());
  check('LICENSE-BUYER.md has no unfilled placeholders', !/\{\{[A-Z0-9_#/]+\}\}/.test(read(join(OUT1, 'LICENSE-BUYER.md'))));
}

// ---- 2. issue for world 123 -------------------------------------------------------------------
section = 'seller: issue';
const REQ = requestCode('demo', '123');
let license = '';
let chunks = [];
{
  check('request code for demo / 123 is HAG-REQ-demo-123-QK42 (the one the docs print)', REQ === 'HAG-REQ-demo-123-QK42');
  const r = hag(['issue', '--sku', 'demo', '--buyer', 'b001', '--req', REQ, '--json']);
  let j = null;
  try {
    j = JSON.parse(r.out);
  } catch (e) {
    j = null;
  }
  check('hag issue --json returns the license and its prop chunks', r.status === 0 && j && typeof j.license === 'string' && j.license.startsWith('HAG1.') && Array.isArray(j.chunks), r.all);
  if (j) {
    license = j.license;
    chunks = j.chunks;
  }
  check('the license is split into three props of at most 200 chars that re-join exactly', chunks.length === 3 && chunks.every((c) => c.length <= 200) && chunks.join('') === license);
  check('payload binds world 123 for buyer b001 / Ana', j && j.payload && j.payload.s === 'demo' && j.payload.b === 'b001' && j.payload.m === 'W' && same(j.payload.w, ['123']) && j.payload.n === 'Ana');
  const plain = hag(['issue', '--sku', 'demo', '--buyer', 'b001', '--req', REQ]);
  check('hag issue prints the activation message with license / license2 / license3 lines', plain.status === 0 && plain.out.includes('---- activation message') && plain.out.includes('license2: ') && plain.out.includes('license3: ') && plain.out.includes('Hi Ana'), plain.all);
  check('the ledger holds both licenses and the bound world', ledger().buyers.b001.licenses.length === 2 && same(ledger().buyers.b001.worlds, ['123']));
}
const L = ledger();
const CK = Buffer.from(L.buyers.b001.ck, 'hex');

// ---- 3. compile the built package with TypeScript 4.7.4 ---------------------------------------
section = 'compile (tsc 4.7.4)';
const COMPILE = join(work, 'compile');
const OUT = join(work, 'out');
{
  cpSync(S1, COMPILE, { recursive: true });
  cpSync(ARENA, join(COMPILE, 'ArenaExample.ts'));
  writeFileSync(
    join(COMPILE, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'ES2020',
          moduleResolution: 'node',
          lib: ['ES2020'],
          types: [],
          strict: true,
          noEmitOnError: true,
          noUnusedLocals: false, // generated modules import the whole section 7 list by design
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
          baseUrl: '.',
          paths: { '*': ['*', 'crypto/*'], 'horizon/core': [relative(COMPILE, STUB)] },
          rootDir: '.',
          outDir: OUT,
        },
        include: ['**/*.ts'],
      },
      null,
      2,
    ),
  );
  const tsc = spawnSync(process.execPath, [TSC, '-p', join(COMPILE, 'tsconfig.json')], { encoding: 'utf8' });
  check('the built package + ArenaExample.ts compile clean under tsc 4.7.4 strict', tsc.status === 0, (tsc.stdout || '') + (tsc.stderr || ''));
  const fix = spawnSync(process.execPath, [FIX, OUT], { encoding: 'utf8' });
  check('fix-esm-imports resolves every bare import and places the mock', fix.status === 0 && !fix.stdout.includes('unresolved') && existsSync(join(OUT, 'horizon-core.js')), fix.stdout + fix.stderr);
  const emitted = ['GuardData_waves.js', 'GuardData_tunables.js', 'AssetGuard.js', 'Guard.js', 'GuardCore.js', 'GuardKey.js', 'GuardKeystone.js', 'GuardProbe.js', 'ArenaExample.js', 'crypto/Bytes.js', 'crypto/Sha256.js', 'crypto/BigNum.js', 'crypto/Rsa.js', 'crypto/ChaCha20.js'];
  check('every module was emitted', emitted.every((f) => existsSync(join(OUT, f))), emitted.filter((f) => !existsSync(join(OUT, f))).join(', '));
}

// ---- 4. the expected plaintext, from the seller side ---------------------------------------
// What the buyer must see: the watermarked table, decrypted with the ledger key from the
// blob inside the generated module (cli/lib/formats.mjs is node:crypto, independent of the
// runtime's own ChaCha20 and SHA-256).
section = 'expected tables';
const expected = {};
const blobs = {};
for (const name of ['waves', 'tunables']) {
  const src = read(join(S1, 'GuardData_' + name + '.ts'));
  const m = /'(HAGD1\.[A-Za-z0-9_-]+)'/.exec(src);
  blobs[name] = m ? m[1] : '';
  const plain = openBlob(blobs[name], CK);
  expected[name] = plain ? { plain, obj: JSON.parse(plain.toString('utf8')) } : null;
  check('the ' + name + ' blob opens under the ledger ck and names the table and the buyer', expected[name] && expected[name].obj.n === name && expected[name].obj.b === 'b001' && 'd' in expected[name].obj);
}
const WAVES = expected.waves ? expected.waves.obj.d : null;
const TUNE = expected.tunables ? expected.tunables.obj.d : null;
const sourceWaves = readJson(join(PKG, 'examples', 'data', 'waves.json'));
const sourceTune = readJson(join(PKG, 'examples', 'data', 'tunables.json'));
check('the watermarked waves keep the 8 seller waves in order, boss last', WAVES && WAVES.length === 8 && same(WAVES.map((w) => w.name), sourceWaves.map((w) => w.name)) && WAVES[7].boss === true);
check('the watermarked tunables differ from the source (slack constants applied)', TUNE && !same(TUNE, sourceTune) && Object.keys(sourceTune).every((k) => typeof TUNE[k] === 'number'));
check('every ledger _m mark ([path, key, value]) is present in the plaintext', (() => {
  const marks = L.buyers.b001.marks;
  const has = (table, mk) => JSON.stringify(table).includes('"' + mk[1] + '":' + JSON.stringify(mk[2]));
  const all = ['waves', 'tunables'].flatMap((n) => (marks[n].keys || []).map((mk) => [n, mk]));
  return all.every(([n, mk]) => has(n === 'waves' ? WAVES : TUNE, mk));
})());
check('slack values sit inside their declared ranges with at most 4 decimals', ['respawnDelay', 'critChance', 'lootDropChance', 'bossIntroDelay'].every((k) => {
  const [lo, hi] = readJson(CONFIG).marks['tunables.' + k];
  return TUNE && TUNE[k] >= lo && TUNE[k] <= hi && String(TUNE[k]).replace(/^[^.]*\.?/, '').length <= 4;
}));

// ---- 5. the generated modules in Node with the horizon/core mock ----------------------------
section = 'Guard.data in Node (mock horizon)';
const u = (f) => pathToFileURL(join(OUT, f)).href;
const hz = await import(u('horizon-core.js'));
const { mock, flush } = hz;
const { Guard } = await import(u('Guard.js'));
const captured = [];
const counts = {};
const resetCounts = () => {
  for (const k of Object.keys(counts)) delete counts[k];
};
{
  // Guard.register is what the generated modules call at load; capture the sources so the
  // test can count unlocks (register() is idempotent by name, so re-registering a counting
  // wrapper replaces the original without touching the module).
  const origRegister = Guard.register;
  Guard.register = (s) => {
    captured.push(s);
    return origRegister.call(Guard, s);
  };
  await import(u('GuardData_waves.js'));
  await import(u('GuardData_tunables.js'));
  Guard.register = origRegister;
  check('both generated modules register their table at load', same(captured.map((s) => s.name), ['waves', 'tunables']) && same(Guard.sources(), ['waves', 'tunables']));
  check('each registered blobHash equals the ledger record', captured.every((s) => /^[0-9a-f]{16}$/.test(s.blobHash) && s.blobHash === L.buyers.b001.blobs[s.name]));
  check('unlock is a function taking (license, world)', captured.every((s) => typeof s.unlock === 'function' && s.unlock.length === 2));
  for (const s of captured) {
    Guard.register({
      name: s.name,
      blobHash: s.blobHash,
      unlock: (lic, w) => {
        counts[s.name] = (counts[s.name] || 0) + 1;
        return s.unlock(lic, w);
      },
    });
  }
}
const FB_WAVES = [{ name: 'trial', enemies: 1 }];
const FB_TUNE = { spawnRate: 1 };
const worldObj = () => hz.world;
let nodeUnlockMs = 0;
let tamperedSig = '';
{
  mock.reset();
  mock.worldId = 123n;
  Guard.attach(worldObj(), license);
  const t = performance.now();
  const waves = Guard.data('waves', FB_WAVES);
  nodeUnlockMs = performance.now() - t;
  check("Guard.data('waves', fallback) in world 123 equals the watermarked table", same(waves, WAVES));
  check("Guard.data('tunables', fallback) equals the watermarked tunables", same(Guard.data('tunables', FB_TUNE), TUNE));
  check('Guard.tune() reads the watermarked slack value', Guard.tune('respawnDelay', 0) === TUNE.respawnDelay && Guard.tune('spawnRate', 0) === TUNE.spawnRate);
  check('Guard.tune() of an unknown name gives the fallback, always finite', Guard.tune('nope', 7) === 7 && Number.isFinite(Guard.tune('nope', 7)));
  Guard.data('waves', FB_WAVES);
  Guard.data('waves', FB_WAVES);
  check('each table was unlocked once; later data() calls are served from the cache', counts.waves === 1 && counts.tunables === 1);
  check('with no AssetGuard yet the policy state stays UNVERIFIED at tier 0 (data unlocks regardless)', Guard.state.state === 'UNVERIFIED' && Guard.state.tier === 0);

  mock.worldId = 456n;
  Guard.attach(worldObj(), license);
  check('world 456 -> the fallback object itself, for both tables', Guard.data('waves', FB_WAVES) === FB_WAVES && Guard.data('tunables', FB_TUNE) === FB_TUNE);
  Guard.data('waves', FB_WAVES);
  check('a failed unlock is remembered: no second verify per data() call in the wrong world', counts.waves === 2);
  Guard.warm('waves');
  check('warm() retries once after a failure and fails again (still fallback)', counts.waves === 3 && Guard.data('waves', FB_WAVES) === FB_WAVES);

  mock.worldId = null; // world.id.get() throws: W02 fail-open to the licensed world
  Guard.attach(worldObj(), license);
  check('unreadable world id fails open to the licensed world (W02)', same(Guard.data('waves', FB_WAVES), WAVES));

  mock.worldId = 123n;
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
  tamperedSig = flip(license, license.length - 10);
  const dot = license.indexOf('.', 5);
  const tamperedPayload = 'HAG1.' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(license.slice(5, dot), 'base64url').toString('utf8')), b: 'b999' })).toString('base64url') + license.slice(dot);
  const truncated = license.slice(0, 300);
  for (const [label, bad] of [['a flipped signature character', tamperedSig], ['an edited payload (buyer id) under the old signature', tamperedPayload], ['a truncated license', truncated], ['no license at all', '']]) {
    Guard.attach(worldObj(), bad);
    check(label + ' -> fallback', Guard.data('waves', FB_WAVES) === FB_WAVES && Guard.data('tunables', FB_TUNE) === FB_TUNE);
  }
}

// ---- 6. trace, verify, doctor ---------------------------------------------------------------
section = 'seller: trace / verify / doctor';
{
  const tr = hag(['trace', OUT1, '--out', join(work, 'trace-b001.md'), '--json']);
  let j = null;
  try {
    j = JSON.parse(tr.out);
  } catch (e) {
    j = null;
  }
  check("hag trace on b001's package names b001 with high confidence", tr.status === 0 && j && j.candidates[0].id === 'b001' && j.confidence === 'high', tr.all);
  check('the decoy b002 scores far below (blob hash, names and marks all belong to b001)', j && j.candidates[1].id === 'b002' && j.candidates[1].score * 3 <= j.candidates[0].score && j.candidates[0].counts.blobs > 0 && j.candidates[0].counts.names > 0);
  check('trace-report.md was written', existsSync(join(work, 'trace-b001.md')) && read(join(work, 'trace-b001.md')).includes('b001'));
  const tr2 = hag(['trace', OUT2, '--out', join(work, 'trace-b002.md'), '--json']);
  check("hag trace on b002's package names b002", tr2.status === 0 && JSON.parse(tr2.out).candidates[0].id === 'b002');
  // The cracker's best move: dump the plaintext and delete the ciphertext. The data-domain
  // marks (the _m keys and the slack constants) still name the buyer.
  const dump = join(work, 'dump');
  mkdirSync(dump, { recursive: true });
  writeFileSync(join(dump, 'waves.json'), JSON.stringify(WAVES, null, 2));
  writeFileSync(join(dump, 'tunables.json'), JSON.stringify(TUNE, null, 2));
  const tr3 = hag(['trace', dump, '--out', join(work, 'trace-dump.md'), '--json']);
  const j3 = tr3.status === 0 ? JSON.parse(tr3.out) : null;
  check('a plain JSON dump of the decrypted tables still traces to b001', j3 && j3.candidates[0].id === 'b001' && j3.candidates[0].counts.blobs === 0 && j3.candidates[0].score > j3.candidates[1].score, tr3.all);

  const v = hag(['verify', license]);
  check('hag verify <license> is OK (I00) for b001 in world 123', v.status === 0 && v.out.includes('I00') && v.out.includes('world 123'), v.all);
  check('hag verify with the shipped GuardKey.ts as the key', hag(['verify', license, '--key', join(S1, 'GuardKey.ts')]).status === 0);
  const vb = hag(['verify', tamperedSig]);
  check('hag verify on the tampered license reports E11 and exits 1', vb.status === 1 && vb.out.includes('E11'), vb.all);
  check('hag verify --json gives the decoded payload', (() => { const r = hag(['verify', license, '--json']); return r.status === 0 && JSON.parse(r.out).payload.b === 'b001'; })());

  const d = hag(['doctor', '--dir', OUT1]);
  check('hag doctor on the build folder (descends into scripts/) passes lint + tsc 4.7.4', d.status === 0 && d.out.includes('tsc 4.7.4: clean') && d.out.includes('hag doctor: OK'), d.all);
  check('hag list shows the buyer and the world', (() => { const r = hag(['list']); return r.status === 0 && r.out.includes('b001') && r.out.includes('123'); })());
}

// ---- 7. AssetGuard lifecycle on the built package --------------------------------------------
section = 'AssetGuard lifecycle (built package)';
const { AssetGuard } = await import(u('AssetGuard.js'));
const { ArenaExample } = await import(u('ArenaExample.js'));
const logs = () => mock.log.join('\n');
const lastText = () => (mock.texts.length ? mock.texts[mock.texts.length - 1].text : '');
function freshRun() {
  mock.reset();
  Guard.reset();
  mock.worldId = 123n;
  mock.captureConsole = true;
  resetCounts();
}
{
  // A. the guard alone: verify on later frames, then one warm per tick.
  freshRun();
  const text = new hz.Entity(77n);
  hz.instantiate(AssetGuard, { license: chunks[0], license2: chunks[1], license3: chunks[2], statusText: text });
  check('start() leaves the guard UNVERIFIED and unlocks nothing (no RSA in start())', Guard.state.state === 'UNVERIFIED' && Object.keys(counts).length === 0);
  await flush(300);
  check('step 1 (300 ms): the split license parses, no E10', !logs().includes('E10') && Guard.state.state === 'UNVERIFIED');
  await flush(50);
  const s = Guard.state;
  check('step 2: I00 / LICENSED, tier 0, buyer Ana, world 123', s.state === 'LICENSED' && s.code === 'I00' && s.tier === 0 && s.buyer === 'Ana' && s.worldId === '123' && s.requestCode === REQ, JSON.stringify(s));
  check('console shows I00 licensed to Ana', logs().includes('I00 licensed to Ana'));
  check("status text reads 'Licensed to Ana'", lastText() === 'Licensed to Ana');
  check('the verify step itself unlocked no table yet', Object.keys(counts).length === 0);
  await flush(40);
  check('first warm tick unlocks waves only', counts.waves === 1 && counts.tunables === undefined);
  await flush(40);
  check('second warm tick unlocks tunables', counts.tunables === 1);
  check('data() after warming is served from the cache and equals the watermarked table', same(Guard.data('waves', FB_WAVES), WAVES) && same(Guard.data('tunables', FB_TUNE), TUNE) && counts.waves === 1 && counts.tunables === 1);
  check('no log line prints the whole license', !logs().includes(license) && !logs().includes(license.slice(-60)));
  check('no timer callback threw', mock.errors.length === 0, mock.errors.map(String).join('\n'));
  mock.captureConsole = false;
  mock.texts.length = 0;
  mock.captureConsole = true;
  await flush(600000);
  check('the 10-minute recheck keeps LICENSED and refreshes the status text', Guard.state.state === 'LICENSED' && lastText() === 'Licensed to Ana' && mock.errors.length === 0);

  // B. the guard plus the example arena: the game plays the real 8 waves.
  freshRun();
  const banner = new hz.Entity(78n);
  const arena = hz.instantiate(ArenaExample, { banner, autoStart: true });
  hz.instantiate(AssetGuard, { license: chunks[0], license2: chunks[1], license3: chunks[2], statusText: new hz.Entity(77n) });
  await flush(350);
  check('arena sees LICENSED (I00) and the 8 real waves', logs().includes('[Arena] guard LICENSED (I00), 8 waves') && !logs().includes('[trial table]'), logs());
  check('wave 1 starts from the real table', logs().includes('[Arena] wave 1/8: ' + WAVES[0].name + ', ' + WAVES[0].enemies + ' enemies'));
  check('the banner shows the ready line, then the wave line', mock.texts.some((t) => t.text === 'Ready: 8 waves') && mock.texts.some((t) => t.text === 'Wave 1: ' + WAVES[0].name));
  check('tier 0 reported to the arena', logs().includes('[Arena] tier 0'));
  check('Arena_Wave was broadcast for wave 1', mock.sent.some((e) => e.name === 'Arena_Wave' && e.data.index === 0 && e.data.name === WAVES[0].name));
  await flush(60000);
  const perKill = typeof TUNE.scorePerKill === 'number' ? TUNE.scorePerKill : 10;
  const perWave = typeof TUNE.scorePerWave === 'number' ? TUNE.scorePerWave : 100;
  for (let k = 0; k < WAVES[0].enemies; k++) arena.sendLocalBroadcastEvent(new hz.LocalEvent('Arena_EnemyDown'), { by: 1 });
  check('clearing wave 1 scores with the real tunables', logs().includes('[Arena] wave 1 cleared by player 1, score ' + (WAVES[0].enemies * perKill + perWave)), logs().split('\n').filter((l) => l.includes('cleared')).join('\n'));
  await flush(typeof TUNE.waveDelayMs === 'number' ? TUNE.waveDelayMs : 4000);
  check('wave 2 follows after the real waveDelayMs', logs().includes('[Arena] wave 2/8: ' + WAVES[1].name), logs());
  check('no handler or timer threw during the arena run', mock.errors.length === 0, mock.errors.map(String).join('\n'));

  // C. no license: I01 / TRIAL with the request code, the arena on its 2-wave trial table.
  freshRun();
  hz.instantiate(ArenaExample, { autoStart: true });
  hz.instantiate(AssetGuard, { statusText: new hz.Entity(77n) });
  await flush(350);
  check('no license -> I01 with the activation request code', logs().includes('I01 no license, trial mode. Activation request code: ' + REQ) && Guard.state.state === 'TRIAL' && Guard.state.tier === 1 && Guard.state.requestCode === REQ);
  check("status text reads 'Trial — activation code: ...'", lastText() === 'Trial — activation code: ' + REQ);
  check('the arena runs on the trial table (2 waves) and prints the code for the seller', logs().includes('[Arena] guard TRIAL (I01), 2 waves [trial table]') && logs().includes('[Arena] activation code for the seller: ' + REQ) && logs().includes('[Arena] wave 1/2: Scouts, 4 enemies'));
  check('nothing was unlocked without a license', Object.keys(counts).length === 0);

  // D. the licensed package duplicated into world 456: E12 with a fresh request code.
  freshRun();
  mock.worldId = 456n;
  hz.instantiate(ArenaExample, { autoStart: true });
  hz.instantiate(AssetGuard, { license: license, statusText: new hz.Entity(77n) });
  await flush(350);
  const req456 = requestCode('demo', '456');
  check('world 456 -> E12 MISMATCH, tier 1, live and licensed ids and a re-issue code in the log', Guard.state.state === 'MISMATCH' && Guard.state.code === 'E12' && Guard.state.tier === 1 && logs().includes('live world: 456, licensed: 123') && logs().includes('free re-issue: ' + req456), logs());
  check("status text reads 'License is for another world — code: ...'", lastText() === 'License is for another world — code: ' + req456);
  check('the arena falls back to the trial table in the wrong world', logs().includes('[Arena] guard MISMATCH (E12), 2 waves [trial table]'));
  mock.captureConsole = false;
}

// ---- 8. the same unlock inside QuickJS-wasm, Horizon's globals deleted ------------------------
section = 'QuickJS (no JIT, typed arrays / BigInt / Proxy / eval / TextEncoder deleted)';
let timing = null;
{
  // The mock redirects the host's Date.now to its virtual clock, and quickjs-emscripten's
  // Date.now inside the sandbox is the host's: the real clock is restored for the timings.
  const virtualNow = Date.now;
  Date.now = mock.realNow;
  const { mod, from } = await loadQuickJS();
  const QuickJS = await mod.getQuickJS();
  const ctx = QuickJS.newContext();
  try {
    const env = JSON.parse(evalOrThrow(ctx, PREAMBLE, 'preamble'));
    check('the sandbox really lacks the globals (' + (env.remaining.length ? 'still defined: ' + env.remaining.join(', ') : 'none left') + ')', sandboxOk(env) && env.bigint === 'undefined' && env.proxy === 'undefined' && env.evalType === 'undefined');
    const names = L.buyers.b001.names.waves; // the per-buyer mangled names, from the ledger
    const files = ['crypto/Bytes.js', 'crypto/Sha256.js', 'crypto/BigNum.js', 'crypto/Rsa.js', 'crypto/ChaCha20.js', 'GuardKey.js', 'GuardData_waves.js'].map((f) => join(OUT, f));
    // The generated module's only outside references are Guard.register and GuardKey's
    // constants; a one-line registry stub captures the source exactly as Guard.ts would.
    const bundle = bundleModules(files, {
      prelude: 'var Guard = { register: function (s) { globalThis.__src = s; } };\n',
      epilogue: 'globalThis.__core = { parse: ' + names.g_parse + ', verify: ' + names.g_verify + ', evaluate: ' + names.g_eval + ', pubN: PUB_N, pubE: PUB_E, sku: SKU };',
    });
    evalOrThrow(ctx, bundle, 'bundle load');
    const RUN = `
(function () {
  var L = ${JSON.stringify(license)};
  var T = ${JSON.stringify(tamperedSig)};
  var src = globalThis.__src;
  var C = globalThis.__core;
  var w123 = { id: { get: function () { return '123'; } } };
  var w456 = { id: { get: function () { return '456'; } } };
  var N = 5;
  var p = src.unlock(L, w123);
  var hex = '';
  if (p) for (var i = 0; i < p.length; i++) hex += (p[i] < 16 ? '0' : '') + p[i].toString(16);
  var t0 = Date.now();
  for (var k = 0; k < N; k++) src.unlock(L, w123);
  var unlockMs = (Date.now() - t0) / N;
  var parsed = C.parse(L);
  var t1 = Date.now();
  var ok = 0;
  for (var m = 0; m < N; m++) ok += C.verify(parsed, C.pubN, C.pubE) ? 1 : 0;
  var verifyMs = (Date.now() - t1) / N;
  var open = src.unlock(L, null);
  var openHex = '';
  if (open) for (var j = 0; j < open.length; j++) openHex += (open[j] < 16 ? '0' : '') + open[j].toString(16);
  var ev = C.evaluate(parsed, C.pubN, C.pubE, C.sku, '123', 0);
  var ev456 = C.evaluate(parsed, C.pubN, C.pubE, C.sku, '456', 0);
  return JSON.stringify({ name: src.name, blobHash: src.blobHash, hex: hex, unlockMs: unlockMs, verifyMs: verifyMs, verified: ok,
    null456: src.unlock(L, w456) === null, nullTampered: src.unlock(T, w123) === null, nullEmpty: src.unlock('', w123) === null,
    openHex: openHex, evState: ev.state, evCode: ev.code, ev456: ev456.code, ev456Detail: ev456.detail,
    bigint: typeof BigInt, typed: typeof Uint8Array });
})()`;
    const r = JSON.parse(evalOrThrow(ctx, RUN, 'run'));
    const plainHex = expected.waves.plain.toString('hex');
    check('the generated module registered its source inside QuickJS', r.name === 'waves' && r.blobHash === L.buyers.b001.blobs.waves);
    check('unlock in world 123 yields byte-identical plaintext to Node (' + (plainHex.length / 2) + ' bytes)', r.hex === plainHex);
    check('the plaintext is the watermarked waves table', same(JSON.parse(Buffer.from(r.hex, 'hex').toString('utf8')).d, WAVES));
    check('world 456, a tampered license and an empty license all yield null', r.null456 && r.nullTampered && r.nullEmpty);
    check('an unreadable world fails open to the licensed world (W02)', r.openHex === plainHex);
    check('the mangled evaluate gives I00/LICENSED in 123 and E12 with a re-issue code in 456', r.evState === 'LICENSED' && r.evCode === 'I00' && r.ev456 === 'E12' && r.ev456Detail.includes(requestCode('demo', '456')));
    check('the RSA signature verified every time (' + r.verified + '/5)', r.verified === 5);
    check('BigInt and Uint8Array stayed undefined throughout', r.bigint === 'undefined' && r.typed === 'undefined');
    timing = { from, verifyMs: r.verifyMs, unlockMs: r.unlockMs, blobBytes: blobs.waves.length, plainBytes: plainHex.length / 2 };
  } catch (e) {
    check('QuickJS run completed', false, e && e.stack ? e.stack : String(e));
  } finally {
    ctx.dispose();
    Date.now = virtualNow;
  }
}

// ---- summary ---------------------------------------------------------------------------------
if (timing) {
  console.log('e2e timings: QuickJS (' + timing.from + ', no JIT, globals deleted): RSA-2048 verify ' + timing.verifyMs.toFixed(1) + ' ms, full unlock of the ' + timing.blobBytes + '-char blob (' + timing.plainBytes + ' plaintext bytes) ' + timing.unlockMs.toFixed(1) + ' ms; Node: first Guard.data() unlock ' + nodeUnlockMs.toFixed(2) + ' ms');
}
console.log('e2e wall time: ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s');
if (process.env.KEEP_E2E) console.log('e2e work dir kept: ' + work);
else rmSync(work, { recursive: true, force: true });
console.log('e2e.test: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
