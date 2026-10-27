// The seller CLI (cli/hag.mjs) end to end in a temporary HAG_HOME, with node:crypto as the
// independent oracle for every contract section 2 format: keygen -> GuardKey.ts round trip,
// issue -> a license Node verifies, verify, build -> blobs that decrypt under the ledger ck
// and carry deterministic watermarks, trace naming the right buyer among five (from a
// GuardData module and from a plain JSON dump), doctor catching a forbidden token, and the
// keystone-test gate on KEYSTONE_MODE 'degrade'. The build tests use the fixture core
// test/fixtures/core-fixture.ts; one extra check builds against the real runtime/ and runs
// `hag doctor` (lint + tsc 4.7.4) on the result when the compiler is installed.
// Run: node test/cli.test.mjs        (needs no prior build; the runtime cross-checks use
// test/out when `npm run build:test` has produced it)
import { constants, createPrivateKey, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYLOAD_KEYS, blobHash, chacha20, check4, openBlob, parseLicense, publicKeyFromEmbedded, requestCode, sha256, unwrapKey, utf8 } from '../cli/lib/formats.mjs';
import { addObjectMarks, slackValue, watermarkTable } from '../cli/lib/watermark.mjs';
import { SECTION7_IMPORTS, extractRegion, mangledName, stripComments, tokenize } from '../cli/lib/mangle.mjs';
import { parseGuardKey, renderGuardKey } from '../cli/lib/guardkey.mjs';
import { splitLicense } from '../cli/lib/issue.mjs';
import { UsageError, parseArgs } from '../cli/lib/common.mjs';

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) passed++;
  else {
    failed++;
    console.log('  FAIL: ' + name + (detail ? '\n        ' + String(detail).split('\n').slice(0, 12).join('\n        ') : ''));
  }
}
const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, '..');
const HAG = join(PKG, 'cli', 'hag.mjs');
const LINT = join(here, 'lint-runtime.mjs');
const work = mkdtempSync(join(tmpdir(), 'hag-cli-'));
const HOME = join(work, '.hag');
const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));
const ledger = () => readJson(join(HOME, 'ledger.json'));

// Runs the CLI as a seller would, in `work`, against the temp ledger.
function hag(args, opts = {}) {
  const env = { ...process.env, HAG_HOME: opts.home || HOME };
  delete env.HAG_KEY_PASSPHRASE;
  if (opts.passphrase) env.HAG_KEY_PASSPHRASE = opts.passphrase;
  const r = spawnSync(process.execPath, [HAG, ...args], { encoding: 'utf8', cwd: opts.cwd || work, env });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') };
}

// A runtime tree for the build tests: the real crypto/ files plus the fixture core.
const RT = join(work, 'runtime');
mkdirSync(RT, { recursive: true });
cpSync(join(PKG, 'runtime', 'crypto'), join(RT, 'crypto'), { recursive: true });
cpSync(join(here, 'fixtures', 'core-fixture.ts'), join(RT, 'GuardCore.ts'));
writeFileSync(join(RT, 'Guard.ts'), '// stand-in for the registry in this fixture tree\nexport const Guard = { register: function (s: any): void { void s; } };\n');

// Data tables and config.
// A table with a few dozen objects so the ~35 % mark rate yields marks for any seed; the
// test buyers also get pinned wm values (below) so the watermark outcome is deterministic.
const WAVES = {
  waves: [...Array(12).keys()].map((i) => ({ n: i + 1, enemies: 3 + i * 2, rate: i === 1 ? 1.25 : 1 + i * 0.1, loot: { gold: 10 * (i + 1), gems: i % 3 }, boss: i % 4 === 3 })),
  boss: { hp: 1200, name: 'Koenig', phases: [{ at: 0.5, speed: 1.2 }, { at: 0.2, speed: 1.5 }] },
  tags: ['a', 'b'],
};
const PINNED_WM = { b017: 'a1b2c3d4e5f60017', b001: '0123456789abcd01', b002: '0123456789abcd02', b003: '0123456789abcd03', b004: '0123456789abcd04', b005: '0123456789abcd05' };
function pinWm(id) {
  const l = ledger();
  l.buyers[id].wm = PINNED_WM[id];
  writeFileSync(join(HOME, 'ledger.json'), JSON.stringify(l, null, 2));
}
const TUNABLES = { spawnRate: 1.0, respawnDelay: 2.0, scoreMul: 10 };
const CFG_DIR = join(work, 'cfg');
mkdirSync(join(CFG_DIR, 'data'), { recursive: true });
writeFileSync(join(CFG_DIR, 'data', 'waves.json'), JSON.stringify(WAVES, null, 2));
writeFileSync(join(CFG_DIR, 'data', 'tunables.json'), JSON.stringify(TUNABLES, null, 2));
const MARKS = { 'waves.boss.hp': [1150, 1250], 'waves.waves[1].rate': [1.2, 1.3], 'tunables.respawnDelay': [1.9, 2.1] };
const CFG = join(CFG_DIR, 'hag.config.json');
writeFileSync(CFG, JSON.stringify({ sku: 'demo', seller: 'Ana Studio', data: { waves: 'data/waves.json', tunables: 'data/tunables.json' }, marks: MARKS }, null, 2));

// Compiled runtime (test/out) for the seller <-> runtime cross-checks, when it exists.
let core = null;
if (existsSync(join(here, 'out', 'runtime', 'GuardCore.js'))) core = await import('./out/runtime/GuardCore.js');
else console.log('   (test/out/runtime/GuardCore.js not built; runtime cross-checks skipped: npm run build:test)');

// ---- node:crypto ChaCha20 wrapper against RFC 8439 ----
console.log('ChaCha20 via node:crypto (RFC 8439 vectors)');
{
  const key = Buffer.from([...Array(32).keys()]);
  const sunscreen = chacha20(key, Buffer.from('000000000000004a00000000', 'hex'), 1, utf8("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."));
  check('2.4.2 sunscreen ciphertext', sunscreen.toString('hex') === '6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0bf91b65c5524733ab8f593dabcd62b35716 39d624e65152ab8f530c359f0861d807ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab77937365af90bbf74a35be6b40b8eedf2785e42874d'.replace(/ /g, ''));
  const block = chacha20(key, Buffer.from('000000090000004a00000000', 'hex'), 1, Buffer.alloc(64));
  check('2.3.2 block function keystream (counter 1 = 4-byte LE counter || nonce IV layout)', block.toString('hex').startsWith('10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e'));
  check('encrypt twice is identity', chacha20(key, Buffer.from('000000000000004a00000000', 'hex'), 1, sunscreen).toString() === "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
}

// ---- usage ----
console.log('hag help');
{
  const h = hag(['help']);
  check('help exits 0 and lists every section 9 command', h.status === 0 && ['keygen --sku <sku>', 'buyer add --sku <sku> --id <buyerId>', 'build --sku <sku> --buyer <buyerId> --config <hag.config.json> --out <dir>', 'issue --sku <sku> --buyer <buyerId> --req <HAG-REQ-...>', 'verify <license>', 'list', 'trace <path>', 'revoke --buyer <id>', 'report --buyer <id>', 'doctor [--dir <package dir>]', 'keystone-test --sku <sku> --record'].every((s) => h.out.includes(s)), h.all);
  check('help <command> prints that command only', hag(['help', 'build']).out.includes('--config') && !hag(['help', 'build']).out.includes('keygen --sku'));
  check('unknown command exits 2', hag(['frobnicate']).status === 2);
  check('unknown option exits 2 with usage', (() => { const r = hag(['keygen', '--sku', 'x', '--bogus']); return r.status === 2 && r.err.includes('--bogus') && r.err.includes('Usage'); })());
  check('parseArgs rejects unknown options', (() => { try { parseArgs(['--x'], { known: ['y'] }); return false; } catch (e) { return e instanceof UsageError; } })());
  check('parseArgs collects multi and positionals', JSON.stringify(parseArgs(['--req', 'A', 'p', '--req=B', '--f'], { multi: ['req'], flags: ['f'] })) === '{"opts":{"req":["A","B"],"f":true},"positional":["p"]}');
}

// ---- keygen ----
console.log('hag keygen');
const GK = join(work, 'GuardKey.ts');
let PUB = null;
{
  const r = hag(['keygen', '--sku', 'demo', '--out', GK]);
  check('keygen exits 0', r.status === 0, r.all);
  check('writes keys/demo.json and GuardKey.ts', existsSync(join(HOME, 'keys', 'demo.json')) && existsSync(GK));
  const rec = readJson(join(HOME, 'keys', 'demo.json'));
  const parsed = parseGuardKey(read(GK));
  PUB = { n: parsed.pubN, e: parsed.pubE };
  const jwk = createPublicKey(createPrivateKey(rec.privateKeyPem)).export({ format: 'jwk' });
  check('PUB_N round-trips to the Node public key (JWK n)', parsed.pubN === jwk.n && jwk.e === 'AQAB' && parsed.pubE === 65537 && parsed.sku === 'demo');
  check('PUB_N rebuilds the same KeyObject', publicKeyFromEmbedded(parsed.pubN, parsed.pubE).export({ format: 'jwk' }).n === jwk.n);
  check('key record holds n/e and an unencrypted PKCS#8 PEM', rec.n === jwk.n && rec.e === 65537 && rec.encrypted === false && rec.privateKeyPem.includes('BEGIN PRIVATE KEY'));
  check('default policy in a new GuardKey.ts', parsed.graceMs === 0 && parsed.keystoneId === '0' && parsed.keystoneMode === 'off' && parsed.bakedLicense === '');
  check('ledger has the SKU record', ledger().skus.demo && ledger().skus.demo.n === jwk.n);
  const again = hag(['keygen', '--sku', 'demo', '--out', GK]);
  check('second keygen for the same SKU refuses without --force', again.status === 1 && again.err.includes('--force'));
  const dir = join(work, 'gk-only');
  mkdirSync(dir, { recursive: true });
  cpSync(GK, join(dir, 'GuardKey.ts'));
  check('GuardKey.ts passes lint-runtime', spawnSync(process.execPath, [LINT, dir], { encoding: 'utf8' }).status === 0);
  // Policy survives a re-key: pre-write a policy file, then keygen a new SKU into it.
  const GK2 = join(work, 'GuardKey2.ts');
  writeFileSync(GK2, renderGuardKey({ sku: 'old', pubN: 'AAAA', pubE: 65537, graceMs: 5000, keystoneId: '987654321', keystoneMode: 'warn', bakedLicense: '' }));
  const r2 = hag(['keygen', '--sku', 'demo2', '--out', GK2]);
  const p2 = parseGuardKey(read(GK2));
  check('keygen keeps GRACE_MS / KEYSTONE_* of an existing GuardKey.ts and replaces SKU / key', r2.status === 0 && p2.sku === 'demo2' && p2.graceMs === 5000 && p2.keystoneId === '987654321' && p2.keystoneMode === 'warn' && p2.pubN !== 'AAAA' && r2.out.includes('policy kept'), r2.all);
  const r3 = hag(['keygen', '--sku', 'quest', '--e', '3', '--out', join(work, 'GuardKey3.ts')]);
  const p3 = parseGuardKey(read(join(work, 'GuardKey3.ts')));
  check('--e 3 gives PUB_E 3 and a matching JWK e', r3.status === 0 && p3.pubE === 3 && createPublicKey(createPrivateKey(readJson(join(HOME, 'keys', 'quest.json')).privateKeyPem)).export({ format: 'jwk' }).e === 'Aw');
  check('--e 17 is refused', hag(['keygen', '--sku', 'q2', '--e', '17', '--out', join(work, 'x.ts')]).status === 2);
  const r4 = hag(['keygen', '--sku', 'enc', '--out', join(work, 'GuardKeyEnc.ts')], { passphrase: 'hunter2' });
  const rec4 = readJson(join(HOME, 'keys', 'enc.json'));
  check('HAG_KEY_PASSPHRASE encrypts the private key', r4.status === 0 && rec4.encrypted === true && rec4.privateKeyPem.includes('ENCRYPTED'));
}

// ---- buyer add ----
console.log('hag buyer add');
{
  const r = hag(['buyer', 'add', '--sku', 'demo', '--id', 'b017', '--name', 'Ana']);
  const b = ledger().buyers.b017;
  check('buyer add creates the ledger entry', r.status === 0 && b && b.name === 'Ana' && b.sku === 'demo', r.all);
  check('wm is 16 hex chars, ck is 32 random bytes in hex', /^[0-9a-f]{16}$/.test(b.wm) && /^[0-9a-f]{64}$/.test(b.ck));
  check('entry has the contract fields', ['worlds', 'licenses', 'blobs', 'marks', 'names', 'revoked', 'keystoneTests'].every((k) => k in b) && b.revoked === null);
  check('duplicate id refused', hag(['buyer', 'add', '--sku', 'demo', '--id', 'b017']).status === 1);
  check('unknown SKU refused', hag(['buyer', 'add', '--sku', 'nokey', '--id', 'b099']).status === 1);
  check('bad id refused', hag(['buyer', 'add', '--sku', 'demo', '--id', 'b/1']).status === 2);
  check('buyer without sub-command is a usage error', hag(['buyer']).status === 2);
  hag(['buyer', 'add', '--sku', 'enc', '--id', 'e001', '--name', 'Enc']);
  pinWm('b017');
}

// ---- issue ----
console.log('hag issue');
const REQ = requestCode('demo', '123');
let LICENSE = '';
let PAYLOAD = null;
{
  check('request code format and check4', /^HAG-REQ-demo-123-[0-9A-HJKMNP-TV-Z]{4}$/.test(REQ) && check4('demo', '123').length === 4);
  if (core) check('request code agrees with the runtime (GuardCore.requestCode)', core.requestCode('demo', '123') === REQ && core.requestCode('demo', null) === requestCode('demo', null));
  const r = hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--req', REQ, '--json']);
  check('issue exits 0', r.status === 0, r.all);
  const j = r.status === 0 ? JSON.parse(r.out) : { payload: {}, license: '' };
  LICENSE = j.license;
  PAYLOAD = j.payload;
  const pub = publicKeyFromEmbedded(PUB.n, PUB.e);
  const parts = LICENSE.split('.');
  check('license is HAG1.<payload>.<sig> with a 342-char signature', parts.length === 3 && parts[0] === 'HAG1' && parts[2].length === 342);
  check('signature verifies with node:crypto over the literal ASCII of HAG1.<payload>', nodeVerify('sha256', Buffer.from('HAG1.' + parts[1], 'ascii'), { key: pub, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(parts[2], 'base64url')));
  check('a different message does not verify', !nodeVerify('sha256', Buffer.from('HAG1.' + parts[1] + 'A', 'ascii'), { key: pub, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(parts[2], 'base64url')));
  const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  check('payload keys are in contract order v,s,b,m,w,kw,i,e,wm,n', JSON.stringify(Object.keys(decoded)) === JSON.stringify(PAYLOAD_KEYS));
  check('payload is compact JSON', Buffer.from(parts[1], 'base64url').toString('utf8') === JSON.stringify(decoded) && !/\s/.test(JSON.stringify(decoded)));
  const b = ledger().buyers.b017;
  check('payload fields', decoded.v === 1 && decoded.s === 'demo' && decoded.b === 'b017' && decoded.m === 'W' && JSON.stringify(decoded.w) === '["123"]' && decoded.kw.length === 1 && decoded.kw[0].length === 43 && decoded.e === 0 && decoded.wm === b.wm && decoded.n === 'Ana' && Math.abs(decoded.i - Date.now() / 1000) < 120);
  check('kw[0] unwraps to the ledger ck with SHA256("HAGKW1"|w|sku|wm)', unwrapKey(decoded.kw[0], '123', 'demo', b.wm).toString('hex') === b.ck);
  check('kw[0] is CK XOR mask, computed by hand', (() => {
    const mask = sha256(utf8('HAGKW1'), utf8('123'), utf8('demo'), utf8(b.wm));
    const ck = Buffer.from(b.ck, 'hex');
    const kw = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) kw[i] = ck[i] ^ mask[i];
    return kw.toString('base64url') === decoded.kw[0];
  })());
  check('ledger records the license and the world', b.licenses.length === 1 && b.licenses[0].license === LICENSE && JSON.stringify(b.worlds) === '["123"]' && b.licenses[0].expires === null);
  if (core) {
    const p = core.parseLicense(LICENSE);
    check('runtime parses and verifies the CLI license (pure-TS RSA)', p.ok && core.verifySignature(p, PUB.n, PUB.e));
    check('runtime evaluates LICENSED in world 123 and MISMATCH in 456', core.evaluate(p, PUB.n, PUB.e, 'demo', '123', Math.floor(Date.now() / 1000)).state === 'LICENSED' && core.evaluate(p, PUB.n, PUB.e, 'demo', '456', 0).code === 'E12');
    check('runtime contentKey equals the ledger ck', Buffer.from(core.contentKey(p.payload, '123', 'demo')).toString('hex') === b.ck);
  }
  // Human output: activation message with the license split for the props.
  const t = hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--req', REQ]);
  const lic2 = (/^LICENSE: (\S+)$/m.exec(t.out) || [])[1] || '';
  const chunks = [...t.out.matchAll(/^license(2|3)?: (\S+)$/gm)].map((m) => m[2]);
  check('prints LICENSE: and the activation message', t.status === 0 && lic2.startsWith('HAG1.') && t.out.includes('Hi Ana') && t.out.includes('world 123'), t.all);
  check('license > 250 chars is split into <= 200-char chunks that re-join', chunks.length === 3 && chunks.every((c) => c.length <= 200) && chunks.join('') === lic2);
  check('splitLicense rules', splitLicense('x'.repeat(250)).chunks.length === 1 && splitLicense('x'.repeat(251)).chunks.length === 2 && splitLicense('x'.repeat(700)).chunks.length === 3 && splitLicense('x'.repeat(700)).oversized === true && splitLicense('x'.repeat(700)).chunks[0].length === 234);
  // Negatives.
  const badCheck = REQ.slice(0, -1) + (REQ.endsWith('A') ? 'B' : 'A');
  check('typo in check4 refused', (() => { const r = hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--req', badCheck]); return r.status === 1 && r.err.includes('check characters'); })());
  check('request code for another SKU refused', (() => { const r = hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--req', requestCode('other', '123')]); return r.status === 1 && r.err.includes('is for SKU "other"'); })());
  check('NOWID request code refused without --unbound', (() => { const r = hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--req', requestCode('demo', null)]); return r.status === 1 && r.err.includes('no world id'); })());
  check('malformed request code refused', hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--req', 'HAG-REQ-demo-123']).status === 1);
  check('no --req and no --unbound is a usage error', hag(['issue', '--sku', 'demo', '--buyer', 'b017']).status === 2);
  check('five request codes refused', hag(['issue', '--sku', 'demo', '--buyer', 'b017', ...[1, 2, 3, 4, 5].flatMap((i) => ['--req', requestCode('demo', String(i))])]).status === 2);
  check('unknown buyer refused', hag(['issue', '--sku', 'demo', '--buyer', 'b999', '--req', REQ]).status === 1);
  check('buyer of another SKU refused', hag(['issue', '--sku', 'demo', '--buyer', 'e001', '--req', REQ]).status === 1);
  const u = hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--unbound', '--json']);
  const uj = u.status === 0 ? JSON.parse(u.out) : null;
  check('--unbound gives m U, w ["*"] and a kw wrapped for "*"', uj && uj.payload.m === 'U' && JSON.stringify(uj.payload.w) === '["*"]' && unwrapKey(uj.payload.kw[0], '*', 'demo', ledger().buyers.b017.wm).toString('hex') === ledger().buyers.b017.ck, u.all);
  const four = hag(['issue', '--sku', 'demo', '--buyer', 'b017', ...['123', '777', '888', '999'].flatMap((w) => ['--req', requestCode('demo', w)]), '--json']);
  const fj = four.status === 0 ? JSON.parse(four.out) : null;
  check('four worlds in one license, kw aligned', fj && fj.payload.w.length === 4 && fj.payload.kw.length === 4 && fj.payload.w[3] === '999' && unwrapKey(fj.payload.kw[3], '999', 'demo', ledger().buyers.b017.wm).toString('hex') === ledger().buyers.b017.ck, four.all);
  check('four-world license needs oversized chunks and says so', fj && fj.chunks.length === 3 && fj.chunks[0].length > 200 && hag(['issue', '--sku', 'demo', '--buyer', 'b017', ...['123', '777', '888', '999'].flatMap((w) => ['--req', requestCode('demo', w)])]).out.includes('warning'));
  check('ledger worlds are the union of issued worlds', JSON.stringify(ledger().buyers.b017.worlds) === '["123","777","888","999"]');
  const ex = hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--req', REQ, '--expires', '2030-06-15', '--json']);
  const ej = ex.status === 0 ? JSON.parse(ex.out) : null;
  check('--expires sets e to the end of that UTC day', ej && ej.payload.e === Math.floor(Date.UTC(2030, 5, 15, 23, 59, 59) / 1000) && ej.expires === '2030-06-15T23:59:59.000Z', ex.all);
  check('--expires in the past refused', hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--req', REQ, '--expires', '2020-01-01']).status === 2);
  check('--expires 2030-02-30 refused', hag(['issue', '--sku', 'demo', '--buyer', 'b017', '--req', REQ, '--expires', '2030-02-30']).status === 2);
  const encNo = hag(['issue', '--sku', 'enc', '--buyer', 'e001', '--req', requestCode('enc', '5')]);
  check('encrypted key without HAG_KEY_PASSPHRASE refused', encNo.status === 1 && encNo.err.includes('HAG_KEY_PASSPHRASE'));
  check('encrypted key with the passphrase signs', hag(['issue', '--sku', 'enc', '--buyer', 'e001', '--req', requestCode('enc', '5'), '--json'], { passphrase: 'hunter2' }).status === 0);
  check('encrypted key with a wrong passphrase fails', hag(['issue', '--sku', 'enc', '--buyer', 'e001', '--req', requestCode('enc', '5')], { passphrase: 'nope' }).status === 1);
}

// ---- verify ----
console.log('hag verify');
{
  const r = hag(['verify', LICENSE]);
  check('valid license: exit 0, I00, signature OK, decoded payload', r.status === 0 && r.out.includes('I00') && r.out.includes('signature: OK') && r.out.includes('"b": "b017"') && r.out.includes('world id(s) 123'), r.all);
  check('reports the content key matches the ledger', r.out.includes('unwraps to the ledger ck'));
  const j = hag(['verify', LICENSE, '--json']);
  check('--json gives ok/state/payload', j.status === 0 && JSON.parse(j.out).ok === true && JSON.parse(j.out).state === 'LICENSED' && JSON.parse(j.out).payload.s === 'demo');
  const sig = LICENSE.slice(LICENSE.lastIndexOf('.') + 1);
  const tampered = LICENSE.slice(0, LICENSE.lastIndexOf('.') + 1) + sig.slice(0, 10) + (sig[10] === 'A' ? 'B' : 'A') + sig.slice(11);
  check('tampered signature: exit 1, E11', (() => { const t = hag(['verify', tampered]); return t.status === 1 && t.out.includes('E11'); })());
  check('tampered payload: exit 1, E11', (() => { const pl = LICENSE.indexOf('.') + 1; const t = hag(['verify', LICENSE.slice(0, pl + 5) + (LICENSE[pl + 5] === 'A' ? 'B' : 'A') + LICENSE.slice(pl + 6)]); return t.status === 1 && (t.out.includes('E11') || t.out.includes('E10')); })());
  check('truncated license: exit 1, E10 with the offset', (() => { const t = hag(['verify', LICENSE.slice(0, -10)]); return t.status === 1 && t.out.includes('E10') && /offset \d+/.test(t.out); })());
  check('whitespace inside a pasted license is ignored', hag(['verify', LICENSE.slice(0, 50) + ' \n' + LICENSE.slice(50)]).status === 0);
  check('--sku other: E14', (() => { const t = hag(['verify', LICENSE, '--sku', 'other']); return t.status === 1 && t.out.includes('E14'); })());
  check('--key with the shipped GuardKey.ts verifies', hag(['verify', LICENSE, '--key', GK]).status === 0);
  check('--key with another SKU key: E11', (() => { const t = hag(['verify', LICENSE, '--key', join(work, 'GuardKey2.ts')]); return t.status === 1 && t.out.includes('E11'); })());
  check('no license argument is a usage error', hag(['verify']).status === 2);
}

// ---- build ----
console.log('hag build (fixture core)');
const OUT = join(work, 'out', 'b017');
let BLOB = '';
let PLAIN = null;
{
  const r = hag(['build', '--sku', 'demo', '--buyer', 'b017', '--config', CFG, '--out', OUT, '--runtime', RT]);
  check('build exits 0', r.status === 0, r.all);
  const S = join(OUT, 'scripts');
  const mod = existsSync(join(S, 'GuardData_waves.ts')) ? read(join(S, 'GuardData_waves.ts')) : '';
  check('writes scripts/GuardData_<name>.ts per table', mod !== '' && existsSync(join(S, 'GuardData_tunables.ts')));
  check('copies runtime/ incl. crypto/ into scripts/', ['BigNum.ts', 'Bytes.ts', 'ChaCha20.ts', 'Rsa.ts', 'Sha256.ts'].every((f) => existsSync(join(S, 'crypto', f))) && existsSync(join(S, 'GuardCore.ts')) && existsSync(join(S, 'Guard.ts')) && read(join(S, 'crypto', 'Sha256.ts')) === read(join(PKG, 'runtime', 'crypto', 'Sha256.ts')));
  const gk = parseGuardKey(read(join(S, 'GuardKey.ts')));
  check('composes scripts/GuardKey.ts for the SKU with the right public key and the seller policy', gk.sku === 'demo' && gk.pubN === PUB.n && gk.pubE === 65537 && gk.keystoneMode === 'off');
  check('writes BUYER-README.md listing the files and LICENSE-BUYER.md from the template', read(join(OUT, 'BUYER-README.md')).includes('scripts/GuardData_waves.ts') && read(join(OUT, 'BUYER-README.md')).includes('HAG-REQ-demo') && read(join(OUT, 'LICENSE-BUYER.md')).includes('Ana Studio') && read(join(OUT, 'LICENSE-BUYER.md')).includes('buyer id b017') && !/\{\{[A-Z_]+\}\}/.test(read(join(OUT, 'LICENSE-BUYER.md'))));
  // The section 7 template.
  check('module starts with the section 7 imports verbatim', mod.includes(SECTION7_IMPORTS));
  const blobLine = /^const (_[a-z2-7]{6,9}_BLOB) = '(HAGD1\.[A-Za-z0-9_-]+)';$/m.exec(mod);
  check('blob constant <mangled>_BLOB = HAGD1....', blobLine !== null);
  BLOB = blobLine ? blobLine[2] : '';
  const reg = /^Guard\.register\(\{ name: 'waves', blobHash: '([0-9a-f]{16})', unlock: function \(lic: string, world: any\) \{ return (_[a-z2-7]{6,9})\((_[a-z2-7]{6,9}_BLOB), lic, PUB_N, PUB_E, SKU, world\); \} \}\);$/m.exec(mod);
  check('Guard.register line matches the template', reg !== null && blobLine !== null && reg[3] === blobLine[1]);
  check('blobHash is sha256(blob)[0..16] and recorded in the ledger', reg !== null && reg[1] === blobHash(BLOB) && ledger().buyers.b017.blobs.waves === reg[1]);
  const names = ledger().buyers.b017.names.waves;
  check('no g_ identifier survives in the module code (string literals are left alone)', !tokenize(mod).some((t) => t.kind === 'code' && /\bg_/.test(t.text)) && mod.includes("'g_parse is not g_parsed'"));
  check('ledger name map covers every region declaration, all unique, _ + base32', names && ['g_Shape', 'g_PREFIX', 'g_PARSED', 'g_tag', 'g_unlock', 'g_BLOB'].every((k) => k in names) && new Set(Object.values(names)).size === Object.keys(names).length && Object.entries(names).every(([k, v]) => (k === 'g_BLOB' ? /^_[a-z2-7]{6,9}_BLOB$/ : /^_[a-z2-7]{6,9}$/).test(v)));
  check('every mangled name is in the module and the unlock name is the registered one', names && Object.values(names).every((v) => mod.includes(v)) && reg !== null && reg[2] === names.g_unlock && new RegExp('^function ' + names.g_unlock + '\\(', 'm').test(mod));
  check('mangled names are SHA256(wm|name|identifier) based and deterministic', names && names.g_unlock === mangledName(ledger().buyers.b017.wm, 'waves', 'g_unlock') && mangledName('a', 'b', 'c') === mangledName('a', 'b', 'c') && mangledName('a', 'b', 'c') !== mangledName('a2', 'b', 'c') && /^_[a-z2-7]{6}$/.test(mangledName('a', 'b', 'c')) && mangledName('a', 'b', 'c', 7).startsWith(mangledName('a', 'b', 'c')));
  const REGION_MARK = '// ---- inlined GuardCore region ----\n';
  const regionPart = mod.slice(mod.indexOf(REGION_MARK) + REGION_MARK.length, mod.indexOf('Guard.register('));
  check('inlined region has comments stripped but keeps the regex and string literals', !/\/\/|\/\*/.test(regionPart) && regionPart.includes('/\\s+/g') && regionPart.includes("'g_parse is not g_parsed'") && regionPart.includes('interface ' + names.g_Shape));
  check('tunables module uses a different name set (per table seed)', ledger().buyers.b017.names.tunables.g_unlock !== names.g_unlock);
  check('generated modules are under the 25 KB lint cap and pass lint-runtime', Buffer.byteLength(mod) < 25 * 1024 && spawnSync(process.execPath, [LINT, S], { encoding: 'utf8' }).status === 0);
  // Decrypt with the ledger ck, by hand, per the section 2 blob format.
  const ck = Buffer.from(ledger().buyers.b017.ck, 'hex');
  const body = Buffer.from(BLOB.slice(6), 'base64url');
  const nonce = body.subarray(0, 12);
  const ct = body.subarray(12, body.length - 16);
  const tag = body.subarray(body.length - 16);
  check('tag16 = SHA256(ck || nonce || ct)[0..16]', tag.equals(sha256(ck, nonce, ct).subarray(0, 16)));
  const plain = chacha20(ck, nonce, 1, ct);
  let parsed = null;
  try { parsed = JSON.parse(plain.toString('utf8')); } catch (e) { parsed = null; }
  PLAIN = parsed;
  check('ChaCha20 counter 1 under ck decrypts to {"n","b","d"} JSON', parsed !== null && parsed.n === 'waves' && parsed.b === 'b017' && typeof parsed.d === 'object' && JSON.stringify(Object.keys(parsed)) === '["n","b","d"]');
  check('openBlob agrees and rejects a flipped byte', openBlob(BLOB, ck) !== null && openBlob(BLOB, ck).equals(plain) && openBlob(BLOB.slice(0, 40) + (BLOB[40] === 'A' ? 'B' : 'A') + BLOB.slice(41), ck) === null && openBlob(BLOB, Buffer.alloc(32)) === null);
  if (core) {
    check('runtime openBlob decrypts the CLI blob with the ledger ck', Buffer.from(core.openBlob(BLOB, Array.from(ck))).equals(plain));
    check('runtime unlock(blob, license) in world 123 yields the plaintext; world 456 null', Buffer.from(core.unlock(BLOB, LICENSE, PUB.n, PUB.e, 'demo', { id: { get: () => 123n } }) || []).equals(plain) && core.unlock(BLOB, LICENSE, PUB.n, PUB.e, 'demo', { id: { get: () => 456n } }) === null);
  }
  // Watermarks inside d.
  const d = parsed ? parsed.d : {};
  const marks = ledger().buyers.b017.marks.waves;
  const at = (obj, path) => path === '$' ? obj : path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((o, k) => (o === undefined ? undefined : o[k]), obj);
  check('ledger _m marks are present in d with their values', marks.keys.length > 0 && marks.keys.every(([path, key, value]) => at(d, path) && at(d, path)[key] === value) && marks.keys.every(([, key, value]) => /^_m[0-9a-f]{4}$/.test(key) && Number.isInteger(value) && value >= 1 && value <= 99));
  check('slack constants replaced inside their ranges with 4 decimals', marks.slack['boss.hp'] >= 1150 && marks.slack['boss.hp'] <= 1250 && d.boss.hp === marks.slack['boss.hp'] && d.waves[1].rate === marks.slack['waves[1].rate'] && d.waves[1].rate >= 1.2 && d.waves[1].rate <= 1.3 && Object.values(marks.slack).every((v) => Math.round(v * 10000) / 10000 === v));
  const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !/^_m[0-9a-f]{4}$/.test(k)).map(([k, x]) => [k, strip(x)])) : v);
  const restored = strip(d);
  restored.boss.hp = 1200;
  restored.waves[1].rate = 1.25;
  check('apart from the marks, d equals the input table', JSON.stringify(restored) === JSON.stringify(WAVES));
  check('marks landed on a sensible share of the 27 objects', marks.keys.length >= 3 && marks.keys.length <= 20);
  // Determinism: a rebuild gives the same d (and the same names) under a fresh nonce.
  const OUT2 = join(work, 'out', 'b017-again');
  const r2 = hag(['build', '--sku', 'demo', '--buyer', 'b017', '--config', CFG, '--out', OUT2, '--runtime', RT]);
  const mod2 = r2.status === 0 ? read(join(OUT2, 'scripts', 'GuardData_waves.ts')) : '';
  const blob2 = (/'(HAGD1\.[A-Za-z0-9_-]+)'/.exec(mod2) || [])[1] || '';
  const plain2 = blob2 ? openBlob(blob2, ck) : null;
  check('rebuild: same wm -> identical watermarked table, identical mangled names', r2.status === 0 && plain2 !== null && plain2.equals(plain) && JSON.stringify(ledger().buyers.b017.names.waves) === JSON.stringify(names), r2.all);
  check('rebuild: fresh nonce -> different blob and hash', blob2 !== '' && blob2 !== BLOB && blobHash(blob2) !== blobHash(BLOB));
  const w1 = watermarkTable(WAVES, 'deadbeefdeadbeef', 'waves', MARKS);
  const w2 = watermarkTable(WAVES, 'deadbeefdeadbeef', 'waves', MARKS);
  const w3 = watermarkTable(WAVES, 'deadbeefdeadbeee', 'waves', MARKS);
  check('watermarkTable is a pure function of (wm, name, data, marks)', JSON.stringify(w1) === JSON.stringify(w2) && JSON.stringify(w1.data) !== JSON.stringify(w3.data));
  check('slack values depend on wm and stay inside [min, max]', slackValue('a', 'waves', 'boss.hp', 1150, 1250) !== slackValue('b', 'waves', 'boss.hp', 1150, 1250) && [...Array(50).keys()].every((i) => { const v = slackValue('wm' + i, 't', 'p', -1.5, -1.4); return v >= -1.5 && v <= -1.4; }));
  check('about a third of objects get an _m key', (() => { const big = { items: [...Array(300).keys()].map((i) => ({ i })) }; const n = addObjectMarks(big, 'feedfacefeedface', 't').marks.length; return n > 60 && n < 150; })());
  // Failure modes.
  const RT2 = join(work, 'runtime-nomarkers');
  cpSync(RT, RT2, { recursive: true });
  writeFileSync(join(RT2, 'GuardCore.ts'), read(join(RT, 'GuardCore.ts')).replace(/\/\/ @hag-core-(begin|end)\n/g, ''));
  const nm = hag(['build', '--sku', 'demo', '--buyer', 'b017', '--config', CFG, '--out', join(work, 'out', 'nm'), '--runtime', RT2]);
  check('missing markers fail loudly naming the markers and the file', nm.status === 1 && nm.err.includes('@hag-core-begin') && nm.err.includes('GuardCore.ts'), nm.all);
  const RT3 = join(work, 'runtime-nounlock');
  cpSync(RT, RT3, { recursive: true });
  writeFileSync(join(RT3, 'GuardCore.ts'), read(join(RT, 'GuardCore.ts')).replace(/g_unlock/g, 'g_open'));
  const nu = hag(['build', '--sku', 'demo', '--buyer', 'b017', '--config', CFG, '--out', join(work, 'out', 'nu'), '--runtime', RT3]);
  check('region without g_unlock fails loudly', nu.status === 1 && nu.err.includes('g_unlock'));
  check('missing core file fails loudly', (() => { const r = hag(['build', '--sku', 'demo', '--buyer', 'b017', '--config', CFG, '--out', join(work, 'out', 'nc'), '--runtime', RT, '--core', join(work, 'nope.ts')]); return r.status === 1 && r.err.includes('@hag-core-begin'); })());
  check('config with a bad mark path fails', (() => { writeFileSync(join(CFG_DIR, 'bad.json'), JSON.stringify({ data: { waves: 'data/waves.json' }, marks: { 'waves.boss.nope': [1, 2] } })); const r = hag(['build', '--sku', 'demo', '--buyer', 'b017', '--config', join(CFG_DIR, 'bad.json'), '--out', join(work, 'out', 'bad'), '--runtime', RT]); return r.status === 1 && r.err.includes('does not exist in the table'); })());
  check('config for another SKU refused', (() => { writeFileSync(join(CFG_DIR, 'other.json'), JSON.stringify({ sku: 'other', data: { waves: 'data/waves.json' } })); return hag(['build', '--sku', 'demo', '--buyer', 'b017', '--config', join(CFG_DIR, 'other.json'), '--out', join(work, 'out', 'o'), '--runtime', RT]).status === 1; })());
  check('--keep-comments keeps the region comments', (() => { const r = hag(['build', '--sku', 'demo', '--buyer', 'b017', '--config', CFG, '--out', join(work, 'out', 'kc'), '--runtime', RT, '--keep-comments']); return r.status === 0 && read(join(work, 'out', 'kc', 'scripts', 'GuardData_waves.ts')).includes('must survive comment stripping'); })());
  check('stripComments keeps the real core region intact (names and regexes)', (() => { const real = read(join(PKG, 'runtime', 'GuardCore.ts')); if (!/@hag-core-begin/.test(real)) return true; const region = extractRegion(real); const s = stripComments(region); return !/\/\/|\/\*/.test(s) && s.includes('function g_unlock(') && (region.match(/\/\\s\+\/g/g) || []).length === (s.match(/\/\\s\+\/g/g) || []).length; })());
}

// ---- build against the real runtime + doctor (lint + tsc 4.7.4) ----
console.log('hag build (real runtime) + hag doctor');
{
  const real = read(join(PKG, 'runtime', 'GuardCore.ts'));
  if (!/^\/\/ @hag-core-begin/m.test(real)) {
    console.log('   (runtime/GuardCore.ts has no markers yet; real-runtime build check skipped)');
  } else {
    const OUTR = join(work, 'out', 'real');
    const r = hag(['build', '--sku', 'demo', '--buyer', 'b017', '--config', CFG, '--out', OUTR]);
    check('build against the real runtime/ succeeds', r.status === 0, r.all);
    const d1 = hag(['doctor', '--dir', join(OUTR, 'scripts'), '--skip-tsc']);
    check('hag doctor (lint, sizes, keystone gate) passes on the real build', d1.status === 0, d1.all);
    const haveTs = existsSync(join(PKG, 'node_modules', 'typescript', 'bin', 'tsc'));
    if (!haveTs) console.log('   (typescript not installed; tsc check skipped)');
    else {
      const d2 = hag(['doctor', '--dir', join(OUTR, 'scripts')]);
      check('the built package compiles under tsc 4.7.4 strict (requires runtime/ itself to compile)', d2.status === 0 && d2.out.includes('tsc 4.7.4: clean'), d2.all);
    }
    const m = read(join(OUTR, 'scripts', 'GuardData_waves.ts'));
    check('real-core module has no g_ names and is under 25 KB', !/\bg_/.test(m) && Buffer.byteLength(m) < 25 * 1024);
    if (core) {
      const blob = (/'(HAGD1\.[A-Za-z0-9_-]+)'/.exec(m) || [])[1];
      check('real-core build blob unlocks in the compiled runtime with the CLI license', blob && core.unlock(blob, LICENSE, PUB.n, PUB.e, 'demo', { id: { get: () => 123n } }) !== null);
    }
  }
}

// ---- trace among five buyers ----
console.log('hag trace');
{
  const ids = ['b001', 'b002', 'b003', 'b004', 'b005'];
  for (const id of ids) {
    check('buyer add ' + id, hag(['buyer', 'add', '--sku', 'demo', '--id', id, '--name', 'Buyer ' + id]).status === 0);
    pinWm(id);
    const r = hag(['build', '--sku', 'demo', '--buyer', id, '--config', CFG, '--out', join(work, 'five', id), '--runtime', RT]);
    check('build ' + id, r.status === 0, r.all);
  }
  const ckOf = (id) => Buffer.from(ledger().buyers[id].ck, 'hex');
  const blobOf = (id, table) => (/'(HAGD1\.[A-Za-z0-9_-]+)'/.exec(read(join(work, 'five', id, 'scripts', 'GuardData_' + table + '.ts'))) || [])[1];
  // (a) a leaked GuardData file.
  const a = hag(['trace', join(work, 'five', 'b003', 'scripts', 'GuardData_waves.ts'), '--out', join(work, 'trace-a.md')]);
  check('(a) GuardData file -> TOP b003 with high confidence', a.status === 0 && /^TOP: b003 .*confidence=high/m.test(a.out), a.all);
  check('(a) evidence names the blob and the mangled identifiers', a.out.includes('blob of table "waves"') && /\d+\/\d+ mangled identifiers/.test(a.out));
  check('(a) trace-report.md written and recorded in the ledger', read(join(work, 'trace-a.md')).startsWith('# hag trace report') && read(join(work, 'trace-a.md')).includes('b003') && ledger().traces.length > 0 && ledger().traces[ledger().traces.length - 1].top[0].id === 'b003');
  // (a') the same file with its blob replaced: only the code marks remain.
  const scrubDir = join(work, 'scrub');
  mkdirSync(scrubDir, { recursive: true });
  writeFileSync(join(scrubDir, 'Levels.ts'), read(join(work, 'five', 'b003', 'scripts', 'GuardData_waves.ts')).replace(/'HAGD1\.[A-Za-z0-9_-]+'/, "'HAGD1.scrubbed'").replace(/blobHash: '[0-9a-f]{16}'/, "blobHash: 'x'"));
  const a2 = hag(['trace', scrubDir, '--out', join(work, 'trace-a2.md'), '--json']);
  const a2j = a2.status === 0 ? JSON.parse(a2.out) : null;
  check("(a') blob scrubbed, file renamed: mangled names alone still name b003", a2j && a2j.candidates[0].id === 'b003' && a2j.candidates[0].counts.blobs === 0 && a2j.candidates[0].counts.names > 0 && a2j.candidates[1].score === 0, a2.all);
  // (b) a plain JSON dump of the decrypted data (d only).
  const dump = JSON.parse(openBlob(blobOf('b004', 'waves'), ckOf('b004')).toString('utf8'));
  const dumpDir = join(work, 'dump');
  mkdirSync(dumpDir, { recursive: true });
  writeFileSync(join(dumpDir, 'waves.json'), JSON.stringify(dump.d, null, 2));
  const b = hag(['trace', dumpDir, '--out', join(work, 'trace-b.md'), '--json']);
  const bj = b.status === 0 ? JSON.parse(b.out) : null;
  check('(b) JSON dump of d -> TOP b004', bj && bj.candidates[0].id === 'b004' && (bj.confidence === 'high' || bj.confidence === 'medium'), b.all);
  check('(b) evidence comes from _m marks and slack constants only', bj && bj.candidates[0].counts.marks > 0 && bj.candidates[0].counts.slack > 0 && bj.candidates[0].counts.blobs === 0 && bj.candidates[0].counts.names === 0 && bj.candidates[0].evidence.some((e) => e.includes('_m marks')) && bj.candidates[0].evidence.some((e) => e.includes('slack')));
  check('(b) the other four buyers score far lower', bj && bj.candidates.slice(1).every((c) => c.score * 3 <= bj.candidates[0].score));
  // (b') the same tables pasted into a TypeScript constant, one-line JSON.
  const tsDump = join(work, 'dump-ts');
  mkdirSync(tsDump, { recursive: true });
  writeFileSync(join(tsDump, 'Waves.ts'), 'export const WAVES = ' + JSON.stringify(dump.d) + ';\n');
  const b2 = hag(['trace', tsDump, '--out', join(work, 'trace-b2.md')]);
  check("(b') dump inside a .ts constant -> TOP b004", b2.status === 0 && /^TOP: b004 /m.test(b2.out), b2.all);
  // (b'') the whole plaintext including the header names the buyer outright.
  const hdrDir = join(work, 'dump-hdr');
  mkdirSync(hdrDir, { recursive: true });
  writeFileSync(join(hdrDir, 'plain.json'), JSON.stringify(dump));
  const b3 = hag(['trace', hdrDir, '--out', join(work, 'trace-b3.md')]);
  check("(b'') full plaintext -> header evidence for b004", b3.status === 0 && /^TOP: b004 /m.test(b3.out) && b3.out.includes('plaintext header names buyer b004'), b3.all);
  // (c) nothing to match.
  const noneDir = join(work, 'none');
  mkdirSync(noneDir, { recursive: true });
  writeFileSync(join(noneDir, 'readme.txt'), 'nothing here\n');
  const c = hag(['trace', noneDir, '--out', join(work, 'trace-c.md')]);
  check('(c) unrelated files -> TOP: none', c.status === 0 && c.out.includes('TOP: none'), c.all);
  // (d) collusion: files from two buyers in one folder.
  const colDir = join(work, 'collude');
  mkdirSync(colDir, { recursive: true });
  cpSync(join(work, 'five', 'b001', 'scripts', 'GuardData_waves.ts'), join(colDir, 'GuardData_waves.ts'));
  cpSync(join(work, 'five', 'b002', 'scripts', 'GuardData_tunables.ts'), join(colDir, 'GuardData_tunables.ts'));
  const d = hag(['trace', colDir, '--out', join(work, 'trace-d.md')]);
  check('(d) two buyers\' files -> collusion candidate flagged', d.status === 0 && d.out.includes('collusion-candidate=') && /^TOP: b00[12] /m.test(d.out) && read(join(work, 'trace-d.md')).includes('Possible collusion'), d.all);
  check('trace with a missing path fails', hag(['trace', join(work, 'does-not-exist')]).status === 1);
  check('trace without a path is a usage error', hag(['trace']).status === 2);
}

// ---- doctor ----
console.log('hag doctor');
{
  const bad = join(work, 'bad-pkg');
  mkdirSync(bad, { recursive: true });
  cpSync(GK, join(bad, 'GuardKey.ts'));
  writeFileSync(join(bad, 'Bad.ts'), "export function bad(): number { const x = new Uint8Array(4); return x.length; }\n");
  const r = hag(['doctor', '--dir', bad, '--skip-tsc']);
  check('doctor catches a forbidden token (Uint8Array) and exits 1', r.status === 1 && r.out.includes('Uint8Array') && r.out.includes('PROBLEM'), r.all);
  const clean = join(work, 'clean-pkg');
  cpSync(RT, clean, { recursive: true });
  cpSync(GK, join(clean, 'GuardKey.ts'));
  const c = hag(['doctor', '--dir', clean, '--skip-tsc']);
  check('doctor passes a clean tree', c.status === 0 && c.out.includes('hag doctor: OK'), c.all);
  check('doctor on a missing dir fails', hag(['doctor', '--dir', join(work, 'nope')]).status === 1);
  const big = join(work, 'big-pkg');
  mkdirSync(big, { recursive: true });
  cpSync(GK, join(big, 'GuardKey.ts'));
  writeFileSync(join(big, 'Big.ts'), '// ' + 'x'.repeat(70 * 1024) + '\nexport const big = 1;\n');
  check('doctor flags a file over 64 KB', (() => { const b = hag(['doctor', '--dir', big, '--skip-tsc']); return b.status === 1 && b.out.includes('64 KB'); })());
}

// ---- keystone-test gating of degrade ----
console.log('hag keystone-test + doctor gate');
{
  const pkg = join(work, 'degrade-pkg');
  cpSync(RT, pkg, { recursive: true });
  const write = (mode, id) => writeFileSync(join(pkg, 'GuardKey.ts'), renderGuardKey({ sku: 'demo', pubN: PUB.n, pubE: PUB.e, graceMs: 0, keystoneId: id, keystoneMode: mode, bakedLicense: '' }));
  write('degrade', '0');
  check("degrade without a KEYSTONE_ID is a problem", (() => { const r = hag(['doctor', '--dir', pkg, '--skip-tsc']); return r.status === 1 && r.out.includes('KEYSTONE_ID'); })());
  write('degrade', '123456789012345');
  const r1 = hag(['doctor', '--dir', pkg, '--skip-tsc']);
  check("degrade with no keystone-test record is refused", r1.status === 1 && r1.out.includes('keystone-test') && r1.out.includes('no keystone-test record'), r1.all);
  check('keystone-test rejects an unknown test name', hag(['keystone-test', '--sku', 'demo', '--record', 'T99=pass']).status === 2);
  check('keystone-test accepts the non-gating checklist records (T0/T1/T2/T7/T11/T12)', hag(['keystone-test', '--sku', 'demo', '--record', 'T0=pass bigint=function', '--record', 'T12=quest:rsa=48ms']).status === 0);
  check("non-gating records do not satisfy the 'degrade' gate", (() => { const r = hag(['doctor', '--dir', pkg, '--skip-tsc']); return r.status === 1 && r.out.includes('no keystone-test record'); })());
  check('keystone-test needs --record', hag(['keystone-test', '--sku', 'demo']).status === 2);
  const k = hag(['keystone-test', '--sku', 'demo', '--record', 'T4=UnauthorizedContent', '--record', 'T5=pass', '--note', 'Studio 2026.10']);
  check('keystone-test stores dated records under the SKU', k.status === 0 && ledger().skus.demo.keystoneTests.length === 4 && ledger().skus.demo.keystoneTests[3].test === 'T5' && ledger().skus.demo.keystoneTests[3].result === 'pass' && /^\d{4}-\d{2}-\d{2}T/.test(ledger().skus.demo.keystoneTests[3].date) && ledger().skus.demo.keystoneTests[3].note === 'Studio 2026.10', k.all);
  const r2 = hag(['doctor', '--dir', pkg, '--skip-tsc']);
  check('degrade allowed with a fresh record', r2.status === 0 && r2.out.includes("'degrade' allowed"), r2.all);
  // Age the records past 90 days.
  const l = ledger();
  for (const t of l.skus.demo.keystoneTests) t.date = new Date(Date.now() - 100 * 86400000).toISOString();
  writeFileSync(join(HOME, 'ledger.json'), JSON.stringify(l, null, 2));
  const r3 = hag(['doctor', '--dir', pkg, '--skip-tsc']);
  check('degrade refused when the newest record is over 90 days old', r3.status === 1 && r3.out.includes('days old'), r3.all);
  write('warn', '123456789012345');
  check("warn mode needs no record", hag(['doctor', '--dir', pkg, '--skip-tsc']).status === 0);
  check('hag list shows keystone-test ages', hag(['list']).out.includes('T5=pass'));
}

// ---- revoke, report, list ----
console.log('hag revoke / report / list');
{
  const r = hag(['revoke', '--buyer', 'b003', '--reason', 'copy found in world 999']);
  check('revoke marks the buyer and prints the unshare steps and the IP checklist', r.status === 0 && r.out.includes('Unshare steps') && r.out.includes('Meta IP report checklist') && r.out.includes('forwards the reporter') && ledger().buyers.b003.revoked && ledger().buyers.b003.revokeReason === 'copy found in world 999', r.all);
  check('revoked buyer: issue and build refused', hag(['issue', '--sku', 'demo', '--buyer', 'b003', '--req', REQ]).status === 1 && hag(['build', '--sku', 'demo', '--buyer', 'b003', '--config', CFG, '--out', join(work, 'out', 'rv'), '--runtime', RT]).status === 1);
  check('revoking twice keeps the first date', (() => { const d = ledger().buyers.b003.revoked; return hag(['revoke', '--buyer', 'b003']).status === 0 && ledger().buyers.b003.revoked === d; })());
  check('revoke of an unknown buyer fails', hag(['revoke', '--buyer', 'zzz']).status === 1);
  const rp = hag(['report', '--buyer', 'b003', '--out', join(work, 'report-b003.md')]);
  const txt = rp.status === 0 ? read(join(work, 'report-b003.md')) : '';
  check('report writes the evidence packet with ledger facts and the last trace', rp.status === 0 && txt.includes('buyer b003') && txt.includes('copy found in world 999') && txt.includes('Last trace naming this buyer') && txt.includes('## Ranking') && txt.includes(ledger().buyers.b003.blobs.waves) && txt.includes('T5') && !/\{\{[A-Z_]+\}\}/.test(txt), rp.all);
  const rp2 = hag(['report', '--buyer', 'b017', '--out', join(work, 'report-b017.md')]);
  check('report for an untraced buyer says so and lists the licenses', rp2.status === 0 && read(join(work, 'report-b017.md')).includes('No trace run has named this buyer') && read(join(work, 'report-b017.md')).includes('| 1 | ') && read(join(work, 'report-b017.md')).includes('Revoked | no'));
  const l = hag(['list']);
  check('list shows buyers, worlds, counts and revocations', l.status === 0 && l.out.includes('b017') && l.out.includes('123,777,888,999') && /b003 .*copy found/.test(l.out) && l.out.includes('Last trace'), l.all);
  const lj = hag(['list', '--json']);
  check('list --json has no ck and no license strings', lj.status === 0 && !lj.out.includes('"ck"') && !lj.out.includes('HAG1.') && JSON.parse(lj.out).buyers.length === 7);
}

if (process.env.HAG_TEST_KEEP) console.log('work dir kept: ' + work);
else rmSync(work, { recursive: true, force: true });
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
