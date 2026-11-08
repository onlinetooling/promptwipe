import type { ImageFormat } from '../engine';
import type { Lang } from './messages';

/** Values longer than this are cut on screen; "Copy" still takes the full text (design §3). */
export const DISPLAY_LIMIT = 20_000;

const UNITS: Record<Lang, readonly [string, string, string, string]> = {
  en: ['byte', 'bytes', 'KB', 'MB'],
  fr: ['octet', 'octets', 'Ko', 'Mo'],
};

/** 1 024-based sizes, the way file managers show them: "812 bytes", "14.2 KB", "1,3 Mo". */
export function formatBytes(n: number, lang: Lang): string {
  const [one, many, kb, mb] = UNITS[lang];
  const nf = (v: number, digits: number): string =>
    new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: digits }).format(v);
  if (n < 1024) return `${nf(n, 0)} ${n === 1 ? one : many}`;
  if (n < 1024 * 1024) return `${nf(n / 1024, n < 10 * 1024 ? 1 : 0)} ${kb}`;
  return `${nf(n / (1024 * 1024), 1)} ${mb}`;
}

const EXTENSION: Record<ImageFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/**
 * Download name: the original name with "-clean" before the extension (design D6).
 * The format never changes, so the extension stays; a name without one gets the format's.
 */
export function cleanName(original: string, format: ImageFormat): string {
  const base = original.split(/[\\/]/).pop()?.trim() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot > 0) return `${base.slice(0, dot)}-clean${base.slice(dot)}`;
  return `${base || 'image'}-clean.${EXTENSION[format]}`;
}

/** The first `limit` UTF-16 units of `s`, without splitting a surrogate pair. */
export function cut(s: string, limit = DISPLAY_LIMIT): string {
  if (s.length <= limit) return s;
  const end = /[\ud800-\udbff]/.test(s[limit - 1] ?? '') ? limit - 1 : limit;
  return s.slice(0, end);
}
