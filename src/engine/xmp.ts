import { type Budget, take } from './budget';
import { decodeUtf8 } from './bytes';

// XMP is read with a small linear scanner over the packet text, not with
// DOMParser (review L3) and not with regular expressions (L1 code review H1:
// a backtracking pattern froze the tab for 36 s on 4.5 MB of crafted XMP).
// Every search is bounded: at most MAX_TRIES candidates per field, each
// looked at within a fixed window.

export interface XmpSummary {
  bytes: number;
  creatorTool: string | null;
  /** IPTC DigitalSourceType code, e.g. "trainedAlgorithmicMedia". */
  digitalSourceType: string | null;
  description: string | null;
  credit: string | null;
  /** dcterms:provenance: pointer to a remote Content Credentials manifest. */
  provenance: string | null;
  /** Ultra HDR / Adobe gain-map metadata (hdrgm). */
  hdrGainMap: boolean;
  /** Google / Samsung Motion Photo markers. */
  motionPhoto: boolean;
  truncated: boolean;
}

/** XMP text scanned (the fields shown sit near the start of real packets). */
const MAX_XMP_TEXT = 1024 * 1024;
const MAX_VALUE = 65536;
const MAX_TRIES = 64;
const MAX_TAG = 4096;

function isNameChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45 || c === 46;
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

/** Index of `needle` in text[from, from + max + needle.length), or -1. */
function within(text: string, needle: string, from: number, max: number): number {
  const i = text.slice(from, from + max + needle.length).indexOf(needle);
  return i < 0 ? -1 : from + i;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

function clean(s: string): string | null {
  // [^<>] stops at the next "<", so stripping tags stays linear.
  const v = decodeEntities(s.replace(/<[^<>]*>/g, '')).trim();
  return v ? v : null;
}

/** Value of `="…"` or `='…'` starting at `from` (spaces allowed), or undefined. */
function attributeValue(text: string, from: number): string | null | undefined {
  let p = from;
  while (p < from + 64 && isSpace(text.charCodeAt(p))) p++;
  if (text.charCodeAt(p) !== 61 /* = */) return undefined;
  p++;
  while (p < from + 128 && isSpace(text.charCodeAt(p))) p++;
  const quote = text[p];
  if (quote !== '"' && quote !== "'") return undefined;
  const end = within(text, quote, p + 1, MAX_VALUE);
  return end < 0 ? undefined : clean(text.slice(p + 1, end));
}

/** Value of <qname …>…</qname>, its first rdf:li, or its rdf:resource; undefined if not well formed. */
function elementValue(text: string, qname: string, from: number): string | null | undefined {
  const gt = within(text, '>', from, MAX_TAG);
  if (gt < 0) return undefined;
  if (text.charCodeAt(gt - 1) === 47 /* / */) {
    const attrs = text.slice(from, gt);
    const r = attrs.indexOf('rdf:resource');
    return r < 0 ? undefined : attributeValue(attrs, r + 'rdf:resource'.length);
  }
  const close = within(text, `</${qname}`, gt + 1, MAX_VALUE);
  if (close < 0) return undefined;
  const inner = text.slice(gt + 1, close);
  const li = inner.indexOf('<rdf:li');
  if (li >= 0) {
    const liGt = inner.indexOf('>', li);
    const liEnd = liGt < 0 ? -1 : inner.indexOf('</rdf:li', liGt);
    if (liEnd >= 0) return clean(inner.slice(liGt + 1, liEnd));
  }
  return clean(inner);
}

/** First value of a property (any namespace prefix), as attribute, element or rdf:resource. */
export function xmpField(text: string, local: string): string | null {
  const needle = `:${local}`;
  let from = 0;
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const at = text.indexOf(needle, from);
    if (at < 0) return null;
    from = at + needle.length;
    if (isNameChar(text.charCodeAt(from))) continue; // ":descriptionFoo"
    let start = at;
    while (start > 0 && at - start < 64 && isNameChar(text.charCodeAt(start - 1))) start--;
    if (start === at || at - start >= 64) continue; // no prefix
    const before = text.charCodeAt(start - 1);
    const value =
      before === 60 /* < */
        ? elementValue(text, text.slice(start, from), from)
        : isSpace(before)
          ? attributeValue(text, from)
          : undefined;
    if (value !== undefined) return value;
  }
  return null;
}

export function readXmp(data: Uint8Array, budget: Budget): XmpSummary {
  const { bytes, truncated } = take(budget, data.subarray(0, MAX_XMP_TEXT));
  const text = decodeUtf8(bytes);
  const source = xmpField(text, 'DigitalSourceType');
  return {
    bytes: data.length,
    creatorTool: xmpField(text, 'CreatorTool'),
    digitalSourceType: source ? (source.split('/').pop() ?? source) : null,
    description: xmpField(text, 'description'),
    credit: xmpField(text, 'Credit'),
    provenance: xmpField(text, 'provenance'),
    hdrGainMap: /\bhdrgm:|ns\.adobe\.com\/hdr-gain-map\//.test(text),
    motionPhoto: /\b(?:MotionPhoto|MicroVideo)\b/.test(text),
    truncated: truncated || data.length > MAX_XMP_TEXT,
  };
}
