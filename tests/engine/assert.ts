import { expect } from 'vitest';
import { analyze, strip, verifyClean, type StripResult } from '../../src/engine';

/** Bytes of the image and colour blocks that must survive unchanged, in order. */
export function keptBlocks(b: Uint8Array): string[] {
  return analyze(b)
    .blocks.filter((x) => x.action === 'keep' && (x.kind === 'image' || x.kind === 'color'))
    // VP8X (flags), ANMF (frame chunks), JFIF (thumbnail) and iCCP (name, encoding) are rebuilt on purpose.
    .filter((x) => x.name !== 'VP8X' && x.name !== 'ANMF' && x.name !== 'iCCP' && x.label !== 'JFIF')
    .map((x) => Buffer.from(b.subarray(x.offset, x.offset + x.size)).toString('hex'));
}

/** Strips, then checks the output re-reads as clean with every image block intact. */
export function stripClean(input: Uint8Array): StripResult {
  const result = strip(input);
  expect(verifyClean(result.bytes)).toBe(true);
  expect(keptBlocks(result.bytes)).toEqual(keptBlocks(input));
  const after = analyze(result.bytes);
  expect(after.blocks.filter((x) => x.action !== 'keep').every((x) => x.kind === 'exif' && x.action === 'rewrite')).toBe(true);
  expect([after.width, after.height]).toEqual([result.structure.width, result.structure.height]);
  return result;
}
