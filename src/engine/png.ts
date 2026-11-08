import { asciiBytes, be32, concat, crc32, decodeLatin1, indexOfNul, need, u32be } from './bytes';
import { EngineError, malformed } from './errors';
import { orientationTiff, readOrientation } from './exif';
import { MAX_BLOCKS } from './limits';
import type { Block, BlockKind, Structure } from './types';
import type { Parsed } from './parsed';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Chunks copied unchanged: needed to display the image (design §3, D3). */
const KEEP: Record<string, BlockKind> = {
  IHDR: 'image',
  PLTE: 'image',
  IDAT: 'image',
  IEND: 'image',
  tRNS: 'image',
  acTL: 'image',
  fcTL: 'image',
  fdAT: 'image',
  sRGB: 'color',
  gAMA: 'color',
  cHRM: 'color',
  iCCP: 'color',
  cICP: 'color',
  mDCV: 'color',
  mDCv: 'color', // pre-REC spelling
  cLLI: 'color',
  cLLi: 'color', // pre-REC spelling
};

const CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

/**
 * Kept chunks have a fixed size by the spec. A wrong size would let any
 * payload ride along in a "kept" block (L1 code review M1): such a chunk is
 * invalid and ignored by decoders, so it is dropped.
 */
const FIXED_SIZE: Record<string, number> = { gAMA: 4, sRGB: 1, cHRM: 32, cICP: 4, mDCV: 24, mDCv: 24, cLLI: 8, cLLi: 8 };
const APNG_SIZE: Record<string, number> = { acTL: 8, fcTL: 26 };

/** Removed chunks we can name more precisely than "other". */
const REMOVED_KIND: Record<string, BlockKind> = {
  tEXt: 'text',
  zTXt: 'text',
  iTXt: 'text',
  eXIf: 'exif',
  caBX: 'c2pa',
};

export interface PngChunk {
  type: string;
  offset: number;
  dataStart: number;
  length: number;
  /** Offset just after the CRC. */
  end: number;
}

function isLetter(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const typed = concat([asciiBytes(type), data]);
  return concat([be32(data.length), typed, be32(crc32(typed))]);
}

/** Keyword of a tEXt / zTXt / iTXt chunk (1-79 Latin-1 bytes before a NUL). */
export function textKeyword(b: Uint8Array, c: PngChunk): string | null {
  const end = c.dataStart + c.length;
  const nul = indexOfNul(b, c.dataStart, Math.min(end, c.dataStart + 80));
  return nul > c.dataStart ? decodeLatin1(b.subarray(c.dataStart, nul)) : null;
}

export function readPngChunks(b: Uint8Array): { chunks: PngChunk[]; end: number } {
  need(b, SIGNATURE.length, 'PNG signature');
  const chunks: PngChunk[] = [];
  let o = SIGNATURE.length;
  for (;;) {
    need(b, o + 8, 'PNG chunk header');
    const length = u32be(b, o);
    if (length > 0x7fffffff) throw malformed('PNG chunk length over 2^31-1');
    for (let i = 4; i < 8; i++) {
      if (!isLetter(b[o + i]!)) throw malformed('PNG chunk type is not four letters');
    }
    const type = String.fromCharCode(b[o + 4]!, b[o + 5]!, b[o + 6]!, b[o + 7]!);
    const end = o + 8 + length + 4;
    need(b, end, `PNG ${type} chunk`);
    chunks.push({ type, offset: o, dataStart: o + 8, length, end });
    if (chunks.length > MAX_BLOCKS) throw malformed('PNG has too many blocks');
    o = end;
    if (type === 'IEND') return { chunks, end: o };
  }
}

export function parsePng(b: Uint8Array): Parsed {
  const { chunks, end } = readPngChunks(b);
  const ihdr = chunks[0];
  if (!ihdr || ihdr.type !== 'IHDR' || ihdr.length !== 13) throw malformed('PNG does not start with IHDR');
  if (!chunks.some((c) => c.type === 'IDAT')) throw malformed('PNG has no IDAT');

  const firstExif = chunks.find((c) => c.type === 'eXIf');
  const orientation = firstExif
    ? readOrientation(b.subarray(firstExif.dataStart, firstExif.dataStart + firstExif.length))
    : 1;

  const colorType = b[ihdr.dataStart + 9]!;
  const plte = chunks.find((c) => c.type === 'PLTE');
  const apng = chunks.some((c) => c.type === 'acTL');
  const tRNSSize = (n: number): boolean =>
    colorType === 0 ? n === 2 : colorType === 2 ? n === 6 : colorType === 3 ? n >= 1 && n <= (plte ? plte.length / 3 : 0) : false;

  const blocks: Block[] = [];
  const keep: boolean[] = [];
  for (const c of chunks) {
    const kept = KEEP[c.type];
    if (kept) {
      if (c.type === 'IHDR' && c !== ihdr) throw malformed('PNG has a second IHDR');
      if (c.type === 'IEND' && c.length !== 0) throw malformed('PNG IEND carries data');
      if (c.type === 'PLTE' && (c.length === 0 || c.length % 3 !== 0 || c.length > 768)) throw malformed('PNG PLTE has a bad size');
      const apngSize = APNG_SIZE[c.type];
      if (apng && apngSize !== undefined && c.length !== apngSize) throw malformed(`PNG ${c.type} has a bad size`);
      const fixed = FIXED_SIZE[c.type];
      const invalid =
        (fixed !== undefined && c.length !== fixed) ||
        (c.type === 'tRNS' && !tRNSSize(c.length)) ||
        (!apng && (c.type === 'fcTL' || c.type === 'fdAT'));
      if (invalid) {
        const label = !apng && (c.type === 'fcTL' || c.type === 'fdAT') ? 'APNG frame without acTL' : 'invalid size';
        blocks.push({ name: c.type, label, offset: c.offset, size: c.end - c.offset, kind: 'other', action: 'remove' });
        keep.push(false);
        continue;
      }
      blocks.push({ name: c.type, label: null, offset: c.offset, size: c.end - c.offset, kind: kept, action: 'keep' });
      keep.push(true);
      continue;
    }
    // First letter uppercase = critical: a decoder must understand it, so
    // dropping or copying it blindly could both produce a wrong image.
    if ((b[c.offset + 4]! & 0x20) === 0 && !CRITICAL.has(c.type)) {
      throw new EngineError('unknown-critical-chunk', `PNG critical chunk ${c.type} is not supported`);
    }
    let kind = REMOVED_KIND[c.type] ?? 'other';
    let label: string | null = null;
    if (c.type === 'iTXt' && textKeyword(b, c) === 'XML:com.adobe.xmp') {
      kind = 'xmp';
      label = 'XMP';
    }
    const action = c === firstExif && orientation !== 1 ? 'rewrite' : 'remove';
    blocks.push({ name: c.type, label, offset: c.offset, size: c.end - c.offset, kind, action });
    keep.push(false);
  }
  if (end < b.length) {
    blocks.push({ name: 'trailing data', label: null, offset: end, size: b.length - end, kind: 'trailing', action: 'remove' });
  }

  const structure: Structure = {
    format: 'png',
    mime: 'image/png',
    width: u32be(b, ihdr.dataStart),
    height: u32be(b, ihdr.dataStart + 4),
    animated: apng,
    orientation,
    blocks,
  };

  return {
    structure,
    orientationBlock,
    write(): Uint8Array<ArrayBuffer> {
      const parts: Uint8Array[] = [new Uint8Array(SIGNATURE)];
      chunks.forEach((c, i) => {
        if (keep[i]) parts.push(b.subarray(c.offset, c.end));
        // eXIf goes right after IHDR: before IDAT (PNG 3e) and before acTL.
        if (c === ihdr && orientation !== 1) parts.push(orientationBlock(orientation));
      });
      return concat(parts);
    },
  };
}

function orientationBlock(orientation: number): Uint8Array<ArrayBuffer> {
  return pngChunk('eXIf', orientationTiff(orientation));
}
