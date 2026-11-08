import { malformed } from './errors';

// Readers below do not check bounds themselves: callers check with `need`
// first, so a short file becomes a typed 'malformed' error instead of a silent
// zero.

/** Throws 'malformed' unless `end` lies within the buffer. */
export function need(b: Uint8Array, end: number, what: string): void {
  if (!Number.isSafeInteger(end) || end < 0 || end > b.length) {
    throw malformed(`${what} runs past the end of the file`);
  }
}

export function u16be(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}

export function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

export function u16le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}

export function u24le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
}

export function u32le(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/** Four bytes as ASCII (chunk types, FourCCs, box types). */
export function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
}

/** True if the bytes at `o` equal the ASCII string `s`. */
export function startsWith(b: Uint8Array, o: number, s: string): boolean {
  if (o + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) {
    if (b[o + i] !== s.charCodeAt(i)) return false;
  }
  return true;
}

export function asciiBytes(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function be32(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

export function le32(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 as used by PNG (ISO 3309 / ITU-T V.42). */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = new TextDecoder('utf-8');
const utf8Strict = new TextDecoder('utf-8', { fatal: true });

export function decodeUtf8(b: Uint8Array): string {
  return utf8.decode(b);
}

/**
 * ISO-8859-1, byte for byte. TextDecoder('latin1') is windows-1252 in the
 * Encoding standard, which would turn 0x80-0x9F into other characters.
 */
export function decodeLatin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

/**
 * PNG tEXt / zTXt text: Latin-1 by the spec, but some tools write UTF-8 into
 * it. Valid UTF-8 with non-ASCII bytes is practically never meant as Latin-1.
 */
export function decodePngText(b: Uint8Array): string {
  try {
    return utf8Strict.decode(b);
  } catch {
    return decodeLatin1(b);
  }
}

/** Removes trailing NUL and white space without a regular expression (linear). */
export function trimText(s: string): string {
  let end = s.length;
  while (end > 0) {
    const c = s.charCodeAt(end - 1);
    if (c === 0 || c === 32 || (c >= 9 && c <= 13)) end--;
    else break;
  }
  return s.slice(0, end).trim();
}

/** Index of the first 0 byte in [start, end), or -1. */
export function indexOfNul(b: Uint8Array, start: number, end: number): number {
  const i = b.indexOf(0, start);
  return i >= 0 && i < end ? i : -1;
}
