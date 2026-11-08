import type { Block, BlockKind, Inspection, StripResult, TextEntry } from '../engine';
import { formatBytes } from './format';
import { type Lang, lookup, messages } from './messages';

// The report as data, already in the page's language (design §3: "what your
// image contains", then what was removed and what was kept). Strings from the
// file stay plain strings here; render.ts puts them in text nodes only.

export interface ValueItem {
  type: 'value';
  label: string;
  /** Who wrote it, when the key is known (sources: research metadata.md §2.1). */
  hint: string | null;
  value: string;
  /** The engine stopped reading this value (5 MB text budget). */
  fileTruncated: boolean;
  /** Long or structured (JSON) values start folded. */
  folded: boolean;
}

export interface NoteItem {
  type: 'note';
  text: string;
}

export type Item = ValueItem | NoteItem;

export interface Section {
  title: string;
  items: Item[];
}

export interface RemovedGroup {
  kind: BlockKind;
  label: string;
  count: number;
  bytes: number;
}

export interface Report {
  sections: Section[];
  warnings: string[];
  removed: RemovedGroup[];
  removedCount: number;
  kept: string[];
  blocks: Block[];
}

/** Values over this length (or with a line break) are shown as a block, not on one line. */
export const LONG_VALUE = 200;
/** Values over this length start folded. */
const FOLD_OVER = 2000;

const GROUP_ORDER: readonly BlockKind[] = ['text', 'exif', 'xmp', 'c2pa', 'iptc', 'comment', 'thumbnail', 'secondary-image', 'trailing', 'other'];

/** A block that takes data out of the file (colour blocks are rebuilt, not removed). */
export function isRemoval(b: Block): boolean {
  return b.action === 'remove' || (b.action === 'rewrite' && b.kind !== 'color');
}

function value(label: string, v: string, opts: { hint?: string | null; fileTruncated?: boolean; folded?: boolean } = {}): ValueItem {
  return {
    type: 'value',
    label,
    hint: opts.hint ?? null,
    value: v,
    fileTruncated: opts.fileTruncated ?? false,
    folded: opts.folded ?? v.length > FOLD_OVER,
  };
}

function textHint(t: TextEntry, inspection: Inspection, lang: Lang): string | null {
  const m = messages[lang];
  switch (t.key) {
    case 'parameters':
      return m.hintA1111;
    case 'workflow':
    case 'prompt':
      return t.key === 'workflow' && inspection.comfyui ? m.hintComfyNodes(inspection.comfyui.nodes) : m.hintComfy;
    case 'invokeai_metadata':
    case 'invokeai_graph':
    case 'invokeai_workflow':
    case 'sd-metadata':
      return m.hintInvoke;
    case 'fooocus_scheme':
      return m.hintFooocus;
    default:
      return null;
  }
}

function coordinate(n: number): string {
  return n.toFixed(5);
}

export function buildReport(inspection: Inspection, result: StripResult | null, lang: Lang): Report {
  const m = messages[lang];
  const size = (n: number): string => formatBytes(n, lang);
  const sections: Section[] = [];

  const texts: Item[] = inspection.texts.map((t) =>
    value(t.source === 'COM' ? m.jpegComment : t.key, t.value, {
      hint: t.source === 'COM' ? null : textHint(t, inspection, lang),
      fileTruncated: t.truncated,
      folded: t.value.trimStart().startsWith('{') || t.value.length > FOLD_OVER,
    }),
  );
  if (texts.length) sections.push({ title: m.secTexts, items: texts });

  const exif = inspection.exif;
  if (exif) {
    const items: Item[] = exif.fields.map((f) => {
      const known = lookup(m.exifLabels, f.tag);
      return value(known && known !== f.tag ? `${known} (${f.tag})` : f.tag, f.value, {
        fileTruncated: f.truncated,
        folded: f.value.includes(':{') || f.value.length > FOLD_OVER,
      });
    });
    if (exif.gps.present) {
      const { latitude: lat, longitude: lon } = exif.gps;
      items.push(value(m.gps, lat !== null && lon !== null ? `${coordinate(lat)}, ${coordinate(lon)}` : m.gpsUnreadable));
    }
    if (exif.makerNoteBytes) items.push({ type: 'note', text: m.makerNote(size(exif.makerNoteBytes)) });
    if (exif.thumbnailBytes) items.push({ type: 'note', text: m.thumbnail(size(exif.thumbnailBytes)) });
    if (items.length) sections.push({ title: m.secExif, items });
  }

  const xmp = inspection.xmp;
  if (xmp) {
    const items: Item[] = [{ type: 'note', text: m.xmpPacket(size(xmp.bytes)) }];
    if (xmp.creatorTool) items.push(value(m.creatorTool, xmp.creatorTool));
    if (xmp.digitalSourceType) {
      const known = lookup(m.sourceTypes, xmp.digitalSourceType);
      items.push(value(m.digitalSourceType, known ? `${known} (${xmp.digitalSourceType})` : xmp.digitalSourceType));
    }
    if (xmp.description) items.push(value(m.description, xmp.description, { fileTruncated: xmp.truncated }));
    if (xmp.credit) items.push(value(m.credit, xmp.credit));
    if (xmp.provenance) items.push(value(m.provenance, xmp.provenance));
    sections.push({ title: m.secXmp, items });
  }

  const c2pa = inspection.c2pa;
  if (c2pa) {
    const items: Item[] = c2pa.readable
      ? [{ type: 'note', text: m.c2paSummary(c2pa.manifests, size(c2pa.bytes)) }]
      : [{ type: 'note', text: m.c2paUnreadable }];
    if (c2pa.generator) items.push(value(m.c2paGenerator, c2pa.generator));
    if (c2pa.signer) items.push(value(m.c2paSigner, c2pa.signer));
    if (c2pa.title) items.push(value(m.c2paTitle, c2pa.title));
    sections.push({ title: m.secC2pa, items });
  }

  const other: Item[] = [];
  if (inspection.hdrGainMap) other.push({ type: 'note', text: m.hdrGainMap });
  else if (inspection.secondaryImages) other.push({ type: 'note', text: m.secondaryImages });
  if (inspection.motionPhoto) other.push({ type: 'note', text: m.motionPhoto });
  if (inspection.trailingBytes) other.push({ type: 'note', text: m.trailing(size(inspection.trailingBytes)) });
  if (other.length) sections.push({ title: m.secOther, items: other });

  const warnings = inspection.warnings.flatMap((w) => lookup(m.warnings, w) ?? []);

  const blocks = inspection.structure.blocks;
  const removedBlocks = blocks.filter(isRemoval);
  const removed: RemovedGroup[] = [];
  for (const kind of GROUP_ORDER) {
    const of = removedBlocks.filter((b) => b.kind === kind);
    if (of.length) removed.push({ kind, label: lookup(m.kinds, kind) ?? kind, count: of.length, bytes: of.reduce((n, b) => n + b.size, 0) });
  }

  const kept: string[] = [m.keptImage];
  if (inspection.structure.animated) kept.push(m.keptAnimation);
  const colorKept = blocks.some((b) => b.kind === 'color' && b.action !== 'remove');
  if (colorKept && inspection.colorProfile) kept.push(m.keptColor(inspection.colorProfile));
  if (result?.orientationKept) kept.push(m.keptOrientation);

  return { sections, warnings, removed, removedCount: removedBlocks.length, kept, blocks };
}
