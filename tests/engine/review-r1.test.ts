// Regression tests for the L1 code review (2026-11-08): each reproduces a
// reviewer finding and must keep passing once fixed.
import { describe, expect, it } from 'vitest';
import { EngineError, analyze, inspect, strip, verifyClean } from '../../src/engine';
import { newBudget } from '../../src/engine/budget';
import { readXmp } from '../../src/engine/xmp';
import {
  ascii, basePng, c2paStore, cat, enc, fixture, iTXt, jpegSegment, pngChunk, riffChunk, splitJpeg, splitPng,
  splitRiff, tEXt, webpFile, withJpegSegments, withPngChunks, xmpPacket, zTXt, app11Segments, tiff,
} from './helpers';

const CANARY = 'PWCANARY-7f3a';
const contains = (b: Uint8Array, s: string): boolean => Buffer.from(b).includes(Buffer.from(s, 'latin1'));
const time = async (fn: () => unknown): Promise<number> => {
  const t = performance.now();
  await fn();
  return performance.now() - t;
};

describe('H1 — XMP scanning is linear', () => {
  const cases: Record<string, string> = {
    'unclosed elements': '<a:description>'.repeat(300_000),
    'unclosed rdf:li': `<a:description>${'<rdf:li>'.repeat(8000)}</a:description>${'<b:Credit x>'.repeat(200_000)}`,
    'many < in a value': `<a:description>${'<'.repeat(65_000)}</a:description>${'<c:CreatorTool '.repeat(200_000)}`,
    'unterminated attributes': ' x:CreatorTool="'.repeat(300_000),
    'self-closing resource bait': '<d:provenance '.repeat(300_000),
  };
  for (const [name, text] of Object.entries(cases)) {
    it(`${name}: under 1 s`, async () => {
      const ms = await time(() => readXmp(enc.encode(text), newBudget()));
      expect(ms).toBeLessThan(1000);
    });
  }

  it('still reads every supported form', () => {
    const s = readXmp(enc.encode(xmpPacket({ creatorTool: 'A &amp; B', source: 'trainedAlgorithmicMedia', description: 'x &lt;y&gt;' })), newBudget());
    expect([s.creatorTool, s.digitalSourceType, s.description]).toEqual(['A & B', 'trainedAlgorithmicMedia', 'x <y>']);
  });
});

describe('M1 — kept blocks cannot smuggle data', () => {
  it('PNG: drops colour / transparency chunks with a wrong size, and stray fcTL / fdAT', () => {
    const junk = ascii(`${CANARY} `.repeat(100));
    const input = withPngChunks(basePng(), [
      pngChunk('gAMA', junk), pngChunk('sRGB', junk), pngChunk('cHRM', junk), pngChunk('cICP', junk),
      pngChunk('mDCV', junk), pngChunk('cLLI', junk), pngChunk('tRNS', junk),
      pngChunk('fcTL', cat(new Uint8Array(26), junk).subarray(0, 26)), pngChunk('fdAT', junk),
    ]);
    const { bytes } = strip(input);
    expect(contains(bytes, CANARY)).toBe(false);
    expect(splitPng(bytes).chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('PNG: keeps valid-size colour chunks', () => {
    const input = withPngChunks(basePng(), [pngChunk('gAMA', new Uint8Array(4)), pngChunk('sRGB', new Uint8Array(1)), pngChunk('cHRM', new Uint8Array(32))]);
    expect(splitPng(strip(input).bytes).chunks.map((c) => c.type)).toEqual(['IHDR', 'gAMA', 'sRGB', 'cHRM', 'IDAT', 'IEND']);
  });

  it('PNG: refuses IEND with a payload and broken APNG control chunks', () => {
    const png = basePng();
    const iendWithData = cat(png.subarray(0, png.length - 12), pngChunk('IEND', ascii(CANARY)));
    expect(() => strip(iendWithData)).toThrowError(/malformed/);
    const apng = fixture('apng.png');
    const { chunks } = splitPng(apng);
    const badActl = cat(apng.subarray(0, 8), ...chunks.map((c) => (c.type === 'acTL' ? pngChunk('acTL', cat(c.data, ascii(CANARY))) : c.bytes)));
    expect(() => strip(badActl)).toThrowError(/malformed/);
  });

  it('JPEG: rewrites an oversized Adobe APP14 to its 12 bytes', () => {
    const adobe = cat(ascii('Adobe'), Uint8Array.of(0, 100, 0, 0, 0, 0, 1), ascii(CANARY.repeat(50)));
    const input = withJpegSegments(fixture('baseline.jpg'), [jpegSegment(0xee, adobe)]);
    expect(analyze(input).blocks.find((b) => b.label === 'Adobe')).toMatchObject({ action: 'rewrite', kind: 'color' });
    const { bytes } = strip(input);
    expect(contains(bytes, CANARY)).toBe(false);
    const seg = splitJpeg(bytes).find((s) => s.marker === 0xee)!;
    expect(seg.bytes.length).toBe(16);
    expect(verifyClean(bytes)).toBe(true);
  });

  it('JPEG: drops a truncated Adobe APP14', () => {
    const input = withJpegSegments(fixture('baseline.jpg'), [jpegSegment(0xee, ascii('Adobe'))]);
    expect(splitJpeg(strip(input).bytes).some((s) => s.marker === 0xee)).toBe(false);
  });

  it('WebP: rewrites ANIM to 6 bytes, zeroes VP8X and ANMF reserved bits', () => {
    const base = fixture('animated.webp');
    const [vp8x, anim, ...frames] = splitRiff(base);
    const vp8xData = vp8x!.data.slice();
    vp8xData[0] = vp8xData[0]! | 0xc1;
    vp8xData.set([0x50, 0x57, 0x43], 1);
    const frame = frames[0]!.data.slice();
    frame[15] = frame[15]! | 0xfc;
    const input = webpFile([
      riffChunk('VP8X', vp8xData),
      riffChunk('ANIM', cat(anim!.data, ascii(CANARY))),
      riffChunk('ANMF', frame),
      ...frames.slice(1).map((f) => f.bytes),
    ]);
    const { bytes } = strip(input);
    expect(contains(bytes, CANARY)).toBe(false);
    expect(Buffer.from(bytes).equals(Buffer.from(base))).toBe(true);
  });

  it('WebP: refuses an ANIM chunk shorter than 6 bytes', () => {
    const [vp8x, , ...frames] = splitRiff(fixture('animated.webp'));
    const input = webpFile([vp8x!.bytes, riffChunk('ANIM', Uint8Array.of(1, 2)), ...frames.map((f) => f.bytes)]);
    expect(() => strip(input)).toThrowError(/malformed/);
  });

  it('a canary in every metadata block never reaches the output', () => {
    const exif = tiff({ ifd0: [{ tag: 0x0131, ascii: CANARY }, { tag: 0x0112, short: 6 }] });
    const files = [
      withPngChunks(basePng(), [tEXt('parameters', CANARY), zTXt('workflow', CANARY), iTXt('XML:com.adobe.xmp', CANARY), pngChunk('eXIf', exif), pngChunk('caBX', cat(c2paStore(), ascii(CANARY))), pngChunk('tIME', ascii(CANARY))]),
      withJpegSegments(fixture('progressive.jpg'), [
        jpegSegment(0xe1, cat(ascii('Exif\0\0'), exif)),
        jpegSegment(0xe1, cat(ascii('http://ns.adobe.com/xap/1.0/\0'), ascii(CANARY))),
        ...app11Segments(cat(c2paStore(), ascii(CANARY)), 100),
        jpegSegment(0xfe, ascii(CANARY)), jpegSegment(0xe5, ascii(CANARY)),
      ], ascii(CANARY)),
      webpFile([
        ...splitRiff(fixture('lossy-alpha.webp')).map((c) => c.bytes),
        riffChunk('EXIF', exif), riffChunk('XMP ', ascii(CANARY)), riffChunk('C2PA', ascii(CANARY)), riffChunk('ZZZZ', ascii(CANARY)),
      ]),
    ];
    for (const f of files) {
      expect(contains(f, CANARY)).toBe(true);
      const { bytes } = strip(f);
      expect(contains(bytes, CANARY)).toBe(false);
    }
  });
});

describe('M2 — the number of blocks and text entries is bounded', () => {
  it('caps text entries and stays fast on 20 000 empty compressed chunks', async () => {
    const chunks = Array.from({ length: 20_000 }, (_, i) => pngChunk('zTXt', cat(ascii(`k${i}`), Uint8Array.of(0, 0))));
    const input = withPngChunks(basePng(), chunks);
    let report: Awaited<ReturnType<typeof inspect>> | undefined;
    const ms = await time(async () => {
      report = await inspect(input);
    });
    expect(ms).toBeLessThan(3000);
    expect(report!.texts.length).toBeLessThanOrEqual(1000);
    expect(report!.warnings).toContain('too-many-texts');
  });

  it('refuses a file made of more than 100 000 blocks', () => {
    const chunk = pngChunk('tEXt', ascii('k\0'));
    const many = new Uint8Array(chunk.length * 100_001);
    for (let i = 0; i < 100_001; i++) many.set(chunk, i * chunk.length);
    const input = withPngChunks(basePng(), [many]);
    expect(() => strip(input)).toThrowError(EngineError);
    expect(() => strip(input)).toThrowError(/too many blocks/);
  });
});

describe('linear text trimming (found while fixing H1)', () => {
  it('EXIF text with a long run of inner spaces is read in linear time', async () => {
    const value = `a${' '.repeat(1_000_000)}b`;
    const t = tiff({ ifd0: [{ tag: 0x010e, ascii: value }] });
    const png = withPngChunks(basePng(), [pngChunk('eXIf', t)]);
    let field: string | undefined;
    const ms = await time(async () => {
      field = (await inspect(png)).exif?.fields[0]?.value;
    });
    expect(ms).toBeLessThan(1000);
    expect(field).toBe(value);
  });
});

describe('L1 / L2 — small corrections', () => {
  it('tEXt is ISO-8859-1 (not windows-1252), and UTF-8 written into tEXt is shown as UTF-8', async () => {
    const latin = pngChunk('tEXt', cat(ascii('a\0'), Uint8Array.of(0x93, 0xe9)));
    const utf8 = pngChunk('tEXt', cat(ascii('b\0'), enc.encode('café 東京')));
    const r = await inspect(withPngChunks(basePng(), [latin, utf8]));
    expect(r.texts.map((t) => t.value)).toEqual(['\u0093é', 'café 東京']);
  });
});

