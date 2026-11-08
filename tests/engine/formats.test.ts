import { describe, expect, it } from 'vitest';
import { EngineError, MAX_FILE_BYTES, detectFormat, inspect, strip } from '../../src/engine';
import {
  ascii,
  basePng,
  be32,
  c2paStore,
  cat,
  enc,
  fixture,
  iTXt,
  jpegSegment,
  pngChunk,
  tEXt,
  tiff,
  withJpegSegments,
  withPngChunks,
  xmpPacket,
  zTXt,
} from './helpers';

const ftyp = (major: string, ...compatible: string[]): Uint8Array => {
  const body = cat(ascii(major), be32(0), ...compatible.map(ascii));
  return cat(be32(body.length + 8), ascii('ftyp'), body, new Uint8Array(16));
};

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof EngineError ? `${e.code}:${e.format ?? ''}` : 'not an EngineError';
  }
}

describe('format detection and refusals', () => {
  it('detects formats from the bytes only', () => {
    expect(detectFormat(basePng())).toBe('png');
    expect(detectFormat(fixture('baseline.jpg'))).toBe('jpeg');
    expect(detectFormat(fixture('lossy.webp'))).toBe('webp');
    expect(detectFormat(ascii('GIF89a......'))).toBe('gif');
    expect(detectFormat(ascii('GIF87a......'))).toBe('gif');
    expect(detectFormat(ftyp('avif', 'mif1', 'miaf'))).toBe('avif');
    expect(detectFormat(ftyp('mif1', 'avif'))).toBe('avif');
    expect(detectFormat(ftyp('heic', 'mif1'))).toBe('heic');
    expect(detectFormat(ftyp('isom', 'mp41'))).toBe('unknown');
    expect(detectFormat(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('unknown');
    expect(detectFormat(new Uint8Array(0))).toBe('unknown');
  });

  it('refuses GIF, AVIF, HEIC and unknown files with the format named', () => {
    expect(codeOf(() => strip(ascii('GIF89a......')))).toBe('unsupported-format:gif');
    expect(codeOf(() => strip(ftyp('avif')))).toBe('unsupported-format:avif');
    expect(codeOf(() => strip(ftyp('heic')))).toBe('unsupported-format:heic');
    expect(codeOf(() => strip(ascii('hello')))).toBe('unsupported-format:unknown');
  });

  it('refuses files over 50 MB before reading them', async () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(basePng());
    expect(codeOf(() => strip(big))).toBe('too-large:');
    await expect(inspect(big)).rejects.toMatchObject({ code: 'too-large' });
  });
});

describe('round trip: metadata in, original out', () => {
  it('PNG: every metadata chunk removed gives back the exact original file', () => {
    const base = basePng();
    const input = withPngChunks(base, [
      tEXt('parameters', 'prompt'),
      zTXt('workflow', '{"nodes":[]}'),
      iTXt('XML:com.adobe.xmp', xmpPacket({ creatorTool: 'X' })),
      pngChunk('eXIf', tiff({ ifd0: [{ tag: 0x0131, ascii: 'Software' }] })),
      pngChunk('caBX', c2paStore()),
      pngChunk('tIME', new Uint8Array(7)),
    ]);
    expect(Buffer.from(strip(input).bytes).equals(Buffer.from(base))).toBe(true);
  });

  it('JPEG: every metadata segment removed gives back the exact original file', () => {
    const base = fixture('progressive.jpg');
    const input = withJpegSegments(
      base,
      [
        jpegSegment(0xe1, cat(ascii('Exif\0\0'), tiff({ ifd0: [{ tag: 0x0131, ascii: 'Software' }] }))),
        jpegSegment(0xe1, cat(ascii('http://ns.adobe.com/xap/1.0/\0'), enc.encode(xmpPacket({ creatorTool: 'X' })))),
        jpegSegment(0xfe, ascii('comment')),
        jpegSegment(0xed, cat(ascii('Photoshop 3.0\0'), new Uint8Array(12))),
      ],
      ascii('trailing'),
    );
    expect(Buffer.from(strip(input).bytes).equals(Buffer.from(base))).toBe(true);
  });
});
