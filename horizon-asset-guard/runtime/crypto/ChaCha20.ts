// ChaCha20.ts
// ChaCha20 stream cipher (RFC 8439 section 2.4: 256-bit key, 96-bit nonce, 32-bit block
// counter) over plain number[] byte arrays, for Meta Horizon Worlds scripts. This is the
// data cipher for the asset guard's GuardData_* blobs: it needs only 32-bit add, rotate and
// xor, so it runs on `| 0` / `>>> 0` arithmetic with no typed arrays, no bigint and no
// Math.imul, and in a no-JIT interpreter it is an order of magnitude cheaper per byte than
// a SHA-256 keystream. Encryption and decryption are the same operation (keystream XOR).
//
// The 20 rounds are written out on sixteen local variables instead of a state array: in a
// bytecode interpreter the array reads and writes of a loop-based quarter round cost more
// than the arithmetic itself. The block counter wraps modulo 2^32 (RFC 8439 leaves the
// overflow undefined and limits a message to 2^32 blocks; a blob here is a few KB).

const SIGMA0 = 0x61707865; // "expa"
const SIGMA1 = 0x3320646e; // "nd 3"
const SIGMA2 = 0x79622d32; // "2-by"
const SIGMA3 = 0x6b206574; // "te k"

// Little-endian 32-bit word at byte offset `i` (as a signed int32; every operation below
// works modulo 2^32 so the sign is irrelevant until the bytes are read back with `>>>`).
function le32(b: number[], i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
}

// Sixteen words of keystream for one block, reused across blocks of one call.
const BLOCK: number[] = new Array(16);
for (let i = 0; i < 16; i++) BLOCK[i] = 0;

// XORs `data` with the ChaCha20 keystream for (key, nonce) starting at block `counter` and
// returns the result as a new number[] of the same length (`data` is not modified). Throws
// on a key that is not 32 bytes, a nonce that is not 12 bytes or a counter that is not an
// integer in 0..2^32-1; callers that must never throw (GuardCore) wrap it in try/catch.
export function chacha20(key: number[], nonce: number[], counter: number, data: number[]): number[] {
  if (!Array.isArray(key) || key.length !== 32) throw new Error('chacha20: key must be 32 bytes');
  if (!Array.isArray(nonce) || nonce.length !== 12) throw new Error('chacha20: nonce must be 12 bytes');
  if (typeof counter !== 'number' || counter !== Math.floor(counter) || counter < 0 || counter > 0xffffffff) {
    throw new Error('chacha20: counter must be an integer in 0..2^32-1');
  }
  if (!Array.isArray(data)) throw new Error('chacha20: data must be a byte array');

  const k0 = le32(key, 0);
  const k1 = le32(key, 4);
  const k2 = le32(key, 8);
  const k3 = le32(key, 12);
  const k4 = le32(key, 16);
  const k5 = le32(key, 20);
  const k6 = le32(key, 24);
  const k7 = le32(key, 28);
  const n0 = le32(nonce, 0);
  const n1 = le32(nonce, 4);
  const n2 = le32(nonce, 8);

  const n = data.length;
  const out: number[] = new Array(n);
  let p = 0;
  for (let block = 0; p < n; block++) {
    // Block counter for this block, wrapped to 32 bits and expressed as an int32.
    const c = ((counter + block) % 4294967296) | 0;
    let x0 = SIGMA0;
    let x1 = SIGMA1;
    let x2 = SIGMA2;
    let x3 = SIGMA3;
    let x4 = k0;
    let x5 = k1;
    let x6 = k2;
    let x7 = k3;
    let x8 = k4;
    let x9 = k5;
    let x10 = k6;
    let x11 = k7;
    let x12 = c;
    let x13 = n0;
    let x14 = n1;
    let x15 = n2;

    // Ten double rounds: four column quarter rounds, then four diagonal quarter rounds.
    // Each quarter round is a += b; d ^= a; d <<<= 16; c += d; b ^= c; b <<<= 12;
    // a += b; d ^= a; d <<<= 8; c += d; b ^= c; b <<<= 7.
    for (let r = 0; r < 10; r++) {
      x0 = (x0 + x4) | 0; x12 ^= x0; x12 = (x12 << 16) | (x12 >>> 16);
      x8 = (x8 + x12) | 0; x4 ^= x8; x4 = (x4 << 12) | (x4 >>> 20);
      x0 = (x0 + x4) | 0; x12 ^= x0; x12 = (x12 << 8) | (x12 >>> 24);
      x8 = (x8 + x12) | 0; x4 ^= x8; x4 = (x4 << 7) | (x4 >>> 25);

      x1 = (x1 + x5) | 0; x13 ^= x1; x13 = (x13 << 16) | (x13 >>> 16);
      x9 = (x9 + x13) | 0; x5 ^= x9; x5 = (x5 << 12) | (x5 >>> 20);
      x1 = (x1 + x5) | 0; x13 ^= x1; x13 = (x13 << 8) | (x13 >>> 24);
      x9 = (x9 + x13) | 0; x5 ^= x9; x5 = (x5 << 7) | (x5 >>> 25);

      x2 = (x2 + x6) | 0; x14 ^= x2; x14 = (x14 << 16) | (x14 >>> 16);
      x10 = (x10 + x14) | 0; x6 ^= x10; x6 = (x6 << 12) | (x6 >>> 20);
      x2 = (x2 + x6) | 0; x14 ^= x2; x14 = (x14 << 8) | (x14 >>> 24);
      x10 = (x10 + x14) | 0; x6 ^= x10; x6 = (x6 << 7) | (x6 >>> 25);

      x3 = (x3 + x7) | 0; x15 ^= x3; x15 = (x15 << 16) | (x15 >>> 16);
      x11 = (x11 + x15) | 0; x7 ^= x11; x7 = (x7 << 12) | (x7 >>> 20);
      x3 = (x3 + x7) | 0; x15 ^= x3; x15 = (x15 << 8) | (x15 >>> 24);
      x11 = (x11 + x15) | 0; x7 ^= x11; x7 = (x7 << 7) | (x7 >>> 25);

      x0 = (x0 + x5) | 0; x15 ^= x0; x15 = (x15 << 16) | (x15 >>> 16);
      x10 = (x10 + x15) | 0; x5 ^= x10; x5 = (x5 << 12) | (x5 >>> 20);
      x0 = (x0 + x5) | 0; x15 ^= x0; x15 = (x15 << 8) | (x15 >>> 24);
      x10 = (x10 + x15) | 0; x5 ^= x10; x5 = (x5 << 7) | (x5 >>> 25);

      x1 = (x1 + x6) | 0; x12 ^= x1; x12 = (x12 << 16) | (x12 >>> 16);
      x11 = (x11 + x12) | 0; x6 ^= x11; x6 = (x6 << 12) | (x6 >>> 20);
      x1 = (x1 + x6) | 0; x12 ^= x1; x12 = (x12 << 8) | (x12 >>> 24);
      x11 = (x11 + x12) | 0; x6 ^= x11; x6 = (x6 << 7) | (x6 >>> 25);

      x2 = (x2 + x7) | 0; x13 ^= x2; x13 = (x13 << 16) | (x13 >>> 16);
      x8 = (x8 + x13) | 0; x7 ^= x8; x7 = (x7 << 12) | (x7 >>> 20);
      x2 = (x2 + x7) | 0; x13 ^= x2; x13 = (x13 << 8) | (x13 >>> 24);
      x8 = (x8 + x13) | 0; x7 ^= x8; x7 = (x7 << 7) | (x7 >>> 25);

      x3 = (x3 + x4) | 0; x14 ^= x3; x14 = (x14 << 16) | (x14 >>> 16);
      x9 = (x9 + x14) | 0; x4 ^= x9; x4 = (x4 << 12) | (x4 >>> 20);
      x3 = (x3 + x4) | 0; x14 ^= x3; x14 = (x14 << 8) | (x14 >>> 24);
      x9 = (x9 + x14) | 0; x4 ^= x9; x4 = (x4 << 7) | (x4 >>> 25);
    }

    // Add the input block back in (RFC 8439 section 2.3), then serialize little-endian.
    BLOCK[0] = (x0 + SIGMA0) | 0;
    BLOCK[1] = (x1 + SIGMA1) | 0;
    BLOCK[2] = (x2 + SIGMA2) | 0;
    BLOCK[3] = (x3 + SIGMA3) | 0;
    BLOCK[4] = (x4 + k0) | 0;
    BLOCK[5] = (x5 + k1) | 0;
    BLOCK[6] = (x6 + k2) | 0;
    BLOCK[7] = (x7 + k3) | 0;
    BLOCK[8] = (x8 + k4) | 0;
    BLOCK[9] = (x9 + k5) | 0;
    BLOCK[10] = (x10 + k6) | 0;
    BLOCK[11] = (x11 + k7) | 0;
    BLOCK[12] = (x12 + c) | 0;
    BLOCK[13] = (x13 + n0) | 0;
    BLOCK[14] = (x14 + n1) | 0;
    BLOCK[15] = (x15 + n2) | 0;
    for (let i = 0; i < 16 && p < n; i++) {
      const w = BLOCK[i];
      out[p] = data[p] ^ (w & 255);
      p++;
      if (p >= n) break;
      out[p] = data[p] ^ ((w >>> 8) & 255);
      p++;
      if (p >= n) break;
      out[p] = data[p] ^ ((w >>> 16) & 255);
      p++;
      if (p >= n) break;
      out[p] = data[p] ^ ((w >>> 24) & 255);
      p++;
    }
  }
  return out;
}
