// AcademyPanel.ts - Creator Academy shared panel. Execution Mode: SHARED (make it by
// Attach Script > New Noesis UI script on the NoesisUI gizmo). Renders the one shared screen
// the server (AcademyGame, Default) owns. Buttons send actions; the server replies with the
// full view state, which every panel reflects. Plain ASCII, under 40 KB.
import * as hz from 'horizon/core';
import { NoesisGizmo } from 'horizon/noesis';

const ACT = new hz.NetworkEvent<{ pid: number; name: string; ctr: number; tid: string; action: string; arg: string }>('CA_Action');
const STATE = new hz.NetworkEvent<{ json: string }>('CA_State');

const PROG_W = 560;          // width in px of the lesson progress bar fill area in the XAML
const TABLE_ID = 'main';     // change per copy if you place more than one Academy in a world

class AcademyPanel extends hz.Component<typeof AcademyPanel> {
  static propsDefinition = {};

  private dc: any = {};
  private ctr = 0;
  private lastRev = -1;
  private gotState = false;

  preStart() {
    // Build the context BEFORE listening, so an early server broadcast lands on a real object
    // (the server may start and push state before this panel's start() runs).
    this.buildContext();
    this.connectNetworkBroadcastEvent(STATE, (d) => this.onState(d.json));
  }

  start() {
    try {
      const gizmo = this.entity.as(NoesisGizmo);
      gizmo.dataContext = this.dc;
      // Noesis may wrap the object - keep mutating the one it actually bound to.
      this.dc = (gizmo.dataContext as any) || this.dc;
    } catch (_e) { /* not a Noesis gizmo in this context */ }
    // always greet once (so the server sends us the current page), then retry until it answers
    this.sayHello(0);
  }

  private sayHello(tries: number) {
    this.send('hello', '');
    if (this.gotState || tries >= 20) return;
    this.async.setTimeout(() => { if (!this.gotState) this.sayHello(tries + 1); }, 500);
  }

  // ---------------------------------------------------------------- sending actions
  private me(): hz.Player {
    try { return this.world.getLocalPlayer(); } catch (_e) { return this.world.getServerPlayer(); }
  }

  private send(action: string, arg: string) {
    this.ctr++;
    const p = this.me();
    let pid = 0, name = 'Player';
    try { pid = p.id; } catch (_e) { pid = 0; }
    try { name = p.name.get(); } catch (_e) { name = 'Player'; }
    this.sendNetworkBroadcastEvent(ACT, { pid, name, ctr: this.ctr, tid: TABLE_ID, action, arg });
  }

  // ---------------------------------------------------------------- receiving state
  private onState(json: string) {
    let s: any;
    try { s = JSON.parse(json); } catch (_e) { this.setErr('Could not read the page. Try again.'); return; }
    if (typeof s.rev === 'number' && s.rev === this.lastRev) return;   // nothing new
    this.lastRev = s.rev;
    this.gotState = true;
    this.setErr('');
    this.dc.ready = '1';
    this.dc.view = s.view;
    this.apply(s);
    this.dc.pulse = this.dc.pulse === '1' ? '0' : '1';                 // flip to replay the page-in animation
  }

  private setErr(msg: string) {
    this.dc.err = msg;
    this.dc.errShow = msg ? '1' : '0';
  }

  private apply(s: any) {
    this.applyHome(s);
    if (s.lesson) this.applyLesson(s.lesson);
    if (s.search) this.applySearch(s.search);
    if (s.bookmarks) this.applyBookmarks(s.bookmarks);
    if (s.quiz) this.applyQuiz(s.quiz);
    if (s.result) this.applyResult(s.result);
  }

  private applyHome(s: any) {
    const secs = s.sections || [];
    for (let i = 0; i < 4; i++) {
      const x = secs[i];
      this.dc['h' + i + 'Label'] = x ? x.label : '';
      this.dc['h' + i + 'Blurb'] = x ? x.blurb : '';
      this.dc['h' + i + 'Count'] = x ? (x.count + ' lessons') : '';
    }
    this.dc.secName = s.secName || '';
  }

  private applyLesson(l: any) {
    this.dc.lsTitle = l.title;
    this.dc.lsSub = l.subtitle;
    this.dc.lsLevel = l.level;
    this.dc.lsMin = l.minutes + ' min read';
    this.dc.lsCounter = l.counter;
    this.dc.lsImg = l.img;
    this.dc.lsProgW = Math.max(6, Math.round((l.progress || 0) * PROG_W));
    this.dc.lsMark = l.marked ? 'Saved' : 'Save';
    this.dc.lsMarkOn = l.marked ? '1' : '0';
    this.dc.lsTip = l.tip || '';
    this.dc.lsTipShow = l.tip ? '1' : '0';
    const steps = l.steps || [];
    for (let i = 0; i < 6; i++) {
      this.dc['st' + i] = steps[i] || '';
      this.dc['st' + i + 'Show'] = steps[i] ? '1' : '0';
      this.dc['st' + i + 'N'] = String(i + 1);
    }
  }

  private applySearch(se: any) {
    this.dc.sqQuery = se.query ? se.query : '';
    this.dc.sqShow = se.query ? '1' : '0';
    const res = se.results || [];
    for (let i = 0; i < 6; i++) {
      const r = res[i];
      this.dc['sr' + i] = r ? r.title : '';
      this.dc['sr' + i + 'Sub'] = r ? r.sub : '';
      this.dc['sr' + i + 'Tag'] = r ? r.tag : '';
      this.dc['sr' + i + 'Show'] = r ? '1' : '0';
    }
    this.dc.srEmpty = (se.count === 0 && se.query && se.query.length >= 2) ? '1' : '0';
    this.dc.srHint = (!se.query || se.query.length < 2) ? '1' : '0';
  }

  private applyBookmarks(b: any) {
    const it = b.items || [];
    for (let i = 0; i < 8; i++) {
      const r = it[i];
      this.dc['__bmId' + i] = r ? r.id : '';     // openBm<i> reads this to open by id
      this.dc['bm' + i] = r ? r.title : '';
      this.dc['bm' + i + 'Sub'] = r ? r.sub : '';
      this.dc['bm' + i + 'Tag'] = r ? r.tag : '';
      this.dc['bm' + i + 'Show'] = r ? '1' : '0';
    }
    this.dc.bmEmpty = (b.count === 0) ? '1' : '0';
    this.dc.bmCount = b.count + ' saved';
  }

  private applyQuiz(q: any) {
    this.dc.qzNum = q.num;
    this.dc.qzQ = q.q;
    const ch = q.choices || [];
    this.dc.qzA = ch[0] || ''; this.dc.qzB = ch[1] || ''; this.dc.qzC = ch[2] || '';
    this.dc.qzBanner = q.banner || '';
    this.dc.qzReveal = q.phase === 'reveal' ? '1' : '0';
    this.dc.qzRightA = q.answer === 0 ? '1' : '0';
    this.dc.qzRightB = q.answer === 1 ? '1' : '0';
    this.dc.qzRightC = q.answer === 2 ? '1' : '0';
    const bd = q.board || [];
    for (let i = 0; i < 5; i++) { this.dc['ql' + i] = bd[i] || ''; this.dc['ql' + i + 'Show'] = bd[i] ? '1' : '0'; }
  }

  private applyResult(r: any) {
    this.dc.rsTitle = r.secName + ' Quiz';
    const bd = r.board || [];
    for (let i = 0; i < 5; i++) { this.dc['rl' + i] = bd[i] || ''; this.dc['rl' + i + 'Show'] = bd[i] ? '1' : '0'; }
    this.dc.rsEmpty = r.empty ? '1' : '0';
  }

  // ---------------------------------------------------------------- the data context
  private buildContext() {
    const d: any = {
      ready: '0', view: 'home', pulse: '0', err: '', errShow: '0',
      // nav
      navHome: () => this.send('home', ''),
      navSearch: () => this.send('openSearch', ''),
      navBookmarks: () => this.send('openBookmarks', ''),
      // lesson controls
      btnPrev: () => this.send('prev', ''),
      btnNext: () => this.send('next', ''),
      btnMark: () => this.send('bookmark', ''),
      btnQuiz: () => this.send('startQuiz', ''),
      // quiz
      ansA: () => this.send('answer', '0'),
      ansB: () => this.send('answer', '1'),
      ansC: () => this.send('answer', '2'),
      quizNext: () => this.send('quizNext', ''),
      quizClose: () => this.send('closeQuiz', ''),
      // search keyboard
      keySpace: () => this.send('key', 'space'),
      keyBack: () => this.send('backspace', ''),
      keyClear: () => this.send('clearSearch', ''),
    };
    // section nav + home cards
    for (let i = 0; i < 4; i++) {
      d['navSec' + i] = ((n: number) => () => this.send('section', String(n)))(i);
      d['h' + i + 'Label'] = ''; d['h' + i + 'Blurb'] = ''; d['h' + i + 'Count'] = '';
    }
    // search results open
    for (let i = 0; i < 6; i++) {
      d['openRes' + i] = ((n: number) => () => this.send('result', String(n)))(i);
    }
    // bookmark open
    for (let i = 0; i < 8; i++) {
      d['openBm' + i] = ((n: number) => () => this.send('open', this.dc['__bmId' + n] || ''))(i);
    }
    // letter keys A-Z
    const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < AZ.length; i++) {
      const ch = AZ[i];
      d['key' + ch] = ((c: string) => () => this.send('key', c))(ch);
    }
    // default field values so bindings never show "undefined"
    const blanks = ['lsTitle','lsSub','lsLevel','lsMin','lsCounter','lsImg','lsMark','lsTip','sqQuery','qzNum','qzQ','qzA','qzB','qzC','qzBanner','rsTitle','secName','bmCount'];
    for (const k of blanks) d[k] = '';
    d.lsProgW = 6; d.lsTipShow = '0'; d.lsMarkOn = '0';
    for (let i = 0; i < 6; i++) { d['st' + i] = ''; d['st' + i + 'Show'] = '0'; d['st' + i + 'N'] = String(i + 1); d['sr' + i] = ''; d['sr' + i + 'Show'] = '0'; d['sr' + i + 'Sub'] = ''; d['sr' + i + 'Tag'] = ''; }
    for (let i = 0; i < 8; i++) { d['bm' + i] = ''; d['bm' + i + 'Show'] = '0'; d['bm' + i + 'Sub'] = ''; d['bm' + i + 'Tag'] = ''; }
    for (let i = 0; i < 5; i++) { d['ql' + i] = ''; d['ql' + i + 'Show'] = '0'; d['rl' + i] = ''; d['rl' + i + 'Show'] = '0'; }
    d.srEmpty = '0'; d.srHint = '1'; d.sqShow = '0'; d.bmEmpty = '1';
    d.qzReveal = '0'; d.qzRightA = '0'; d.qzRightB = '0'; d.qzRightC = '0'; d.rsEmpty = '0';
    this.dc = d;
  }
}

hz.Component.register(AcademyPanel);

// (bookmark ids are captured inside applyBookmarks so openBm<i> can open a saved lesson by id.)
