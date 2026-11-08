import { fourcc, startsWith, u32be } from './bytes';
import type { DetectedFormat } from './types';

const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

/** Format from the first bytes; the file name and MIME type are never trusted. */
export function detectFormat(b: Uint8Array): DetectedFormat {
  if (b.length >= 8 && b[0] === 0x89 && startsWith(b, 1, 'PNG\r\n\x1a\n')) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'webp';
  if (startsWith(b, 0, 'GIF87a') || startsWith(b, 0, 'GIF89a')) return 'gif';
  if (b.length >= 16 && startsWith(b, 4, 'ftyp')) {
    // ISO BMFF: major brand at 8, compatible brands from 16 to the box end.
    const end = Math.min(u32be(b, 0), b.length, 4096);
    const brands = [fourcc(b, 8)];
    for (let o = 16; o + 4 <= end; o += 4) brands.push(fourcc(b, o));
    if (brands.some((x) => AVIF_BRANDS.has(x))) return 'avif';
    if (brands.some((x) => HEIC_BRANDS.has(x))) return 'heic';
  }
  return 'unknown';
}
