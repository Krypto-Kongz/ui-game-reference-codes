// Headless test for SF_SoundFinder.ts: compiles it with TypeScript 4.7.4 (strict, CommonJS, ES2020)
// against types/horizon-core.d.ts, then runs it in mock-horizon-core.cjs across every API shape
// the tool has to survive. Run: node dev/test.mjs  (needs a TypeScript 4.7.4 tsc; set TSC=path)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TSC = process.env.TSC || join(here, '../../horizon-asset-guard/node_modules/.bin/tsc');
const out = join(here, 'out');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL: ' + msg); } };

function sh(args) {
  try { return execFileSync(TSC, args, { cwd: here, encoding: 'utf8' }); }
  catch (e) { console.log(e.stdout || e.message); throw new Error('tsc failed'); }
}
console.log('tsc ' + sh(['--version']).trim());
rmSync(out, { recursive: true, force: true });
sh(['-p', 'tsconfig.json']);
mkdirSync(join(out, 'node_modules/horizon'), { recursive: true });
copyFileSync(join(here, 'mock-horizon-core.cjs'), join(out, 'node_modules/horizon/core.js'));
const src = readFileSync(join(here, '../Scripts/SF_SoundFinder.ts'), 'utf8');
ok(/^[\x00-\x7F]*$/.test(src), 'script is plain ASCII');
ok(Buffer.byteLength(src) < 40000, 'script under 40 KB (' + Buffer.byteLength(src) + ' bytes)');
const compiled = readFileSync(join(out, 'SF_SoundFinder.js'), 'utf8');
// a second build with SF_DEBUG = false
writeFileSync(join(out, 'SF_off.js'), compiled.replace('const SF_DEBUG = true;', 'const SF_DEBUG = false;'));
const req = createRequire(join(out, 'x.js'));

// ---------------------------------------------------------------- world builder
function build(opt) {
  const db = new Map();
  let n = 0;
  const nextId = () => { n++; return opt.dense ? String(n) : String(1234567890123000n + BigInt(n) * 7919n); };
  const add = (name, type, parent, pos, extra) => {
    const id = nextId();
    db.set(id, { name, type, parent, children: [], pos: pos || [n * 0.5, 0, n * 0.25], tags: [], asset: String(1000 + n), ...(extra || {}) });
    if (parent) db.get(parent).children.push(id);
    return id;
  };
  const floor = add('Floor', 'mesh', null);
  add('Sky', 'mesh', null);
  const level = add('Level', 'group', null);
  add('Loop Track', 'mesh', level);
  add('Door', 'mesh', level);
  const audio = add('Audio', 'group', level);
  const S = {};
  S.rain1 = add('Rain Loop', 'audio', audio, [1, 0.5, -3], { asset: '1111' });
  S.rain2 = add('Rain Loop', 'audio', audio, [5, 0.5, -3]);
  S.door = add('SFX_Door_Creak', 'audio', audio, [0, 1, 2]);
  S.rec = add('Sound Recorder', 'audio', audio, [2, 2, 2]);
  S.whoosh = add('whoosh', 'audio', audio);
  S.bgm = add('bgm_level1', 'audio', audio);
  S.kaboom = add('kaboom', 'audio', audio, null, { tags: opt.tagKaboom ? ['sfx'] : [] });
  S.cafe = add('Café Ambience', 'audio', audio);
  S.click = add('Click', 'audio', audio, [4, 4, 4]);
  S.clickCopy = add('Click Copy', 'audio', audio, [4, 4, 4.001]);
  S.wind = add('Wind', 'audio', null);
  S.music = add('Music Box', 'audio', null);
  for (let i = 0; i < 260; i++) add('Crate ' + i, 'mesh', i % 3 === 0 ? level : null);
  const selfId = add('SF Sound Finder', 'empty', opt.sfInGroup ? level : null);
  if (opt.throwy) {
    db.get(S.whoosh).throwOn = ['position'];
    db.get(floor).throwOn = ['name', 'children', 'tags'];
    db.get(level).throwOn = ['tags'];
  }
  return { db, selfId, S };
}

// ---------------------------------------------------------------- run one scenario
function run(label, opt, mode, file) {
  const w = build(opt);
  for (const k of Object.keys(req.cache)) delete req.cache[k];
  const hz = req('horizon/core');
  const M = hz.__MOCK;
  M.db = w.db; M.mode = mode; M.timers = []; M.logs = []; M.registered = []; M.selfId = w.selfId;
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let thrown = null, ticks = 0;
  try {
    req('./' + (file || 'SF_SoundFinder.js'));
    const Cls = M.registered[0];
    const c = new Cls();
    c.start();
    while (M.timers.length && ticks < 100000) { const t = M.timers.shift(); ticks++; t.cb(); }
  } catch (e) { thrown = e; }
  finally { console.log = orig; }
  const text = logs.join('\n');
  const rows = logs.filter((l) => /^\[SF\] \d\d  /.test(l));
  const rowFor = (name) => rows.find((r) => r.indexOf('"' + name + '"') >= 0);
  console.log(label + ': ' + rows.length + ' rows, ' + ticks + ' ticks');
  ok(!thrown, label + ': nothing thrown (' + (thrown && thrown.stack) + ')');
  ok(text.indexOf('Stopped by an unexpected error') < 0, label + ': no internal error');
  ok(M.logs.length === 0, label + ': never plays, stops or edits a sound (' + M.logs.join(',') + ')');
  ok(/^[\x00-\x7F]*$/.test(text), label + ': console output is plain ASCII');
  return { logs, text, rows, rowFor, w, M, hz, ticks };
}

// Pulls the paste-ready map out of the console, compiles it, and calls SF_sound() in the mock.
function checkMap(label, r, expectCount) {
  const start = r.logs.findIndex((l) => l.indexOf('----- copy the') >= 0);
  const end = r.logs.findIndex((l) => l.indexOf('----- end of SF_SoundMap.ts') >= 0);
  ok(start >= 0 && end > start, label + ': map printed');
  if (!(start >= 0 && end > start)) return;
  const map = r.logs.slice(start + 1, end).join('\n') + '\n';
  ok(/^[\x00-\x7F]*$/.test(map), label + ': map is ASCII');
  const md = join(here, 'out-map');
  rmSync(md, { recursive: true, force: true });
  mkdirSync(md, { recursive: true });
  writeFileSync(join(md, 'SF_SoundMap.ts'), map);
  writeFileSync(join(md, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'commonjs', lib: ['ES2020'], types: [], strict: true, noUnusedLocals: true, noEmitOnError: true, outDir: 'js' }, files: ['../types/horizon-core.d.ts', 'SF_SoundMap.ts'] }));
  let compiledOk = true;
  try { execFileSync(TSC, ['-p', join(md, 'tsconfig.json')], { encoding: 'utf8' }); } catch (e) { compiledOk = false; console.log(e.stdout); }
  ok(compiledOk, label + ': SF_SoundMap.ts compiles with TS 4.7.4 strict');
  if (!compiledOk) return;
  mkdirSync(join(md, 'js/node_modules/horizon'), { recursive: true });
  copyFileSync(join(out, 'node_modules/horizon/core.js'), join(md, 'js/node_modules/horizon/core.js'));
  const mreq = createRequire(join(md, 'js/x.js'));
  const hz2 = mreq('horizon/core');
  hz2.__MOCK.db = r.w.db; hz2.__MOCK.mode = {};
  const m = mreq('./SF_SoundMap.js');
  const keys = Object.keys(m.SND);
  ok(keys.length === expectCount, label + ': SND has ' + expectCount + ' keys (' + keys.length + ')');
  ok(new Set(keys).size === keys.length && keys.every((k) => /^[a-z][a-z0-9_]*$/.test(k)), label + ': keys unique and clean');
  const g = m.SF_sound(keys[0]);
  ok(g instanceof hz2.AudioGizmo && String(g.id) === m.SND[keys[0]], label + ': SF_sound() returns that AudioGizmo');
  return m.SND;
}

const ALL12 = ['Rain Loop', 'SFX_Door_Creak', 'Sound Recorder', 'whoosh', 'bgm_level1', 'kaboom', 'Caf? Ambience', 'Click', 'Click Copy', 'Wind', 'Music Box'];

// A: sequential ids, as() refuses non-sounds -> every sound in the world, nothing else
{
  const r = run('A dense+cast', { dense: true }, { castValidates: true });
  ok(r.rows.length === 12, 'A: 12 sounds (' + r.rows.length + ')');
  ok(ALL12.every((n) => r.rowFor(n)), 'A: every sound listed, wherever it sits');
  ok(!r.rowFor('Loop Track'), 'A: the mesh "Loop Track" is not listed');
  ok(/type test: works \(cast check\)/.test(r.text), 'A: type test reported as working');
  ok(/id sweep: used/.test(r.text), 'A: sweep used');
  ok(/DUP-NAME/.test(r.rowFor('Rain Loop')) && r.rows.filter((x) => /"Rain Loop"/.test(x)).length === 2, 'A: both Rain Loops flagged DUP-NAME');
  ok(/UNNAMED/.test(r.rowFor('Sound Recorder')), 'A: Sound Recorder flagged UNNAMED');
  ok(/SAME-SPOT/.test(r.rowFor('Click')) && /SAME-SPOT/.test(r.rowFor('Click Copy')), 'A: stacked Click copies flagged SAME-SPOT');
  ok(/asset id: not exposed/.test(r.text) && /Asset Library > select the sound > Asset ID/.test(r.text), 'A: asset id reported as not exposed, with the manual route');
  ok(/sound from id: works/.test(r.text), 'A: id references work');
  const snd = checkMap('A', r, 12);
  if (snd) {
    ok(snd.rain_loop && snd.rain_loop_2 && snd.door_creak && snd.sound && snd.caf_ambience, 'A: keys rain_loop, rain_loop_2, door_creak, sound, caf_ambience');
    ok(snd.rain_loop === r.w.S.rain1 || snd.rain_loop === r.w.S.rain2, 'A: rain_loop holds a Rain Loop entity id');
  }
}
// B: as() never refuses, but volume is readable -> type test by volume read
{
  const r = run('B dense+read', { dense: true }, { readableVolume: true });
  ok(r.rows.length === 12 && !r.rowFor('Loop Track'), 'B: 12 sounds, no mesh (' + r.rows.length + ')');
  ok(/type test: works \(volume read\)/.test(r.text), 'B: volume-read type test used');
}
// C: no type test possible (likely real Horizon) -> tags + names, false matches flagged NAME-ONLY
{
  const r = run('C dense+names', { dense: true, tagKaboom: true }, {});
  ok(/type test: not possible/.test(r.text), 'C: type test reported impossible');
  ok(r.rowFor('kaboom') && !/NAME-ONLY/.test(r.rowFor('kaboom')), 'C: tagged kaboom found by tag');
  ok(r.rowFor('Loop Track') && /NAME-ONLY/.test(r.rowFor('Loop Track')), 'C: Loop Track listed but flagged NAME-ONLY');
  ok(!r.rowFor('Wind'), 'C: untagged "Wind" cannot be found by name (expected limit)');
  ok(!r.rowFor('Audio') && r.rows.length === 12, 'C: the "Audio" folder is not listed; 12 rows (' + r.rows.length + ')');
  ok(r.rowFor('Music Box') && r.rowFor('SFX_Door_Creak') && r.rowFor('Caf? Ambience'), 'C: name matches found');
  checkMap('C', r, r.rows.length);
}
// D: big ids, nothing grouped, one tagged sound -> only the tagged one
{
  const r = run('D big+tag', { dense: false, tagKaboom: true }, {});
  ok(/id sweep: skipped \(ids are not small/.test(r.text), 'D: sweep skipped for big ids');
  ok(/not inside a group/.test(r.text), 'D: says this object is not in a group');
  ok(r.rows.length === 1 && r.rowFor('kaboom'), 'D: finds the tagged sound only (' + r.rows.length + ')');
}
// D2: big ids, nothing tagged -> clear help instead of an empty map
{
  const r = run('D2 big+none', { dense: false }, {});
  ok(r.rows.length === 0 && /No sounds found/.test(r.text) && /add the tag sfx/.test(r.text), 'D2: help printed');
  ok(!/----- copy the/.test(r.text), 'D2: no empty map printed');
}
// E: big ids, SF placed inside the Level group -> group route finds the grouped sounds by name
{
  const r = run('E big+group', { dense: false, sfInGroup: true }, {});
  ok(r.rowFor('Rain Loop') && r.rowFor('SFX_Door_Creak') && !r.rowFor('Music Box'), 'E: grouped sounds found, root ones not');
  ok(r.rows.length === 10, 'E: 9 grouped sounds + the Loop Track name match (' + r.rows.length + ')');
}
// F: exists() says yes to everything -> sweep refused
{
  const r = run('F exists-lies', { dense: true }, { existsAlwaysTrue: true, castValidates: true });
  ok(/id sweep: skipped \(cannot tell/.test(r.text), 'F: sweep refused when exists() cannot be trusted');
}
// G: a world-wide list exists -> used even with big ids
{
  const r = run('G world-list', { dense: false }, { worldList: true, castValidates: true });
  ok(/world list: used getAllEntities/.test(r.text) && r.rows.length === 12, 'G: world list used, 12 sounds (' + r.rows.length + ')');
}
// H: engine calls throw here and there -> still completes
{
  const r = run('H throwy', { dense: true, throwy: true }, { castValidates: true, tagsThrow: true });
  ok(r.rows.length === 12 && /position/.test(r.rows[0]) === false, 'H: completes with 12 sounds despite throwing engine calls (' + r.rows.length + ')');
  ok(/\(\?\)/.test(r.rowFor('whoosh')), 'H: unreadable position shown as (?)');
}
// I: Entity constructor not usable -> no sweep, and the map warns that SF_sound() cannot work
{
  const r = run('I no-ctor', { dense: true, sfInGroup: true }, { noEntityCtor: true, castValidates: true });
  ok(/sweep: skipped \(cannot tell/.test(r.text) && /sound from id: not available/.test(r.text) && /Link sounds with Entity properties/.test(r.text), 'I: degrades and explains');
}
// J: an API that exposes the asset -> asset ids printed
{
  const r = run('J asset', { dense: true }, { castValidates: true, assetMember: true });
  ok(/asset id: readable \(soundAsset\)/.test(r.text) && r.rows.some((x) => / 1111 /.test(x)), 'J: asset ids read and shown');
}
// K: SF_DEBUG = false -> silent and idle
{
  const r = run('K off', { dense: true }, { castValidates: true }, 'SF_off.js');
  ok(r.logs.length === 0 && r.ticks === 0, 'K: no output and no work when SF_DEBUG is false');
}

rmSync(join(here, 'out-map'), { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
