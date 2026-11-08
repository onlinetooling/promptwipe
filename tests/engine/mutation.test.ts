import { describe, expect, it } from 'vitest';
import { EngineError, inspect, strip, verifyClean } from '../../src/engine';
import {
  app11Segments,
  ascii,
  basePng,
  c2paStore,
  cat,
  enc,
  fixture,
  iTXt,
  jpegSegment,
  pngChunk,
  richExif,
  riffChunk,
  splitRiff,
  tEXt,
  webpFile,
  withJpegSegments,
  withPngChunks,
  xmpPacket,
  zTXt,
} from './helpers';

// Design §9: 500 random mutations (truncation, flipped and inserted bytes,
// broken lengths) must give either a clean output or a typed error — never a
// crash, a hang, or a file that still carries metadata.

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

function bases(): Uint8Array[] {
  const exif = cat(ascii('Exif\0\0'), richExif(6));
  const lossy = splitRiff(fixture('lossy-alpha.webp'));
  const vp8x = lossy[0]!.data.slice();
  vp8x[0] = vp8x[0]! | 0x08 | 0x04;
  return [
    withPngChunks(basePng(), [tEXt('parameters', 'a prompt'), zTXt('workflow', '{"nodes":[1,2]}'), iTXt('XML:com.adobe.xmp', xmpPacket({ creatorTool: 'T' }), true), pngChunk('eXIf', richExif(3)), pngChunk('caBX', c2paStore())]),
    withPngChunks(fixture('apng.png'), [tEXt('prompt', '{"1":{"class_type":"KSampler"}}')]),
    withJpegSegments(fixture('baseline.jpg'), [jpegSegment(0xe1, exif), jpegSegment(0xfe, ascii('comment')), ...app11Segments(c2paStore({ padding: 200 }), 120)], ascii('tail')),
    withJpegSegments(fixture('progressive.jpg'), [jpegSegment(0xe1, cat(ascii('http://ns.adobe.com/xap/1.0/\0'), enc.encode(xmpPacket({ creatorTool: 'T' }))))]),
    webpFile([riffChunk('VP8X', vp8x), ...lossy.slice(1).map((c) => c.bytes), riffChunk('EXIF', richExif(8, true)), riffChunk('XMP ', ascii('<x/>')), riffChunk('C2PA', c2paStore())]),
    cat(fixture('animated.webp'), ascii('trailing')),
  ];
}

function mutate(b: Uint8Array, rnd: () => number, kind: number): Uint8Array {
  const at = (n: number): number => Math.floor(rnd() * n);
  const out = b.slice();
  switch (kind) {
    case 0:
      return out.subarray(0, 1 + at(b.length - 1)); // truncation
    case 1: {
      for (let i = 0, n = 1 + at(4); i < n; i++) out[at(out.length)] = at(256); // flipped bytes
      return out;
    }
    case 2: {
      const p = at(b.length);
      const junk = Uint8Array.from({ length: 1 + at(16) }, () => at(256));
      return cat(b.subarray(0, p), junk, b.subarray(p)); // inserted bytes
    }
    default: {
      const p = at(Math.max(1, b.length - 4));
      out.set([0xff, 0xff, 0xff, at(256)], p); // broken length field
      return out;
    }
  }
}

describe('robustness: 500 random mutations', () => {
  it('gives a clean file or a typed error, never anything else', { timeout: 60_000 }, async () => {
    const rnd = mulberry32(20261108);
    const inputs = bases();
    let cleaned = 0;
    let refused = 0;
    for (let i = 0; i < 500; i++) {
      const m = mutate(inputs[i % inputs.length]!, rnd, i % 4);
      try {
        const result = strip(m);
        expect(verifyClean(result.bytes), `mutation ${i}`).toBe(true);
        cleaned++;
      } catch (e) {
        expect(e, `mutation ${i}`).toBeInstanceOf(EngineError);
        refused++;
      }
      try {
        await inspect(m);
      } catch (e) {
        expect(e, `inspect mutation ${i}`).toBeInstanceOf(EngineError);
      }
    }
    // Both paths must actually be exercised.
    expect(cleaned).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(50);
  });
});
