import { describe, expect, it } from 'vitest';
import { newBudget } from '../../src/engine/budget';
import { certificateSubject, decodeCbor, jumbfFromApp11, readC2pa } from '../../src/engine/c2pa';
import { orientationTiff, readExif, readOrientation } from '../../src/engine/exif';
import { iccDescription } from '../../src/engine/icc';
import { readXmp, xmpField } from '../../src/engine/xmp';
import { Tag, app11Segments, ascii, be32, c2paStore, cat, cbor, derCertificate, enc, iccProfile, tiff, userCommentUnicode, xmpPacket } from './helpers';

describe('EXIF', () => {
  it('writes a 26-byte orientation-only TIFF that reads back for every orientation', () => {
    for (let v = 1; v <= 8; v++) {
      const t = orientationTiff(v);
      expect(t.length).toBe(26);
      expect(readOrientation(t)).toBe(v);
      const summary = readExif(t, newBudget());
      expect(summary?.fields).toEqual([]);
      expect(summary?.gps.present).toBe(false);
    }
  });

  it('treats out-of-range or missing orientation as 1, and garbage as no EXIF', () => {
    expect(readOrientation(tiff({ ifd0: [{ tag: 0x0112, short: 9 }] }))).toBe(1);
    expect(readOrientation(tiff({ ifd0: [{ tag: 0x0131, ascii: 'x' }] }))).toBe(1);
    expect(readOrientation(ascii('not a tiff at all'))).toBe(1);
    expect(readExif(ascii('nope'), newBudget())).toBeNull();
  });

  it('decodes UserComment in UNICODE (both byte orders), ASCII and undefined codes', () => {
    const text = 'a fox, Steps: 20';
    for (const le of [false, true]) {
      const t = tiff({ le, ifd0: [], exif: [{ tag: 0x9286, undefinedBytes: userCommentUnicode(text, le) }] });
      expect(readExif(t, newBudget())?.fields).toEqual([{ tag: 'UserComment', value: text, truncated: false }]);
    }
    // piexif writes UTF-16BE even in a little-endian TIFF: the heuristic follows the bytes.
    const mixed = tiff({ le: true, ifd0: [], exif: [{ tag: 0x9286, undefinedBytes: userCommentUnicode(text, false) }] });
    expect(readExif(mixed, newBudget())?.fields[0]?.value).toBe(text);
    const asciiCode = tiff({ ifd0: [], exif: [{ tag: 0x9286, undefinedBytes: cat(ascii('ASCII\0\0\0'), ascii(text)) }] });
    expect(readExif(asciiCode, newBudget())?.fields[0]?.value).toBe(text);
    const noCode = tiff({ ifd0: [], exif: [{ tag: 0x9286, undefinedBytes: cat(new Uint8Array(8), ascii(text)) }] });
    expect(readExif(noCode, newBudget())?.fields[0]?.value).toBe(text);
  });

  it('reads south / east GPS coordinates', () => {
    const t = tiff({
      ifd0: [],
      gps: [
        { tag: 1, ascii: 'S' },
        { tag: 2, rational: [[33, 1], [52, 1], [0, 1]] },
        { tag: 3, ascii: 'E' },
        { tag: 4, rational: [[151, 1], [12, 1], [36, 1]] },
      ],
    });
    expect(readExif(t, newBudget())?.gps).toEqual({ present: true, latitude: -33.866667, longitude: 151.21 });
  });

  it('survives IFD loops and huge entry counts', () => {
    // IFD0 whose "next IFD" points back to itself.
    const loop = cat(ascii('MM\0*'), be32(8), Uint8Array.of(0, 0), be32(8));
    expect(readExif(loop, newBudget())).not.toBeNull();
    // 65535 declared entries in a 20-byte file.
    const huge = cat(ascii('MM\0*'), be32(8), Uint8Array.of(0xff, 0xff), new Uint8Array(10));
    expect(readOrientation(huge)).toBe(1);
    expect(readExif(huge, newBudget())?.fields).toEqual([]);
  });

  it('charges EXIF text to the shared budget', () => {
    const t = tiff({ ifd0: [{ tag: 0x010e, ascii: 'x'.repeat(100) }] });
    const budget = newBudget(10);
    const field = readExif(t, budget)?.fields[0];
    expect(field).toEqual({ tag: 'ImageDescription', value: 'x'.repeat(10), truncated: true });
    expect(budget.exceeded).toBe(true);
  });
});

describe('XMP', () => {
  it('reads attribute, element and rdf:Alt forms, and decodes entities', () => {
    const text = xmpPacket({ creatorTool: 'Tool &amp; Co', source: 'compositeWithTrainedAlgorithmicMedia', description: 'a &lt;b&gt; prompt' });
    expect(xmpField(text, 'CreatorTool')).toBe('Tool & Co');
    expect(xmpField(text, 'description')).toBe('a <b> prompt');
    const summary = readXmp(enc.encode(text), newBudget());
    expect(summary.digitalSourceType).toBe('compositeWithTrainedAlgorithmicMedia');
    expect(summary.hdrGainMap).toBe(false);
    expect(xmpField('<xmp:CreatorTool>Element Tool</xmp:CreatorTool>', 'CreatorTool')).toBe('Element Tool');
    expect(xmpField('<dcterms:provenance rdf:resource="https://example.test/m.c2pa"/>', 'provenance')).toBe('https://example.test/m.c2pa');
  });

  it('flags Motion Photo and gain-map XMP', () => {
    const s = readXmp(enc.encode('<x GCamera:MotionPhoto="1" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"/>'), newBudget());
    expect([s.motionPhoto, s.hdrGainMap]).toEqual([true, true]);
  });
});

describe('ICC', () => {
  it('reads v2 desc and v4 mluc descriptions, null for garbage', () => {
    expect(iccDescription(iccProfile('sRGB IEC61966-2.1', 2))).toBe('sRGB IEC61966-2.1');
    expect(iccDescription(iccProfile('Display P3', 4))).toBe('Display P3');
    expect(iccDescription(new Uint8Array(200))).toBeNull();
    expect(iccDescription(ascii('short'))).toBeNull();
  });
});

describe('CBOR', () => {
  it('decodes the types a C2PA claim uses', () => {
    const v = decodeCbor(cbor({ a: 1, b: -2, c: 'text', d: Uint8Array.of(1, 2), e: [true, false, null], f: new Tag(18, [0]) })) as Map<string, unknown>;
    expect(v.get('a')).toBe(1);
    expect(v.get('b')).toBe(-2);
    expect(v.get('c')).toBe('text');
    expect(v.get('d')).toEqual(Uint8Array.of(1, 2));
    expect(v.get('e')).toEqual([true, false, null]);
    expect(v.get('f')).toEqual({ tag: 18, value: [0] });
  });

  it('decodes indefinite lengths and floats', () => {
    // [_ 1, "a" "b" (chunked), {_ "k": 2.5 }]
    const bytes = Uint8Array.of(0x9f, 0x01, 0x7f, 0x61, 0x61, 0x61, 0x62, 0xff, 0xbf, 0x61, 0x6b, 0xfb, 0x40, 0x04, 0, 0, 0, 0, 0, 0, 0xff, 0xff);
    expect(decodeCbor(bytes)).toEqual([1, 'ab', new Map([['k', 2.5]])]);
  });

  it('refuses nesting bombs and truncated input', () => {
    expect(() => decodeCbor(new Uint8Array(100).fill(0x81))).toThrow();
    expect(() => decodeCbor(Uint8Array.of(0x5a, 0xff, 0xff, 0xff, 0xff))).toThrow();
    expect(() => decodeCbor(Uint8Array.of(0x9a, 0xff, 0xff, 0xff, 0xff))).toThrow();
  });
});

describe('C2PA', () => {
  it('reports the active (last) manifest of the store', () => {
    const s = readC2pa(c2paStore({ generator: 'New Tool 2.0', olderManifest: true }), 123);
    expect(s).toMatchObject({ bytes: 123, manifests: 2, generator: 'New Tool 2.0', signer: 'Example Signer Inc.', readable: true });
  });

  it('falls back to the certificate common name', () => {
    expect(certificateSubject(derCertificate({ CN: 'Only A Name' }))).toBe('Only A Name');
    expect(certificateSubject(ascii('not der'))).toBeNull();
  });

  it('reassembles APP11 segments sent out of order', () => {
    const store = c2paStore({ generator: 'Split Tool', padding: 500 });
    const payloads = app11Segments(store, 100).map((seg) => seg.subarray(4));
    expect(payloads.length).toBeGreaterThan(3);
    const shuffled = [payloads[2]!, payloads[0]!, ...payloads.slice(3).reverse(), payloads[1]!];
    const [rebuilt] = jumbfFromApp11(shuffled);
    expect(Buffer.from(rebuilt!).equals(Buffer.from(store))).toBe(true);
  });

  it('never throws on garbage: unreadable but reported', () => {
    for (const junk of [ascii('garbage'), new Uint8Array(64), c2paStore().subarray(0, 40), cat(be32(1), ascii('jumb'), be32(0), be32(5))]) {
      const s = readC2pa(junk, junk.length);
      expect(s.readable).toBe(false);
      expect(s.bytes).toBe(junk.length);
    }
  });
});
