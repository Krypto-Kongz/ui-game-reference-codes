// Sha256.ts
// SHA-256 (FIPS 180-4) over plain number[] byte arrays, for Meta Horizon Worlds scripts.
// No typed arrays, no bigint, no Math.imul (SHA-256 only adds, rotates and xors, so 32-bit
// results are produced with `| 0` and read back unsigned with `>>> 0`). Written for
// TypeScript 4.7 / ES2020. The hot loop is tuned for a no-JIT interpreter: one block at a
// time, straight from the input array, with one preallocated message schedule.

// First 32 bits of the fractional parts of the cube roots of the first 64 primes.
const K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

// Scratch space reused across calls (verification is single-threaded).
const W: number[] = new Array(64);
for (let i = 0; i < 64; i++) W[i] = 0;

// Compress one 64-byte block of `src` starting at `off` into the eight-word state `h`.
function sha256Block(h: number[], src: number[], off: number): void {
  for (let i = 0; i < 16; i++) {
    const p = off + (i << 2);
    W[i] = (src[p] << 24) | (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3];
  }
  for (let i = 16; i < 64; i++) {
    const x = W[i - 15];
    const y = W[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = h[0];
  let b = h[1];
  let c = h[2];
  let d = h[3];
  let e = h[4];
  let f = h[5];
  let g = h[6];
  let hh = h[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0;
  h[1] = (h[1] + b) | 0;
  h[2] = (h[2] + c) | 0;
  h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0;
  h[5] = (h[5] + f) | 0;
  h[6] = (h[6] + g) | 0;
  h[7] = (h[7] + hh) | 0;
}

// Returns the 32-byte digest of `data` (an array of integers 0..255) as a number[].
export function sha256(data: number[]): number[] {
  const h: number[] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const n = data.length;
  const full = n - (n % 64);
  for (let off = 0; off < full; off += 64) sha256Block(h, data, off);

  // Tail: remaining bytes, 0x80, zero padding, then the 64-bit big-endian bit length.
  const rest = n - full;
  const tailLen = rest < 56 ? 64 : 128;
  const tail: number[] = new Array(tailLen);
  let i = 0;
  for (; i < rest; i++) tail[i] = data[full + i];
  tail[i++] = 0x80;
  for (; i < tailLen - 8; i++) tail[i] = 0;
  // Bit length as two 32-bit halves; n < 2^53 so Math.floor keeps the split exact.
  const bitsLo = (n << 3) >>> 0; // low 32 bits of n*8 (n << 3 wraps exactly like n*8 mod 2^32)
  const bitsHi = Math.floor(n / 0x20000000); // n*8 / 2^32 == n / 2^29
  tail[tailLen - 8] = (bitsHi >>> 24) & 255;
  tail[tailLen - 7] = (bitsHi >>> 16) & 255;
  tail[tailLen - 6] = (bitsHi >>> 8) & 255;
  tail[tailLen - 5] = bitsHi & 255;
  tail[tailLen - 4] = (bitsLo >>> 24) & 255;
  tail[tailLen - 3] = (bitsLo >>> 16) & 255;
  tail[tailLen - 2] = (bitsLo >>> 8) & 255;
  tail[tailLen - 1] = bitsLo & 255;
  for (let off = 0; off < tailLen; off += 64) sha256Block(h, tail, off);

  const out: number[] = new Array(32);
  for (let j = 0; j < 8; j++) {
    const w = h[j];
    out[j * 4] = (w >>> 24) & 255;
    out[j * 4 + 1] = (w >>> 16) & 255;
    out[j * 4 + 2] = (w >>> 8) & 255;
    out[j * 4 + 3] = w & 255;
  }
  return out;
}
