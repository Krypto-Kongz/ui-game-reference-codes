import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const req = createRequire(new URL('./out/x.js', import.meta.url));
const hz = req('horizon/core');
const { Entity, __BUS: BUS, __emit: emit, __flush: flush } = hz;
const { NoesisGizmo } = req('horizon/noesis');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

// answer key: map quiz question text -> correct choice index, from the source content
const ANS = {};
for (const k of ['blender','photoshop','canva','horizon']) {
  for (const l of JSON.parse(readFileSync(new URL(`./content/${k}.json`, import.meta.url))).lessons)
    ANS[l.quiz.q] = l.quiz.answer;
}

// players + worlds
const mkP = (id, name) => ({ id, name: { get: () => name } });
const p1 = mkP(1, 'Ana'), p2 = mkP(2, 'Bob'), sp = mkP(0, 'Server');
const pv = new Map();
const scores = [];
const storage = {
  getPlayerVariable: (p, key) => (pv.get(p.id + key) ?? 0),
  setPlayerVariable: (p, key, v) => pv.set(p.id + key, v),
};
const leaderboards = { setScoreForPlayer: (name, p, s, o) => scores.push({ name, pid: p.id, s }) };
const serverWorld = { getPlayers: () => [p1, p2], getServerPlayer: () => sp, getLocalPlayer: () => sp, persistentStorage: storage, leaderboards };
const panelWorld = { getPlayers: () => [p1, p2], getServerPlayer: () => sp, getLocalPlayer: () => p1, persistentStorage: storage, leaderboards };

const gizmo = new NoesisGizmo();
const Game = req('./AcademyGame.js') && hz.Component._last; // registered on require
const serverCls = hz.Component._last;
const Panel = req('./AcademyPanel.js') && hz.Component._last;
const panelCls = hz.Component._last;

const server = new serverCls({ entity: new Entity(1), world: serverWorld });
const panel = new panelCls({ entity: new Entity(100, gizmo), world: panelWorld });
server.preStart(); panel.preStart();
server.start(); panel.start();
flush();
const dc = () => gizmo.dataContext;

// a raw action from any player (simulates another player's panel)
let ctr2 = 0;
const act = (p, action, arg) => { emit('CA_Action', { pid: p.id, name: p.name.get(), ctr: ++ctr2, tid: 'main', action, arg: arg || '' }); flush(); };

// 1 handshake + home
ok(dc(), 'panel has a dataContext');
ok(dc().ready === '1', 'ready after handshake (' + dc().ready + ')');
ok(dc().view === 'home', 'home view');
ok(dc().h0Label === 'Blender' && dc().h3Label === 'Horizon', 'home cards labelled');
ok(/lessons/.test(dc().h0Count), 'home card shows lesson count: ' + dc().h0Count);

// 2 open a section -> lesson 1
dc().navSec0(); flush();
ok(dc().view === 'lesson', 'section opens lesson view');
ok(dc().lsImg === 'blender-01.png', 'lesson image bound (' + dc().lsImg + ')');
ok(dc().lsCounter === '1 / 20', 'lesson counter (' + dc().lsCounter + ')');
ok(dc().st0 && dc().st0Show === '1', 'first step shown');
ok(typeof dc().lsProgW === 'number' && dc().lsProgW > 0, 'progress width is a number');

// 3 next / prev
dc().btnNext(); flush();
ok(dc().lsCounter === '2 / 20', 'next advances (' + dc().lsCounter + ')');
const t2 = dc().lsTitle;
dc().btnPrev(); flush();
ok(dc().lsCounter === '1 / 20', 'prev goes back');

// 4 bookmark on lesson 2, check persistence + bookmarks view
dc().btnNext(); flush();
ok(dc().lsMark === 'Save', 'not yet saved');
dc().btnMark(); flush();
ok(dc().lsMark === 'Saved' && dc().lsMarkOn === '1', 'bookmark toggles to Saved');
ok(JSON.stringify(pv.get(1 + 'CreatorAcademy:bookmarks') || {}).indexOf('blender-02') >= 0, 'bookmark persisted to player var');
dc().navBookmarks(); flush();
ok(dc().view === 'bookmarks' && dc().bmEmpty === '0', 'bookmarks view not empty');
ok(dc().bm0 === t2 && dc().bm0Show === '1', 'saved lesson shows in bookmarks (' + dc().bm0 + ')');
ok(dc().bm0Tag === 'BLENDER', 'bookmark row has section tag');
dc().openBm0(); flush();
ok(dc().view === 'lesson' && dc().lsCounter === '2 / 20', 'tapping a bookmark opens it');

// 5 search via on-screen keyboard
dc().navSearch(); flush();
ok(dc().view === 'search' && dc().srHint === '1', 'search starts with a hint');
dc().keyU(); dc().keyV(); flush();                      // type "uv"
ok(dc().sqQuery === 'uv', 'typing builds the query (' + dc().sqQuery + ')');
ok(dc().sr0Show === '1' && /uv|unwrap/i.test(dc().sr0 + dc().sr0Sub), 'search finds a UV lesson (' + dc().sr0 + ')');
dc().keyBack(); flush();
ok(dc().sqQuery === 'u', 'delete removes a letter');
dc().keyClear(); flush();
ok(dc().sqQuery === '' && dc().srHint === '1', 'clear empties the query');
dc().keyD(); dc().keyO(); dc().keyO(); dc().keyR(); flush();  // "door"
if (dc().sr0Show === '1') { dc().openRes0(); flush(); ok(dc().view === 'lesson', 'opening a search result works'); }
else ok(true, 'no result for door (acceptable)');

// 6 quiz - group scoring + leaderboard
dc().navSec1(); flush();                 // photoshop section
dc().btnQuiz(); flush();
ok(dc().view === 'quiz', 'quiz starts');
ok(dc().qzQ && dc().qzA && dc().qzB && dc().qzC, 'quiz question + 3 choices shown');
ok(/ \/ /.test(dc().qzNum), 'quiz counter (' + dc().qzNum + ')');
let answered = 0, correctByP1 = 0;
for (let step = 0; step < 8; step++) {
  if (dc().view !== 'quiz') break;
  const q = dc().qzQ; const correct = ANS[q];
  ok(correct !== undefined, 'quiz question is from the dataset');
  // p1 answers correctly THROUGH THE PANEL (monotonic counter); p2 answers wrong as a raw action
  const p1ans = [dc().ansA, dc().ansB, dc().ansC];
  p1ans[correct](); flush(); correctByP1++;
  act(p2, 'answer', String((correct + 1) % 3));
  ok(dc().qzReveal === '1', 'answer reveals the result');
  const rightKey = 'qzRight' + 'ABC'[correct];
  ok(dc()[rightKey] === '1', 'correct choice is highlighted');
  ok(/Ana/.test(dc().qzBanner), 'banner credits first correct answerer (' + dc().qzBanner + ')');
  ok(dc().ql0 && /Ana/.test(dc().ql0), 'scoreboard shows Ana leading');
  answered++;
  dc().quizNext(); flush();
}
ok(dc().view === 'result', 'quiz ends on the result view (' + dc().view + ')');
ok(/Quiz/.test(dc().rsTitle), 'result title');
ok(/Ana/.test(dc().rl0) && new RegExp('' + correctByP1).test(dc().rl0), 'final scoreboard shows Ana with full score (' + dc().rl0 + ')');
ok(scores.filter(s => s.pid === 1).length >= 1, 'a score was written to the leaderboard for Ana');
const anaScore = scores.filter(s => s.pid === 1).pop();
ok(anaScore && anaScore.s === correctByP1, 'leaderboard score equals correct answers (' + (anaScore && anaScore.s) + ')');

// 7 play again + home
dc().btnQuiz(); flush();
ok(dc().view === 'quiz', 'play again restarts the quiz');
dc().quizClose(); flush();
ok(dc().view === 'lesson', 'quit returns to a lesson');
dc().navHome(); flush();
ok(dc().view === 'home', 'home button works');

// 8 no bound field is undefined (would render blank/NaN in Noesis)
const required = ['lsTitle','lsImg','qzA','sr0','bm0','ql0','rl0','h0Label','lsProgW','view','ready'];
for (const k of required) ok(dc()[k] !== undefined, 'dc.' + k + ' is defined');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
