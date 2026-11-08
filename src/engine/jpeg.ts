import { asciiBytes, concat, need, startsWith, u16be } from './bytes';
import { EngineError, malformed } from './errors';
import { orientationTiff, readOrientation } from './exif';
import { isIccProfile } from './icc';
import { MAX_BLOCKS } from './limits';
import type { Parsed } from './parsed';
import type { Block, BlockAction, BlockKind, Structure } from './types';

export interface JpegSegment {
  marker: number;
  /** Start of the segment, fill bytes included. */
  offset: number;
  /** Start of the payload (after marker and length), or the segment end for standalone markers. */
  payload: number;
  /** End of the marker payload; for SOS the entropy-coded data runs from here to `end`. */
  headerEnd: number;
  /** End of the segment; for SOS, end of its entropy-coded data. */
  end: number;
}

export const EXIF_ID = 'Exif\0\0';
export const XMP_ID = 'http://ns.adobe.com/xap/1.0/\0';
export const XMP_EXT_ID = 'http://ns.adobe.com/xmp/extension/\0';
export const ICC_ID = 'ICC_PROFILE\0';
const JFIF_ID = 'JFIF\0';
const JFIF_HEADER = 14; // id 5 + version 2 + units 1 + density 4 + thumbnail size 2
const ADOBE_SIZE = 12; // "Adobe" 5 + version 2 + flags 4 + colour transform 1

function isSof(m: number): boolean {
  return m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
}

/** Decoding markers copied unchanged (design §3, review L1: DAC, DNL, EXP included). */
function isImageMarker(m: number): boolean {
  return (
    isSof(m) ||
    m === 0xc4 || // DHT
    m === 0xcc || // DAC
    m === 0xdb || // DQT
    m === 0xdd || // DRI
    m === 0xdc || // DNL
    m === 0xdf || // EXP
    m === 0xda || // SOS (+ entropy-coded data)
    m === 0xd8 || // SOI
    m === 0xd9 || // EOI
    (m >= 0xd0 && m <= 0xd7) || // RSTn
    m === 0x01 // TEM
  );
}

export function readJpegSegments(b: Uint8Array): { segments: JpegSegment[]; end: number } {
  need(b, 4, 'JPEG header');
  if (b[0] !== 0xff || b[1] !== 0xd8) throw malformed('JPEG does not start with SOI');
  const segments: JpegSegment[] = [{ marker: 0xd8, offset: 0, payload: 2, headerEnd: 2, end: 2 }];
  let o = 2;
  for (;;) {
    if (segments.length > MAX_BLOCKS) throw malformed('JPEG has too many blocks');
    need(b, o + 2, 'JPEG marker');
    if (b[o] !== 0xff) throw malformed('JPEG segment does not start with a marker');
    let m = o + 1;
    while (m < b.length && b[m] === 0xff) m++; // fill bytes
    need(b, m + 1, 'JPEG marker');
    const marker = b[m]!;
    const after = m + 1;
    if (marker === 0x00) throw malformed('JPEG marker 0x00 outside scan data');
    if (marker === 0xd9) {
      segments.push({ marker, offset: o, payload: after, headerEnd: after, end: after });
      return { segments, end: after };
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xd8) {
      if (marker === 0xd8) throw malformed('second SOI before EOI');
      segments.push({ marker, offset: o, payload: after, headerEnd: after, end: after });
      o = after;
      continue;
    }
    need(b, after + 2, 'JPEG segment length');
    const length = u16be(b, after);
    if (length < 2) throw malformed('JPEG segment length under 2');
    const headerEnd = after + length;
    let end = headerEnd;
    need(b, end, 'JPEG segment');
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker that is not a stuffed
      // 0xFF00 or a restart marker.
      let i = end;
      for (;;) {
        i = b.indexOf(0xff, i);
        if (i < 0 || i + 1 >= b.length) throw malformed('JPEG scan data has no end marker');
        const n = b[i + 1]!;
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) i += 2;
        else if (n === 0xff) i += 1;
        else break;
      }
      end = i;
    }
    segments.push({ marker, offset: o, payload: after + 2, headerEnd, end });
    o = end;
  }
}

/**
 * True when a decoding segment is exactly as long as its content says.
 * Decoders reject a mismatch, and checking it means no extra bytes can ride
 * along in a kept segment (security review 2026-11-08).
 */
function exactLength(b: Uint8Array, s: JpegSegment): boolean {
  const m = s.marker;
  const p = s.payload;
  const n = s.headerEnd - p;
  if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) return n === 0;
  if (isSof(m)) return n >= 6 && n === 6 + 3 * b[p + 5]!;
  if (m === 0xda) return n >= 1 && n === 1 + 2 * b[p]! + 3;
  if (m === 0xdd || m === 0xdc) return n === 2; // DRI, DNL
  if (m === 0xdf) return n === 1; // EXP
  if (m === 0xcc) return n > 0 && n % 2 === 0; // DAC
  let i = p;
  if (m === 0xdb) {
    // DQT: (precision/id, 64 or 128 bytes) repeated
    while (i < s.headerEnd) {
      const precision = b[i]! >> 4;
      if (precision > 1) return false;
      i += 1 + (precision ? 128 : 64);
    }
    return n > 0 && i === s.headerEnd;
  }
  if (m === 0xc4) {
    // DHT: (class/id, 16 counts, values) repeated
    while (i < s.headerEnd) {
      if (i + 17 > s.headerEnd) return false;
      let count = 0;
      for (let k = 1; k <= 16; k++) count += b[i + k]!;
      i += 17 + count;
    }
    return n > 0 && i === s.headerEnd;
  }
  return true;
}

/** The ICC segments form one whole profile: sequence 1..N, same count, header size = data. */
function validIcc(b: Uint8Array, icc: JpegSegment[]): boolean {
  const n = icc.length;
  const parts: Uint8Array[] = new Array<Uint8Array>(n);
  for (const s of icc) {
    if (s.end - s.payload < ICC_ID.length + 3) return false;
    const seq = b[s.payload + ICC_ID.length]!;
    const count = b[s.payload + ICC_ID.length + 1]!;
    if (count !== n || seq < 1 || seq > n || parts[seq - 1]) return false;
    parts[seq - 1] = b.subarray(s.payload + ICC_ID.length + 2, s.end);
  }
  return isIccProfile(concat(parts));
}

function appName(marker: number): string {
  return marker === 0xfe ? 'COM' : `APP${marker - 0xe0}`;
}

interface Plan {
  kind: BlockKind;
  label: string | null;
  action: BlockAction;
}

interface Context {
  firstExif: JpegSegment | undefined;
  orientation: number;
  iccValid: boolean;
  seen: Set<string>;
}

function planSegment(b: Uint8Array, s: JpegSegment, ctx: Context): Plan {
  const m = s.marker;
  const p = s.payload;
  const has = (id: string): boolean => p + id.length <= s.end && startsWith(b, p, id);
  // Only the first JFIF and the first Adobe segment are kept.
  const first = (label: string): boolean => {
    if (ctx.seen.has(label)) return false;
    ctx.seen.add(label);
    return true;
  };
  if (isImageMarker(m)) {
    if (!exactLength(b, s)) throw malformed(`JPEG ${markerName(m)} segment length does not match its content`);
    return { kind: 'image', label: null, action: 'keep' };
  }
  switch (m) {
    case 0xe0:
      if (has(JFIF_ID) && s.end - p >= JFIF_HEADER) {
        if (!first('JFIF')) return { kind: 'other', label: 'JFIF (duplicate)', action: 'remove' };
        const thumb = b[p + 12]! * b[p + 13]! > 0 || s.end - p > JFIF_HEADER;
        return thumb
          ? { kind: 'thumbnail', label: 'JFIF', action: 'rewrite' }
          : { kind: 'image', label: 'JFIF', action: 'keep' };
      }
      if (has('JFXX\0')) return { kind: 'thumbnail', label: 'JFXX', action: 'remove' };
      return { kind: 'other', label: null, action: 'remove' };
    case 0xe1:
      if (has(EXIF_ID)) {
        return { kind: 'exif', label: 'EXIF', action: s === ctx.firstExif && ctx.orientation !== 1 ? 'rewrite' : 'remove' };
      }
      if (has(XMP_ID)) return { kind: 'xmp', label: 'XMP', action: 'remove' };
      if (has(XMP_EXT_ID)) return { kind: 'xmp', label: 'Extended XMP', action: 'remove' };
      return { kind: 'other', label: null, action: 'remove' };
    case 0xe2:
      if (has(ICC_ID)) {
        return ctx.iccValid
          ? { kind: 'color', label: 'ICC profile', action: 'keep' }
          : { kind: 'other', label: 'ICC profile (invalid)', action: 'remove' };
      }
      if (has('MPF\0')) return { kind: 'secondary-image', label: 'MPF', action: 'remove' };
      return { kind: 'other', label: null, action: 'remove' };
    case 0xeb:
      // Every APP11, not only the first: a C2PA store spans several (C2PA 2.2 A.3.1).
      return has('JP') ? { kind: 'c2pa', label: 'JUMBF', action: 'remove' } : { kind: 'other', label: null, action: 'remove' };
    case 0xed:
      return has('Photoshop 3.0\0')
        ? { kind: 'iptc', label: 'Photoshop / IPTC', action: 'remove' }
        : { kind: 'other', label: null, action: 'remove' };
    case 0xee:
      // Adobe APP14 tells the decoder the colour transform (CMYK / YCCK): keep
      // its 12 bytes, and nothing that rides after them (L1 code review M1).
      if (!has('Adobe')) return { kind: 'other', label: null, action: 'remove' };
      if (!first('Adobe')) return { kind: 'other', label: 'Adobe (duplicate)', action: 'remove' };
      if (s.end - p === ADOBE_SIZE) return { kind: 'color', label: 'Adobe', action: 'keep' };
      return s.end - p > ADOBE_SIZE
        ? { kind: 'color', label: 'Adobe', action: 'rewrite' }
        : { kind: 'other', label: 'Adobe', action: 'remove' };
    case 0xfe:
      return { kind: 'comment', label: null, action: 'remove' };
    default:
      if (m >= 0xe3 && m <= 0xef) return { kind: 'other', label: null, action: 'remove' };
      throw new EngineError('unknown-marker', `JPEG marker 0xFF${m.toString(16).toUpperCase()} is not supported`);
  }
}

export function parseJpeg(b: Uint8Array): Parsed {
  const { segments, end } = readJpegSegments(b);
  const sof = segments.find((s) => isSof(s.marker));
  if (!sof || sof.end - sof.payload < 6) throw malformed('JPEG has no frame header');
  if (!segments.some((s) => s.marker === 0xda)) throw malformed('JPEG has no scan');

  const isExif = (s: JpegSegment): boolean => s.marker === 0xe1 && s.payload + 6 <= s.end && startsWith(b, s.payload, EXIF_ID);
  const firstExif = segments.find(isExif);
  const orientation = firstExif ? readOrientation(b.subarray(firstExif.payload + 6, firstExif.end)) : 1;

  const icc = segments.filter((s) => s.marker === 0xe2 && s.payload + ICC_ID.length <= s.end && startsWith(b, s.payload, ICC_ID));
  const ctx: Context = { firstExif, orientation, iccValid: icc.length > 0 && validIcc(b, icc), seen: new Set() };
  const plans = segments.map((s) => planSegment(b, s, ctx));
  const blocks: Block[] = segments.map((s, i) => {
    const plan = plans[i]!;
    const name = (s.marker >= 0xe0 && s.marker <= 0xef) || s.marker === 0xfe ? appName(s.marker) : markerName(s.marker);
    return { name, label: plan.label, offset: s.offset, size: s.end - s.offset, kind: plan.kind, action: plan.action };
  });
  if (end < b.length) {
    // After EOI: MPF secondary images (Ultra HDR gain map), Motion Photo video…
    const mpf = plans.some((p) => p.label === 'MPF');
    blocks.push({
      name: 'trailing data',
      label: null,
      offset: end,
      size: b.length - end,
      kind: mpf ? 'secondary-image' : 'trailing',
      action: 'remove',
    });
  }

  const structure: Structure = {
    format: 'jpeg',
    mime: 'image/jpeg',
    width: u16be(b, sof.payload + 3),
    height: u16be(b, sof.payload + 1),
    animated: false,
    orientation,
    blocks,
  };

  return {
    structure,
    orientationBlock,
    write(): Uint8Array<ArrayBuffer> {
      const parts: Uint8Array[] = [];
      segments.forEach((s, i) => {
        const plan = plans[i]!;
        if (plan.action === 'keep') parts.push(b.subarray(s.offset, s.end));
        else if (plan.action === 'rewrite' && plan.kind === 'exif') parts.push(orientationBlock(orientation));
        else if (plan.action === 'rewrite' && plan.label === 'Adobe') {
          parts.push(new Uint8Array([0xff, 0xee, 0x00, ADOBE_SIZE + 2]), b.subarray(s.payload, s.payload + ADOBE_SIZE));
        } else if (plan.action === 'rewrite' && plan.label === 'JFIF') {
          const header = b.slice(s.payload, s.payload + JFIF_HEADER);
          header[12] = 0;
          header[13] = 0;
          parts.push(new Uint8Array([0xff, 0xe0, 0x00, JFIF_HEADER + 2]), header);
        }
      });
      return concat(parts);
    },
  };
}

function orientationBlock(orientation: number): Uint8Array<ArrayBuffer> {
  const payload = concat([asciiBytes(EXIF_ID), orientationTiff(orientation)]);
  return concat([new Uint8Array([0xff, 0xe1, 0x00, payload.length + 2]), payload]);
}

const MARKER_NAMES: Record<number, string> = {
  0xc4: 'DHT',
  0xcc: 'DAC',
  0xd8: 'SOI',
  0xd9: 'EOI',
  0xda: 'SOS',
  0xdb: 'DQT',
  0xdc: 'DNL',
  0xdd: 'DRI',
  0xdf: 'EXP',
  0x01: 'TEM',
};

function markerName(m: number): string {
  if (isSof(m)) return `SOF${m - 0xc0}`;
  if (m >= 0xd0 && m <= 0xd7) return `RST${m - 0xd0}`;
  return MARKER_NAMES[m] ?? `0xFF${m.toString(16).toUpperCase()}`;
}
