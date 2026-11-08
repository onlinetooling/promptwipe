// Synchronous zlib inflate (RFC 1950 / 1951), after Mark Adler's puff.c.
// Used where the engine must know exactly how a compressed stream ends (a
// kept PNG iCCP must end at its chunk end, security review 2026-11-08) and
// for the report, so decoding is the same in every browser. Output is capped:
// a decompression bomb stops at `maxOut`.

export interface ZlibResult {
  bytes: Uint8Array<ArrayBuffer>;
  /** Stopped at maxOut: `bytes` is the beginning only. */
  truncated: boolean;
  /** The stream decoded to its end and the Adler-32 matched. */
  complete: boolean;
  /** Input bytes used, Adler-32 included, when complete; -1 otherwise. */
  end: number;
}

class Corrupt extends Error {}
class Full extends Error {}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huffman {
  count: Uint16Array; // codes per length, 0..15
  symbol: Uint16Array; // symbols ordered by code
}

function huffman(size: number): Huffman {
  return { count: new Uint16Array(16), symbol: new Uint16Array(size) };
}

/** Canonical Huffman table from code lengths. Returns 0 if complete, > 0 if incomplete, < 0 if over-subscribed. */
function construct(h: Huffman, lengths: Uint8Array, n: number): number {
  h.count.fill(0);
  for (let s = 0; s < n; s++) h.count[lengths[s]!] = h.count[lengths[s]!]! + 1;
  if (h.count[0] === n) return 0;
  let left = 1;
  for (let len = 1; len <= 15; len++) {
    left = (left << 1) - h.count[len]!;
    if (left < 0) return left;
  }
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len]! + h.count[len]!;
  for (let s = 0; s < n; s++) {
    const len = lengths[s]!;
    if (len !== 0) {
      h.symbol[offs[len]!] = s;
      offs[len] = offs[len]! + 1;
    }
  }
  return left;
}

let fixed: { lit: Huffman; dist: Huffman } | null = null;

function fixedTables(): { lit: Huffman; dist: Huffman } {
  if (!fixed) {
    const lengths = new Uint8Array(288);
    lengths.fill(8, 0, 144);
    lengths.fill(9, 144, 256);
    lengths.fill(7, 256, 280);
    lengths.fill(8, 280, 288);
    const lit = huffman(288);
    construct(lit, lengths, 288);
    const dist = huffman(30);
    construct(dist, new Uint8Array(30).fill(5), 30);
    fixed = { lit, dist };
  }
  return fixed;
}

class Inflater {
  pos: number;
  bitbuf = 0;
  bitcnt = 0;
  out: Uint8Array<ArrayBuffer>;
  len = 0;

  constructor(
    readonly src: Uint8Array,
    start: number,
    readonly max: number,
  ) {
    this.pos = start;
    this.out = new Uint8Array(Math.min(max, Math.max(1024, src.length * 4)));
  }

  bits(need: number): number {
    let val = this.bitbuf;
    while (this.bitcnt < need) {
      if (this.pos >= this.src.length) throw new Corrupt();
      val |= this.src[this.pos++]! << this.bitcnt;
      this.bitcnt += 8;
    }
    this.bitbuf = val >>> need;
    this.bitcnt -= need;
    return val & ((1 << need) - 1);
  }

  private room(n: number): void {
    if (this.len + n <= this.out.length) return;
    if (this.len + n > this.max) throw new Full();
    let size = this.out.length * 2;
    while (size < this.len + n) size *= 2;
    const grown = new Uint8Array(Math.min(size, this.max));
    grown.set(this.out.subarray(0, this.len));
    this.out = grown;
  }

  private put(byte: number): void {
    if (this.len >= this.out.length) this.room(1);
    this.out[this.len++] = byte;
  }

  stored(): void {
    this.bitbuf = 0; // to the byte boundary
    this.bitcnt = 0;
    if (this.pos + 4 > this.src.length) throw new Corrupt();
    const n = this.src[this.pos]! | (this.src[this.pos + 1]! << 8);
    const check = this.src[this.pos + 2]! | (this.src[this.pos + 3]! << 8);
    if (n !== (~check & 0xffff)) throw new Corrupt();
    this.pos += 4;
    if (this.pos + n > this.src.length) throw new Corrupt();
    const fit = Math.min(n, this.max - this.len);
    if (fit > 0) {
      this.room(fit);
      this.out.set(this.src.subarray(this.pos, this.pos + fit), this.len);
      this.len += fit;
    }
    if (fit < n) throw new Full();
    this.pos += n;
  }

  decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= this.bits(1);
      const count = h.count[len]!;
      if (code - count < first) return h.symbol[index + (code - first)]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Corrupt();
  }

  codes(lit: Huffman, dist: Huffman): void {
    for (;;) {
      let sym = this.decode(lit);
      if (sym < 256) this.put(sym);
      else if (sym === 256) return;
      else {
        sym -= 257;
        if (sym >= 29) throw new Corrupt();
        const length = LENGTH_BASE[sym]! + this.bits(LENGTH_EXTRA[sym]!);
        const dsym = this.decode(dist);
        if (dsym >= 30) throw new Corrupt();
        const distance = DIST_BASE[dsym]! + this.bits(DIST_EXTRA[dsym]!);
        if (distance > this.len) throw new Corrupt();
        // Fill exactly up to the cap, then stop.
        const fit = Math.min(length, this.max - this.len);
        if (this.len + fit > this.out.length) this.room(fit);
        for (let i = 0; i < fit; i++) {
          this.out[this.len] = this.out[this.len - distance]!;
          this.len++;
        }
        if (fit < length) throw new Full();
      }
    }
  }

  dynamic(): void {
    const nlen = this.bits(5) + 257;
    const ndist = this.bits(5) + 1;
    const ncode = this.bits(4) + 4;
    if (nlen > 286 || ndist > 30) throw new Corrupt();
    const lengths = new Uint8Array(320);
    for (let i = 0; i < ncode; i++) lengths[CODE_ORDER[i]!] = this.bits(3);
    const lit = huffman(288);
    const dist = huffman(30);
    if (construct(lit, lengths, 19) !== 0) throw new Corrupt();
    lengths.fill(0);
    let index = 0;
    while (index < nlen + ndist) {
      let sym = this.decode(lit);
      if (sym < 16) {
        lengths[index++] = sym;
        continue;
      }
      let len = 0;
      if (sym === 16) {
        if (index === 0) throw new Corrupt();
        len = lengths[index - 1]!;
        sym = 3 + this.bits(2);
      } else if (sym === 17) sym = 3 + this.bits(3);
      else sym = 11 + this.bits(7);
      if (index + sym > nlen + ndist) throw new Corrupt();
      while (sym-- > 0) lengths[index++] = len;
    }
    if (lengths[256] === 0) throw new Corrupt();
    let err = construct(lit, lengths, nlen);
    if (err < 0 || (err > 0 && nlen - lit.count[0]! !== 1)) throw new Corrupt();
    err = construct(dist, lengths.subarray(nlen), ndist);
    if (err < 0 || (err > 0 && ndist - dist.count[0]! !== 1)) throw new Corrupt();
    this.codes(lit, dist);
  }

  output(): Uint8Array<ArrayBuffer> {
    return this.out.slice(0, this.len);
  }
}

export function adler32(b: Uint8Array): number {
  let a = 1;
  let s = 0;
  for (let i = 0; i < b.length; ) {
    const end = Math.min(i + 5552, b.length);
    for (; i < end; i++) {
      a += b[i]!;
      s += a;
    }
    a %= 65521;
    s %= 65521;
  }
  return ((s << 16) | a) >>> 0;
}

/** Inflates a zlib stream; null when it is not zlib or nothing decodes. */
export function inflateZlib(src: Uint8Array, maxOut: number): ZlibResult | null {
  if (src.length < 2) return null;
  const cmf = src[0]!;
  const flg = src[1]!;
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || ((cmf << 8) | flg) % 31 !== 0 || flg & 0x20) return null;
  const s = new Inflater(src, 2, Math.max(0, maxOut));
  try {
    let last: number;
    do {
      last = s.bits(1);
      const type = s.bits(2);
      if (type === 0) s.stored();
      else if (type === 1) {
        const t = fixedTables();
        s.codes(t.lit, t.dist);
      } else if (type === 2) s.dynamic();
      else throw new Corrupt();
    } while (!last);
  } catch (e) {
    const bytes = s.output();
    if (e instanceof Full) return { bytes, truncated: true, complete: false, end: -1 };
    // Corrupt or truncated stream (or anything unexpected): keep what decoded.
    return bytes.length ? { bytes, truncated: false, complete: false, end: -1 } : null;
  }
  const bytes = s.output();
  // The Adler-32 follows the last block, on a byte boundary.
  const at = s.pos;
  const complete =
    at + 4 <= src.length &&
    ((src[at]! << 24) | (src[at + 1]! << 16) | (src[at + 2]! << 8) | src[at + 3]!) >>> 0 === adler32(bytes);
  return { bytes, truncated: false, complete, end: complete ? at + 4 : -1 };
}
