import { constants, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { adler32, inflateZlib } from '../../src/engine/zlib';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(1951);
const at = (n: number): number => Math.floor(rnd() * n);

function sample(kind: number, size: number): Uint8Array {
  const b = new Uint8Array(size);
  if (kind === 0) for (let i = 0; i < size; i++) b[i] = at(256); // incompressible
  else if (kind === 1) {
    const words = ['prompt', 'seed', ' ', 'KSampler', '{"nodes":', '0.75', '\n', 'masterpiece'];
    let o = 0;
    while (o < size) for (const c of words[at(words.length)]!) if (o < size) b[o++] = c.charCodeAt(0);
  } else if (kind === 2) b.fill(at(256)); // one byte repeated
  else for (let i = 0; i < size; i++) b[i] = i % (1 + at(40)); // short periods
  return b;
}

const STRATEGIES = [constants.Z_DEFAULT_STRATEGY, constants.Z_FILTERED, constants.Z_HUFFMAN_ONLY, constants.Z_RLE, constants.Z_FIXED];

describe('inflateZlib', () => {
  it('matches node:zlib on 2 000 random streams (all levels and strategies, stored blocks included)', () => {
    for (let i = 0; i < 2000; i++) {
      const data = sample(i % 4, at(i % 10 === 0 ? 300_000 : 3000));
      const z = new Uint8Array(deflateSync(data, { level: at(10), strategy: STRATEGIES[at(STRATEGIES.length)]! }));
      const r = inflateZlib(z, 1 << 30);
      expect(r, `case ${i}`).not.toBeNull();
      expect(r!.complete, `case ${i}`).toBe(true);
      expect(r!.end, `case ${i}`).toBe(z.length);
      expect(Buffer.from(r!.bytes).equals(Buffer.from(data)), `case ${i}`).toBe(true);
    }
  });

  it('reports where the stream ends, so trailing bytes are visible', () => {
    const z = new Uint8Array(deflateSync(Buffer.from('ICC profile bytes')));
    const r = inflateZlib(new Uint8Array([...z, 1, 2, 3]), 1 << 20);
    expect(r?.complete).toBe(true);
    expect(r?.end).toBe(z.length);
  });

  it('stops a decompression bomb at the cap', () => {
    const z = new Uint8Array(deflateSync(new Uint8Array(20 * 1024 * 1024)));
    const t = performance.now();
    const r = inflateZlib(z, 1024 * 1024);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(r).toMatchObject({ truncated: true, complete: false, end: -1 });
    expect(r!.bytes.length).toBe(1024 * 1024);
  });

  it('flags a wrong Adler-32 and keeps partial output of a truncated stream', () => {
    const z = new Uint8Array(deflateSync(Buffer.from('hello hello hello hello')));
    const badSum = z.slice();
    badSum[badSum.length - 1] = badSum[badSum.length - 1]! ^ 1;
    expect(inflateZlib(badSum, 1 << 20)).toMatchObject({ complete: false, end: -1 });
    const long = new Uint8Array(deflateSync(sample(1, 50_000), { level: 1 }));
    const cut = inflateZlib(long.subarray(0, long.length >> 1), 1 << 20);
    expect(cut?.complete).toBe(false);
    expect(cut!.bytes.length).toBeGreaterThan(0);
  });

  it('never throws on corrupted input', () => {
    for (let i = 0; i < 3000; i++) {
      const z = new Uint8Array(deflateSync(sample(i % 4, 1 + at(2000)), { level: at(10) }));
      for (let k = 0, n = 1 + at(4); k < n; k++) z[2 + at(z.length - 2)] = at(256);
      expect(() => inflateZlib(z, 1 << 20)).not.toThrow();
    }
    expect(inflateZlib(Uint8Array.of(0x78), 10)).toBeNull();
    expect(inflateZlib(Uint8Array.of(0x78, 0x9d, 0, 0), 10)).toBeNull(); // bad header check
    expect(inflateZlib(Uint8Array.of(0x78, 0xbb, 0, 0, 0, 0, 1, 2, 3), 10)).toBeNull(); // preset dictionary
  });

  it('computes Adler-32 like zlib', () => {
    expect(adler32(new Uint8Array(0))).toBe(1);
    expect(adler32(Buffer.from('Wikipedia'))).toBe(0x11e60398);
  });
});
