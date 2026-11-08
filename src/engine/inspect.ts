import { type Budget, charge, newBudget, take } from './budget';
import { decodeLatin1, decodePngText, decodeUtf8, indexOfNul, startsWith } from './bytes';
import { type C2paSummary, jumbfFromApp11, readC2pa } from './c2pa';
import { type ExifSummary, readExif } from './exif';
import { iccDescription } from './icc';
import { inflate } from './inflate';
import { parse } from './container';
import { EXIF_ID, ICC_ID, XMP_ID, readJpegSegments } from './jpeg';
import { MAX_TEXTS, TEXT_BLOCK_COST } from './limits';
import { readPngChunks, textKeyword } from './png';
import type { Structure } from './types';
import { exifTiffOf, readRiffChunks } from './webp';
import { type XmpSummary, readXmp } from './xmp';

// "What does this image contain?" (design §3). Values read here are untrusted
// text: the UI renders them with textContent only, never innerHTML.

export type InspectWarning =
  | 'text-budget-exceeded' // more than 5 MB of text: the rest is not shown (it is still removed)
  | 'too-many-texts' // more than MAX_TEXTS text blocks: the rest is not shown (it is still removed)
  | 'compressed-text-unreadable' // a zTXt / iTXt / iCCP stream is corrupt
  | 'exif-unreadable'
  | 'c2pa-unreadable';

export interface TextEntry {
  /** PNG chunk type, or "COM" for a JPEG comment. */
  source: 'tEXt' | 'zTXt' | 'iTXt' | 'COM';
  /** Keyword: "parameters" (A1111), "prompt" / "workflow" (ComfyUI)… */
  key: string;
  value: string;
  truncated: boolean;
}

export interface Inspection {
  structure: Structure;
  texts: TextEntry[];
  exif: ExifSummary | null;
  xmp: XmpSummary | null;
  c2pa: C2paSummary | null;
  /** ComfyUI graph found in a "prompt" / "workflow" value. */
  comfyui: { nodes: number } | null;
  /** Name of the kept colour profile ("Display P3"…), "sRGB", or null. */
  colorProfile: string | null;
  /** JPEG MPF secondary images (HDR gain map, depth map): removed, so HDR displays fall back to SDR. */
  secondaryImages: boolean;
  hdrGainMap: boolean;
  motionPhoto: boolean;
  /** Bytes after the end of the image (removed). */
  trailingBytes: number;
  warnings: InspectWarning[];
}

class Collector {
  readonly budget: Budget = newBudget();
  readonly texts: TextEntry[] = [];
  readonly warnings = new Set<InspectWarning>();
  exif: ExifSummary | null = null;
  xmp: XmpSummary | null = null;
  c2pa: C2paSummary | null = null;
  colorProfile: string | null = null;
  secondaryImages = false;
  private textBlocks = 0;

  /** False once MAX_TEXTS text blocks were read; each read costs budget even when empty. */
  admitText(): boolean {
    if (++this.textBlocks > MAX_TEXTS) {
      this.warnings.add('too-many-texts');
      return false;
    }
    charge(this.budget, TEXT_BLOCK_COST);
    return true;
  }

  addText(entry: TextEntry): void {
    if (entry.value.trim()) this.texts.push(entry);
  }

  addExif(tiff: Uint8Array): void {
    if (this.exif) return;
    this.exif = readExif(tiff, this.budget);
    if (!this.exif) this.warnings.add('exif-unreadable');
  }

  addXmp(data: Uint8Array): void {
    if (!this.xmp) this.xmp = readXmp(data, this.budget);
  }

  addC2pa(store: Uint8Array, bytes: number): void {
    const summary = readC2pa(store, bytes);
    if (!summary.readable) this.warnings.add('c2pa-unreadable');
    if (!this.c2pa || (!this.c2pa.readable && summary.readable)) this.c2pa = summary;
    else this.c2pa.bytes += bytes;
  }
}

function inspectPng(b: Uint8Array, c: Collector): void {
  const { chunks } = readPngChunks(b);
  for (const ch of chunks) {
    const data = b.subarray(ch.dataStart, ch.dataStart + ch.length);
    const end = data.length;
    switch (ch.type) {
      case 'tEXt':
      case 'zTXt':
      case 'iTXt': {
        const key = textKeyword(b, ch);
        if (key === null || !c.admitText()) break;
        let at = key.length + 1;
        let compressed = ch.type === 'zTXt';
        if (ch.type === 'zTXt') at += 1; // compression method
        if (ch.type === 'iTXt') {
          if (at + 2 > end) break;
          compressed = data[at] === 1;
          at += 2; // flag, method
          const lang = indexOfNul(data, at, end);
          if (lang < 0) break;
          const translated = indexOfNul(data, lang + 1, end);
          if (translated < 0) break;
          at = translated + 1;
        }
        let raw: Uint8Array = data.subarray(at);
        let truncated = false;
        if (compressed) {
          const inflated = inflate(raw, c.budget);
          if (!inflated) {
            c.warnings.add('compressed-text-unreadable');
            break;
          }
          raw = inflated.bytes;
          truncated = inflated.truncated;
        } else {
          const taken = ch.type === 'iTXt' && key === 'XML:com.adobe.xmp' ? { bytes: raw, truncated: false } : take(c.budget, raw);
          raw = taken.bytes;
          truncated = taken.truncated;
        }
        if (ch.type === 'iTXt' && key === 'XML:com.adobe.xmp') {
          c.addXmp(raw);
          break;
        }
        const value = ch.type === 'iTXt' ? decodeUtf8(raw) : decodePngText(raw);
        c.addText({ source: ch.type, key, value, truncated });
        break;
      }
      case 'eXIf':
        c.addExif(data);
        break;
      case 'caBX':
        c.addC2pa(data, ch.end - ch.offset);
        break;
      case 'iCCP': {
        const nul = indexOfNul(data, 0, Math.min(end, 80));
        if (nul < 1) break;
        const name = decodeLatin1(data.subarray(0, nul)).trim();
        const profile = inflate(data.subarray(nul + 2), c.budget);
        if (!profile) c.warnings.add('compressed-text-unreadable');
        c.colorProfile = (profile && iccDescription(profile.bytes)) || name || null;
        break;
      }
      case 'sRGB':
        c.colorProfile ??= 'sRGB';
        break;
    }
  }
}

function inspectJpeg(b: Uint8Array, c: Collector): void {
  const { segments } = readJpegSegments(b);
  const app11: Uint8Array[] = [];
  let app11Bytes = 0;
  const icc: { seq: number; data: Uint8Array }[] = [];
  for (const s of segments) {
    const p = b.subarray(s.payload, s.end);
    switch (s.marker) {
      case 0xe1:
        if (startsWith(p, 0, EXIF_ID)) c.addExif(p.subarray(EXIF_ID.length));
        else if (startsWith(p, 0, XMP_ID)) c.addXmp(p.subarray(XMP_ID.length));
        break;
      case 0xe2:
        if (startsWith(p, 0, ICC_ID) && p.length > ICC_ID.length + 2) {
          icc.push({ seq: p[ICC_ID.length]!, data: p.subarray(ICC_ID.length + 2) });
        } else if (startsWith(p, 0, 'MPF\0')) c.secondaryImages = true;
        break;
      case 0xeb:
        if (startsWith(p, 0, 'JP')) {
          app11.push(p);
          app11Bytes += s.end - s.offset;
        }
        break;
      case 0xfe: {
        if (!c.admitText()) break;
        const { bytes, truncated } = take(c.budget, p);
        c.addText({ source: 'COM', key: 'comment', value: decodeUtf8(bytes).trim(), truncated });
        break;
      }
    }
  }
  if (app11.length) {
    const stores = jumbfFromApp11(app11);
    stores.forEach((store, i) => c.addC2pa(store, i === 0 ? app11Bytes : 0));
  }
  if (icc.length) {
    icc.sort((x, y) => x.seq - y.seq);
    const total = icc.reduce((n, x) => n + x.data.length, 0);
    const profile = new Uint8Array(total);
    let o = 0;
    for (const x of icc) {
      profile.set(x.data, o);
      o += x.data.length;
    }
    c.colorProfile = iccDescription(profile) ?? 'ICC';
  }
}

function inspectWebp(b: Uint8Array, c: Collector, riffEnd: number): void {
  for (const ch of readRiffChunks(b, 12, riffEnd)) {
    const data = b.subarray(ch.dataStart, ch.dataStart + ch.size);
    if (ch.fourcc === 'EXIF') c.addExif(exifTiffOf(data));
    else if (ch.fourcc === 'XMP ') c.addXmp(data);
    else if (ch.fourcc === 'C2PA') c.addC2pa(data, ch.end - ch.offset);
    else if (ch.fourcc === 'ICCP') c.colorProfile = iccDescription(data) ?? 'ICC';
  }
}

/** Node count of a ComfyUI "workflow" (UI graph) or "prompt" (API graph) JSON. */
export function comfyNodes(json: string): number | null {
  const s = json.trim();
  if (!s.startsWith('{')) return null;
  try {
    const v: unknown = JSON.parse(s);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const nodes = (v as { nodes?: unknown }).nodes;
    if (Array.isArray(nodes)) return nodes.length;
    const values = Object.values(v);
    if (values.length && values.every((x) => x !== null && typeof x === 'object' && 'class_type' in x)) return values.length;
  } catch {
    return null;
  }
  return null;
}

function findComfy(c: Collector): { nodes: number } | null {
  const candidates: { key: string; json: string }[] = c.texts
    .filter((t) => t.key === 'workflow' || t.key === 'prompt')
    .map((t) => ({ key: t.key, json: t.value }));
  // ComfyUI's WebP / AVIF savers write "workflow:{…}" and "prompt:{…}" into EXIF text tags.
  for (const f of c.exif?.fields ?? []) {
    const m = /^(workflow|prompt):/.exec(f.value);
    if (m) candidates.push({ key: m[1]!, json: f.value.slice(m[0].length) });
  }
  candidates.sort((a, b) => (a.key === b.key ? 0 : a.key === 'workflow' ? -1 : 1));
  for (const x of candidates) {
    const nodes = comfyNodes(x.json);
    if (nodes !== null) return { nodes };
  }
  return null;
}

/** Everything the report shows. Throws EngineError when the file cannot be cleaned either. */
export async function inspect(bytes: Uint8Array): Promise<Inspection> {
  const structure = parse(bytes).structure;
  const c = new Collector();
  if (structure.format === 'png') inspectPng(bytes, c);
  else if (structure.format === 'jpeg') inspectJpeg(bytes, c);
  else {
    const trailing = structure.blocks.find((x) => x.kind === 'trailing');
    inspectWebp(bytes, c, trailing ? trailing.offset : bytes.length);
  }
  if (c.budget.exceeded) c.warnings.add('text-budget-exceeded');
  const trailingBytes = structure.blocks
    .filter((x) => x.name === 'trailing data')
    .reduce((n, x) => n + x.size, 0);
  return {
    structure,
    texts: c.texts,
    exif: c.exif,
    xmp: c.xmp,
    c2pa: c.c2pa,
    comfyui: findComfy(c),
    colorProfile: c.colorProfile,
    secondaryImages: c.secondaryImages,
    hdrGainMap: c.xmp?.hdrGainMap ?? false,
    motionPhoto: c.xmp?.motionPhoto ?? false,
    trailingBytes,
    warnings: [...c.warnings],
  };
}
