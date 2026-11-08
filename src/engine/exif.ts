import { type Budget, take } from './budget';
import { decodeUtf8, startsWith, trimText } from './bytes';

// TIFF / EXIF reader for the report, plus the orientation-only EXIF writer.
// Reads are bounded and never throw: a broken EXIF is simply dropped by the
// cleaner, and the report says it could not be read.

const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4,
};
const MAX_ENTRIES = 1000;

interface Tiff {
  b: Uint8Array;
  le: boolean;
}

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Absolute offset of the value bytes inside the TIFF data. */
  at: number;
  size: number;
}

function tiffOf(b: Uint8Array): Tiff | null {
  if (b.length < 8) return null;
  if (startsWith(b, 0, 'II*\0')) return { b, le: true };
  if (startsWith(b, 0, 'MM\0*')) return { b, le: false };
  return null;
}

function rd16(t: Tiff, o: number): number {
  const { b } = t;
  return t.le ? b[o]! | (b[o + 1]! << 8) : (b[o]! << 8) | b[o + 1]!;
}

function rd32(t: Tiff, o: number): number {
  const { b } = t;
  return t.le
    ? (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0
    : ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function readIfd(t: Tiff, off: number, visited: Set<number>): { entries: Entry[]; next: number } | null {
  const len = t.b.length;
  if (off < 8 || off + 2 > len || visited.has(off)) return null;
  visited.add(off);
  const declared = rd16(t, off);
  const count = Math.min(declared, MAX_ENTRIES);
  const entries: Entry[] = [];
  let p = off + 2;
  let i = 0;
  for (; i < count && p + 12 <= len; i++, p += 12) {
    const type = rd16(t, p + 2);
    const unit = TYPE_SIZE[type];
    if (unit === undefined) continue;
    const n = rd32(t, p + 4);
    const size = n * unit;
    const at = size <= 4 ? p + 8 : rd32(t, p + 8);
    if (!Number.isSafeInteger(size) || at + size > len) continue;
    entries.push({ tag: rd16(t, p), type, count: n, at, size });
  }
  // The next-IFD offset follows the last entry; only trust it if every
  // declared entry was walked.
  const next = i === declared && p + 4 <= len ? rd32(t, p) : 0;
  return { entries, next };
}

/** EXIF orientation (1-8) from TIFF data; 1 when absent or unreadable. */
export function readOrientation(tiffBytes: Uint8Array): number {
  const t = tiffOf(tiffBytes);
  if (!t) return 1;
  const ifd0 = readIfd(t, rd32(t, 4), new Set());
  const e = ifd0?.entries.find((x) => x.tag === 0x0112);
  if (!e || e.type !== 3 || e.count < 1) return 1;
  const v = rd16(t, e.at);
  return v >= 1 && v <= 8 ? v : 1;
}

/**
 * A 26-byte big-endian TIFF holding only the Orientation tag (design §3, review
 * H1): the image keeps its rotation and nothing else.
 */
export function orientationTiff(orientation: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xff, 0x00, 0x00, // Orientation SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

export interface ExifField {
  /** EXIF tag name ("Software", "UserComment"…). */
  tag: string;
  value: string;
  truncated: boolean;
}

export interface ExifSummary {
  fields: ExifField[];
  orientation: number;
  gps: { present: boolean; latitude: number | null; longitude: number | null };
  makerNoteBytes: number;
  thumbnailBytes: number;
}

const IFD0_TEXT: Record<number, string> = {
  0x010e: 'ImageDescription',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0131: 'Software',
  0x0132: 'DateTime',
  0x013b: 'Artist',
  0x8298: 'Copyright',
  0x9c9b: 'XPTitle',
  0x9c9c: 'XPComment',
  0x9c9d: 'XPAuthor',
  0x9c9e: 'XPKeywords',
  0x9c9f: 'XPSubject',
};

const EXIF_TEXT: Record<number, string> = {
  0x9286: 'UserComment',
  0x9003: 'DateTimeOriginal',
  0x9004: 'CreateDate',
  0xa420: 'ImageUniqueID',
  0xa430: 'CameraOwnerName',
  0xa431: 'BodySerialNumber',
  0xa433: 'LensMake',
  0xa434: 'LensModel',
};

function decodeUtf16(b: Uint8Array, fallbackLe: boolean): string {
  let even = 0;
  let odd = 0;
  for (let i = 0; i < Math.min(b.length, 400); i++) {
    if (b[i] === 0) {
      if (i % 2 === 0) even++;
      else odd++;
    }
  }
  const le = even === odd ? fallbackLe : odd > even;
  return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b);
}

function decodeUserComment(t: Tiff, raw: Uint8Array): string {
  if (raw.length < 8) return decodeUtf8(raw);
  const body = raw.subarray(8);
  if (startsWith(raw, 0, 'ASCII\0\0\0')) return decodeUtf8(body);
  if (startsWith(raw, 0, 'UNICODE\0')) return decodeUtf16(body, t.le);
  if (startsWith(raw, 0, 'JIS\0\0\0\0\0')) {
    try {
      return new TextDecoder('shift_jis').decode(body);
    } catch {
      return decodeUtf8(body);
    }
  }
  if (raw.subarray(0, 8).every((x) => x === 0)) return decodeUtf8(body);
  return decodeUtf8(raw);
}

function textOf(t: Tiff, e: Entry, budget: Budget): { value: string; truncated: boolean } | null {
  if (e.type !== 1 && e.type !== 2 && e.type !== 7) return null;
  const { bytes, truncated } = take(budget, t.b.subarray(e.at, e.at + e.size));
  let value: string;
  if (e.tag === 0x9286) value = decodeUserComment(t, bytes);
  else if (e.tag >= 0x9c9b && e.tag <= 0x9c9f) value = new TextDecoder('utf-16le').decode(bytes);
  else {
    const nul = bytes.indexOf(0);
    value = decodeUtf8(nul >= 0 ? bytes.subarray(0, nul) : bytes);
  }
  value = trimText(value);
  return value ? { value, truncated } : null;
}

function rational(t: Tiff, at: number): number | null {
  const den = rd32(t, at + 4);
  return den === 0 ? null : rd32(t, at) / den;
}

function coordinate(t: Tiff, ref: Entry | undefined, val: Entry | undefined, negative: string): number | null {
  if (!ref || !val || val.type !== 5 || val.count < 3) return null;
  const d = rational(t, val.at);
  const m = rational(t, val.at + 8);
  const s = rational(t, val.at + 16);
  if (d === null || m === null || s === null) return null;
  const sign = String.fromCharCode(t.b[ref.at] ?? 0) === negative ? -1 : 1;
  const v = sign * (d + m / 60 + s / 3600);
  return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
}

/** Fields worth showing to the user, or null if the TIFF header is unreadable. */
export function readExif(tiffBytes: Uint8Array, budget: Budget): ExifSummary | null {
  const t = tiffOf(tiffBytes);
  if (!t) return null;
  const visited = new Set<number>();
  const summary: ExifSummary = {
    fields: [],
    orientation: readOrientation(tiffBytes),
    gps: { present: false, latitude: null, longitude: null },
    makerNoteBytes: 0,
    thumbnailBytes: 0,
  };
  const ifd0 = readIfd(t, rd32(t, 4), visited);
  if (!ifd0) return summary;

  const collect = (entries: Entry[], names: Record<number, string>): void => {
    for (const e of entries) {
      const tag = names[e.tag];
      if (!tag) continue;
      const text = textOf(t, e, budget);
      if (text) summary.fields.push({ tag, ...text });
    }
  };
  collect(ifd0.entries, IFD0_TEXT);

  const pointer = (entries: Entry[], tag: number): number | null => {
    const e = entries.find((x) => x.tag === tag);
    return e && (e.type === 4 || e.type === 13) && e.count >= 1 ? rd32(t, e.at) : null;
  };

  const exifAt = pointer(ifd0.entries, 0x8769);
  const exifIfd = exifAt === null ? null : readIfd(t, exifAt, visited);
  if (exifIfd) {
    collect(exifIfd.entries, EXIF_TEXT);
    const mn = exifIfd.entries.find((x) => x.tag === 0x927c);
    if (mn) summary.makerNoteBytes = mn.size;
  }

  const gpsAt = pointer(ifd0.entries, 0x8825);
  const gpsIfd = gpsAt === null ? null : readIfd(t, gpsAt, visited);
  if (gpsIfd && gpsIfd.entries.length > 0) {
    const byTag = (tag: number): Entry | undefined => gpsIfd.entries.find((x) => x.tag === tag);
    summary.gps = {
      present: true,
      latitude: coordinate(t, byTag(1), byTag(2), 'S'),
      longitude: coordinate(t, byTag(3), byTag(4), 'W'),
    };
  }

  const ifd1 = ifd0.next ? readIfd(t, ifd0.next, visited) : null;
  const thumbLen = ifd1?.entries.find((x) => x.tag === 0x0202);
  if (thumbLen && (thumbLen.type === 4 || thumbLen.type === 3)) {
    summary.thumbnailBytes = thumbLen.type === 4 ? rd32(t, thumbLen.at) : rd16(t, thumbLen.at);
  }
  return summary;
}
