import { describe, expect, it } from 'vitest';
import { analyze, inspect, strip } from '../../src/engine';
import { stripClean } from './assert';
import {
  ascii,
  c2paStore,
  cat,
  enc,
  fixture,
  iccProfile,
  le32,
  richExif,
  riffChunk,
  splitRiff,
  tiff,
  webpFile,
  xmpPacket,
} from './helpers';

const ids = (b: Uint8Array): string[] => splitRiff(b).map((c) => c.id);
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const riffSizeOk = (b: Uint8Array): boolean => new DataView(b.buffer, b.byteOffset).getUint32(4, true) === b.length - 8;

/** Rebuilds a fixture's chunks, with VP8X flags or-ed and extra chunks inserted. */
function rebuild(base: Uint8Array, opts: { flags?: number; afterVp8x?: Uint8Array[]; atEnd?: Uint8Array[] }): Uint8Array {
  const chunks = splitRiff(base);
  const out: Uint8Array[] = [];
  for (const c of chunks) {
    if (c.id === 'VP8X') {
      const data = c.data.slice();
      data[0] = data[0]! | (opts.flags ?? 0);
      out.push(riffChunk('VP8X', data), ...(opts.afterVp8x ?? []));
    } else out.push(c.bytes);
  }
  return webpFile([...out, ...(opts.atEnd ?? [])]);
}

const COMFY_WORKFLOW = JSON.stringify({ nodes: [{ id: 1 }, { id: 2 }] });
const comfyExif = (orientation: number): Uint8Array =>
  tiff({
    le: true,
    ifd0: [
      { tag: 0x010f, ascii: `workflow:${COMFY_WORKFLOW}` },
      { tag: 0x0110, ascii: 'prompt:{"1":{"class_type":"KSampler"}}' },
      { tag: 0x0112, short: orientation },
    ],
  });

describe('WebP — extended (VP8X + ALPH + VP8)', () => {
  const base = fixture('lossy-alpha.webp');

  it('starts from a clean fixture', () => {
    expect(ids(base)).toEqual(['VP8X', 'ALPH', 'VP8 ']);
    expect(analyze(base).blocks.every((b) => b.action === 'keep')).toBe(true);
  });

  it('removes EXIF, XMP, C2PA and unknown chunks, and gives back the original bytes', () => {
    const input = rebuild(base, {
      flags: 0x08 | 0x04,
      atEnd: [
        riffChunk('EXIF', comfyExif(1)),
        riffChunk('XMP ', enc.encode(xmpPacket({ creatorTool: 'ComfyUI' }))),
        riffChunk('ABCD', ascii('odd')), // odd size: pad byte
        riffChunk('C2PA', c2paStore({ generator: 'Google Gemini', signer: { CN: 'Google LLC' } })),
      ],
    });
    expect(analyze(input).blocks.map((b) => `${b.name}:${b.action}`)).toEqual([
      'VP8X:keep',
      'ALPH:keep',
      'VP8:keep',
      'EXIF:remove',
      'XMP:remove',
      'ABCD:remove',
      'C2PA:remove',
    ]);
    const { bytes } = stripClean(input);
    expect(hex(bytes)).toBe(hex(base));
  });

  it('reports the ComfyUI graph from EXIF text tags, XMP and C2PA', async () => {
    const input = rebuild(base, {
      flags: 0x08 | 0x04,
      atEnd: [
        riffChunk('EXIF', comfyExif(1)),
        riffChunk('XMP ', enc.encode(xmpPacket({ creatorTool: 'ComfyUI' }))),
        riffChunk('C2PA', c2paStore({ generator: 'Google Gemini', signer: { CN: 'Google LLC' }, x5chainIn: 'unprotected' })),
      ],
    });
    const r = await inspect(input);
    expect(r.comfyui).toEqual({ nodes: 2 });
    expect(r.xmp?.creatorTool).toBe('ComfyUI');
    expect(r.c2pa).toMatchObject({ generator: 'Google Gemini', signer: 'Google LLC', readable: true });
  });

  it('writes an orientation-only EXIF and sets only the EXIF flag', () => {
    const input = rebuild(base, { flags: 0x08 | 0x04, atEnd: [riffChunk('EXIF', cat(ascii('Exif\0\0'), richExif(3, true))), riffChunk('XMP ', ascii('<x/>'))] });
    const result = stripClean(input);
    expect(result.orientationKept).toBe(3);
    const out = splitRiff(result.bytes);
    expect(out.map((c) => c.id)).toEqual(['VP8X', 'ALPH', 'VP8 ', 'EXIF']);
    expect(out[0]!.data[0]).toBe(splitRiff(base)[0]!.data[0]! | 0x08);
    expect(out[3]!.data.length).toBe(26);
    expect(riffSizeOk(result.bytes)).toBe(true);
    expect(analyze(result.bytes).orientation).toBe(3);
  });

  it('keeps ICCP and names the profile', async () => {
    const input = rebuild(base, { flags: 0x20, afterVp8x: [riffChunk('ICCP', iccProfile('Display P3'))] });
    expect((await inspect(input)).colorProfile).toBe('Display P3');
    const { bytes } = stripClean(input);
    expect(hex(bytes)).toBe(hex(input));
  });
});

describe('WebP — simple formats', () => {
  it('lossy VP8: removes a non-standard trailing EXIF chunk and gives back the original', () => {
    const base = fixture('lossy.webp');
    expect(ids(base)).toEqual(['VP8 ']);
    const input = webpFile([...splitRiff(base).map((c) => c.bytes), riffChunk('EXIF', richExif(6))]);
    const result = stripClean(input);
    expect(result.orientationKept).toBeNull(); // EXIF is only defined with VP8X
    expect(hex(result.bytes)).toBe(hex(base));
  });

  it('lossless VP8L: removes bytes after the RIFF payload', () => {
    const base = fixture('lossless.webp');
    expect(ids(base)).toEqual(['VP8L']);
    const input = cat(base, ascii('appended secret'));
    expect(analyze(input).blocks.at(-1)).toMatchObject({ kind: 'trailing', size: 15 });
    expect(hex(stripClean(input).bytes)).toBe(hex(base));
  });

  it('reads dimensions from VP8 and VP8L headers', () => {
    expect([analyze(fixture('lossy.webp')).width, analyze(fixture('lossy.webp')).height]).toEqual([16, 12]);
    expect([analyze(fixture('lossless.webp')).width, analyze(fixture('lossless.webp')).height]).toEqual([16, 12]);
  });
});

describe('WebP — animation', () => {
  const base = fixture('animated.webp');

  it('removes an unknown chunk inside an ANMF frame and gives back the original', () => {
    expect(ids(base)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF']);
    const chunks = splitRiff(base);
    const frame = chunks[2]!;
    const extra = riffChunk('XYZW', ascii('frame secret')); // even
    const odd = riffChunk('QRST', ascii('odd')); // odd: pad byte inside the frame
    const frameData = cat(frame.data, extra, odd);
    const input = webpFile([
      riffChunk('VP8X', Uint8Array.of(chunks[0]!.data[0]! | 0x04, ...chunks[0]!.data.subarray(1))),
      chunks[1]!.bytes,
      cat(ascii('ANMF'), le32(frameData.length), frameData),
      chunks[3]!.bytes,
      riffChunk('XMP ', ascii('<x:xmpmeta/>')),
    ]);
    const s = analyze(input);
    expect(s.animated).toBe(true);
    expect(s.blocks.filter((b) => b.action === 'remove').map((b) => b.name)).toEqual(['ANMF/XYZW', 'ANMF/QRST', 'XMP']);
    expect(hex(stripClean(input).bytes)).toBe(hex(base));
  });
});

describe('WebP — refusals', () => {
  const base = fixture('lossless.webp');

  it('refuses a RIFF size larger than the file', () => {
    const bad = base.slice();
    bad.set(le32(base.length), 4);
    expect(() => strip(bad)).toThrowError(/malformed/);
  });

  it('refuses a chunk that runs past the RIFF payload', () => {
    const bad = base.slice();
    bad.set(le32(base.length), 16); // VP8L size
    expect(() => strip(bad)).toThrowError(/malformed/);
  });

  it('refuses a file whose first chunk is not an image', () => {
    expect(() => strip(webpFile([riffChunk('XMP ', ascii('<x/>'))]))).toThrowError(/VP8/);
  });
});
