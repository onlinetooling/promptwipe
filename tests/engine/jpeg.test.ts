import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { EngineError, analyze, inspect, strip } from '../../src/engine';
import { stripClean } from './assert';
import {
  app11Segments,
  ascii,
  be16,
  be32,
  c2paStore,
  cat,
  enc,
  fixture,
  iccProfile,
  jpegSegment,
  richExif,
  splitJpeg,
  tiff,
  withJpegSegments,
  xmpPacket,
} from './helpers';

const decoded = (b: Uint8Array): string => Buffer.from(jpeg.decode(b, { useTArray: true }).data).toString('hex');
const markers = (b: Uint8Array): string[] =>
  splitJpeg(b).map((s) => {
    const p = s.bytes.subarray(4, 16);
    const id = String.fromCharCode(...p).replace(/[^\x20-\x7e].*$/s, '');
    return s.marker >= 0xe0 && s.marker <= 0xef ? `APP${s.marker - 0xe0}:${id}` : s.marker.toString(16);
  });

const exifSeg = (t: Uint8Array): Uint8Array => jpegSegment(0xe1, cat(ascii('Exif\0\0'), t));
const jfif = (thumbW: number, thumbH: number): Uint8Array =>
  jpegSegment(0xe0, cat(ascii('JFIF\0'), Uint8Array.of(1, 2, 1, 0, 72, 0, 72, thumbW, thumbH), new Uint8Array(thumbW * thumbH * 3).fill(9)));

/** Every metadata block a phone + AI pipeline can leave in a JPEG. */
function everything(base: Uint8Array): { input: Uint8Array; store: Uint8Array; app11: number } {
  const store = c2paStore({ generator: 'Adobe_Firefly c2pa-rs/0.49', signer: { O: 'Adobe Inc.' }, padding: 300 });
  const app11 = app11Segments(store, 200);
  const segments = [
    jfif(2, 2),
    jpegSegment(0xe0, cat(ascii('JFXX\0'), Uint8Array.of(0x10), new Uint8Array(20))),
    exifSeg(richExif(6)),
    jpegSegment(0xe1, cat(ascii('http://ns.adobe.com/xap/1.0/\0'), enc.encode(xmpPacket({ creatorTool: 'Midjourney', source: 'trainedAlgorithmicMedia', extra: '<hdrgm:Version>1.0</hdrgm:Version>' })))),
    jpegSegment(0xe1, cat(ascii('http://ns.adobe.com/xmp/extension/\0'), ascii('0123456789ABCDEF0123456789ABCDEF'), be32(10), be32(0), ascii('<x>extended'))),
    jpegSegment(0xe2, cat(ascii('ICC_PROFILE\0'), Uint8Array.of(1, 1), iccProfile('Display P3', 4))),
    jpegSegment(0xe2, cat(ascii('MPF\0'), ascii('MM\0*'), new Uint8Array(20))),
    jpegSegment(0xe3, ascii('Meta data')),
    ...app11,
    jpegSegment(0xed, cat(ascii('Photoshop 3.0\0'), ascii('8BIM'), be16(0x0404), new Uint8Array(10))),
    jpegSegment(0xee, cat(ascii('Adobe'), Uint8Array.of(0, 100, 0, 0, 0, 0, 1))),
    jpegSegment(0xef, ascii('APP15 vendor data')),
    jpegSegment(0xfe, ascii('prompt: a red fox, seed 99')),
  ];
  // Secondary image after EOI, as MPF / Ultra HDR / Motion Photo files have.
  const trailing = cat(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1), ascii('gain map or video'), Uint8Array.of(0xff, 0xd9));
  return { input: withJpegSegments(base, segments, trailing), store, app11: app11.length };
}

describe('JPEG — everything a phone or a generator leaves', () => {
  it('keeps only the decoding segments, ICC, Adobe and an orientation-only EXIF', () => {
    const { input } = everything(fixture('baseline.jpg'));
    const result = stripClean(input);
    expect(result.orientationKept).toBe(6);
    const after = markers(result.bytes);
    expect(after.slice(0, 5)).toEqual(['d8', 'APP0:JFIF', 'APP1:Exif', 'APP2:ICC_PROFILE', 'APP14:Adobe']);
    // Only the first JFIF is kept: the base file's own JFIF is a duplicate.
    expect(after.filter((m) => m.startsWith('APP'))).toEqual(['APP0:JFIF', 'APP1:Exif', 'APP2:ICC_PROFILE', 'APP14:Adobe']);
    expect(after).not.toContain('fe');
    expect(after.at(-1)).toBe('d9');

    const exif = splitJpeg(result.bytes)[2]!.bytes;
    expect(exif.length).toBe(36); // marker 2 + length 2 + "Exif\0\0" 6 + TIFF 26
    const app0 = splitJpeg(result.bytes)[1]!.bytes;
    expect(app0.length).toBe(18); // JFIF without thumbnail
    expect([app0[16], app0[17]]).toEqual([0, 0]);
    expect(decoded(result.bytes)).toBe(decoded(input));
    expect(result.bytes.length).toBeLessThan(input.length);
  });

  it('labels each removed block for the report', () => {
    const { input, app11 } = everything(fixture('baseline.jpg'));
    expect(app11).toBeGreaterThan(2);
    const removed = analyze(input)
      .blocks.filter((b) => b.action !== 'keep')
      .map((b) => `${b.action}:${b.name}:${b.label ?? ''}:${b.kind}`);
    expect(removed).toEqual([
      'rewrite:APP0:JFIF:thumbnail',
      'remove:APP0:JFXX:thumbnail',
      'rewrite:APP1:EXIF:exif',
      'remove:APP1:XMP:xmp',
      'remove:APP1:Extended XMP:xmp',
      'remove:APP2:MPF:secondary-image',
      'remove:APP3::other',
      ...new Array<string>(app11).fill('remove:APP11:JUMBF:c2pa'),
      'remove:APP13:Photoshop / IPTC:iptc',
      'remove:APP15::other',
      'remove:COM::comment',
      'remove:APP0:JFIF (duplicate):other',
      'remove:trailing data::secondary-image',
    ]);
  });

  it('reports EXIF, XMP, C2PA over several APP11 segments, ICC, MPF and the comment', async () => {
    const { input } = everything(fixture('baseline.jpg'));
    const r = await inspect(input);
    const fields = Object.fromEntries(r.exif!.fields.map((f) => [f.tag, f.value]));
    expect(fields).toMatchObject({
      ImageDescription: 'a castle at dawn, highly detailed',
      Software: 'Fooocus v2.5.5',
      UserComment: 'masterpiece, a red fox\nSteps: 30, Seed: 1234',
      XPComment: 'XP comment text',
      BodySerialNumber: 'SN-998877',
    });
    expect(r.exif!.orientation).toBe(6);
    expect(r.exif!.gps.present).toBe(true);
    expect(r.exif!.makerNoteBytes).toBe(40);
    expect(r.exif!.thumbnailBytes).toBe(8);
    expect(r.xmp).toMatchObject({ creatorTool: 'Midjourney', digitalSourceType: 'trainedAlgorithmicMedia', hdrGainMap: true });
    expect(r.c2pa).toMatchObject({ generator: 'Adobe_Firefly c2pa-rs/0.49', signer: 'Adobe Inc.', manifests: 1, readable: true });
    expect(r.colorProfile).toBe('Display P3');
    expect(r.secondaryImages).toBe(true);
    expect(r.hdrGainMap).toBe(true);
    expect(r.trailingBytes).toBe(23);
    expect(r.texts).toEqual([{ source: 'COM', key: 'comment', value: 'prompt: a red fox, seed 99', truncated: false }]);
    expect(r.warnings).toEqual([]);
  });

  it('cleans a progressive JPEG (several scans) without touching the scans', () => {
    const base = fixture('progressive.jpg');
    expect(analyze(base).blocks.filter((b) => b.name === 'SOS').length).toBeGreaterThan(1);
    const { input } = everything(base);
    const result = stripClean(input);
    expect(decoded(result.bytes)).toBe(decoded(base));
  });
});

describe('JPEG — orientation', () => {
  it('reads a little-endian EXIF and writes the orientation back (big-endian, 26 bytes)', () => {
    const input = withJpegSegments(fixture('baseline.jpg'), [exifSeg(richExif(8, true))]);
    const result = stripClean(input);
    expect(result.orientationKept).toBe(8);
    expect(analyze(result.bytes).orientation).toBe(8);
  });

  it('drops EXIF entirely when orientation is 1 or absent', () => {
    for (const t of [richExif(1), tiff({ ifd0: [{ tag: 0x0131, ascii: 'Software' }] })]) {
      const result = stripClean(withJpegSegments(fixture('baseline.jpg'), [exifSeg(t)]));
      expect(result.orientationKept).toBeNull();
      expect(markers(result.bytes).some((m) => m.startsWith('APP1'))).toBe(false);
    }
  });

  it('takes the orientation from the first EXIF segment only', () => {
    const input = withJpegSegments(fixture('baseline.jpg'), [exifSeg(richExif(3)), exifSeg(richExif(6))]);
    expect(stripClean(input).orientationKept).toBe(3);
  });
});

describe('JPEG — structure', () => {
  it('keeps DRI, accepts fill bytes before markers and keeps a JFIF without thumbnail as is', () => {
    const base = fixture('baseline.jpg');
    const dri = jpegSegment(0xdd, be16(0));
    const input = cat(base.subarray(0, 2), jfif(0, 0), Uint8Array.of(0xff, 0xff), dri, base.subarray(2));
    const blocks = analyze(input).blocks;
    expect(blocks.find((b) => b.name === 'DRI')).toMatchObject({ action: 'keep', kind: 'image' });
    expect(blocks.find((b) => b.label === 'JFIF')).toMatchObject({ action: 'keep' });
    stripClean(input);
  });

  it('keeps DAC, DNL and EXP markers (review L1) instead of dropping them silently', () => {
    const base = fixture('baseline.jpg');
    const input = cat(base.subarray(0, 2), jpegSegment(0xcc, Uint8Array.of(0, 0)), jpegSegment(0xdf, Uint8Array.of(0)), base.subarray(2));
    const names = analyze(input).blocks.filter((b) => b.action === 'keep').map((b) => b.name);
    expect(names).toContain('DAC');
    expect(names).toContain('EXP');
  });

  it('refuses unknown markers (hierarchical DHP, JPEG-LS, reserved)', () => {
    const base = fixture('baseline.jpg');
    for (const m of [0xde, 0xf7, 0xc8, 0xf0]) {
      const input = cat(base.subarray(0, 2), jpegSegment(m, Uint8Array.of(0)), base.subarray(2));
      expect(() => strip(input)).toThrow(EngineError);
      expect(() => strip(input)).toThrowError(/unknown-marker/);
    }
  });

  it('refuses truncated files and files without a frame or a scan', () => {
    const base = fixture('baseline.jpg');
    expect(() => strip(base.subarray(0, base.length - 2))).toThrowError(/malformed/);
    expect(() => strip(base.subarray(0, 40))).toThrowError(/malformed/);
    const noScan = cat(base.subarray(0, 2), jpegSegment(0xfe, ascii('x')), Uint8Array.of(0xff, 0xd9));
    expect(() => strip(noScan)).toThrowError(/frame header/);
  });

  it('refuses garbage between segments', () => {
    const base = fixture('baseline.jpg');
    const app0End = 4 + ((base[4]! << 8) | base[5]!);
    const input = cat(base.subarray(0, app0End), Uint8Array.of(0x12, 0x34), base.subarray(app0End));
    expect(() => strip(input)).toThrowError(/malformed/);
  });
});
