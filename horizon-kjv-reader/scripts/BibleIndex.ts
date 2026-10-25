// BibleIndex.ts
// One place to look up the King James text: books, chapters, verses, references, search, and
// speech-friendly text. Imported by BibleReaderUI (each player's panel) and BibleReaderNpc (the
// shared reader). Attach to nothing.

import { BOOKS_01 } from 'BibleData01';
import { BOOKS_02 } from 'BibleData02';
import { BOOKS_03 } from 'BibleData03';
import { BOOKS_04 } from 'BibleData04';
import { BOOKS_05 } from 'BibleData05';
import { BOOKS_06 } from 'BibleData06';
import { BOOKS_07 } from 'BibleData07';
import { BOOKS_08 } from 'BibleData08';
import { BOOKS_09 } from 'BibleData09';
import { BOOKS_10 } from 'BibleData10';

export type Book = {
  index: number; // 0..65
  name: string;
  short: string;
  testament: 'OT' | 'NT';
  chapters: string[][];
  heads: { [cv: string]: string };
};

export type Ref = { b: number; c: number; v: number; v2: number }; // v2 >= v; v = 0 means whole chapter

const RAW = [
  ...BOOKS_01, ...BOOKS_02, ...BOOKS_03, ...BOOKS_04, ...BOOKS_05,
  ...BOOKS_06, ...BOOKS_07, ...BOOKS_08, ...BOOKS_09, ...BOOKS_10,
];

const SHORT: string[] = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1 Sam', '2 Sam', '1 Kgs', '2 Kgs',
  '1 Chr', '2 Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam',
  'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech',
  'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1 Cor', '2 Cor', 'Gal', 'Eph', 'Phil', 'Col',
  '1 Thess', '2 Thess', '1 Tim', '2 Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1 Pet', '2 Pet', '1 John',
  '2 John', '3 John', 'Jude', 'Rev',
];

export const BOOKS: Book[] = RAW.map((r, i) => ({
  index: i,
  name: r.n,
  short: SHORT[i],
  testament: i < 39 ? 'OT' : 'NT',
  chapters: r.c,
  heads: r.h,
}));

export const VERSE_COUNT = BOOKS.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.length, 0), 0);

export function chapterCount(b: number): number {
  return BOOKS[b]?.chapters.length ?? 0;
}

export function verseCount(b: number, c: number): number {
  return BOOKS[b]?.chapters[c - 1]?.length ?? 0;
}

// Raw verse text (may start with the paragraph mark), or '' if out of range.
export function verseText(b: number, c: number, v: number): string {
  return BOOKS[b]?.chapters[c - 1]?.[v - 1] ?? '';
}

export function plainText(text: string): string {
  return text.replace(/^¶\s*/, '');
}

export function heading(b: number, c: number, v: number): string {
  return BOOKS[b]?.heads[c + ':' + v] ?? '';
}

export function refLabel(b: number, c: number, v = 0, v2 = 0): string {
  const name = BOOKS[b]?.name ?? '?';
  if (!v) return `${name} ${c}`;
  return v2 && v2 !== v ? `${name} ${c}:${v}-${v2}` : `${name} ${c}:${v}`;
}

export function refKey(b: number, c: number, v: number): string {
  return `${b}:${c}:${v}`;
}

export function parseKey(key: string): { b: number; c: number; v: number } | null {
  const m = /^(\d+):(\d+):(\d+)$/.exec(String(key));
  if (!m) return null;
  const b = +m[1], c = +m[2], v = +m[3];
  if (!BOOKS[b] || c < 1 || c > chapterCount(b) || v < 0 || v > verseCount(b, c)) return null;
  return { b, c, v };
}

// ---------------------------------------------------------------------------------------------
// Reference parsing: "John 3:16", "jn 3 16", "1 Cor 13", "I Samuel 17:4-11", "Psalm 23", "song 2"
// ---------------------------------------------------------------------------------------------

const EXTRA_ALIASES: { [alias: string]: string } = {
  gn: 'Genesis', ge: 'Genesis', ex: 'Exodus', exo: 'Exodus', lv: 'Leviticus', nm: 'Numbers', nu: 'Numbers',
  dt: 'Deuteronomy', deu: 'Deuteronomy', jos: 'Joshua', jdg: 'Judges', jg: 'Judges', ru: 'Ruth', rth: 'Ruth',
  ne: 'Nehemiah', es: 'Esther', est: 'Esther', jb: 'Job', psalm: 'Psalms', psa: 'Psalms', pss: 'Psalms',
  pr: 'Proverbs', prv: 'Proverbs', ec: 'Ecclesiastes', ecc: 'Ecclesiastes', qoh: 'Ecclesiastes',
  sos: 'Song of Solomon', songofsongs: 'Song of Solomon', canticles: 'Song of Solomon', so: 'Song of Solomon',
  is: 'Isaiah', jr: 'Jeremiah', la: 'Lamentations', eze: 'Ezekiel', ezk: 'Ezekiel', dn: 'Daniel', ho: 'Hosea',
  jl: 'Joel', am: 'Amos', ob: 'Obadiah', jon: 'Jonah', jnh: 'Jonah', mc: 'Micah', na: 'Nahum', hb: 'Habakkuk',
  zep: 'Zephaniah', hg: 'Haggai', zec: 'Zechariah', ml: 'Malachi', mt: 'Matthew', mat: 'Matthew',
  mk: 'Mark', mr: 'Mark', mrk: 'Mark', lk: 'Luke', luk: 'Luke', jn: 'John', jhn: 'John', joh: 'John',
  ac: 'Acts', act: 'Acts', ro: 'Romans', rm: 'Romans', ga: 'Galatians', eph: 'Ephesians', php: 'Philippians',
  pp: 'Philippians', co: 'Colossians', ti: 'Titus', tit: 'Titus', phm: 'Philemon', philem: 'Philemon',
  he: 'Hebrews', jm: 'James', jas: 'James', jud: 'Jude', jd: 'Jude', re: 'Revelation', rv: 'Revelation',
  revelations: 'Revelation', apocalypse: 'Revelation',
};

const ALIASES: [string, number][] = (() => {
  const map = new Map<string, number>();
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  BOOKS.forEach((b, i) => {
    map.set(squash(b.name), i);
    map.set(squash(b.short), i);
  });
  const byName = new Map(BOOKS.map(b => [b.name, b.index] as [string, number]));
  for (const [alias, name] of Object.entries(EXTRA_ALIASES)) map.set(alias, byName.get(name)!);
  // numbered books: "1jn", "1john", "1 jo" ...
  const numbered: [string, string[]][] = [
    ['Samuel', ['sa', 'sm', 'sam']], ['Kings', ['ki', 'kg', 'kgs']], ['Chronicles', ['ch', 'chr', 'chron']],
    ['Corinthians', ['co', 'cor']], ['Thessalonians', ['th', 'thes', 'thess']], ['Timothy', ['ti', 'tm', 'tim']],
    ['Peter', ['pe', 'pt', 'pet']], ['John', ['jn', 'jo', 'jhn', 'joh']],
  ];
  for (const [base, abbrs] of numbered) {
    for (const n of ['1', '2', '3']) {
      const idx = byName.get(`${n} ${base}`);
      if (idx === undefined) continue;
      for (const a of abbrs) map.set(n + a, idx);
    }
  }
  // longest aliases first so "1 john" wins over "1 j..." style partial matches
  return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
})();

export function parseReference(input: string): Ref | null {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s
    .replace(/^(first|1st|i)\s+/, '1 ')
    .replace(/^(second|2nd|ii)\s+/, '2 ')
    .replace(/^(third|3rd|iii)\s+/, '3 ')
    .replace(/[.]/g, ' ')
    .replace(/\s+/g, ' ');
  const m = /^(\d?\s?[a-z][a-z\s']*?)\s*(\d+)?(?:\s*[:\s]\s*(\d+))?(?:\s*-\s*(\d+))?\s*$/.exec(s);
  if (!m) return null;
  const bookPart = m[1].replace(/[^a-z0-9]/g, '');
  let b = -1;
  for (const [alias, idx] of ALIASES) {
    if (bookPart === alias) { b = idx; break; }
  }
  if (b < 0) {
    // unique prefix of a full book name ("rev", "phili")
    const hits = BOOKS.filter(x => x.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(bookPart));
    if (hits.length === 1 && bookPart.length >= 3) b = hits[0].index;
  }
  if (b < 0) return null;
  const c = m[2] ? +m[2] : 1;
  if (c < 1 || c > chapterCount(b)) return null;
  const v = m[3] ? +m[3] : 0;
  const v2 = m[4] ? +m[4] : v;
  if (v < 0 || v > verseCount(b, c) || v2 < v || v2 > verseCount(b, c)) return null;
  return { b, c, v, v2 };
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

export type Hit = { b: number; c: number; v: number; text: string };

export function search(query: string, limit = 40): { hits: Hit[]; total: number } {
  const q = String(query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const hits: Hit[] = [];
  let total = 0;
  if (q.length < 2) return { hits, total };
  for (const book of BOOKS) {
    for (let c = 0; c < book.chapters.length; c++) {
      const ch = book.chapters[c];
      for (let v = 0; v < ch.length; v++) {
        if (ch[v].toLowerCase().indexOf(q) >= 0) {
          total++;
          if (hits.length < limit) hits.push({ b: book.index, c: c + 1, v: v + 1, text: plainText(ch[v]) });
        }
      }
    }
  }
  return { hits, total };
}

// ---------------------------------------------------------------------------------------------
// Speech helpers (the text shown is never altered; only what the reader says)
// ---------------------------------------------------------------------------------------------

const ORDINAL: { [n: string]: string } = { '1': 'First', '2': 'Second', '3': 'Third' };

export function spokenBookName(name: string): string {
  return name.replace(/^([123]) /, (_m, n: string) => ORDINAL[n] + ' ');
}

export function spokenRef(b: number, c: number, v = 0, v2 = 0): string {
  const name = spokenBookName(BOOKS[b]?.name ?? '');
  if (BOOKS[b]?.name === 'Psalms') {
    const head = `Psalm ${c}`;
    return v ? `${head}, verse ${v}${v2 && v2 !== v ? ` through ${v2}` : ''}` : head;
  }
  if (!v) return `${name}, chapter ${c}`;
  return `${name}, chapter ${c}, verse ${v}${v2 && v2 !== v ? ` through ${v2}` : ''}`;
}

export function speechText(text: string): string {
  return plainText(text)
    .replace(/\bLORD'S\b/g, "Lord's")
    .replace(/\bLORD\b/g, 'Lord')
    .replace(/\bGOD\b/g, 'God')
    .replace(/\bJEHOVAH\b/g, 'Jehovah')
    .replace(/\bJAH\b/g, 'Jah')
    .replace(/\s+/g, ' ')
    .trim();
}

// Roughly how long text-to-speech takes for a passage (used only as a timing fallback).
export function speechSeconds(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return 0.6 + words / 2.55;
}

// ---------------------------------------------------------------------------------------------
// Verse of the day: a fixed list of well-known verses, chosen by date
// ---------------------------------------------------------------------------------------------

const DAILY = [
  'John 3:16', 'Psalms 23:1', 'Proverbs 3:5', 'Isaiah 40:31', 'Philippians 4:13', 'Romans 8:28', 'Jeremiah 29:11',
  'Joshua 1:9', 'Matthew 11:28', 'Psalms 46:1', '2 Timothy 1:7', 'Romans 12:2', 'Hebrews 11:1', 'Psalms 119:105',
  'Galatians 5:22', 'Micah 6:8', 'Lamentations 3:22', 'Matthew 5:9', 'John 14:6', '1 Corinthians 13:4', 'Psalms 27:1',
  'Isaiah 41:10', 'Ephesians 2:8', 'Matthew 6:33', 'James 1:5', 'Psalms 37:4', 'Romans 5:8', 'Proverbs 18:10',
  'John 1:1', 'Genesis 1:1', 'Psalms 91:1', '1 John 4:19', 'Colossians 3:23', 'Psalms 139:14', 'Ecclesiastes 3:1',
  'Matthew 5:14', 'John 8:32', 'Romans 15:13', 'Psalms 121:1', 'Isaiah 26:3', 'Deuteronomy 31:6', 'Nahum 1:7',
  '2 Corinthians 5:17', 'Hebrews 13:8', 'Revelation 21:4', 'Psalms 34:8', 'Zephaniah 3:17', 'John 16:33',
];

export function verseOfDay(date: Date): { b: number; c: number; v: number } {
  const day = Math.floor(date.getTime() / 86400000);
  const r = parseReference(DAILY[((day % DAILY.length) + DAILY.length) % DAILY.length])!;
  return { b: r.b, c: r.c, v: r.v };
}
