import { asciiBytes, concat, fourcc, le32, need, startsWith, u16le, u24le, u32le } from './bytes';
import { malformed } from './errors';
import { orientationTiff, readOrientation } from './exif';
import { isIccProfile } from './icc';
import { MAX_BLOCKS } from './limits';
import type { Parsed } from './parsed';
import type { Block, BlockKind, Structure } from './types';

export interface RiffChunk {
  fourcc: string;
  offset: number;
  dataStart: number;
  size: number;
  /** End including the pad byte of an odd-sized chunk. */
  end: number;
}

const FLAG_EXIF = 0x08;
const FLAG_ANIMATION = 0x02;
const FLAG_ICC = 0x20;
/** VP8X flags kept as they are: alpha, animation. ICC and EXIF are recomputed, reserved bits zeroed. */
const FLAGS_KEPT = 0x10 | FLAG_ANIMATION;
const ANIM_SIZE = 6;

const KEEP: Record<string, BlockKind> = {
  VP8X: 'image',
  'VP8 ': 'image',
  VP8L: 'image',
  ALPH: 'image',
  ANIM: 'image',
  ANMF: 'image',
  ICCP: 'color',
};

const FRAME_KEEP = new Set(['ALPH', 'VP8 ', 'VP8L']);
const ANMF_HEADER = 16;

/** FourCC for display: unknown chunks may hold any byte. */
function nameOf(id: string): string {
  return id.replace(/[^\x20-\x7e]/g, '?').trim() || '????';
}

export function readRiffChunks(b: Uint8Array, start: number, end: number): RiffChunk[] {
  const chunks: RiffChunk[] = [];
  let o = start;
  while (o < end) {
    if (o + 8 > end) throw malformed('WebP chunk header runs past its container');
    const size = u32le(b, o + 4);
    const dataEnd = o + 8 + size;
    if (dataEnd > end) throw malformed('WebP chunk runs past its container');
    chunks.push({ fourcc: fourcc(b, o), offset: o, dataStart: o + 8, size, end: Math.min(dataEnd + (size & 1), end) });
    if (chunks.length > MAX_BLOCKS) throw malformed('WebP has too many blocks');
    o = chunks[chunks.length - 1]!.end;
  }
  return chunks;
}

/** A chunk's header and data, plus a zero pad byte when the size is odd. */
function copyChunk(b: Uint8Array, c: RiffChunk): Uint8Array[] {
  const body = b.subarray(c.offset, c.dataStart + c.size);
  return c.size & 1 ? [body, new Uint8Array(1)] : [body];
}

export function exifTiffOf(data: Uint8Array): Uint8Array {
  // The container spec does not say whether the "Exif\0\0" prefix is present;
  // writers differ, so accept both.
  return startsWith(data, 0, 'Exif\0\0') ? data.subarray(6) : data;
}

function dimensions(b: Uint8Array, c: RiffChunk): { width: number; height: number } {
  const d = c.dataStart;
  if (c.fourcc === 'VP8X') {
    if (c.size < 10) throw malformed('WebP VP8X chunk too short');
    return { width: 1 + u24le(b, d + 4), height: 1 + u24le(b, d + 7) };
  }
  if (c.fourcc === 'VP8 ') {
    if (c.size < 10 || b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) {
      throw malformed('WebP VP8 key frame header missing');
    }
    return { width: u16le(b, d + 6) & 0x3fff, height: u16le(b, d + 8) & 0x3fff };
  }
  if (c.fourcc === 'VP8L') {
    if (c.size < 5 || b[d] !== 0x2f) throw malformed('WebP VP8L signature missing');
    const bits = u32le(b, d + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw malformed('WebP does not start with VP8, VP8L or VP8X');
}

export function parseWebp(b: Uint8Array): Parsed {
  need(b, 12, 'RIFF header');
  if (!startsWith(b, 0, 'RIFF') || !startsWith(b, 8, 'WEBP')) throw malformed('not a RIFF WEBP file');
  const riffEnd = 8 + u32le(b, 4);
  if (riffEnd < 20) throw malformed('RIFF size too small');
  need(b, riffEnd, 'RIFF payload');

  const chunks = readRiffChunks(b, 12, riffEnd);
  const first = chunks[0];
  if (!first) throw malformed('WebP has no chunk');
  const { width, height } = dimensions(b, first);
  const extended = first.fourcc === 'VP8X';
  const flags = extended ? b[first.dataStart]! : 0;

  // EXIF is only defined in the extended format (it needs the VP8X flag).
  const firstExif = extended ? chunks.find((c) => c.fourcc === 'EXIF') : undefined;
  const orientation = firstExif
    ? readOrientation(exifTiffOf(b.subarray(firstExif.dataStart, firstExif.dataStart + firstExif.size)))
    : 1;

  // Strict layout (security review 2026-11-08), so no duplicate or misplaced
  // image chunk can ride along: simple format = the first bitstream only;
  // extended = VP8X, at most one valid ICCP (flag set) before the image, then
  // ANIM + ANMF frames when animated, else an optional ALPH right before VP8
  // and a single bitstream.
  const animatedFlag = extended && (flags & FLAG_ANIMATION) !== 0;
  const layout = new Set<RiffChunk>([first]);
  let iccKept = false;
  if (extended) {
    let imageSeen = false;
    let animKept = false;
    let bitstream = false;
    let frameCount = 0;
    chunks.forEach((c, i) => {
      if (i === 0) return;
      const keepIt = (): void => {
        layout.add(c);
      };
      switch (c.fourcc) {
        case 'ICCP':
          if (!iccKept && !imageSeen && (flags & FLAG_ICC) !== 0 && isIccProfile(b.subarray(c.dataStart, c.dataStart + c.size))) {
            keepIt();
            iccKept = true;
          }
          break;
        case 'ANIM':
          if (animatedFlag && !animKept && !imageSeen) {
            keepIt();
            animKept = true;
          }
          break;
        case 'ANMF':
          if (animatedFlag && animKept) {
            keepIt();
            frameCount++;
          }
          imageSeen = true;
          break;
        case 'ALPH':
          if (!animatedFlag && !bitstream && !imageSeen && chunks[i + 1]?.fourcc === 'VP8 ') keepIt();
          imageSeen = true;
          break;
        case 'VP8 ':
        case 'VP8L':
          if (!animatedFlag && !bitstream) {
            keepIt();
            bitstream = true;
          }
          imageSeen = true;
          break;
      }
    });
    if (animatedFlag ? frameCount === 0 : !bitstream) throw malformed('WebP has no image data in the expected place');
  }

  const blocks: Block[] = [];
  const frames = new Map<RiffChunk, RiffChunk[]>();
  for (const c of chunks) {
    const kept = KEEP[c.fourcc];
    if (kept && !layout.has(c)) {
      const label = c.fourcc === 'ICCP' ? 'ICC profile (invalid, repeated or without flag)' : 'out of place';
      blocks.push({ name: nameOf(c.fourcc), label, offset: c.offset, size: c.end - c.offset, kind: 'other', action: 'remove' });
      continue;
    }
    if (kept) {
      // ANIM is 6 bytes by the spec; anything after them is not kept (L1 code review M1).
      if (c.fourcc === 'ANIM' && c.size < ANIM_SIZE) throw malformed('WebP ANIM chunk too short');
      const action = c.fourcc === 'ANIM' && c.size > ANIM_SIZE ? 'rewrite' : 'keep';
      blocks.push({ name: nameOf(c.fourcc), label: null, offset: c.offset, size: c.end - c.offset, kind: kept, action });
      if (c.fourcc === 'ANMF') {
        if (c.size < ANMF_HEADER) throw malformed('WebP ANMF chunk too short');
        const subs = readRiffChunks(b, c.dataStart + ANMF_HEADER, c.dataStart + c.size);
        // A frame keeps an optional ALPH right before VP8 and its first
        // bitstream; unknown chunks (allowed at the end of a frame) and
        // repeated image chunks are dropped.
        const keptSubs: RiffChunk[] = [];
        let bitstream = false;
        subs.forEach((sub, j) => {
          const isBitstream = sub.fourcc === 'VP8 ' || sub.fourcc === 'VP8L';
          const ok = isBitstream ? !bitstream : sub.fourcc === 'ALPH' && !bitstream && keptSubs.length === 0 && subs[j + 1]?.fourcc === 'VP8 ';
          if (isBitstream && ok) bitstream = true;
          if (ok) keptSubs.push(sub);
          else {
            const label = FRAME_KEEP.has(sub.fourcc) ? 'out of place' : null;
            blocks.push({ name: `ANMF/${nameOf(sub.fourcc)}`, label, offset: sub.offset, size: sub.end - sub.offset, kind: 'other', action: 'remove' });
          }
        });
        if (!bitstream) throw malformed('WebP frame has no bitstream');
        frames.set(c, keptSubs);
      }
      continue;
    }
    let kind: BlockKind = 'other';
    let label: string | null = null;
    if (c.fourcc === 'EXIF') kind = 'exif';
    else if (c.fourcc === 'XMP ') {
      kind = 'xmp';
      label = 'XMP';
    } else if (c.fourcc === 'C2PA') kind = 'c2pa';
    const action = c === firstExif && orientation !== 1 ? 'rewrite' : 'remove';
    blocks.push({ name: nameOf(c.fourcc), label, offset: c.offset, size: c.end - c.offset, kind, action });
  }
  if (blocks.length > MAX_BLOCKS) throw malformed('WebP has too many blocks');
  if (riffEnd < b.length) {
    blocks.push({ name: 'trailing data', label: null, offset: riffEnd, size: b.length - riffEnd, kind: 'trailing', action: 'remove' });
  }

  const structure: Structure = {
    format: 'webp',
    mime: 'image/webp',
    width,
    height,
    animated: animatedFlag,
    orientation,
    blocks,
  };

  return {
    structure,
    orientationBlock,
    write(): Uint8Array<ArrayBuffer> {
      const parts: Uint8Array[] = [];
      for (const c of chunks) {
        if (KEEP[c.fourcc] && !layout.has(c)) continue; // duplicate or misplaced image chunk
        if (c.fourcc === 'VP8X') {
          const data = b.slice(c.dataStart, c.dataStart + 10);
          data[0] = (data[0]! & FLAGS_KEPT) | (iccKept ? FLAG_ICC : 0) | (orientation !== 1 ? FLAG_EXIF : 0);
          data.fill(0, 1, 4); // reserved
          parts.push(asciiBytes('VP8X'), le32(10), data);
        } else if (c.fourcc === 'ANIM') {
          parts.push(asciiBytes('ANIM'), le32(ANIM_SIZE), b.subarray(c.dataStart, c.dataStart + ANIM_SIZE));
        } else if (c.fourcc === 'ANMF') {
          const header = b.slice(c.dataStart, c.dataStart + ANMF_HEADER);
          header[15] = header[15]! & 0x03; // blending + disposal bits; the rest is reserved
          const body = concat([header, ...(frames.get(c) ?? []).flatMap((s) => copyChunk(b, s))]);
          parts.push(asciiBytes('ANMF'), le32(body.length), body);
        } else if (KEEP[c.fourcc]) {
          parts.push(...copyChunk(b, c));
        } else if (c === firstExif && orientation !== 1) {
          parts.push(orientationBlock(orientation));
        }
      }
      const body = concat(parts);
      return concat([asciiBytes('RIFF'), le32(body.length + 4), asciiBytes('WEBP'), body]);
    },
  };
}

function orientationBlock(orientation: number): Uint8Array<ArrayBuffer> {
  const tiff = orientationTiff(orientation); // 26 bytes: even, no pad byte
  return concat([asciiBytes('EXIF'), le32(tiff.length), tiff]);
}
