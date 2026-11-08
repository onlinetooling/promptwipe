// Test-only builders. They are written independently of the engine (Node's
// zlib CRC and deflate, separate TIFF / CBOR / JUMBF / DER writers) so a bug
// in an engine reader cannot hide behind the same bug in the fixture.

import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

export const enc = new TextEncoder();

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
}

export function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
}

export function be32(n: number): Uint8Array {
  return Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

export function le32(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24);
}

export function be16(n: number): Uint8Array {
  return Uint8Array.of((n >>> 8) & 255, n & 255);
}

export function zlib(data: Uint8Array): Uint8Array {
  return new Uint8Array(deflateSync(data));
}

// ---------------- PNG ----------------

export const PNG_SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typed = cat(ascii(type), data);
  return cat(be32(data.length), typed, be32(crc32(typed)));
}

export interface RawChunk {
  type: string;
  data: Uint8Array;
  bytes: Uint8Array;
}

export function splitPng(b: Uint8Array): { chunks: RawChunk[]; rest: Uint8Array } {
  const chunks: RawChunk[] = [];
  let o = 8;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (o + 12 <= b.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    chunks.push({ type, data: b.subarray(o + 8, o + 8 + len), bytes: b.subarray(o, o + 12 + len) });
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return { chunks, rest: b.subarray(o) };
}

/** Inserts chunks right after IHDR (where generators usually put text). */
export function withPngChunks(png: Uint8Array, extra: Uint8Array[], where: 'after-IHDR' | 'before-IEND' = 'after-IHDR'): Uint8Array {
  const { chunks, rest } = splitPng(png);
  const out: Uint8Array[] = [PNG_SIG];
  for (const c of chunks) {
    if (where === 'before-IEND' && c.type === 'IEND') out.push(...extra);
    out.push(c.bytes);
    if (where === 'after-IHDR' && c.type === 'IHDR') out.push(...extra);
  }
  return cat(...out, rest);
}

/** A small RGBA PNG with a gradient, built from scratch. */
export function basePng(width = 8, height = 6): Uint8Array {
  const ihdr = cat(be32(width), be32(height), Uint8Array.of(8, 6, 0, 0, 0));
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const p = y * (1 + width * 4) + 1 + x * 4;
      raw.set([x * 30, y * 40, 200, x === 0 ? 0 : 255], p);
    }
  }
  return cat(PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib(raw)), pngChunk('IEND', new Uint8Array(0)));
}

export function tEXt(key: string, value: string): Uint8Array {
  return pngChunk('tEXt', cat(ascii(key), Uint8Array.of(0), ascii(value)));
}

export function zTXt(key: string, value: Uint8Array | string): Uint8Array {
  const data = typeof value === 'string' ? ascii(value) : value;
  return pngChunk('zTXt', cat(ascii(key), Uint8Array.of(0, 0), zlib(data)));
}

export function iTXt(key: string, value: string, compressed = false): Uint8Array {
  const text = enc.encode(value);
  return pngChunk(
    'iTXt',
    cat(ascii(key), Uint8Array.of(0, compressed ? 1 : 0, 0), ascii('en'), Uint8Array.of(0), enc.encode('Prompt'), Uint8Array.of(0), compressed ? zlib(text) : text),
  );
}

// ---------------- TIFF / EXIF ----------------

export type TagSpec =
  | { tag: number; ascii: string }
  | { tag: number; short: number }
  | { tag: number; long: number }
  | { tag: number; rational: [number, number][] }
  | { tag: number; undefinedBytes: Uint8Array }
  | { tag: number; bytes: Uint8Array };

export interface TiffSpec {
  le?: boolean;
  ifd0: TagSpec[];
  exif?: TagSpec[];
  gps?: TagSpec[];
  thumbnail?: Uint8Array;
}

/** A TIFF structure as found in EXIF blocks. Pointers and offsets are computed. */
export function tiff(spec: TiffSpec): Uint8Array {
  const le = spec.le ?? false;
  const u16 = (n: number): number[] => (le ? [n & 255, n >>> 8] : [n >>> 8, n & 255]);
  const u32 = (n: number): number[] => (le ? [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24] : [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

  type Ifd = { specs: TagSpec[]; offset: number };
  const ifd0: Ifd = { specs: [...spec.ifd0], offset: 0 };
  const exif: Ifd | null = spec.exif ? { specs: spec.exif, offset: 0 } : null;
  const gps: Ifd | null = spec.gps ? { specs: spec.gps, offset: 0 } : null;
  const ifd1: Ifd | null = spec.thumbnail ? { specs: [{ tag: 0x0201, long: 0 }, { tag: 0x0202, long: spec.thumbnail.length }], offset: 0 } : null;
  if (exif) ifd0.specs.push({ tag: 0x8769, long: 0 });
  if (gps) ifd0.specs.push({ tag: 0x8825, long: 0 });
  const all = [ifd0, exif, gps, ifd1].filter((x): x is Ifd => x !== null);
  let o = 8;
  for (const ifd of all) {
    ifd.specs.sort((a, b) => a.tag - b.tag);
    ifd.offset = o;
    o += 2 + ifd.specs.length * 12 + 4;
  }
  let dataAt = o;
  const out: number[] = [...(le ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42]), ...u32(8)];
  const data: number[] = [];
  const place = (bytes: number[]): number => {
    const at = dataAt + data.length;
    for (const x of bytes) data.push(x);
    if (data.length % 2) data.push(0);
    return at;
  };
  let thumbAt = 0;
  if (ifd1 && spec.thumbnail) thumbAt = place([...spec.thumbnail]);
  for (const ifd of all) {
    out.push(...u16(ifd.specs.length));
    for (const s of ifd.specs) {
      let type: number;
      let count: number;
      let bytes: number[];
      if ('ascii' in s) {
        const b = [...enc.encode(s.ascii), 0];
        [type, count, bytes] = [2, b.length, b];
      } else if ('short' in s) [type, count, bytes] = [3, 1, [...u16(s.short), 0, 0]];
      else if ('long' in s) {
        let v = s.long;
        if (s.tag === 0x8769 && exif) v = exif.offset;
        if (s.tag === 0x8825 && gps) v = gps.offset;
        if (s.tag === 0x0201) v = thumbAt;
        [type, count, bytes] = [4, 1, u32(v)];
      } else if ('rational' in s) [type, count, bytes] = [5, s.rational.length, s.rational.flatMap(([n, d]) => [...u32(n), ...u32(d)])];
      else if ('undefinedBytes' in s) [type, count, bytes] = [7, s.undefinedBytes.length, [...s.undefinedBytes]];
      else [type, count, bytes] = [1, s.bytes.length, [...s.bytes]];
      out.push(...u16(s.tag), ...u16(type), ...u32(count));
      if (bytes.length <= 4) out.push(...bytes, ...new Array<number>(4 - bytes.length).fill(0));
      else out.push(...u32(place(bytes)));
    }
    const next = ifd === ifd0 && ifd1 ? ifd1.offset : 0;
    out.push(...u32(next));
  }
  return Uint8Array.from([...out, ...data]);
}

/** EXIF UserComment as piexif writes it for A1111 / Fooocus ("UNICODE\0" + UTF-16). */
export function userCommentUnicode(text: string, le = false): Uint8Array {
  const units = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    units[i * 2 + (le ? 1 : 0)] = c >>> 8;
    units[i * 2 + (le ? 0 : 1)] = c & 255;
  }
  return cat(ascii('UNICODE\0'), units);
}

export function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2 + 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) & 255;
    out[i * 2 + 1] = text.charCodeAt(i) >>> 8;
  }
  return out;
}

/** A realistic phone + generator EXIF: rotation, GPS, thumbnail, prompt in UserComment. */
export function richExif(orientation: number, le = false): Uint8Array {
  return tiff({
    le,
    ifd0: [
      { tag: 0x010e, ascii: 'a castle at dawn, highly detailed' },
      { tag: 0x010f, ascii: 'Pixel Maker' },
      { tag: 0x0110, ascii: 'Model X' },
      { tag: 0x0112, short: orientation },
      { tag: 0x0131, ascii: 'Fooocus v2.5.5' },
      { tag: 0x0132, ascii: '2026:11:08 10:12:33' },
      { tag: 0x9c9c, bytes: utf16le('XP comment text') },
    ],
    exif: [
      { tag: 0x9003, ascii: '2026:11:08 10:12:33' },
      { tag: 0x9286, undefinedBytes: userCommentUnicode('masterpiece, a red fox\nSteps: 30, Seed: 1234', le) },
      { tag: 0x927c, undefinedBytes: new Uint8Array(40).fill(7) },
      { tag: 0xa431, ascii: 'SN-998877' },
    ],
    gps: [
      { tag: 0x0001, ascii: 'N' },
      { tag: 0x0002, rational: [[48, 1], [51, 1], [2400, 100]] },
      { tag: 0x0003, ascii: 'W' },
      { tag: 0x0004, rational: [[2, 1], [21, 1], [0, 1]] },
    ],
    thumbnail: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4),
  });
}

// ---------------- JPEG ----------------

export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  return cat(Uint8Array.of(0xff, marker), be16(payload.length + 2), payload);
}

export interface RawSegment {
  marker: number;
  bytes: Uint8Array;
}

/** Independent JPEG splitter (segments up to the first SOS, then the scan block, then EOI). */
export function splitJpeg(b: Uint8Array): RawSegment[] {
  const out: RawSegment[] = [{ marker: 0xd8, bytes: b.subarray(0, 2) }];
  let o = 2;
  while (o < b.length) {
    const marker = b[o + 1]!;
    if (marker === 0xd9) {
      out.push({ marker, bytes: b.subarray(o, o + 2) });
      break;
    }
    const len = (b[o + 2]! << 8) | b[o + 3]!;
    let end = o + 2 + len;
    if (marker === 0xda) {
      while (!(b[end] === 0xff && b[end + 1] !== 0 && !(b[end + 1]! >= 0xd0 && b[end + 1]! <= 0xd7))) end++;
    }
    out.push({ marker, bytes: b.subarray(o, end) });
    o = end;
  }
  return out;
}

export function withJpegSegments(jpeg: Uint8Array, afterSoi: Uint8Array[], trailing: Uint8Array = new Uint8Array(0)): Uint8Array {
  return cat(jpeg.subarray(0, 2), ...afterSoi, jpeg.subarray(2), trailing);
}

/** C2PA JUMBF store split over several APP11 segments (JPEG XT box format). */
export function app11Segments(store: Uint8Array, maxPayload: number, instance = 1): Uint8Array[] {
  const header = store.subarray(0, 8); // LBox + TBox, repeated in every segment
  const content = store.subarray(8);
  const segments: Uint8Array[] = [];
  let seq = 1;
  for (let o = 0; o < content.length || seq === 1; o += maxPayload, seq++) {
    const slice = content.subarray(o, o + maxPayload);
    segments.push(jpegSegment(0xeb, cat(ascii('JP'), be16(instance), be32(seq), header, slice)));
  }
  return segments;
}

// ---------------- WebP ----------------

export function riffChunk(id: string, data: Uint8Array): Uint8Array {
  return cat(ascii(id), le32(data.length), data, data.length % 2 ? Uint8Array.of(0) : new Uint8Array(0));
}

export function webpFile(chunks: Uint8Array[]): Uint8Array {
  const body = cat(ascii('WEBP'), ...chunks);
  return cat(ascii('RIFF'), le32(body.length), body);
}

export interface RawRiff {
  id: string;
  data: Uint8Array;
  bytes: Uint8Array;
}

export function splitRiff(b: Uint8Array, start = 12, end = b.length): RawRiff[] {
  const out: RawRiff[] = [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = start;
  while (o + 8 <= end) {
    const size = view.getUint32(o + 4, true);
    const padded = size + (size & 1);
    out.push({ id: String.fromCharCode(...b.subarray(o, o + 4)), data: b.subarray(o + 8, o + 8 + size), bytes: b.subarray(o, o + 8 + padded) });
    o += 8 + padded;
  }
  return out;
}

export function vp8x(flags: number, width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riffChunk('VP8X', Uint8Array.of(flags, 0, 0, 0, w & 255, (w >>> 8) & 255, w >>> 16, h & 255, (h >>> 8) & 255, h >>> 16));
}

// ---------------- C2PA: CBOR, JUMBF, DER ----------------

export class Tag {
  constructor(
    readonly tag: number,
    readonly value: unknown,
  ) {}
}

export function cbor(value: unknown): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: number): void => {
    const m = major << 5;
    if (n < 24) out.push(m | n);
    else if (n < 256) out.push(m | 24, n);
    else if (n < 65536) out.push(m | 25, n >>> 8, n & 255);
    else out.push(m | 26, n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  };
  const pushAll = (b: Uint8Array): void => {
    for (const x of b) out.push(x);
  };
  const e = (v: unknown): void => {
    if (typeof v === 'number') v >= 0 ? head(0, v) : head(1, -1 - v);
    else if (typeof v === 'string') {
      const b = enc.encode(v);
      head(3, b.length);
      pushAll(b);
    } else if (v instanceof Uint8Array) {
      head(2, v.length);
      pushAll(v);
    } else if (Array.isArray(v)) {
      head(4, v.length);
      v.forEach(e);
    } else if (v instanceof Map) {
      head(5, v.size);
      for (const [k, x] of v) {
        e(k);
        e(x);
      }
    } else if (v instanceof Tag) {
      head(6, v.tag);
      e(v.value);
    } else if (v === true) out.push(0xf5);
    else if (v === false) out.push(0xf4);
    else if (v === null) out.push(0xf6);
    else if (typeof v === 'object' && v) {
      const entries = Object.entries(v);
      head(5, entries.length);
      for (const [k, x] of entries) {
        e(k);
        e(x);
      }
    } else throw new Error('cannot encode');
  };
  e(value);
  return Uint8Array.from(out);
}

export function box(type: string, content: Uint8Array): Uint8Array {
  return cat(be32(content.length + 8), ascii(type), content);
}

const C2PA_UUID = Uint8Array.of(0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71);

export function superbox(label: string, children: Uint8Array[]): Uint8Array {
  const jumd = box('jumd', cat(C2PA_UUID, Uint8Array.of(0x03), enc.encode(label), Uint8Array.of(0)));
  return box('jumb', cat(jumd, ...children));
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  const n = content.length;
  const len = n < 128 ? Uint8Array.of(n) : n < 256 ? Uint8Array.of(0x81, n) : Uint8Array.of(0x82, n >>> 8, n & 255);
  return cat(Uint8Array.of(tag), len, content);
}

function derName(attrs: { O?: string; CN?: string }): Uint8Array {
  const rdn = (oidLast: number, value: string, tag = 0x0c): Uint8Array =>
    tlv(0x31, tlv(0x30, cat(tlv(0x06, Uint8Array.of(0x55, 0x04, oidLast)), tlv(tag, enc.encode(value)))));
  const parts = [rdn(0x06, 'US', 0x13)];
  if (attrs.O) parts.push(rdn(0x0a, attrs.O));
  if (attrs.CN) parts.push(rdn(0x03, attrs.CN));
  return tlv(0x30, cat(...parts));
}

export function derCertificate(subject: { O?: string; CN?: string }): Uint8Array {
  const tbs = tlv(
    0x30,
    cat(
      tlv(0xa0, tlv(0x02, Uint8Array.of(2))),
      tlv(0x02, Uint8Array.of(1)),
      tlv(0x30, tlv(0x06, Uint8Array.of(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02))),
      derName({ CN: 'Test Issuing CA', O: 'Test CA Org' }),
      tlv(0x30, cat(tlv(0x17, ascii('260101000000Z')), tlv(0x17, ascii('270101000000Z')))),
      derName(subject),
      tlv(0x30, new Uint8Array(0)),
    ),
  );
  return tlv(0x30, cat(tbs, tlv(0x30, tlv(0x06, Uint8Array.of(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02))), tlv(0x03, Uint8Array.of(0, 1, 2, 3))));
}

export interface StoreSpec {
  generator?: string;
  generatorInfo?: { name: string; version?: string };
  title?: string;
  signer?: { O?: string; CN?: string };
  x5chainIn?: 'protected' | 'unprotected';
  olderManifest?: boolean;
  padding?: number;
}

export function c2paStore(spec: StoreSpec = {}): Uint8Array {
  const claim = new Map<string, unknown>();
  if (spec.generator) claim.set('claim_generator', spec.generator);
  if (spec.generatorInfo) claim.set('claim_generator_info', [spec.generatorInfo]);
  if (spec.title) claim.set('dc:title', spec.title);
  claim.set('dc:format', 'image/png');
  claim.set('instanceID', 'xmp:iid:0000');
  const cert = derCertificate(spec.signer ?? { O: 'Example Signer Inc.', CN: 'Example Signer' });
  const prot = spec.x5chainIn === 'unprotected' ? new Map<number, unknown>([[1, -7]]) : new Map<number, unknown>([[1, -7], [33, [cert]]]);
  const unprot = spec.x5chainIn === 'unprotected' ? new Map<number, unknown>([[33, cert]]) : new Map();
  const cose = new Tag(18, [cbor(prot), unprot, null, new Uint8Array(64)]);
  const manifest = (label: string, gen: string | undefined): Uint8Array =>
    superbox(label, [
      superbox('c2pa.assertions', [superbox('c2pa.actions', [box('cbor', cbor({ actions: [{ action: 'c2pa.created' }] }))])]),
      superbox('c2pa.claim', [box('cbor', cbor(gen === undefined ? claim : new Map([['claim_generator', gen]])))]),
      superbox('c2pa.signature', [box('cbor', cbor(cose))]),
      ...(spec.padding ? [box('free', new Uint8Array(spec.padding))] : []),
    ]);
  const manifests = [manifest('urn:uuid:active', undefined)];
  if (spec.olderManifest) manifests.unshift(manifest('urn:uuid:older', 'Older Tool 1.0'));
  return superbox('c2pa', manifests);
}

/** An XMP packet like an AI generator or editor writes. */
export function xmpPacket(fields: { creatorTool?: string; source?: string; description?: string; extra?: string } = {}): string {
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:dc="http://purl.org/dc/elements/1.1/"',
    fields.creatorTool ? ` xmp:CreatorTool="${fields.creatorTool}"` : '',
    fields.source ? ` Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/${fields.source}"` : '',
    '>',
    fields.description ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${fields.description}</rdf:li></rdf:Alt></dc:description>` : '',
    fields.extra ?? '',
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
  ].join('');
}

/** A synthetic ICC header + tag table holding only a 'desc' tag. */
export function iccProfile(description: string, version: 2 | 4 = 2): Uint8Array {
  let tag: Uint8Array;
  if (version === 2) {
    const text = cat(ascii(description), Uint8Array.of(0));
    tag = cat(ascii('desc'), new Uint8Array(4), be32(text.length), text, new Uint8Array(4 + 4 + 2 + 1 + 67));
  } else {
    const utf16 = new Uint8Array(description.length * 2);
    for (let i = 0; i < description.length; i++) {
      utf16[i * 2] = description.charCodeAt(i) >>> 8;
      utf16[i * 2 + 1] = description.charCodeAt(i) & 255;
    }
    tag = cat(ascii('mluc'), new Uint8Array(4), be32(1), be32(12), ascii('enUS'), be32(utf16.length), be32(28), utf16);
  }
  const tagOffset = 128 + 4 + 12;
  const header = new Uint8Array(128);
  header.set(be32(tagOffset + tag.length), 0);
  header.set(ascii('acsp'), 36);
  return cat(header, be32(1), ascii('desc'), be32(tagOffset), be32(tag.length), tag);
}
