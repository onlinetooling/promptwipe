// PromptWipe engine: shows and removes the metadata of PNG, JPEG and WebP
// images by container surgery (design §3). Image blocks are copied byte for
// byte; metadata blocks are not copied. No decoding, no re-encoding.

import { equalBytes } from './bytes';
import { parse } from './container';
import { EngineError } from './errors';
import type { Parsed } from './parsed';
import type { StripResult, Structure } from './types';

export { parse } from './container';
export { MAX_BLOCKS, MAX_FILE_BYTES, MAX_TEXTS } from './limits';
export { detectFormat } from './detect';
export { EngineError, type EngineErrorCode } from './errors';
export { inspect, type Inspection, type TextEntry, type InspectWarning } from './inspect';
export type { ExifSummary, ExifField } from './exif';
export type { XmpSummary } from './xmp';
export type { C2paSummary } from './c2pa';
export type * from './types';

/** The block plan for a file: what is kept, removed or rewritten. */
export function analyze(bytes: Uint8Array): Structure {
  return parse(bytes).structure;
}

/**
 * Removes every metadata block. The output is re-read before it is returned:
 * if it does not parse as clean, with the same dimensions, nothing is returned.
 */
export function strip(bytes: Uint8Array): StripResult {
  const parsed = parse(bytes);
  const out = parsed.write();
  const problem = cleanProblem(out, parsed.structure);
  if (problem) throw new EngineError('verification-failed', problem);
  const { orientation } = parsed.structure;
  return { structure: parsed.structure, bytes: out, orientationKept: orientation !== 1 ? orientation : null };
}

/** True if `bytes` holds no metadata block (an orientation-only EXIF is allowed). */
export function verifyClean(bytes: Uint8Array): boolean {
  try {
    return cleanProblem(bytes, null) === null;
  } catch {
    return false;
  }
}

function cleanProblem(out: Uint8Array, source: Structure | null): string | null {
  let reread: Parsed;
  try {
    reread = parse(out);
  } catch (e) {
    return `output does not parse (${e instanceof EngineError ? e.code : 'error'})`;
  }
  const s = reread.structure;
  if (source && (s.format !== source.format || s.width !== source.width || s.height !== source.height)) {
    return 'output format or dimensions differ from the source';
  }
  if (source && s.orientation !== source.orientation) return 'output orientation differs from the source';
  for (const block of s.blocks) {
    if (block.action === 'keep') continue;
    const allowed =
      block.kind === 'exif' &&
      block.action === 'rewrite' &&
      equalBytes(out.subarray(block.offset, block.offset + block.size), reread.orientationBlock(s.orientation));
    if (!allowed) return `output still holds a ${block.kind} block (${block.name})`;
  }
  return null;
}
