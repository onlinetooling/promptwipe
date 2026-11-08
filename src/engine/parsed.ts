import type { Structure } from './types';

/** What each format module returns: the plan, and how to apply it. */
export interface Parsed {
  structure: Structure;
  /** Writes the cleaned file: kept blocks byte for byte, rewritten blocks minimal. */
  write(): Uint8Array<ArrayBuffer>;
  /** The exact bytes of the orientation-only EXIF block this format writes. */
  orientationBlock(orientation: number): Uint8Array<ArrayBuffer>;
}
