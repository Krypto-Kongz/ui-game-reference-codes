// BibleReaderUI.ts
// Each player's King James Bible panel (Noesis). Attach to the Noesis UI gizmo that uses
// noesis/BibleReader.xaml, execution mode **Shared** (every player gets their own panel).
//
// Browse any book, chapter and verse; search the whole text; bookmark verses; and ask the one
// shared Reader NPC (BibleReaderNpc) to read a verse, a passage or a chapter aloud. Everyone's
// panel highlights the verse the Reader is speaking, and "Follow" keeps your page in step.

import * as hz from 'horizon/core';
import { NoesisGizmo } from 'horizon/noesis';
import { BibleEvents, ReaderState, IDLE_STATE } from 'BibleShared';
import {
  BOOKS, chapterCount, verseCount, verseText, plainText, heading, refLabel, refKey, parseKey,
  parseReference, search, verseOfDay,
} from 'BibleIndex';

type Vis = 'Visible' | 'Collapsed';
const SHOW: Vis = 'Visible';
const HIDE: Vis = 'Collapsed';

// ---------------------------------------------------------------------------------------------
// Themes (every value is bound by BibleReader.xaml)
// ---------------------------------------------------------------------------------------------

type Theme = {
  name: string;
  bgA: string; bgB: string; bgC: string;
  blobA: string; blobB: string; blobC: string; blobOp: number;
  leadOp: number; raysOp: number; starsOp: number; glintOp: number; raysColor: string;
  panelA: string; panelB: string; panelSolid: string; edgeA: string; edgeB: string; sheenOp: number;
  shadowColor: string; shadowOp: number; shadowBlur: number; shadowDepth: number;
  pageA: string; pageB: string; pageEdge: string; pageEdgeOp: number; pageBorder: string;
  text: string; subtext: string; pageText: string; pageSub: string; accent: string; accent2: string;
  verseA: string; verseB: string; verseC: string; verseNum: string; heading: string;
  glowColor: string; glowRadius: number; titleGlow: string;
  selBg: string; playBg: string; playBar: string;
  btnA: string; btnB: string; btnText: string; btnEdge: string;
  chip: string; chipOn: string; chipOnText: string; inputBg: string; inputText: string;
};

const THEMES: Theme[] = [
  {
    name: 'Parchment',
    bgA: '#2E1C10', bgB: '#4A2F1B', bgC: '#21140B',
    blobA: '#9A6A35', blobB: '#C89A4B', blobC: '#7A4A22', blobOp: 0.35,
    leadOp: 0, raysOp: 0.16, starsOp: 0, glintOp: 0, raysColor: '#FFE7B0',
    panelA: '#F2F3E6CB', panelB: '#E6E9D6AE', panelSolid: '#EEF0E2C4', edgeA: '#FFFFF6DC', edgeB: '#668A6A3C', sheenOp: 0.18,
    shadowColor: '#140A03', shadowOp: 0.55, shadowBlur: 26, shadowDepth: 8,
    pageA: '#F7ECD1', pageB: '#E9D4A8', pageEdge: '#8B5A2B', pageEdgeOp: 0.5, pageBorder: '#80B08A55',
    text: '#3B2A1A', subtext: '#7A5C3E', pageText: '#3B2A1A', pageSub: '#7A5C3E', accent: '#8B1E1E', accent2: '#A87A2A',
    verseA: '#33241A', verseB: '#33241A', verseC: '#33241A', verseNum: '#8B1E1E', heading: '#6E5236',
    glowColor: '#00000000', glowRadius: 0, titleGlow: '#00000000',
    selBg: '#38C9A050', playBg: '#4DE0B860', playBar: '#8B1E1E',
    btnA: '#F7EDD3', btnB: '#E6D2A6', btnText: '#3B2A1A', btnEdge: '#80A8814A',
    chip: '#E9DAB4', chipOn: '#8B1E1E', chipOnText: '#FFF4DC', inputBg: '#FFFBF0', inputText: '#3B2A1A',
  },
  {
    name: 'Stained Glass',
    bgA: '#0D1238', bgB: '#2A0E36', bgC: '#082624',
    blobA: '#E0115F', blobB: '#1560D8', blobC: '#2FBF71', blobOp: 0.9,
    leadOp: 0.6, raysOp: 0.3, starsOp: 0, glintOp: 0, raysColor: '#FFF3C4',
    panelA: '#D9150F2B', panelB: '#E60D0A1E', panelSolid: '#E0120D26', edgeA: '#FFD4AF37', edgeB: '#66D4AF37', sheenOp: 0.12,
    shadowColor: '#000000', shadowOp: 0.5, shadowBlur: 26, shadowDepth: 8,
    pageA: '#F5FFF9EA', pageB: '#EBF6EBD2', pageEdge: '#D4AF37', pageEdgeOp: 0.22, pageBorder: '#FFD4AF37',
    text: '#FFF6E0', subtext: '#CDBF9E', pageText: '#2A1C10', pageSub: '#6B5536', accent: '#D4AF37', accent2: '#E0115F',
    verseA: '#2A1C10', verseB: '#2A1C10', verseC: '#2A1C10', verseNum: '#9B1B30', heading: '#1F4FA8',
    glowColor: '#00000000', glowRadius: 0, titleGlow: '#66D4AF37',
    selBg: '#33D4AF37', playBg: '#40E0115F', playBar: '#C2185B',
    btnA: '#E62A1F45', btnB: '#F2160F2C', btnText: '#FFF6E0', btnEdge: '#B3D4AF37',
    chip: '#26FFFFFF', chipOn: '#D4AF37', chipOnText: '#1A1208', inputBg: '#F2FFF9EA', inputText: '#2A1C10',
  },
  {
    name: 'Night',
    bgA: '#05080F', bgB: '#0A0F1E', bgC: '#070B16',
    blobA: '#1B2A55', blobB: '#2A1B45', blobC: '#14324A', blobOp: 0.55,
    leadOp: 0, raysOp: 0, starsOp: 0.9, glintOp: 0, raysColor: '#FFFFFF',
    panelA: '#E6101628', panelB: '#E60B1020', panelSolid: '#E60E1424', edgeA: '#30FFFFFF', edgeB: '#0DFFFFFF', sheenOp: 0.05,
    shadowColor: '#000000', shadowOp: 0.6, shadowBlur: 24, shadowDepth: 8,
    pageA: '#0F1528', pageB: '#0B1020', pageEdge: '#000000', pageEdgeOp: 0.35, pageBorder: '#1FFFFFFF',
    text: '#C9D3E6', subtext: '#7C89A3', pageText: '#D5DDEC', pageSub: '#7C89A3', accent: '#F2B35B', accent2: '#8FB3FF',
    verseA: '#C9D3E6', verseB: '#C9D3E6', verseC: '#C9D3E6', verseNum: '#F2B35B', heading: '#8FB3FF',
    glowColor: '#00000000', glowRadius: 0, titleGlow: '#40F2B35B',
    selBg: '#1FF2B35B', playBg: '#2EF2B35B', playBar: '#F2B35B',
    btnA: '#161E36', btnB: '#10172B', btnText: '#C9D3E6', btnEdge: '#26FFFFFF',
    chip: '#161E36', chipOn: '#F2B35B', chipOnText: '#0A0F1E', inputBg: '#121A30', inputText: '#D5DDEC',
  },
  {
    name: 'Neon Glass',
    bgA: '#000000', bgB: '#04010A', bgC: '#000000',
    blobA: '#00E5FF', blobB: '#FF00D4', blobC: '#7A00FF', blobOp: 0.38,
    leadOp: 0, raysOp: 0, starsOp: 0, glintOp: 0.55, raysColor: '#FFFFFF',
    panelA: '#B3050509', panelB: '#D9000000', panelSolid: '#CC030306', edgeA: '#FF00E5FF', edgeB: '#FFFF2BD6', sheenOp: 0.1,
    shadowColor: '#00E5FF', shadowOp: 0.32, shadowBlur: 24, shadowDepth: 0,
    pageA: '#C2020205', pageB: '#E0000000', pageEdge: '#00E5FF', pageEdgeOp: 0.12, pageBorder: '#9900E5FF',
    text: '#E8FBFF', subtext: '#8FA3C7', pageText: '#E8FBFF', pageSub: '#8FA3C7', accent: '#00E5FF', accent2: '#FF3BEF',
    verseA: '#7CF7FF', verseB: '#FF8AF3', verseC: '#B79CFF', verseNum: '#FF3BEF', heading: '#F9F871',
    glowColor: '#00D9FF', glowRadius: 10, titleGlow: '#FF00E5FF',
    selBg: '#2200E5FF', playBg: '#30FF2BD6', playBar: '#FF3BEF',
    btnA: '#14FFFFFF', btnB: '#05FFFFFF', btnText: '#E8FBFF', btnEdge: '#9900E5FF',
    chip: '#0FFFFFFF', chipOn: '#00E5FF', chipOnText: '#000000', inputBg: '#1AFFFFFF', inputText: '#E8FBFF',
  },
];

const FONT_SIZES = [16, 19, 23, 28];
const QUICK = ['Genesis 1', 'Psalms 23', 'Psalms 91', 'Proverbs 3', 'Isaiah 53', 'Matthew 5', 'John 1', 'John 3', 'Romans 8', '1 Corinthians 13', 'Hebrews 11', 'Revelation 21'];

type VerseItem = { n: number; t: string; head: string; headVis: Vis; sel: boolean; play: boolean };
type BookItem = { i: number; name: string; sel: boolean };
type ChapterItem = { n: number; sel: boolean };
type RefItem = { key: string; ref: string; t: string };

class BibleReaderUI extends hz.Component<typeof BibleReaderUI> {
  static propsDefinition = {
    readerNpc: { type: hz.PropTypes.Entity },
    startTheme: { type: hz.PropTypes.Number, default: 3 }, // 0 Parchment, 1 Stained Glass, 2 Night, 3 Neon Glass
    startFont: { type: hz.PropTypes.Number, default: 1 }, // index into 16 / 19 / 23 / 28
    pageWidth: { type: hz.PropTypes.Number, default: 690 }, // text column width used for pagination
    pageHeight: { type: hz.PropTypes.Number, default: 520 }, // verse area height used for pagination
    charWidth: { type: hz.PropTypes.Number, default: 0.46 }, // average glyph width / font size (raise if pages overflow)
  };

  private ctx: any = null;
  private me: hz.Player | null = null;
  private b = 42; // John
  private c = 3;
  private sel = 0; // selected verse
  private pages: number[][] = []; // verse numbers on each page
  private page = 0;
  private theme = 3;
  private font = 1;
  private testament: 'OT' | 'NT' = 'NT';
  private follow = false;
  private reader: ReaderState = { ...IDLE_STATE };
  private bookmarks: string[] = [];

  start() {
    const local = this.world.getLocalPlayer();
    if (!local || local.id === this.world.getServerPlayer().id) return; // Shared mode: no UI on the server
    this.me = local;
    this.theme = clampInt(this.props.startTheme, 0, THEMES.length - 1);
    this.font = clampInt(this.props.startFont, 0, FONT_SIZES.length - 1);
    this.buildContext();
    this.openChapter(this.b, this.c, 16);

    this.connectNetworkBroadcastEvent(BibleEvents.state, (s: ReaderState) => this.onReaderState(s));
    this.connectNetworkBroadcastEvent(BibleEvents.notice, (d: { playerId: number; text: string }) => {
      if (d.playerId === local.id) this.toast(d.text);
    });
    this.connectNetworkBroadcastEvent(BibleEvents.bookmarks, (d: { playerId: number; keys: string[] }) => {
      if (d.playerId !== local.id) return;
      this.bookmarks = d.keys.filter(k => parseKey(k));
      this.refreshBookmarks();
    });
    if (this.props.readerNpc) this.sendNetworkEvent(this.props.readerNpc, BibleEvents.hello, { player: local });
    else this.ctx.ui.aiNote = 'No Reader linked (set the readerNpc property)';
  }

  // -------------------------------------------------------------------------------------------
  // Data context
  // -------------------------------------------------------------------------------------------

  private buildContext() {
    const t = THEMES[this.theme];
    const vod = verseOfDay(new Date());
    const model = {
      theme: { ...t },
      ui: {
        bookTitle: '', chapterTitle: '', pageLabel: '', fontSize: FONT_SIZES[this.font],
        numSize: Math.round(FONT_SIZES[this.font] * 0.62), lineHeight: Math.round(FONT_SIZES[this.font] * 1.5),
        fontLabel: 'Text ' + FONT_SIZES[this.font],
        otOn: this.testament === 'OT', ntOn: this.testament === 'NT',
        otVis: this.testament === 'OT' ? SHOW : HIDE, ntVis: this.testament === 'NT' ? SHOW : HIDE,
        prevPageVis: HIDE, nextPageVis: HIDE,
        selVis: HIDE, selRef: '', selText: '', selMarked: false, selMarkLabel: 'Bookmark',
        searchVis: HIDE, searchTitle: '', searchEmptyVis: HIDE,
        marksEmptyVis: SHOW,
        vodRef: refLabel(vod.b, vod.c, vod.v), vodText: plainText(verseText(vod.b, vod.c, vod.v)), vodKey: refKey(vod.b, vod.c, vod.v),
        readerVis: HIDE, idleVis: SHOW, readerRef: '', readerBy: '', readerQueue: '', readerMine: false,
        followOn: this.follow, aiOn: false, aiNote: 'Connecting to the Reader...',
        toast: '', toastFlip: false, themeFlip: false, pageFlip: false,
        th0: this.theme === 0, th1: this.theme === 1, th2: this.theme === 2, th3: this.theme === 3, themeName: t.name,
      },
      booksOT: BOOKS.filter(x => x.testament === 'OT').map(x => ({ i: x.index, name: x.name, sel: x.index === this.b })),
      booksNT: BOOKS.filter(x => x.testament === 'NT').map(x => ({ i: x.index, name: x.name, sel: x.index === this.b })),
      chapters: [] as ChapterItem[],
      verses: [] as VerseItem[],
      results: [] as RefItem[],
      marks: [] as RefItem[],
      quick: QUICK.map(q => ({ label: q.replace('Psalms', 'Psalm').replace('1 Corinthians', '1 Cor'), q })),

      // ---- commands ----
      openBook: (p: unknown) => this.openChapter(Number(p), 1),
      openChapter: (p: unknown) => this.openChapter(this.b, Number(p)),
      prevChapter: () => this.stepChapter(-1),
      nextChapter: () => this.stepChapter(1),
      prevPage: () => this.showPage(this.page - 1),
      nextPage: () => this.showPage(this.page + 1),
      selectVerse: (p: unknown) => this.selectVerse(Number(p)),
      readVerse: () => this.requestRead(this.sel, this.sel),
      readFromHere: () => this.requestRead(this.sel, verseCount(this.b, this.c)),
      readChapter: () => this.requestRead(1, verseCount(this.b, this.c)),
      readPage: () => { const p = this.pages[this.page]; if (p) this.requestRead(p[0], p[p.length - 1]); },
      explain: () => this.requestExplain(),
      stopReading: () => this.props.readerNpc && this.me && this.sendNetworkEvent(this.props.readerNpc, BibleEvents.stop, { player: this.me }),
      toggleFollow: () => this.setFollow(!this.follow),
      toggleBookmark: () => this.toggleBookmark(),
      openKey: (p: unknown) => this.openKey(String(p)),
      removeMark: (p: unknown) => this.removeBookmark(String(p)),
      doSearch: (p: unknown) => this.doSearch(String(p ?? '')),
      closeSearch: () => { this.ctx.ui.searchVis = HIDE; },
      quickGo: (p: unknown) => this.doSearch(String(p)),
      setTheme: (p: unknown) => this.setTheme(Number(p)),
      fontDown: () => this.setFont(this.font - 1),
      fontUp: () => this.setFont(this.font + 1),
      showOT: () => this.setTestament('OT'),
      showNT: () => this.setTestament('NT'),
    };
    const gizmo = this.entity.as(NoesisGizmo);
    gizmo.dataContext = model;
    this.ctx = (gizmo.dataContext as any) ?? model;
  }

  // -------------------------------------------------------------------------------------------
  // Navigation and pagination
  // -------------------------------------------------------------------------------------------

  private openChapter(b: number, c: number, focusVerse = 0) {
    if (!BOOKS[b]) return;
    c = clampInt(c, 1, chapterCount(b));
    const bookChanged = b !== this.b || !this.ctx.chapters.length;
    this.b = b;
    this.c = c;
    const book = BOOKS[b];
    if (book.testament !== this.testament) this.setTestament(book.testament);
    for (const list of [this.ctx.booksOT, this.ctx.booksNT] as BookItem[][]) for (const it of list) it.sel = it.i === b;
    if (bookChanged) {
      this.ctx.chapters = book.chapters.map((_v, i) => ({ n: i + 1, sel: i + 1 === c }));
    } else {
      for (const it of this.ctx.chapters as ChapterItem[]) it.sel = it.n === c;
    }
    this.ctx.ui.bookTitle = book.name === 'Psalms' ? 'Psalms' : book.name;
    this.ctx.ui.chapterTitle = (book.name === 'Psalms' ? 'Psalm ' : 'Chapter ') + c;
    this.paginate();
    const target = focusVerse > 0 ? this.pageOf(focusVerse) : 0;
    this.sel = 0;
    this.ctx.ui.selVis = HIDE;
    this.showPage(target);
    if (focusVerse > 0) this.selectVerse(focusVerse);
  }

  private stepChapter(dir: number) {
    let b = this.b, c = this.c + dir;
    if (c < 1) { b = (b + BOOKS.length - 1) % BOOKS.length; c = chapterCount(b); }
    if (c > chapterCount(b)) { b = (b + 1) % BOOKS.length; c = 1; }
    this.openChapter(b, c);
  }

  // Fill pages by an estimated character budget so a page fits without scrolling.
  private paginate() {
    const fs = FONT_SIZES[this.font];
    const perLine = this.props.pageWidth / (fs * this.props.charWidth);
    const lines = this.props.pageHeight / (fs * 1.5);
    const budget = perLine * lines * 0.98;
    const n = verseCount(this.b, this.c);
    this.pages = [];
    let cur: number[] = [], used = 0;
    for (let v = 1; v <= n; v++) {
      const text = verseText(this.b, this.c, v);
      const cost = (Math.ceil(text.length / perLine) + 0.35) * perLine + (heading(this.b, this.c, v) ? perLine * 1.3 : 0);
      if (cur.length && used + cost > budget) {
        this.pages.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(v);
      used += cost;
    }
    if (cur.length) this.pages.push(cur);
  }

  private pageOf(v: number): number {
    const i = this.pages.findIndex(p => p.includes(v));
    return i < 0 ? 0 : i;
  }

  private showPage(i: number) {
    if (!this.pages.length) return;
    i = clampInt(i, 0, this.pages.length - 1);
    const changed = i !== this.page;
    this.page = i;
    const playing = this.reader.state === 'reading' && this.reader.b === this.b && this.reader.c === this.c ? this.reader.v : 0;
    this.ctx.verses = this.pages[i].map(v => {
      const head = heading(this.b, this.c, v);
      return { n: v, t: verseText(this.b, this.c, v), head, headVis: head ? SHOW : HIDE, sel: v === this.sel, play: v === playing } as VerseItem;
    });
    const p = this.pages[i];
    this.ctx.ui.pageLabel = this.pages.length > 1
      ? `Verses ${p[0]}-${p[p.length - 1]} of ${verseCount(this.b, this.c)}  ·  page ${i + 1}/${this.pages.length}`
      : `${verseCount(this.b, this.c)} verses`;
    this.ctx.ui.prevPageVis = i > 0 ? SHOW : HIDE;
    this.ctx.ui.nextPageVis = i < this.pages.length - 1 ? SHOW : HIDE;
    if (changed) this.ctx.ui.pageFlip = !this.ctx.ui.pageFlip;
  }

  private selectVerse(v: number) {
    if (!verseText(this.b, this.c, v)) return;
    this.sel = v;
    for (const it of this.ctx.verses as VerseItem[]) it.sel = it.n === v;
    const key = refKey(this.b, this.c, v);
    const ui = this.ctx.ui;
    ui.selVis = SHOW;
    ui.selRef = refLabel(this.b, this.c, v);
    ui.selText = plainText(verseText(this.b, this.c, v));
    ui.selMarked = this.bookmarks.includes(key);
    ui.selMarkLabel = ui.selMarked ? 'Bookmarked' : 'Bookmark';
    if (this.props.readerNpc && this.me) {
      this.sendNetworkEvent(this.props.readerNpc, BibleEvents.focus, { player: this.me, b: this.b, c: this.c, v });
    }
  }

  private openKey(key: string) {
    const k = parseKey(key);
    if (!k) return;
    this.ctx.ui.searchVis = HIDE;
    this.openChapter(k.b, k.c, k.v);
  }

  // -------------------------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------------------------

  private doSearch(text: string) {
    const q = text.trim();
    if (!q) return;
    const ref = parseReference(q);
    if (ref) {
      this.ctx.ui.searchVis = HIDE;
      this.openChapter(ref.b, ref.c, ref.v);
      this.toast(refLabel(ref.b, ref.c, ref.v, ref.v2));
      return;
    }
    const { hits, total } = search(q, 40);
    this.ctx.results = hits.map(h => ({ key: refKey(h.b, h.c, h.v), ref: refLabel(h.b, h.c, h.v), t: h.text }));
    this.ctx.ui.searchTitle = total
      ? `"${q}": ${total} verse${total === 1 ? '' : 's'}${total > hits.length ? ` (first ${hits.length} shown)` : ''}`
      : `No verses contain "${q}"`;
    this.ctx.ui.searchEmptyVis = total ? HIDE : SHOW;
    this.ctx.ui.searchVis = SHOW;
  }

  // -------------------------------------------------------------------------------------------
  // Bookmarks
  // -------------------------------------------------------------------------------------------

  private toggleBookmark() {
    if (!this.sel) return;
    const key = refKey(this.b, this.c, this.sel);
    const i = this.bookmarks.indexOf(key);
    if (i >= 0) this.bookmarks.splice(i, 1);
    else this.bookmarks.unshift(key);
    this.bookmarks = this.bookmarks.slice(0, 50);
    this.ctx.ui.selMarked = i < 0;
    this.ctx.ui.selMarkLabel = i < 0 ? 'Bookmarked' : 'Bookmark';
    this.refreshBookmarks();
    this.saveBookmarks();
    this.toast(i < 0 ? 'Bookmarked ' + refLabel(this.b, this.c, this.sel) : 'Bookmark removed');
  }

  private removeBookmark(key: string) {
    this.bookmarks = this.bookmarks.filter(k => k !== key);
    if (this.sel && refKey(this.b, this.c, this.sel) === key) {
      this.ctx.ui.selMarked = false;
      this.ctx.ui.selMarkLabel = 'Bookmark';
    }
    this.refreshBookmarks();
    this.saveBookmarks();
  }

  private refreshBookmarks() {
    this.ctx.marks = this.bookmarks.map(key => {
      const k = parseKey(key)!;
      return { key, ref: refLabel(k.b, k.c, k.v), t: plainText(verseText(k.b, k.c, k.v)) };
    });
    this.ctx.ui.marksEmptyVis = this.bookmarks.length ? HIDE : SHOW;
  }

  private saveBookmarks() {
    if (this.props.readerNpc && this.me) {
      this.sendNetworkEvent(this.props.readerNpc, BibleEvents.saveBookmarks, { player: this.me, keys: this.bookmarks });
    }
  }

  // -------------------------------------------------------------------------------------------
  // The shared Reader
  // -------------------------------------------------------------------------------------------

  private requestRead(from: number, to: number) {
    if (!this.props.readerNpc || !this.me) {
      this.toast('No Reader linked to this panel');
      return;
    }
    if (from < 1) {
      this.toast('Tap a verse first');
      return;
    }
    this.sendNetworkEvent(this.props.readerNpc, BibleEvents.read, { player: this.me, b: this.b, c: this.c, from, to });
    this.setFollow(true);
    this.toast('Reader: ' + refLabel(this.b, this.c, from, to === from ? 0 : to));
  }

  private requestExplain() {
    if (!this.props.readerNpc || !this.me || !this.sel) return;
    this.sendNetworkEvent(this.props.readerNpc, BibleEvents.explain, { player: this.me, b: this.b, c: this.c, v: this.sel });
    this.setFollow(true);
    this.toast(this.reader.ai ? 'Asked the Reader to explain ' + refLabel(this.b, this.c, this.sel) : 'Reading the verse aloud');
  }

  private setFollow(on: boolean) {
    this.follow = on;
    this.ctx.ui.followOn = on;
    if (on && this.reader.state === 'reading') this.followReader();
  }

  private onReaderState(s: ReaderState) {
    const prev = this.reader;
    this.reader = s;
    const ui = this.ctx.ui;
    ui.aiOn = s.ai;
    ui.aiNote = s.aiNote || ui.aiNote;
    const reading = s.state === 'reading';
    ui.readerVis = reading ? SHOW : HIDE;
    ui.idleVis = reading ? HIDE : SHOW;
    if (reading) {
      ui.readerRef = s.v ? refLabel(s.b, s.c, s.v) : refLabel(s.b, s.c, s.from, s.to === s.from ? 0 : s.to);
      ui.readerBy = 'requested by ' + s.requester;
      ui.readerQueue = s.queue ? `${s.queue} waiting` : '';
      ui.readerMine = !!this.me && s.requesterId === this.me.id;
    }
    if (this.follow && reading) this.followReader();
    else this.markPlaying();
    if (prev.state === 'reading' && !reading && this.follow) this.setFollow(false);
  }

  private followReader() {
    const s = this.reader;
    if (!BOOKS[s.b]) return;
    if (s.b !== this.b || s.c !== this.c) this.openChapter(s.b, s.c, 0);
    if (s.v) {
      const target = this.pageOf(s.v);
      if (target !== this.page) this.showPage(target);
    }
    this.markPlaying();
  }

  private markPlaying() {
    const s = this.reader;
    const playing = s.state === 'reading' && s.b === this.b && s.c === this.c ? s.v : 0;
    for (const it of this.ctx.verses as VerseItem[]) it.play = it.n === playing;
  }

  // -------------------------------------------------------------------------------------------
  // Look and feel
  // -------------------------------------------------------------------------------------------

  private setTheme(i: number) {
    this.theme = clampInt(i, 0, THEMES.length - 1);
    Object.assign(this.ctx.theme, THEMES[this.theme]);
    for (let k = 0; k < THEMES.length; k++) this.ctx.ui['th' + k] = k === this.theme;
    this.ctx.ui.themeName = THEMES[this.theme].name;
    this.ctx.ui.themeFlip = !this.ctx.ui.themeFlip;
  }

  private setFont(i: number) {
    this.font = clampInt(i, 0, FONT_SIZES.length - 1);
    const fs = FONT_SIZES[this.font];
    this.ctx.ui.fontSize = fs;
    this.ctx.ui.numSize = Math.round(fs * 0.62);
    this.ctx.ui.lineHeight = Math.round(fs * 1.5);
    this.ctx.ui.fontLabel = 'Text ' + fs;
    const keep = this.sel || this.pages[this.page]?.[0] || 1;
    this.paginate();
    this.showPage(this.pageOf(keep));
  }

  private setTestament(t: 'OT' | 'NT') {
    this.testament = t;
    const ui = this.ctx.ui;
    ui.otOn = t === 'OT';
    ui.ntOn = t === 'NT';
    ui.otVis = t === 'OT' ? SHOW : HIDE;
    ui.ntVis = t === 'NT' ? SHOW : HIDE;
  }

  private toast(text: string) {
    this.ctx.ui.toast = text;
    this.ctx.ui.toastFlip = !this.ctx.ui.toastFlip;
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  v = Math.round(Number(v));
  if (isNaN(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

hz.Component.register(BibleReaderUI);
