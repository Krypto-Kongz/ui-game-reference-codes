// BigNum.ts
// Minimal unsigned big-number arithmetic for RSA signature verification in Meta Horizon
// Worlds scripts: big-endian bytes <-> limbs, comparison, and modular exponentiation with
// a small public exponent. No BigInt, no typed arrays, no Math.imul, TypeScript 4.7 / ES2020.
//
// Representation: little-endian number[] of 25-bit limbs. With 25-bit limbs the merged
// Montgomery step `t + a*b + m*n + carry` stays below 2^53 (two products under 2^50 each),
// so plain double arithmetic is exact, and one carry split per limb suffices: the carry is
// `(v * 2^-25) | 0` (scaling by a power of two is exact, ToInt32 truncates) and the low
// limb is `v - carry * 2^25`. Measured in a no-JIT interpreter this beats 26-bit limbs with
// two splits per step by about a third. `& LIMB_MASK` is used only where the value is
// known to be below 2^53 (ToInt32 keeps the low 32 bits of any such integer).
//
// modPow uses Montgomery multiplication (CIOS, with the multiply and reduce loops merged)
// for the square-and-multiply loop and a single Knuth algorithm D remainder to bring the
// base into Montgomery form, so no precomputed constants are needed for the key. The
// modulus must be odd (true of RSA).

const LIMB_BITS = 25;
const LIMB_BASE = 0x2000000; // 2^25
const LIMB_MASK = 0x1ffffff;
const LIMB_INV = 1 / 0x2000000; // 2^-25, exact

// 2^k for k = 0..25, used instead of `<<` where a shift could exceed 32 bits.
const POW2: number[] = [];
for (let k = 0, p = 1; k <= LIMB_BITS; k++, p *= 2) POW2.push(p);

// Big-endian bytes -> limbs (little-endian). `limbCount` pads with zero limbs (or trims
// zero limbs above it; the caller guarantees the value fits).
export function limbsFromBytes(bytes: number[], limbCount: number): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = bytes.length - 1; i >= 0; i--) {
    acc += bytes[i] * POW2[bits];
    bits += 8;
    if (bits >= LIMB_BITS) {
      out.push(acc & LIMB_MASK);
      acc = Math.floor(acc / LIMB_BASE);
      bits -= LIMB_BITS;
    }
  }
  out.push(acc);
  while (out.length > limbCount) {
    if (out[out.length - 1] !== 0) throw new Error('limbsFromBytes: value does not fit');
    out.pop();
  }
  while (out.length < limbCount) out.push(0);
  return out;
}

// Limbs -> big-endian bytes of exactly `byteLength` bytes (zero padded; the caller
// guarantees the value fits).
export function limbsToBytes(limbs: number[], byteLength: number): number[] {
  const out: number[] = new Array(byteLength);
  let acc = 0;
  let bits = 0;
  let li = 0;
  for (let i = byteLength - 1; i >= 0; i--) {
    if (bits < 8) {
      acc += (li < limbs.length ? limbs[li] : 0) * POW2[bits];
      li++;
      bits += LIMB_BITS;
    }
    out[i] = acc & 255;
    acc = Math.floor(acc / 256);
    bits -= 8;
  }
  return out;
}

// Number of limbs needed to hold `byteLength` bytes.
export function limbCountForBytes(byteLength: number): number {
  return Math.floor((byteLength * 8 + LIMB_BITS - 1) / LIMB_BITS);
}

// Compares the low `len` limbs of a and b: -1, 0 or 1.
export function compareLimbs(a: number[], b: number[], len: number): number {
  for (let i = len - 1; i >= 0; i--) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

// Compares two big-endian byte arrays as unsigned integers (leading zeros ignored).
export function compareBytes(a: number[], b: number[]): number {
  let i = 0;
  let j = 0;
  while (i < a.length && a[i] === 0) i++;
  while (j < b.length && b[j] === 0) j++;
  const la = a.length - i;
  const lb = b.length - j;
  if (la !== lb) return la > lb ? 1 : -1;
  for (; i < a.length; i++, j++) {
    if (a[i] !== b[j]) return a[i] > b[j] ? 1 : -1;
  }
  return 0;
}

function limbBitLength(x: number): number {
  let n = 0;
  while (x > 0) {
    n++;
    x >>>= 1;
  }
  return n;
}

// a << s bits (0 <= s < 25) into a new array of `outLen` limbs (zero padded; the caller
// makes outLen large enough, i.e. a.length + 1 when the shift can overflow).
function shiftLeftBits(a: number[], s: number, outLen: number): number[] {
  const out: number[] = new Array(outLen);
  const mul = POW2[s];
  let carry = 0;
  for (let i = 0; i < outLen; i++) {
    const v = (i < a.length ? a[i] : 0) * mul + carry;
    out[i] = v & LIMB_MASK;
    carry = Math.floor(v / LIMB_BASE);
  }
  return out;
}

// a >> s bits (0 <= s < 25) in place, dropping bits shifted out of limb 0.
function shiftRightBitsInPlace(a: number[], s: number): void {
  if (s === 0) return;
  const div = POW2[s];
  const mul = POW2[LIMB_BITS - s];
  for (let i = 0; i < a.length; i++) {
    const hi = i + 1 < a.length ? a[i + 1] : 0;
    a[i] = (Math.floor(a[i] / div) + (hi * mul)) & LIMB_MASK;
  }
}

// a mod n for an arbitrary-length a and an L-limb n whose top limb is non-zero.
// Knuth, TAOCP vol. 2, algorithm D (remainder only), with the modulus normalised so its
// top limb has bit 25 set; then each trial quotient is at most one too large.
export function modReduce(a: number[], n: number[]): number[] {
  const L = n.length;
  let m = a.length;
  while (m > 0 && a[m - 1] === 0) m--;
  if (m < L || (m === L && compareLimbs(a, n, L) < 0)) {
    const r: number[] = new Array(L);
    for (let i = 0; i < L; i++) r[i] = i < m ? a[i] : 0;
    return r;
  }
  if (L === 1) {
    let rem = 0;
    for (let i = m - 1; i >= 0; i--) rem = (rem * LIMB_BASE + a[i]) % n[0];
    return [rem];
  }
  const s = LIMB_BITS - limbBitLength(n[L - 1]);
  const v = shiftLeftBits(n, s, L);
  const u = shiftLeftBits(a.slice(0, m), s, m + 1);
  const vTop = v[L - 1];
  const vNext = v[L - 2];
  for (let j = m - L; j >= 0; j--) {
    // Trial quotient from the top two limbs of the window u[j .. j+L].
    const num = u[j + L] * LIMB_BASE + u[j + L - 1];
    let qhat = Math.floor(num / vTop);
    if (qhat > LIMB_MASK) qhat = LIMB_MASK;
    let rhat = num - qhat * vTop;
    while (rhat < 0) {
      qhat--;
      rhat += vTop;
    }
    while (rhat < LIMB_BASE && qhat * vNext > rhat * LIMB_BASE + u[j + L - 2]) {
      qhat--;
      rhat += vTop;
    }
    // u[j .. j+L] -= qhat * v
    let borrow = 0;
    for (let i = 0; i < L; i++) {
      const t = u[j + i] - qhat * v[i] - borrow;
      const lo = t & LIMB_MASK;
      borrow = (lo - t) / LIMB_BASE;
      u[j + i] = lo;
    }
    const top = u[j + L] - borrow;
    u[j + L] = top & LIMB_MASK;
    if (top < 0) {
      // qhat was one too large: add v back once.
      let carry = 0;
      for (let i = 0; i < L; i++) {
        const t = u[j + i] + v[i] + carry;
        u[j + i] = t & LIMB_MASK;
        carry = Math.floor(t / LIMB_BASE);
      }
      u[j + L] = (u[j + L] + carry) & LIMB_MASK;
    }
  }
  const r = u.slice(0, L);
  shiftRightBitsInPlace(r, s);
  return r;
}

// -n0^-1 mod 2^25 for an odd limb n0 (Newton iteration, as in jsbn's invDigit).
function negInverseLimb(x: number): number {
  let y = x & 3;
  y = (y * (2 - (x & 0xf) * y)) & 0xf;
  y = (y * (2 - (x & 0xff) * y)) & 0xff;
  y = (y * (2 - (((x & 0xffff) * y) & 0xffff))) & 0xffff;
  y = (y * (2 - ((x * y) % LIMB_BASE))) % LIMB_BASE;
  return y > 0 ? LIMB_BASE - y : -y;
}

// Montgomery product a*b*2^(-25L) mod n (CIOS with the multiply and reduce passes merged
// into one loop per row). a, b < n; result < n in a new array. `t` is scratch of L+1 limbs.
// Bounds per inner step: t[j] < 2^25, a[j]*bi and m*n[j] < 2^50 each, c < 2^26+4, so every
// partial sum is an integer below 2^53 and exact in a double.
function montMul(a: number[], b: number[], n: number[], n0inv: number, L: number, t: number[]): number[] {
  for (let i = 0; i <= L; i++) t[i] = 0;
  const a0 = a[0];
  const n0 = n[0];
  for (let i = 0; i < L; i++) {
    const bi = b[i];
    let v = t[0] + a0 * bi;
    const lo = v - ((v * LIMB_INV) | 0) * LIMB_BASE;
    const m = (lo * n0inv) & LIMB_MASK; // makes t[0] + a0*bi + m*n0 divisible by 2^25
    let c = ((v + m * n0) * LIMB_INV) | 0;
    for (let j = 1; j < L; j++) {
      v = t[j] + a[j] * bi + m * n[j] + c;
      c = (v * LIMB_INV) | 0;
      t[j - 1] = v - c * LIMB_BASE;
    }
    v = t[L] + c;
    c = (v * LIMB_INV) | 0;
    t[L - 1] = v - c * LIMB_BASE;
    t[L] = c; // 0 or 1, since t stays below 2n
  }
  const out: number[] = new Array(L);
  if (t[L] !== 0 || compareLimbs(t, n, L) >= 0) {
    let borrow = 0;
    for (let i = 0; i < L; i++) {
      const d = t[i] - n[i] - borrow;
      out[i] = d & LIMB_MASK;
      borrow = d < 0 ? 1 : 0;
    }
  } else {
    for (let i = 0; i < L; i++) out[i] = t[i];
  }
  return out;
}

// base^exp mod modulus over big-endian byte arrays. `exp` is a non-negative safe integer
// (RSA public exponents such as 3, 17 or 65537); the modulus must be odd and non-zero.
// The result has modulus.length bytes, zero padded on the left.
export function modPow(base: number[], exp: number, modulus: number[]): number[] {
  if (exp < 0 || exp !== Math.floor(exp) || exp > 9007199254740991) throw new Error('modPow: bad exponent');
  let nLen = limbCountForBytes(modulus.length);
  const n = limbsFromBytes(modulus, nLen);
  while (nLen > 0 && n[nLen - 1] === 0) nLen--;
  if (nLen === 0) throw new Error('modPow: modulus is zero');
  if ((n[0] & 1) === 0) throw new Error('modPow: modulus must be odd');
  n.length = nLen;
  const L = nLen;

  // Base in Montgomery form: x * 2^(25L) mod n (also reduces a base >= n).
  const x = limbsFromBytes(base, limbCountForBytes(base.length));
  const shifted: number[] = new Array(L + x.length);
  for (let i = 0; i < L; i++) shifted[i] = 0;
  for (let i = 0; i < x.length; i++) shifted[L + i] = x[i];
  const xR = modReduce(shifted, n);

  if (exp === 0) return limbsToBytes(modReduce([1], n), modulus.length);

  const bits: number[] = [];
  for (let e = exp; e > 0; e = Math.floor(e / 2)) bits.push(e % 2);
  const n0inv = negInverseLimb(n[0]);
  const t: number[] = new Array(L + 1);
  let acc = xR.slice(0, L);
  for (let i = bits.length - 2; i >= 0; i--) {
    acc = montMul(acc, acc, n, n0inv, L, t);
    if (bits[i] === 1) acc = montMul(acc, xR, n, n0inv, L, t);
  }
  const one: number[] = new Array(L);
  for (let i = 0; i < L; i++) one[i] = 0;
  one[0] = 1;
  acc = montMul(acc, one, n, n0inv, L, t);
  return limbsToBytes(acc, modulus.length);
}
