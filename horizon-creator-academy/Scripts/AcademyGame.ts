// AcademyGame.ts - Creator Academy server brain. Execution Mode: DEFAULT, on one empty object.
// Owns ALL state for the shared panel: current view, section, lesson, search, bookmarks, quiz.
// One shared screen: whoever taps changes the view for everyone. Broadcasts one compact JSON
// (on change, plus a heartbeat) that every AcademyPanel renders. Plain ASCII, under 40 KB.
//
// Create in the editor: a persistent variable group "CreatorAcademy" with a Object variable
// "bookmarks", and a leaderboard "AcademyQuiz". Both are optional - the panel works without them.
import * as hz from 'horizon/core';
import { SECTIONS } from 'AcademyData';
import { Lesson } from 'AcademyTypes';

// ---- events shared with the panel (keep names in sync with AcademyPanel.ts)
const ACT = new hz.NetworkEvent<{ pid: number; name: string; ctr: number; tid: string; action: string; arg: string }>('CA_Action');
const STATE = new hz.NetworkEvent<{ json: string }>('CA_State');

const PV_GROUP = 'CreatorAcademy';
const PV_BOOKMARKS = 'CreatorAcademy:bookmarks';
const LEADERBOARD = 'AcademyQuiz';
const QUIZ_LEN = 8;              // questions per section quiz
const HEARTBEAT_MS = 3000;

type View = 'home' | 'lesson' | 'search' | 'bookmarks' | 'quiz' | 'result';

interface QuizPlayer { pid: number; name: string; score: number; }

class AcademyGame extends hz.Component<typeof AcademyGame> {
  static propsDefinition = {};

  private view: View = 'home';
  private sec = 0;                 // section index
  private les = 0;                 // lesson index within section
  private query = '';
  private results: Lesson[] = [];
  private marks: { [id: string]: boolean } = {};
  private lastCtr: { [pid: number]: number } = {};
  private rev = 0;                 // bumps every state push so the panel can pulse

  // quiz state
  private qzOn = false;
  private qzSec = 0;
  private qzItems: Lesson[] = [];
  private qzNum = 0;
  private qzPhase: 'question' | 'reveal' = 'question';
  private qzAnswered: { [pid: number]: number } = {};
  private qzFirst = -1;            // pid of first correct answerer this question
  private qzBanner = '';
  private qzPlayers: { [pid: number]: QuizPlayer } = {};

  preStart() {
    this.connectNetworkBroadcastEvent(ACT, (d) => this.onAction(d));
    this.connectCodeBlockEvent(this.entity, hz.CodeBlockEvents.OnPlayerEnterWorld, (p: hz.Player) => this.onJoin(p));
  }

  start() {
    // load any saved bookmarks from players already here
    for (const p of this.world.getPlayers()) this.loadBookmarks(p);
    this.async.setInterval(() => this.push(), HEARTBEAT_MS);
    this.push();
  }

  // ---------------------------------------------------------------- input
  private onAction(d: { pid: number; name: string; ctr: number; tid: string; action: string; arg: string }) {
    // ignore duplicate presses (panel sends a rising counter per player)
    if (this.lastCtr[d.pid] !== undefined && d.ctr <= this.lastCtr[d.pid] && d.action !== 'hello') return;
    this.lastCtr[d.pid] = d.ctr;
    const a = d.action;
    const arg = d.arg || '';
    if (a === 'hello') { this.push(); return; }
    if (a === 'home') { this.view = 'home'; this.qzOn = false; }
    else if (a === 'section') { this.sec = clamp(parseInt(arg, 10) || 0, 0, SECTIONS.length - 1); this.les = 0; this.view = 'lesson'; }
    else if (a === 'open') { this.openById(arg); }
    else if (a === 'next') { this.step(1); }
    else if (a === 'prev') { this.step(-1); }
    else if (a === 'bookmark') { this.toggleMark(d); }
    else if (a === 'openBookmarks') { this.view = 'bookmarks'; }
    else if (a === 'openSearch') { this.view = 'search'; }
    else if (a === 'key') { this.typeKey(arg); }
    else if (a === 'backspace') { this.query = this.query.slice(0, -1); this.runSearch(); }
    else if (a === 'clearSearch') { this.query = ''; this.runSearch(); }
    else if (a === 'result') { const i = parseInt(arg, 10); if (this.results[i]) this.openById(this.results[i].id); }
    else if (a === 'startQuiz') { this.startQuiz(); }
    else if (a === 'answer') { this.answer(d, parseInt(arg, 10)); return; }
    else if (a === 'quizNext') { this.quizNext(); }
    else if (a === 'closeQuiz') { this.qzOn = false; this.view = 'lesson'; }
    this.push();
  }

  private onJoin(p: hz.Player) {
    this.loadBookmarks(p);
    this.push();
  }

  // ---------------------------------------------------------------- navigation
  private openById(id: string) {
    for (let s = 0; s < SECTIONS.length; s++) {
      const i = SECTIONS[s].lessons.findIndex((l) => l.id === id);
      if (i >= 0) { this.sec = s; this.les = i; this.view = 'lesson'; return; }
    }
  }

  private step(dir: number) {
    if (this.view !== 'lesson') { this.view = 'lesson'; return; }
    const n = SECTIONS[this.sec].lessons.length;
    this.les = (this.les + dir + n) % n;
  }

  private curLesson(): Lesson {
    return SECTIONS[this.sec].lessons[this.les];
  }

  // ---------------------------------------------------------------- search (on-screen keyboard)
  private typeKey(c: string) {
    if (c === 'space') c = ' ';
    if (c.length === 1 && this.query.length < 24) this.query += c.toLowerCase();
    this.view = 'search';
    this.runSearch();
  }

  private runSearch() {
    const q = this.query.trim();
    this.results = [];
    if (q.length < 2) return;
    const words = q.split(' ').filter((w) => w.length > 0);
    const scored: { l: Lesson; sc: number }[] = [];
    for (const sec of SECTIONS) {
      for (const l of sec.lessons) {
        const hay = (l.title + ' ' + l.subtitle + ' ' + l.keywords.join(' ')).toLowerCase();
        let sc = 0;
        for (const w of words) {
          if (hay.indexOf(w) >= 0) sc += 2;
          if (l.title.toLowerCase().indexOf(w) >= 0) sc += 3;
        }
        if (sc > 0) scored.push({ l, sc });
      }
    }
    scored.sort((a, b) => b.sc - a.sc);
    this.results = scored.slice(0, 6).map((x) => x.l);
  }

  // ---------------------------------------------------------------- bookmarks
  private toggleMark(d: { pid: number; name: string }) {
    const id = this.curLesson().id;
    this.marks[id] = !this.marks[id];
    const p = this.playerById(d.pid);
    if (p) this.saveBookmarks(p);
  }

  private markedList(): Lesson[] {
    const out: Lesson[] = [];
    for (const sec of SECTIONS) for (const l of sec.lessons) if (this.marks[l.id]) out.push(l);
    return out;
  }

  private loadBookmarks(p: hz.Player) {
    try {
      const raw: any = (this.world as any).persistentStorage.getPlayerVariable(p, PV_BOOKMARKS);
      if (raw && raw.ids && Array.isArray(raw.ids)) {
        for (const id of raw.ids) this.marks[String(id)] = true;
      }
    } catch (_e) { /* no persistence configured - bookmarks stay in memory */ }
  }

  private saveBookmarks(p: hz.Player) {
    try {
      const ids = Object.keys(this.marks).filter((k) => this.marks[k]);
      (this.world as any).persistentStorage.setPlayerVariable(p, PV_BOOKMARKS, { ids });
    } catch (_e) { /* no persistence configured */ }
  }

  // ---------------------------------------------------------------- quiz (shared group quiz)
  private startQuiz() {
    this.qzOn = true;
    this.qzSec = this.sec;
    this.view = 'quiz';
    const pool = SECTIONS[this.qzSec].lessons.slice();
    this.qzItems = shuffle(pool).slice(0, Math.min(QUIZ_LEN, pool.length));
    this.qzNum = 0;
    this.qzPlayers = {};
    this.beginQuestion();
  }

  private beginQuestion() {
    this.qzPhase = 'question';
    this.qzAnswered = {};
    this.qzFirst = -1;
    this.qzBanner = 'Tap the right answer!';
  }

  private answer(d: { pid: number; name: string }, choice: number) {
    if (!this.qzOn || this.qzPhase !== 'question') return;
    if (this.qzAnswered[d.pid] !== undefined) return;     // one answer per player per question
    this.qzAnswered[d.pid] = choice;
    if (!this.qzPlayers[d.pid]) this.qzPlayers[d.pid] = { pid: d.pid, name: d.name || 'Player', score: 0 };
    const correct = this.qzItems[this.qzNum].quiz.answer;
    if (choice === correct && this.qzFirst < 0) {
      this.qzFirst = d.pid;
      this.qzPlayers[d.pid].score += 1;
      this.qzPhase = 'reveal';
      this.qzBanner = 'Correct! +1 to ' + this.qzPlayers[d.pid].name;
    } else if (this.allAnswered()) {
      this.qzPhase = 'reveal';
      this.qzBanner = this.qzFirst < 0 ? 'Nobody got it. The answer is marked.' : this.qzBanner;
    }
    this.push();
  }

  private allAnswered(): boolean {
    const here = this.world.getPlayers().length;
    return Object.keys(this.qzAnswered).length >= Math.max(1, here);
  }

  private quizNext() {
    if (this.qzPhase !== 'reveal') { this.qzPhase = 'reveal'; return; }
    this.qzNum += 1;
    if (this.qzNum >= this.qzItems.length) { this.finishQuiz(); return; }
    this.beginQuestion();
  }

  private finishQuiz() {
    this.view = 'result';
    const players = this.playersSorted();
    for (const qp of players) {
      const p = this.playerById(qp.pid);
      if (!p) continue;
      try { (this.world as any).leaderboards.setScoreForPlayer(LEADERBOARD, p, qp.score, true); } catch (_e) { /* no leaderboard configured */ }
    }
  }

  private playersSorted(): QuizPlayer[] {
    const arr: QuizPlayer[] = [];
    for (const k in this.qzPlayers) arr.push(this.qzPlayers[k]);
    arr.sort((a, b) => b.score - a.score);
    return arr;
  }

  // ---------------------------------------------------------------- helpers
  private playerById(pid: number): hz.Player | null {
    for (const p of this.world.getPlayers()) { if (p.id === pid) return p; }
    return null;
  }

  // ---------------------------------------------------------------- state push
  private push() {
    this.rev++;
    const st = this.buildState();
    this.sendNetworkBroadcastEvent(STATE, { json: JSON.stringify(st) });
  }

  private buildState(): any {
    const sec = SECTIONS[this.sec];
    const s: any = {
      rev: this.rev,
      view: this.view,
      secIndex: this.sec,
      secName: sec ? sec.label : '',
      secColor: sec ? sec.color : '0A84FF',
      sections: SECTIONS.map((x) => ({ key: x.key, label: x.label, color: x.color, blurb: x.blurb, count: x.lessons.length })),
    };
    if (this.view === 'lesson') this.fillLesson(s);
    if (this.view === 'search') this.fillSearch(s);
    if (this.view === 'bookmarks') this.fillBookmarks(s);
    if (this.view === 'quiz') this.fillQuiz(s);
    if (this.view === 'result') this.fillResult(s);
    return s;
  }

  private fillLesson(s: any) {
    const l = this.curLesson();
    const n = SECTIONS[this.sec].lessons.length;
    s.lesson = {
      id: l.id, title: l.title, subtitle: l.subtitle, level: l.level, levelColor: l.levelColor,
      minutes: l.minutes, img: l.img, steps: l.steps, tip: l.tip,
      counter: (this.les + 1) + ' / ' + n, progress: (this.les + 1) / n,
      marked: this.marks[l.id] ? 1 : 0,
    };
  }

  private fillSearch(s: any) {
    s.search = {
      query: this.query,
      results: this.results.map((l) => ({ id: l.id, title: l.title, sub: l.subtitle, tag: this.tagOf(l.id) })),
      count: this.results.length,
    };
  }

  private fillBookmarks(s: any) {
    const list = this.markedList();
    s.bookmarks = {
      items: list.slice(0, 8).map((l) => ({ id: l.id, title: l.title, sub: l.subtitle, tag: this.tagOf(l.id) })),
      count: list.length,
    };
  }

  private tagOf(id: string): string {
    for (const sec of SECTIONS) if (sec.lessons.some((l) => l.id === id)) return sec.label.toUpperCase();
    return '';
  }

  private fillQuiz(s: any) {
    const item = this.qzItems[this.qzNum];
    s.quiz = {
      num: (this.qzNum + 1) + ' / ' + this.qzItems.length,
      q: item.quiz.q,
      choices: item.quiz.choices,
      phase: this.qzPhase,
      answer: this.qzPhase === 'reveal' ? item.quiz.answer : -1,
      banner: this.qzBanner,
      board: this.playersSorted().slice(0, 5).map((p, i) => (i + 1) + '. ' + p.name + '   ' + p.score),
      color: SECTIONS[this.qzSec].color,
    };
  }

  private fillResult(s: any) {
    const players = this.playersSorted();
    s.result = {
      secName: SECTIONS[this.qzSec].label,
      board: players.slice(0, 5).map((p, i) => (i + 1) + '. ' + p.name + '   ' + p.score),
      total: this.qzItems.length,
      empty: players.length === 0 ? 1 : 0,
    };
  }

  private colorOf(id: string): string {
    for (const sec of SECTIONS) if (sec.lessons.some((l) => l.id === id)) return sec.color;
    return '0A84FF';
  }
}

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

hz.Component.register(AcademyGame);
