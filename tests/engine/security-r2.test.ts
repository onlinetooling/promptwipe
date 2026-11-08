// Regression tests for the automated security review of 2026-11-08 (second
// pass): data must not ride along in a kept block that is repeated, misplaced
// or longer than its content.
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { analyze, strip, verifyClean } from '../../src/engine';
import {
  ascii,
  basePng,
  be16,
  cat,
  fixture,
  iccProfile,
  jpegSegment,
  pngChunk,
  riffChunk,
  splitJpeg,
  splitPng,
  splitRiff,
  webpFile,
  withJpegSegments,
  withPngChunks,
  zlib,
} from './helpers';

const CANARY = 'PWCANARY-r2';
const contains = (b: Uint8Array, s: string): boolean => Buffer.from(b).includes(Buffer.from(s, 'latin1'));
const pngTypes = (b: Uint8Array): string[] => splitPng(b).chunks.map((c) => c.type);
const iccp = (name: string, profile = iccProfile('Display P3'), method = 0): Uint8Array =>
  pngChunk('iCCP', cat(ascii(name), Uint8Array.of(0, method), zlib(profile)));

describe('PNG kept chunks', () => {
  it('keeps one copy of each colour chunk and drops misplaced ones', () => {
    const png = basePng();
    const { chunks } = splitPng(png);
    const gama = pngChunk('gAMA', ascii('PWCA')); // right size, payload is a marker
    const input = cat(
      png.subarray(0, 8),
      chunks[0]!.bytes,
      pngChunk('gAMA', new Uint8Array(4)),
      gama, // duplicate
      chunks[1]!.bytes, // IDAT
      pngChunk('cHRM', new Uint8Array(32)), // after IDAT
      chunks[2]!.bytes,
    );
    const { bytes } = strip(input);
    expect(pngTypes(bytes)).toEqual(['IHDR', 'gAMA', 'IDAT', 'IEND']);
    expect(contains(bytes, 'PWCA')).toBe(false);
    expect(analyze(input).blocks.filter((b) => b.action === 'remove').map((b) => b.label)).toEqual(['duplicate', 'out of order']);
  });

  it('rebuilds iCCP from the decoded profile: fixed name, deterministic encoding', () => {
    const input = withPngChunks(basePng(), [iccp(`${CANARY} tracking id`)]);
    expect(analyze(input).blocks.find((b) => b.name === 'iCCP')).toMatchObject({ action: 'rewrite', kind: 'color' });
    const { bytes } = strip(input);
    expect(contains(bytes, CANARY)).toBe(false);
    const out = splitPng(bytes).chunks.find((c) => c.type === 'iCCP')!;
    expect(Buffer.from(out.data.subarray(0, 12)).toString('latin1')).toBe('ICC Profile\0');
    expect(Buffer.from(inflateSync(out.data.subarray(13))).equals(Buffer.from(iccProfile('Display P3')))).toBe(true);
    expect(verifyClean(bytes)).toBe(true);
    // Already canonical name: rebuilt all the same (no original compressed byte is kept), and idempotent.
    const canonical = withPngChunks(basePng(), [iccp('ICC Profile')]);
    expect(analyze(canonical).blocks.find((b) => b.name === 'iCCP')?.action).toBe('rewrite');
    const once = strip(canonical).bytes;
    expect(analyze(once).blocks.find((b) => b.name === 'iCCP')?.action).toBe('keep');
    expect(Buffer.from(strip(once).bytes).equals(Buffer.from(once))).toBe(true);
  });

  it('drops an iCCP with a bad compression method or next to sRGB', () => {
    for (const extra of [[iccp('ICC Profile', iccProfile('x'), 1)], [iccp('ICC Profile'), pngChunk('sRGB', Uint8Array.of(0))]]) {
      const types = pngTypes(strip(withPngChunks(basePng(), extra)).bytes);
      expect(types).not.toContain('iCCP');
    }
  });

  it('keeps an iCCP only if its zlib stream ends at the chunk end and holds a real profile', () => {
    const z = zlib(iccProfile('Display P3'));
    const withJunk = pngChunk('iCCP', cat(ascii('ICC Profile'), Uint8Array.of(0, 0), z, ascii(CANARY)));
    const notIcc = pngChunk('iCCP', cat(ascii('ICC Profile'), Uint8Array.of(0, 0), zlib(ascii(CANARY.repeat(20)))));
    const bomb = pngChunk('iCCP', cat(ascii('ICC Profile'), Uint8Array.of(0, 0), zlib(new Uint8Array(32 * 1024 * 1024))));
    for (const chunk of [withJunk, notIcc, bomb]) {
      const input = withPngChunks(basePng(), [chunk]);
      expect(analyze(input).blocks.find((x) => x.name === 'iCCP')).toMatchObject({ action: 'remove', label: 'invalid' });
      const { bytes } = strip(input);
      expect(pngTypes(bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
      expect(contains(bytes, CANARY)).toBe(false);
    }
    expect(pngTypes(strip(withPngChunks(basePng(), [pngChunk('iCCP', cat(ascii('ICC Profile'), Uint8Array.of(0, 0), z))])).bytes)).toContain('iCCP');
  });

  it('inflates only the first iCCP, however many there are', () => {
    const bomb = pngChunk('iCCP', cat(ascii('x'), Uint8Array.of(0, 0), zlib(new Uint8Array(16 * 1024 * 1024))));
    const input = withPngChunks(basePng(), new Array<Uint8Array>(200).fill(bomb));
    const t = performance.now();
    strip(input);
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it('refuses a repeated PLTE', () => {
    const png = basePng();
    const { chunks } = splitPng(png);
    const plte = pngChunk('PLTE', new Uint8Array(6));
    const input = cat(png.subarray(0, 8), chunks[0]!.bytes, plte, plte, chunks[1]!.bytes, chunks[2]!.bytes);
    expect(() => strip(input)).toThrowError(/PLTE/);
  });
});

describe('JPEG decoding segments', () => {
  const base = fixture('baseline.jpg');
  const segs = splitJpeg(base);
  const rebuild = (marker: number, change: (payload: Uint8Array) => Uint8Array): Uint8Array =>
    cat(...segs.map((s) => (s.marker === marker && s.marker !== 0xda ? jpegSegment(marker, change(s.bytes.subarray(4))) : s.bytes)));

  it('refuses DQT, DHT and SOF segments longer than their tables', () => {
    for (const marker of [0xdb, 0xc4, 0xc0]) {
      const input = rebuild(marker, (p) => cat(p, ascii(CANARY)));
      expect(() => strip(input), `marker ${marker.toString(16)}`).toThrowError(/length does not match/);
    }
  });

  it('refuses a DRI segment with extra bytes', () => {
    const input = cat(base.subarray(0, 2), jpegSegment(0xdd, cat(be16(0), ascii('xx'))), base.subarray(2));
    expect(() => strip(input)).toThrowError(/DRI/);
  });

  it('keeps a two-segment ICC profile, drops an incomplete or fake one', () => {
    const profile = iccProfile('Display P3', 4);
    const half = Math.floor(profile.length / 2);
    const icc = (seq: number, count: number, data: Uint8Array): Uint8Array =>
      jpegSegment(0xe2, cat(ascii('ICC_PROFILE\0'), Uint8Array.of(seq, count), data));
    const whole = withJpegSegments(base, [icc(2, 2, profile.subarray(half)), icc(1, 2, profile.subarray(0, half))]);
    expect(analyze(whole).blocks.filter((b) => b.label === 'ICC profile').map((b) => b.action)).toEqual(['keep', 'keep']);

    const missing = withJpegSegments(base, [icc(1, 2, profile.subarray(0, half))]);
    const fake = withJpegSegments(base, [icc(1, 1, ascii(`${CANARY}`.repeat(20)))]);
    for (const input of [missing, fake]) {
      const { bytes } = strip(input);
      expect(splitJpeg(bytes).some((s) => s.marker === 0xe2)).toBe(false);
      expect(contains(bytes, CANARY)).toBe(false);
    }
  });

  it('keeps only the first Adobe APP14', () => {
    const adobe = (t: number): Uint8Array => jpegSegment(0xee, cat(ascii('Adobe'), Uint8Array.of(0, 100, 0, 0, 0, 0, t)));
    const { bytes } = strip(withJpegSegments(base, [adobe(1), adobe(2)]));
    expect(splitJpeg(bytes).filter((s) => s.marker === 0xee)).toHaveLength(1);
  });
});

describe('WebP layout', () => {
  it('simple format: a second bitstream chunk is dropped', () => {
    const base = fixture('lossy.webp');
    const extra = riffChunk('VP8 ', cat(ascii(CANARY), new Uint8Array(20)));
    const { bytes } = strip(webpFile([...splitRiff(base).map((c) => c.bytes), extra]));
    expect(Buffer.from(bytes).equals(Buffer.from(base))).toBe(true);
  });

  it('extended still image: repeated ALPH / VP8, ANIM and ANMF are dropped', () => {
    const base = fixture('lossy-alpha.webp');
    const [vp8x, alph, vp8] = splitRiff(base);
    const input = webpFile([
      vp8x!.bytes,
      alph!.bytes,
      vp8!.bytes,
      riffChunk('ALPH', ascii(`${CANARY}1`)),
      riffChunk('VP8 ', ascii(`${CANARY}2`)),
      riffChunk('ANIM', ascii(`${CANARY}3`)),
      riffChunk('ANMF', ascii(`${CANARY}4`.repeat(4))),
    ]);
    const { bytes } = strip(input);
    expect(contains(bytes, CANARY)).toBe(false);
    expect(Buffer.from(bytes).equals(Buffer.from(base))).toBe(true);
  });

  it('ICCP is kept only once, valid, before the image and with its flag', () => {
    const base = fixture('lossy-alpha.webp');
    const [vp8x, ...rest] = splitRiff(base);
    const withFlag = Uint8Array.of(vp8x!.data[0]! | 0x20, ...vp8x!.data.subarray(1));
    const good = riffChunk('ICCP', iccProfile('Display P3'));
    const fake = riffChunk('ICCP', ascii(CANARY.repeat(10)));

    const valid = webpFile([riffChunk('VP8X', withFlag), good, good, ...rest.map((c) => c.bytes)]);
    expect(splitRiff(strip(valid).bytes).map((c) => c.id)).toEqual(['VP8X', 'ICCP', 'ALPH', 'VP8 ']);

    const noFlag = webpFile([vp8x!.bytes, good, ...rest.map((c) => c.bytes)]);
    const invalid = webpFile([riffChunk('VP8X', withFlag), fake, ...rest.map((c) => c.bytes)]);
    for (const input of [noFlag, invalid]) {
      const { bytes } = strip(input);
      expect(Buffer.from(bytes).equals(Buffer.from(base))).toBe(true); // ICC flag cleared, no ICCP
    }
  });

  it('a frame keeps one bitstream; ALPH before VP8L is dropped', () => {
    const base = fixture('animated.webp');
    const [vp8x, anim, f1, f2] = splitRiff(base);
    const frame = cat(f1!.data, riffChunk('VP8L', ascii(CANARY)));
    const input = webpFile([vp8x!.bytes, anim!.bytes, riffChunk('ANMF', frame), f2!.bytes]);
    const { bytes } = strip(input);
    expect(contains(bytes, CANARY)).toBe(false);
    expect(Buffer.from(bytes).equals(Buffer.from(base))).toBe(true);

    const lossless = fixture('lossless.webp');
    const [vp8l] = splitRiff(lossless);
    const ext = webpFile([riffChunk('VP8X', Uint8Array.of(0x10, 0, 0, 0, 15, 0, 0, 11, 0, 0)), riffChunk('ALPH', ascii(CANARY)), vp8l!.bytes]);
    expect(contains(strip(ext).bytes, CANARY)).toBe(false);
  });
});
