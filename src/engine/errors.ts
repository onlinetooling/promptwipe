import type { DetectedFormat } from './types';

/**
 * Every failure the engine reports. The UI maps each code to a message; the
 * file is never modified when one of these is thrown.
 */
export type EngineErrorCode =
  | 'too-large' // file over MAX_FILE_BYTES
  | 'unsupported-format' // GIF, AVIF, HEIC or anything that is not PNG / JPEG / WebP
  | 'malformed' // structure does not parse (truncated, bad lengths…)
  | 'unknown-critical-chunk' // PNG critical chunk we do not know: refusing is safer than guessing
  | 'unknown-marker' // JPEG marker outside the known set (hierarchical, JPEG-LS…)
  | 'verification-failed'; // the cleaned output did not re-read as clean (engine bug guard)

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  /** Technical detail in English. Never contains values read from the file. */
  readonly detail: string;
  /** Set for 'unsupported-format', so the UI can name the format (HEIC message…). */
  readonly format: DetectedFormat | null;

  constructor(code: EngineErrorCode, detail: string, format: DetectedFormat | null = null) {
    super(`${code}: ${detail}`);
    this.name = 'EngineError';
    this.code = code;
    this.detail = detail;
    this.format = format;
  }
}

export function malformed(detail: string): EngineError {
  return new EngineError('malformed', detail);
}
