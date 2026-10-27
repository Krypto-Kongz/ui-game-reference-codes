// mangle.mjs
// The generated GuardData_<name>.ts module (contract section 7): the GuardCore.ts region
// between `// @hag-core-begin` and `// @hag-core-end`, copied into the module with every
// `g_*` identifier renamed per buyer and table, next to the encrypted blob and the
// Guard.register(...) call. Each data module therefore re-verifies the license and
// re-derives the key on its own; there is no single boolean to patch, and the name set is
// a code-domain watermark `hag trace` matches against the ledger.
//
// Mangled name = '_' + 6 lowercase base32 chars (RFC 4648 alphabet a-z2-7) from the first
// 30 bits of SHA256(utf8(wm) | utf8(table name) | utf8(original identifier)); on the rare
// collision inside one file the next 5 bits are appended until the name is unique. The
// rename is a word-boundary regex over the region, so a prefix like `g_parse` can never
// bleed into `g_parsed`.
import { HagError } from './common.mjs';
import { sha256, utf8 } from './formats.mjs';

export const BEGIN_MARK = '// @hag-core-begin';
export const END_MARK = '// @hag-core-end';
export const B32_LOWER = 'abcdefghijklmnopqrstuvwxyz234567';
export const G_IDENT_RE = /\bg_[A-Za-z0-9_]+\b/g;
export const MANGLED_RE = /\b_[a-z2-7]{6,9}\b/g;

// Contract section 7 import block, verbatim: every generated module carries all of it
// even when the region does not use every name (the core test compiles the region with
// unused locals allowed for exactly this reason).
export const SECTION7_IMPORTS =
  "import { Guard } from 'Guard';\n" +
  "import { PUB_N, PUB_E, SKU } from 'GuardKey';\n" +
  "import { sha256 } from 'Sha256';\n" +
  "import { chacha20 } from 'ChaCha20';\n" +
  "import { rsaVerifyPkcs1Sha256, rsaPublicKeyFromBase64Url } from 'Rsa';\n" +
  "import { utf8ToBytes, base64UrlToBytes, bytesToBase64Url, concatBytes, bytesEqual } from 'Bytes';\n";

// The text between the marker lines, or a loud failure naming the file and the fix: the
// build cannot produce a guarded module without the core, and a silent empty region would
// ship modules that never unlock anything.
export function extractRegion(coreText, corePath) {
  const begin = /^[ \t]*\/\/ @hag-core-begin[ \t]*$/gm;
  const end = /^[ \t]*\/\/ @hag-core-end[ \t]*$/gm;
  const b = [...coreText.matchAll(begin)];
  const e = [...coreText.matchAll(end)];
  const where = corePath || 'runtime/GuardCore.ts';
  if (b.length !== 1 || e.length !== 1) {
    throw new HagError(
      'cannot inline the verify core: ' + where + ' must contain exactly one "' + BEGIN_MARK + '" line and one "' + END_MARK + '" line (found ' + b.length + ' and ' + e.length + '). ' +
        'The build copies the region between them into every GuardData_* module (contract sections 3 and 7); without the markers no buyer package can be produced.',
    );
  }
  if (e[0].index < b[0].index) throw new HagError('cannot inline the verify core: in ' + where + ' "' + END_MARK + '" comes before "' + BEGIN_MARK + '"');
  const region = coreText.slice(b[0].index + b[0][0].length, e[0].index);
  if (!/\bfunction\s+g_unlock\s*\(/.test(region)) throw new HagError('cannot inline the verify core: the region in ' + where + ' has no "function g_unlock(" (contract section 3)');
  return region;
}

// Region rules (contract section 3): no export / import / class / Horizon reference inside.
export function checkRegion(region, corePath) {
  const code = stripComments(region);
  const where = corePath || 'runtime/GuardCore.ts';
  if (/^\s*export\b/m.test(code)) throw new HagError('core region in ' + where + ' contains an export; the region must be self-contained (contract section 3)');
  if (/^\s*import\b/m.test(code)) throw new HagError('core region in ' + where + ' contains an import; imports belong outside the region (contract section 3)');
  if (/\bclass\b/.test(code)) throw new HagError('core region in ' + where + ' declares a class; only functions, consts and interfaces are allowed (contract section 3)');
  if (/horizon/i.test(code)) throw new HagError('core region in ' + where + ' references horizon; the region may not touch the Horizon API (contract section 3)');
  // Top-level declarations sit at column 0 (the region is module-level code); indented
  // ones are function locals and may be named freely.
  const decls = [...code.matchAll(/^(?:function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const bad = decls.filter((d) => !d.startsWith('g_'));
  if (bad.length > 0) throw new HagError('core region in ' + where + ' declares non-g_ names (' + bad.join(', ') + '); every top-level helper must be g_-prefixed (contract section 3)');
}

// Splits TypeScript source into code, comment, string (incl. template) and regex-literal
// segments, so renaming and comment stripping can treat each kind correctly: a `g_` word
// inside a string or a regex is data and must not change, while comments may go. A `/` is
// taken as a regex start only where a division cannot appear (after an operator, `(`, `,`,
// `[`, `{`, `;`, `:` or at the start), which covers the region's `.replace(/\s+/g, '')`.
export function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let code = '';
  let lastSignificant = '';
  const flushCode = () => {
    if (code !== '') tokens.push({ kind: 'code', text: code });
    code = '';
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      flushCode();
      tokens.push({ kind: 'comment', text: src.slice(start, i) });
      continue;
    }
    if (c === '/' && d === '*') {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      flushCode();
      tokens.push({ kind: 'comment', text: src.slice(start, i) });
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      i++;
      while (i < n && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i = Math.min(n, i + 1);
      flushCode();
      tokens.push({ kind: 'string', text: src.slice(start, i) });
      lastSignificant = c;
      continue;
    }
    if (c === '/' && /[(,=:[!&|?{};]|^$/.test(lastSignificant)) {
      const start = i;
      i++;
      let inClass = false;
      while (i < n && (inClass || src[i] !== '/') && src[i] !== '\n') {
        if (src[i] === '\\') i += 2;
        else {
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          i++;
        }
      }
      if (src[i] === '/') i++;
      while (i < n && /[a-z]/.test(src[i])) i++; // flags
      flushCode();
      tokens.push({ kind: 'regex', text: src.slice(start, i) });
      lastSignificant = '/';
      continue;
    }
    code += c;
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  flushCode();
  return tokens;
}

// Comment removal that leaves strings, template literals and regex literals alone. Line
// structure is kept (a comment becomes nothing, its newline stays) and runs of blank lines
// collapse to one. The generated module ships to the buyer, who also has GuardCore.ts, so
// nothing is hidden; the point is a smaller file and no original names in comments.
export function stripComments(src) {
  const out = tokenize(src)
    .filter((t) => t.kind !== 'comment')
    .map((t) => t.text)
    .join('');
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');
}

// Every distinct g_* identifier in the region's code (not in strings, regexes or comments),
// in order of first appearance.
export function collectNames(region) {
  const seen = new Set();
  const names = [];
  for (const t of tokenize(region)) {
    if (t.kind !== 'code') continue;
    for (const m of t.text.matchAll(G_IDENT_RE)) {
      if (!seen.has(m[0])) {
        seen.add(m[0]);
        names.push(m[0]);
      }
    }
  }
  return names;
}

// '_' + base32 chars of SHA256(wm | name | identifier): 6 chars (30 bits) normally, more
// only to resolve a collision inside the same file.
export function mangledName(wm, name, identifier, chars = 6) {
  const h = sha256(utf8(wm), utf8(name), utf8(identifier));
  let bits = 0;
  let acc = 0;
  let out = '_';
  let byte = 0;
  while (out.length < chars + 1) {
    while (bits < 5) {
      acc = (acc << 8) | h[byte % h.length];
      byte++;
      bits += 8;
    }
    bits -= 5;
    out += B32_LOWER[(acc >> bits) & 31];
    acc &= (1 << bits) - 1;
  }
  return out;
}

// The rename map for one module; `reserved` are names that already exist in the module
// text outside the region (the blob constant, imports) and must not be produced.
export function mangleMap(region, wm, name, reserved = []) {
  const taken = new Set(reserved);
  const map = new Map();
  for (const ident of collectNames(region)) {
    let chars = 6;
    let m = mangledName(wm, name, ident, chars);
    while (taken.has(m)) {
      chars++;
      if (chars > 9) throw new HagError('cannot find a unique mangled name for ' + ident);
      m = mangledName(wm, name, ident, chars);
    }
    taken.add(m);
    map.set(ident, m);
  }
  return map;
}

// Word-boundary rename over the region: every g_* identifier in code must be in the map;
// g_ words in comments are renamed when known (so a kept comment leaks no original name);
// string and regex literals are left exactly as written.
export function renameRegion(region, map) {
  const values = [...map.values()];
  if (new Set(values).size !== values.length) throw new HagError('internal: mangled names are not unique');
  const out = tokenize(region)
    .map((t) => {
      if (t.kind === 'code') {
        return t.text.replace(G_IDENT_RE, (m) => {
          const r = map.get(m);
          if (!r) throw new HagError('internal: no mangled name for ' + m);
          return r;
        });
      }
      if (t.kind === 'comment') return t.text.replace(G_IDENT_RE, (m) => map.get(m) || m);
      return t.text;
    })
    .join('');
  const left = tokenize(out).some((t) => t.kind === 'code' && G_IDENT_RE.test(t.text) && !(G_IDENT_RE.lastIndex = 0));
  if (left) throw new HagError('internal: g_ identifiers survived the rename');
  return out;
}

// The complete module text. `region` is already mangled; `map` supplies the unlock name.
export function renderModule({ name, blob, blobHash, region, map, blobConst }) {
  const unlock = map.get('g_unlock');
  if (!unlock) throw new HagError('internal: region has no g_unlock');
  return (
    '// GuardData_' + name + '.ts\n' +
    '// Generated by `hag build`: the encrypted "' + name + '" table of this build plus its own copy of the\n' +
    '// license check. Do not edit; a changed blob or core only yields trial data (Guard.data fallback).\n' +
    SECTION7_IMPORTS +
    'const ' + blobConst + " = '" + blob + "';\n" +
    '// ---- inlined GuardCore region ----\n' +
    region +
    (region.endsWith('\n') ? '' : '\n') +
    "Guard.register({ name: '" + name + "', blobHash: '" + blobHash + "', unlock: function (lic: string, world: any) { return " + unlock + '(' + blobConst + ', lic, PUB_N, PUB_E, SKU, world); } });\n'
  );
}
