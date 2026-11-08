import {
  EngineError,
  MAX_FILE_BYTES,
  detectFormat,
  inspect,
  strip,
  type DetectedFormat,
  type EngineErrorCode,
  type Inspection,
  type StripResult,
} from '../engine';
import { cleanName } from './format';

// One file, start to finish: read, inspect, strip, then decode the original and
// the output and compare their sizes before anything is offered (design §3).
// No DOM here, so it is tested without a browser.

/** Above this, the pictures are not decoded for the check (memory): structure check only. */
export const MAX_DECODE_PIXELS = 40_000_000;

/** A decode that takes longer is given up (a hung decoder must not leave the page on "Reading…"). */
export const DECODE_TIMEOUT_MS = 20_000;

export type Source = 'drop' | 'file' | 'paste';

export interface DecodedSize {
  width: number;
  height: number;
}

/** Decodes an image and returns its size, or null if this browser cannot decode it. */
export type Decoder = (blob: Blob) => Promise<DecodedSize | null>;

/** How the cleaned file was checked beyond the engine's own re-read. */
export type Check =
  | 'decoded' // original and output decoded, same size
  | 'skipped-large' // over MAX_DECODE_PIXELS
  | 'skipped-undecodable' // this browser cannot decode the original
  | 'not-needed'; // output identical to the input: nothing offered

export type FailureCode = EngineErrorCode | 'read-failed' | 'decode-mismatch' | 'internal';

export interface Failure {
  code: FailureCode;
  /** Technical, English, never a value from the file. */
  detail: string;
  format: DetectedFormat | null;
}

export interface FileInfo {
  name: string;
  size: number;
  source: Source;
}

export type Outcome =
  | {
      kind: 'done';
      file: FileInfo;
      inspection: Inspection;
      result: StripResult;
      check: Check;
      /** The output is byte-identical to the input: there was nothing to remove. */
      unchanged: boolean;
      downloadName: string;
      blob: Blob;
    }
  | {
      kind: 'error';
      file: FileInfo;
      failure: Failure;
      /** Format from the first bytes, for the diagnostic (null if the file was not read). */
      detected: DetectedFormat | null;
      /** Set when the file could be read but not cleaned: the report still shows what it holds. */
      inspection: Inspection | null;
    };

function failure(e: unknown): Failure {
  if (e instanceof EngineError) return { code: e.code, detail: e.detail, format: e.format };
  // An unexpected exception is an engine bug: keep only its type, never its message.
  return { code: 'internal', detail: e instanceof Error ? e.name : typeof e, format: null };
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The outcome for an exception that escaped processFile (an engine or browser bug). */
export function crashed(file: File, source: Source, e: unknown): Outcome {
  return { kind: 'error', file: { name: file.name, size: file.size, source }, failure: failure(e), detected: null, inspection: null };
}

/**
 * Returns null when `isCurrent()` turns false along the way (a newer file
 * replaced this one: its result must not be shown).
 */
export async function processFile(
  file: File,
  source: Source,
  decode: Decoder,
  isCurrent: () => boolean,
  timeoutMs = DECODE_TIMEOUT_MS,
): Promise<Outcome | null> {
  const info: FileInfo = { name: file.name, size: file.size, source };
  const fail = (f: Failure, detected: DetectedFormat | null, inspection: Inspection | null = null): Outcome => ({
    kind: 'error',
    file: info,
    failure: f,
    detected,
    inspection,
  });

  // Refused before reading: a 2 GB file is never loaded into memory.
  if (file.size > MAX_FILE_BYTES) return fail({ code: 'too-large', detail: `file is over ${MAX_FILE_BYTES} bytes`, format: null }, null);

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    return isCurrent() ? fail({ code: 'read-failed', detail: e instanceof Error ? e.name : 'error', format: null }, null) : null;
  }
  if (!isCurrent()) return null;
  const detected = detectFormat(bytes);

  let inspection: Inspection;
  try {
    inspection = await inspect(bytes);
  } catch (e) {
    return isCurrent() ? fail(failure(e), detected) : null;
  }
  if (!isCurrent()) return null;

  let result: StripResult;
  try {
    result = strip(bytes);
  } catch (e) {
    return fail(failure(e), detected, inspection);
  }

  const { structure } = result;
  const blob = new Blob([result.bytes], { type: structure.mime });
  const done = (check: Check, unchanged: boolean): Outcome => ({
    kind: 'done',
    file: info,
    inspection,
    result,
    check,
    unchanged,
    downloadName: cleanName(file.name, structure.format),
    blob,
  });

  if (equal(result.bytes, bytes)) return done('not-needed', true);
  if (structure.width * structure.height > MAX_DECODE_PIXELS) return done('skipped-large', false);

  // One picture at a time, to keep peak memory at one decoded image.
  const before = await timed(decode(file), timeoutMs);
  if (!isCurrent()) return null;
  if (before === 'timeout' || !before) return done('skipped-undecodable', false);
  const after = await timed(decode(blob), timeoutMs);
  if (!isCurrent()) return null;
  if (after === 'timeout' || !after || after.width !== before.width || after.height !== before.height) {
    const got = after === 'timeout' ? 'timed out' : after ? `${after.width}x${after.height}` : 'not decodable';
    return fail(
      { code: 'decode-mismatch', detail: `original decodes to ${before.width}x${before.height}, output ${got}`, format: structure.format },
      detected,
      inspection,
    );
  }
  return done('decoded', false);
}

function timed<T>(work: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** createImageBitmap, closed right after; <img>.decode() where it is missing. */
export const browserDecode: Decoder = async (blob) => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return null;
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
};
