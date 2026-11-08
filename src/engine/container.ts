import { detectFormat } from './detect';
import { EngineError } from './errors';
import { parseJpeg } from './jpeg';
import type { Parsed } from './parsed';
import { parsePng } from './png';
import { parseWebp } from './webp';

import { MAX_FILE_BYTES } from './limits';

export { MAX_FILE_BYTES } from './limits';

/** Parses the container; throws EngineError for anything it cannot clean safely. */
export function parse(bytes: Uint8Array): Parsed {
  if (bytes.length > MAX_FILE_BYTES) throw new EngineError('too-large', `file is over ${MAX_FILE_BYTES} bytes`);
  const format = detectFormat(bytes);
  switch (format) {
    case 'png':
      return parsePng(bytes);
    case 'jpeg':
      return parseJpeg(bytes);
    case 'webp':
      return parseWebp(bytes);
    default:
      throw new EngineError('unsupported-format', `format ${format} is not supported`, format);
  }
}
