// Lifecycle simulation of AssetGuard + Guard + GuardKeystone against the Node mock of
// horizon/core (test/mocks/horizon-core.mjs), with manual timer flushing. Covers contract
// section 10, bullet 4: no license -> I01/TRIAL; valid -> I00/LICENSED; mismatch -> E12;
// bad signature -> E11; truncated -> E10; expired -> E13; sources warmed; sentinel
// disagreement -> tier 2; plus grace, status text, hag:req/hag:res, W02 fail-open, the tier-2
// jitter rule, Reset re-attach, and the keystone spawn-error policy.
//
// Runs on the compiled test build: npm run build:test   then   node test/assetguard.test.mjs
// (HAG_TEST_OUT=<dir> points at another compiled tree with the same layout: runtime/*.js,
// runtime/crypto/*.js and horizon-core.js at its root). The build's GuardKey.js is the
// checked-in sample whose private key this test does not have, so each scenario family gets
// a private copy of test/out in a temp dir with runtime/GuardKey.js replaced by a key
// generated here; every other file, including the mock copy fix-esm-imports.mjs places at
// out/horizon-core.js, is the real compiled output.
import { constants, createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.HAG_TEST_OUT || join(here, 'out');
for (const f of ['runtime/AssetGuard.js', 'runtime/Guard.js', 'runtime/GuardCore.js', 'runtime/GuardKeystone.js', 'horizon-core.js', 'runtime/crypto/ChaCha20.js']) {
  if (!existsSync(join(OUT, f))) {
    console.error('assetguard.test: ' + join(OUT, f) + ' missing; run `npm run build:test` first');
    process.exit(1);
  }
}

let passed = 0;
let failed = 0;
let section = '';
function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.error('  FAIL [' + section + '] ' + name);
  }
}
const sha256 = (buf) => createHash('sha256').update(buf).digest();
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const utf8 = (s) => Buffer.from(s, 'utf8');
const hash32 = (text) => sha256(utf8(text)).readUInt32BE(0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- seller side: key, licenses, blobs ----------------------------------------------------
const SKU = 'tsku';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
const PUB_N = publicKey.export({ format: 'jwk' }).n;
const CK = Array.from(randomBytes(32));
const WM = '0123456789abcdef';

function makeLicense(o = {}) {
  const m = o.m || 'W';
  const w = m === 'U' ? ['*'] : o.w || ['123'];
  const sku = o.sku || SKU;
  const kw = w.map((id) => {
    const mask = sha256(Buffer.concat([utf8('HAGKW1'), utf8(id), utf8(sku), utf8(WM)]));
    return b64u(CK.map((c, i) => c ^ mask[i]));
  });
  const payload = { v: 1, s: sku, b: 'b017', m, w, kw, i: Math.floor(Date.now() / 1000) - 10, e: o.e === undefined ? 0 : o.e, wm: WM, n: o.n === undefined ? 'Ana' : o.n };
  const signed = 'HAG1.' + b64u(utf8(JSON.stringify(payload)));
  const sig = sign('sha256', utf8(signed), { key: privateKey, padding: constants.RSA_PKCS1_PADDING });
  return signed + '.' + b64u(sig);
}

const guardKeyJs = (o = {}) =>
  `export const SKU = ${JSON.stringify(SKU)};\nexport const PUB_N = ${JSON.stringify(PUB_N)};\nexport const PUB_E = 65537;\n` +
  `export const GRACE_MS = ${o.grace === undefined ? 60000 : o.grace};\nexport const KEYSTONE_ID = ${JSON.stringify(o.keystoneId || '0')};\n` +
  `export const KEYSTONE_MODE = ${JSON.stringify(o.keystoneMode || 'off')};\nexport const BAKED_LICENSE = ${JSON.stringify(o.baked || '')};\n`;

const tempDirs = [];
async function loadBuild(label, keyOpts) {
  const dir = mkdtempSync(join(tmpdir(), 'hag-assetguard-' + label + '-'));
  tempDirs.push(dir);
  cpSync(OUT, dir, { recursive: true });
  writeFileSync(join(dir, 'runtime', 'GuardKey.js'), guardKeyJs(keyOpts));
  const u = (f) => pathToFileURL(join(dir, f)).href;
  const [hz, guard, ag, core, chacha] = await Promise.all([import(u('horizon-core.js')), import(u('runtime/Guard.js')), import(u('runtime/AssetGuard.js')), import(u('runtime/GuardCore.js')), import(u('runtime/crypto/ChaCha20.js'))]);
  return { hz, mock: hz.mock, flush: hz.flush, Guard: guard.Guard, GuardedComponent: guard.GuardedComponent, AssetGuard: ag.AssetGuard, core, chacha20: chacha.chacha20 };
}

// A GuardData_* module in miniature: a real HAGD1 blob plus GuardCore.unlock, exactly what
// `hag build` generates (minus the inlined, mangled core).
function makeSource(B, name, table, counter) {
  const plain = Array.from(utf8(JSON.stringify({ n: name, b: 'b017', d: table })));
  const nonce = Array.from(randomBytes(12));
  const ct = B.chacha20(CK, nonce, 1, plain);
  const tag = Array.from(sha256(Buffer.from([...CK, ...nonce, ...ct]))).slice(0, 16);
  const blob = 'HAGD1.' + b64u([...nonce, ...ct, ...tag]);
  return {
    name,
    blobHash: sha256(utf8(blob)).toString('hex').slice(0, 16),
    unlock: (lic, world) => {
      if (counter) counter[name] = (counter[name] || 0) + 1;
      return B.core.unlock(blob, lic, PUB_N, 65537, SKU, world);
    },
  };
}

const WAVES = [{ id: 1, enemies: 3, _m1a2b: 7 }, { id: 2, enemies: 5 }];
const TUNABLES = { spawnRate: 1.25, speed: 3.5 };
const FB = ['trial'];

function fresh(B, opts = {}) {
  B.mock.reset();
  B.Guard.reset(true);
  B.mock.captureConsole = true;
  const counter = {};
  B.Guard.register(makeSource(B, 'waves', WAVES, counter));
  B.Guard.register(makeSource(B, 'tunables', TUNABLES, counter));
  const text = new B.hz.Entity(77n);
  const ag = B.hz.instantiate(B.AssetGuard, { license: opts.license || '', license2: opts.license2 || '', license3: opts.license3 || '', statusText: opts.noText ? undefined : text });
  const logs = () => B.mock.log.join('\n');
  const lastText = () => (B.mock.texts.length ? B.mock.texts[B.mock.texts.length - 1].text : '');
  return { ag, counter, logs, lastText };
}

// ---- family A: license states, warming, sentinels, network -------------------------------
const A = await loadBuild('a', { grace: 60000 });
const { Guard, flush, mock, hz, core } = A;

section = 'registration and props';
check('Component.register(AssetGuard) ran at load', mock.registered.some((r) => r.cls === A.AssetGuard));
check('props are exactly license/license2/license3/statusText', same(Object.keys(A.AssetGuard.propsDefinition), ['license', 'license2', 'license3', 'statusText']));
check('license props are strings defaulting to empty', ['license', 'license2', 'license3'].every((k) => A.AssetGuard.propsDefinition[k].type === hz.PropTypes.String && A.AssetGuard.propsDefinition[k].default === ''));
check('statusText is an entity prop', A.AssetGuard.propsDefinition.statusText.type === hz.PropTypes.Entity);

section = 'no license';
{
  const readyStates = [];
  const tiers = [];
  const s = fresh(A);
  Guard.onReady((st) => readyStates.push(st.state));
  Guard.onTier((t) => tiers.push(t));
  check('start() leaves the guard UNVERIFIED (verify runs on a later frame)', Guard.state.state === 'UNVERIFIED');
  check('nothing fired before the first timer', readyStates.length === 0 && tiers.length === 0);
  await flush(299);
  check('still UNVERIFIED at 299 ms', Guard.state.state === 'UNVERIFIED');
  await flush(1);
  const req = core.requestCode(SKU, '123');
  check('TRIAL / I01 after step 1', Guard.state.state === 'TRIAL' && Guard.state.code === 'I01');
  check('request code HAG-REQ-<sku>-<world>-<check4>', Guard.state.requestCode === req && /^HAG-REQ-tsku-123-[0-9A-HJKMNP-TV-Z]{4}$/.test(req));
  check('I01 logged with the request code', s.logs().includes('I01') && s.logs().includes(req));
  check('status text: Trial + activation code', s.lastText() === 'Trial — activation code: ' + req);
  check('tier 0 during grace', Guard.state.tier === 0);
  check('onReady fired once with TRIAL', same(readyStates, ['TRIAL']));
  check('ready() resolved', (await Guard.ready()).state === 'TRIAL');
  check('data() is the fallback without a key', Guard.data('waves', FB) === FB);
  check('tune() is the fallback without a key', Guard.tune('spawnRate', 0.5) === 0.5);
  check('no unlock attempted in trial (no RSA per frame)', (s.counter.waves || 0) === 0);
  await flush(59999);
  check('tier still 0 just before grace ends', Guard.state.tier === 0);
  await flush(1);
  check('tier 1 after GRACE_MS', Guard.state.tier === 1 && Guard.state.state === 'TRIAL');
  check('onTier saw 0 then 1', same(tiers, [0, 1]));
  await flush(600000);
  check('10-minute recheck keeps TRIAL/tier 1 and refreshes the text', Guard.state.state === 'TRIAL' && Guard.state.tier === 1 && s.lastText().startsWith('Trial'));
  check('no handler threw', mock.errors.length === 0);
}

section = 'valid license';
{
  const lic = makeLicense();
  const s = fresh(A, { license: lic });
  let readyCount = 0;
  Guard.onReady(() => readyCount++);
  await flush(300);
  check('step 1 only parses: still UNVERIFIED before the verify timer', Guard.state.state === 'UNVERIFIED');
  await flush(50);
  check('LICENSED / I00', Guard.state.state === 'LICENSED' && Guard.state.code === 'I00' && Guard.state.tier === 0);
  check('buyer name from payload', Guard.state.buyer === 'Ana');
  check('worldId recorded', Guard.state.worldId === '123');
  check('I00 logged, license never printed in full', s.logs().includes('I00 licensed to Ana') && !s.logs().includes(lic));
  check('status text: Licensed to <n>', s.lastText() === 'Licensed to Ana');
  check('onReady fired once', readyCount === 1);
  check('no source unlocked yet (warming is staggered on timers)', !s.counter.waves && !s.counter.tunables);
  await flush(40);
  check('first source warmed one tick later', s.counter.waves === 1 && !s.counter.tunables);
  await flush(40);
  check('second source warmed on the next tick', s.counter.tunables === 1);
  check('data() serves the decrypted table from cache', same(Guard.data('waves', FB), WAVES) && s.counter.waves === 1);
  check('tune() reads tunables', Guard.tune('spawnRate', 0.5) === 1.25 && Guard.tune('speed', 0) === 3.5);
  check('tune() falls back for an unknown tunable', Guard.tune('missing', 2.5) === 2.5);
  check('tune() is always finite', Number.isFinite(Guard.tune('speed', NaN)) && Guard.tune('missing', Infinity) === 0);
  check('unregistered source -> fallback', Guard.data('nope', FB) === FB);

  // hag:req / hag:res: a client component asks the server guard for a decrypted table.
  const client = hz.instantiate(hz.Component);
  client.sendNetworkBroadcastEvent(new hz.NetworkEvent('hag:req'), { name: 'waves' });
  const res = mock.sent.filter((m) => m.name === 'hag:res');
  check('server answers hag:req with hag:res carrying the decrypted JSON', res.length === 1 && res[0].data.name === 'waves' && res[0].data.json === JSON.stringify(WAVES));
  client.sendNetworkBroadcastEvent(new hz.NetworkEvent('hag:req'), { name: 'nope' });
  check('unknown table -> empty json so the client keeps its trial value', mock.sent.filter((m) => m.name === 'hag:res').pop().data.json === '');
  let got = null;
  Guard.for(client).request('waves', FB, (v, live) => (got = { v, live }));
  check('GuardClient.request resolves with the table', got && same(got.v, WAVES) && got.live === true);
  got = null;
  Guard.for(client).request('nope', FB, (v, live) => (got = { v, live }));
  check('GuardClient.request resolves with the fallback when the server has nothing', got && got.v === FB && got.live === false);

  await flush(600000);
  check('recheck keeps LICENSED', Guard.state.state === 'LICENSED' && readyCount === 1);
  check('no handler threw', mock.errors.length === 0);
}

section = 'split props and whitespace';
{
  const lic = makeLicense();
  const cut1 = Math.floor(lic.length / 3);
  const s = fresh(A, { license: lic.slice(0, cut1) + '\n', license2: ' ' + lic.slice(cut1, cut1 * 2), license3: lic.slice(cut1 * 2) + ' ' });
  await flush(350);
  check('license concatenated from three props with whitespace trimmed', Guard.state.state === 'LICENSED');
  check('status text set', s.lastText() === 'Licensed to Ana');
}

section = 'mismatch';
{
  const s = fresh(A, { license: makeLicense({ w: ['123', '124'] }) });
  mock.worldId = 456n;
  await flush(350);
  const req = core.requestCode(SKU, '456');
  check('MISMATCH / E12 / tier 1', Guard.state.state === 'MISMATCH' && Guard.state.code === 'E12' && Guard.state.tier === 1);
  check('E12 log names live id, bound ids and a fresh request code', s.logs().includes('E12') && s.logs().includes('456') && s.logs().includes('123, 124') && s.logs().includes(req) && s.logs().includes('free re-issue'));
  check('status text: another world + code', s.lastText() === 'License is for another world — code: ' + req);
  await flush(200);
  check('no warming in MISMATCH', !s.counter.waves);
  check('data() is the fallback in another world', Guard.data('waves', FB) === FB);
  check('fallback is cached: one unlock, not one per call', (s.counter.waves || 0) === 1 && Guard.data('waves', FB) === FB && s.counter.waves === 1);
  mock.worldId = 124n;
  await flush(600000);
  check('recheck picks up a now-matching world (second licensed world)', Guard.state.state === 'LICENSED' && Guard.state.worldId === '124');
}

section = 'bad signature';
{
  // Flip a character well inside the signature: the last of the 342 base64url characters
  // carries only two significant bits (256 bytes = 2048 bits in 2052), so flipping it can
  // leave the decoded signature unchanged and the license valid.
  const lic = makeLicense();
  const at = lic.length - 10;
  const flipped = lic.slice(0, at) + (lic.charAt(at) === 'A' ? 'B' : 'A') + lic.slice(at + 1);
  const s = fresh(A, { license: flipped });
  await flush(350);
  check('INVALID / E11', Guard.state.state === 'INVALID' && Guard.state.code === 'E11' && Guard.state.tier === 1);
  check('E11 logged with a request code', s.logs().includes('E11') && s.logs().includes('HAG-REQ-tsku-123-'));
  check('status text: invalid + code', s.lastText().startsWith('License invalid (E11)'));
  check('data() is the fallback', Guard.data('waves', FB) === FB);
}

section = 'truncated';
{
  const lic = makeLicense();
  const s = fresh(A, { license: lic.slice(0, lic.length - 40) });
  await flush(300);
  check('E10 logged at step 1 with an offset', s.logs().includes('E10') && /offset \d+/.test(s.logs()));
  await flush(50);
  check('INVALID / E10 with offset in detail', Guard.state.state === 'INVALID' && Guard.state.code === 'E10' && /offset \d+/.test(Guard.state.detail));
  check('status text: invalid (E10)', s.lastText().startsWith('License invalid (E10)'));
}

section = 'wrong sku';
{
  fresh(A, { license: makeLicense({ sku: 'other' }) });
  await flush(350);
  check('INVALID / E14', Guard.state.state === 'INVALID' && Guard.state.code === 'E14');
}

section = 'expired';
{
  const s = fresh(A, { license: makeLicense({ e: Math.floor(Date.now() / 1000) - 100 }) });
  await flush(350);
  check('EXPIRED / E13 / policy tier 1', Guard.state.state === 'EXPIRED' && Guard.state.code === 'E13' && Guard.state.tier === 1);
  check('E13 logged', s.logs().includes('E13'));
  await flush(100);
  check('data still unlocks after expiry (policy only)', same(Guard.data('waves', FB), WAVES));
  check('status text: expired', s.lastText().startsWith('License expired'));
}

section = 'expiry crossed by the recheck';
{
  fresh(A, { license: makeLicense({ e: Math.floor(Date.now() / 1000) + 400 }) });
  const tiers = [];
  Guard.onTier((t) => tiers.push(t));
  await flush(350);
  check('LICENSED while e is in the future', Guard.state.state === 'LICENSED');
  await flush(600000);
  check('recheck turns it EXPIRED and fires onTier(1)', Guard.state.state === 'EXPIRED' && same(tiers, [0, 1]));
}

section = 'unbound license';
{
  mock.worldId = 456n;
  const s = fresh(A, { license: makeLicense({ m: 'U' }) });
  mock.worldId = 456n;
  await flush(450);
  check('mode U licenses any world', Guard.state.state === 'LICENSED');
  check('data unlocks with the "*" key', same(Guard.data('waves', FB), WAVES) && s.counter.waves === 1);
}

section = 'world id unreadable (W02 fail-open)';
{
  const s = fresh(A, { license: makeLicense() });
  mock.worldId = null;
  await flush(450);
  check('W02 logged', s.logs().includes('W02'));
  check('LICENSED with the live id unknown', Guard.state.state === 'LICENSED' && Guard.state.worldId === null);
  check('request code uses NOWID', Guard.state.requestCode === core.requestCode(SKU, null) && Guard.state.requestCode.includes('-NOWID-'));
  check('data unlocks via w[0]', same(Guard.data('waves', FB), WAVES));
  mock.worldIdMissing = true;
  const s2 = fresh(A, { license: makeLicense() });
  mock.worldIdMissing = true;
  await flush(450);
  check('world.id absent entirely is the same fail-open', Guard.state.state === 'LICENSED' && same(Guard.data('waves', FB), WAVES) && s2.logs().includes('W02'));
}

section = 'reset button re-attach';
{
  fresh(A, { license: makeLicense() });
  let readyCount = 0;
  Guard.onReady(() => readyCount++);
  await flush(450);
  check('first run licensed, cache warm', Guard.state.state === 'LICENSED' && same(Guard.data('waves', FB), WAVES) && readyCount === 1);
  // Reset: a new component instance runs preStart/start with a changed license.
  mock.worldId = 456n;
  hz.instantiate(A.AssetGuard, { license: makeLicense(), license2: '', license3: '', statusText: undefined });
  check('attach() clears the verdict and caches at preStart', Guard.state.state === 'UNVERIFIED' && Guard.data('waves', FB) === FB);
  await flush(350);
  check('second run reaches its own verdict and re-fires onReady', Guard.state.state === 'MISMATCH' && readyCount === 2);
}

section = 'robustness';
{
  const s = fresh(A, { license: makeLicense() });
  Guard.register({ name: 'boom', blobHash: '0', unlock: () => { throw new Error('unlock exploded'); } });
  Guard.register({ name: 'junk', blobHash: '0', unlock: () => Array.from(utf8('not json')) });
  Guard.register({ name: 'empty', blobHash: '0', unlock: () => [] });
  Guard.register({ name: 'bad', blobHash: '0', unlock: 'nope' });
  await flush(600);
  check('throwing unlock -> fallback, E20 logged, game keeps running', Guard.data('boom', FB) === FB && s.logs().includes('E20'));
  check('non-JSON plaintext -> fallback', Guard.data('junk', FB) === FB);
  check('empty plaintext -> fallback', Guard.data('empty', FB) === FB);
  check('invalid registration ignored', !Guard.sources().includes('bad'));
  check('good sources unaffected', same(Guard.data('waves', FB), WAVES));
  Guard.onReady(() => { throw new Error('callback exploded'); });
  Guard.onTier(() => { throw new Error('callback exploded'); });
  Guard.halfPatched = true;
  check('throwing callbacks are contained; setter forces tier 2', Guard.state.tier === 2 && Guard.halfPatched);
  Guard.halfPatched = false;
  check('setter clears again', Guard.state.tier === 0);
  check('no handler threw into the mock', mock.errors.length === 0);
  const s2 = fresh(A, { license: makeLicense(), noText: true });
  await flush(450);
  check('no statusText wired: licensed, no text writes, no error', Guard.state.state === 'LICENSED' && mock.texts.length === 0 && !s2.logs().includes('W00'));
}

section = 'sentinel disagreement -> tier 2';
{
  const lic = makeLicense();
  const s = fresh(A, { license: lic });
  const real = Array.from(utf8(JSON.stringify({ n: 'canary', b: 'b017', d: { ok: 1 } })));
  const patched = Array.from(utf8(JSON.stringify({ n: 'canary', b: 'b017', d: { ok: 2 } })));
  let flip = false;
  let canaryCalls = 0;
  Guard.register({ name: 'canary', blobHash: '0', unlock: () => (canaryCalls++, flip ? patched : real) });
  class Arena extends A.GuardedComponent {
    start() {
      this.sawTier = [];
      this.guard.onTier((t) => this.sawTier.push(t));
    }
  }
  const arena = hz.instantiate(Arena);
  check('GuardedComponent exposes a bound client', typeof arena.guard.data === 'function' && arena.guard.state.state === 'UNVERIFIED');
  await flush(500);
  check('licensed and every source warmed (3 sources, 3 ticks)', Guard.state.state === 'LICENSED' && s.counter.waves === 1 && s.counter.tunables === 1 && canaryCalls === 1);
  check('onTier from the base class saw tier 0', same(arena.sawTier, [0]));
  flip = true; // from now on the canary module "verifies differently": half-patched build
  await flush(1000 + 180000 - 501);
  check('no sentinel round before the 3-minute floor', canaryCalls === 1 && Guard.state.tier === 0);
  const seed = hash32(lic);
  const firstDelay = 180000 + (hash32('sentinel:' + String(arena.entity.id) + '|' + seed) % 1020000);
  await flush(firstDelay - 180000 + 1);
  check('first round fired at the seed-derived delay', canaryCalls >= 1);
  await flush(2 * 600000 + 120000);
  check('half-patched flag set, tier 2', Guard.halfPatched && Guard.state.tier === 2);
  check('onTier(2) delivered to the enrolled component', arena.sawTier[arena.sawTier.length - 1] === 2);
  check('W20 logged', s.logs().includes('W20'));
  check('state stays LICENSED (substitution is occasional, not a verdict change)', Guard.state.state === 'LICENSED');
  // Jitter rule: fallback when sha256(name|bucket|seed) % 4 === 0, per 10-minute bucket.
  const bucket = Math.floor(Date.now() / 600000);
  const hit = (name) => hash32(name + '|' + bucket + '|' + seed) % 4 === 0;
  const names = ['waves', 'tunables', 'canary'];
  for (const n of names) {
    const v = Guard.data(n, FB);
    check('tier-2 jitter rule for ' + n, hit(n) ? v === FB : v !== FB);
  }
  check('tune() at tier 2 is finite and either real or fallback', [0.5, 1.25].includes(Guard.tune('spawnRate', 0.5)));
  let anyHit = false;
  for (let i = 0; i < 64 && !anyHit; i++) anyHit = Guard.data('probe' + i + '|' + bucket, FB) === FB;
  check('rule is a function of the name (some names hit)', anyHit);
  check('no handler threw', mock.errors.length === 0);
}

section = 'baked license';
{
  const B2 = await loadBuild('baked', { grace: 0, baked: makeLicense({ n: 'Prebound' }) });
  B2.mock.captureConsole = true;
  B2.Guard.register(makeSource(B2, 'waves', WAVES));
  B2.hz.instantiate(B2.AssetGuard, { license: '', license2: '', license3: '', statusText: undefined });
  await B2.flush(350);
  check('empty props fall back to BAKED_LICENSE', B2.Guard.state.state === 'LICENSED' && B2.Guard.state.buyer === 'Prebound');
  B2.Guard.reset(true);
  B2.mock.reset();
  B2.mock.captureConsole = true;
  B2.hz.instantiate(B2.AssetGuard, { license: '', license2: '', license3: '', statusText: undefined });
  await B2.flush(350);
  check('a Reset with still-empty props uses the baked license again', B2.Guard.state.state === 'LICENSED' && B2.Guard.state.buyer === 'Prebound');
}

// ---- family K: keystone spawn-error policy ------------------------------------------------
async function keystoneRun(K, spawnCfg, ms) {
  K.mock.reset();
  K.Guard.reset(true);
  K.mock.captureConsole = true;
  Object.assign(K.mock.spawn, spawnCfg);
  const results = [];
  const tiers = [];
  K.Guard.onKeystone((e) => results.push(e));
  K.Guard.onTier((t) => tiers.push(t));
  K.hz.instantiate(K.AssetGuard, { license: makeLicense(), license2: '', license3: '', statusText: undefined });
  await K.flush(ms);
  return { results, tiers, logs: () => K.mock.log.join('\n'), attempts: K.mock.spawn.attempts };
}
const E = (await loadBuild('k', { grace: 0 })).hz.SpawnError;

section = 'keystone degrade mode';
{
  const K = await loadBuild('kd', { grace: 0, keystoneId: '5550001', keystoneMode: 'degrade' });
  let r = await keystoneRun(K, { error: E.None, delayMs: 10 }, 350 + 2000 + 10);
  check('spawn success -> onKeystone(rootEntities)', r.results.length === 1 && Array.isArray(r.results[0]) && r.results[0].length === 1);
  check('asset built from KEYSTONE_ID as a bigint', r.attempts.length === 1 && r.attempts[0].id === 5550001n);
  check('one attempt about 2 s after the verdict', r.attempts[0].at === 2350);
  check('late subscriber gets the cached keystone result', (() => { let v; K.Guard.onKeystone((e) => (v = e)); return Array.isArray(v); })());

  r = await keystoneRun(K, { error: E.UnauthorizedContent, delayMs: 10 }, 350 + 2000 + 10 + 5000 + 10 + 15000 + 10 + 45000 + 10);
  check('hard failure retried 3 times with 5/15/45 s backoff', r.attempts.length === 4 && r.attempts[1].at - r.attempts[0].at === 5010 && r.attempts[2].at - r.attempts[1].at === 15010 && r.attempts[3].at - r.attempts[2].at === 45010);
  check('unavailable -> onKeystone(null), W03 logged, FBS/CMI hint', r.results.length === 1 && r.results[0] === null && r.logs().includes('W03') && r.logs().includes('FBS/CMI'));
  check('tier still 0 right after (degrade is delayed)', K.Guard.state.tier === 0 && K.Guard.state.state === 'LICENSED');
  const seed = hash32(K.Guard.license());
  const delay = 180000 + (hash32('keystone|' + seed) % 1020000);
  await K.flush(delay - 1);
  check('no degrade before the seed-derived delay', K.Guard.state.tier === 0);
  await K.flush(1);
  check('tier 2 after the jittered delay (3 to 20 min)', K.Guard.state.tier === 2 && r.tiers[r.tiers.length - 1] === 2 && r.logs().includes('W21'));
  check('data() applies the jitter rule at tier 2 (fallback or real, never garbage)', [FB, undefined].includes(K.Guard.data('waves', FB)));

  r = await keystoneRun(K, { sequence: [E.ExceedsCapacity, E.Unknown, E.Cancelled, E.ExceedsCapacity], delayMs: 10 }, 350 + 2000 + 70000);
  check('transient errors on every attempt -> null but no degrade clock', r.results.length === 1 && r.results[0] === null && r.attempts.length === 4);
  await K.flush(1300000);
  check('still tier 0 twenty-one minutes later', K.Guard.state.tier === 0);

  r = await keystoneRun(K, { sequence: [E.InvalidAsset, E.InvalidAsset, E.ExceedsCapacity, E.InvalidAsset], delayMs: 10 }, 350 + 2000 + 70000);
  await K.flush(1300000);
  check('one transient among hard failures -> not "unavailable", no degrade', r.results[0] === null && K.Guard.state.tier === 0);

  r = await keystoneRun(K, { sequence: [E.ExceedsCapacity, E.None], delayMs: 10 }, 350 + 2000 + 10 + 5000 + 10);
  check('transient then success -> entities after one backoff', r.results.length === 1 && Array.isArray(r.results[0]) && r.attempts.length === 2);

  r = await keystoneRun(K, { error: E.ExceedsCapacity, reject: true, delayMs: 10 }, 350 + 2000 + 70000);
  check('rejected promises count as transient', r.results[0] === null && r.attempts.length === 4 && K.Guard.state.tier === 0);

  r = await keystoneRun(K, { delayMs: null }, 350 + 2000 + 4 * 20000 + 65000 + 10);
  check('never-settling spawn hits the 20 s timeout, retries, then null', r.results.length === 1 && r.results[0] === null && r.attempts.length === 4 && r.logs().includes('timeout'));
  check('no handler threw', K.mock.errors.length === 0);
}

section = 'keystone warn mode and off';
{
  const K = await loadBuild('kw', { grace: 0, keystoneId: '5550002', keystoneMode: 'warn' });
  const r = await keystoneRun(K, { error: E.UnauthorizedContent, delayMs: 10 }, 350 + 2000 + 70000);
  await K.flush(1300000);
  check('warn mode: null + log only, never tier 2', r.results[0] === null && K.Guard.state.tier === 0 && r.logs().includes('warn'));
  const K2 = await loadBuild('koff', { grace: 0, keystoneId: '5550003', keystoneMode: 'off' });
  const r2 = await keystoneRun(K2, { error: E.None, delayMs: 10 }, 350 + 2000 + 70000);
  check('off: no spawn, no keystone callback', r2.attempts.length === 0 && r2.results.length === 0);
  K2.Guard.reset(true);
  K2.mock.reset();
  K2.mock.captureConsole = true;
  K2.hz.instantiate(K2.AssetGuard, { license: '', license2: '', license3: '', statusText: undefined });
  await K2.flush(300);
  check('GRACE_MS 0: trial starts at tier 1', K2.Guard.state.state === 'TRIAL' && K2.Guard.state.tier === 1);
}

section = 'keystone without BigInt';
{
  const K = await loadBuild('kb', { grace: 0, keystoneId: '5550004', keystoneMode: 'degrade' });
  const saved = globalThis.BigInt;
  try {
    globalThis.BigInt = undefined;
    const r = await keystoneRun(K, { error: E.None, delayMs: 10 }, 350 + 2000 + 70000);
    await K.flush(1300000);
    check('no BigInt: W03, onKeystone(null), no degrade (not a license signal)', r.results.length === 1 && r.results[0] === null && r.logs().includes('W03') && K.Guard.state.tier === 0 && r.attempts.length === 0);
  } finally {
    globalThis.BigInt = saved;
  }
}

for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
// The mock routes console.log into its capture buffer, so the summary goes straight to stdout.
process.stdout.write('assetguard.test: ' + passed + ' passed, ' + failed + ' failed\n');
if (failed > 0) process.exit(1);
