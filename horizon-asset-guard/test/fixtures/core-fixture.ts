// core-fixture.ts
// A small stand-in for runtime/GuardCore.ts used by test/cli.test.mjs, so the CLI build
// tests do not depend on the real core (owned by another engineer and still moving). It has
// the two marker lines, a few g_* declarations of every kind the mangler must rename
// (interface, const, function), a regex literal and comments to exercise the comment
// stripper, and a trivial g_unlock with the contract signature. Never shipped.
import { sha256 } from 'Sha256';
import { utf8ToBytes } from 'Bytes';

// @hag-core-begin
// The shape g_tag returns; renamed per buyer like every other g_ name.
interface g_Shape {
  ok: boolean;
  tag: string;
}

const g_PREFIX = 'HAGD1.'; /* block comment with g_PREFIX inside */
const g_PARSED = 'g_parse is not g_parsed'; // a string mentioning g_ names stays a string

// Strips whitespace (the /\s+/g literal must survive comment stripping) and checks the prefix.
function g_tag(blob: string): g_Shape {
  const s = blob.replace(/\s+/g, '');
  return { ok: s.slice(0, 6) === g_PREFIX, tag: s.slice(0, 6) + g_PARSED.slice(0, 0) };
}

// Trivial unlock: every argument must be present; returns a hash so callers get bytes.
function g_unlock(blob: string, raw: string, pubN: string, pubE: number, sku: string, world: any): number[] | null {
  const t = g_tag(blob);
  if (!t.ok || raw.length === 0 || pubN.length === 0 || pubE < 3 || sku.length === 0 || world === undefined) return null;
  return sha256(utf8ToBytes(sku + t.tag));
}
// @hag-core-end

export function unlock(blob: string, raw: string, pubN: string, pubE: number, sku: string, world: any): number[] | null {
  return g_unlock(blob, raw, pubN, pubE, sku, world);
}
