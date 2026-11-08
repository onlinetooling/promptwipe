/** The formats the engine cleans (design §3). */
export type ImageFormat = 'png' | 'jpeg' | 'webp';

/** What the file looks like from its first bytes. */
export type DetectedFormat = ImageFormat | 'gif' | 'avif' | 'heic' | 'unknown';

/** What happens to a block when the image is cleaned. */
export type BlockAction =
  | 'keep' // copied byte for byte
  | 'remove' // not copied
  | 'rewrite'; // replaced by a minimal version (orientation-only EXIF, JFIF without thumbnail)

/** Why a block exists, for the before / after report. */
export type BlockKind =
  | 'image' // pixel data and the structure needed to decode it
  | 'color' // colour profile and colour-space information (kept, design D3)
  | 'text' // PNG text chunks: prompts, workflows, generation parameters
  | 'exif'
  | 'xmp'
  | 'c2pa' // Content Credentials (JUMBF manifest store)
  | 'iptc'
  | 'comment'
  | 'thumbnail'
  | 'secondary-image' // MPF images: HDR gain map, depth map…
  | 'trailing' // bytes after the end of the image (Motion Photo video…)
  | 'other'; // other metadata and unknown optional blocks

export interface Block {
  /** Container name: PNG chunk type, JPEG marker ("APP1"), WebP FourCC. */
  name: string;
  /** Finer identification when the name is ambiguous ("EXIF", "XMP", "ICC profile"…), else null. */
  label: string | null;
  offset: number;
  size: number;
  kind: BlockKind;
  action: BlockAction;
}

export interface Structure {
  format: ImageFormat;
  mime: string;
  /** From the header (IHDR, SOFn, VP8X / VP8 / VP8L); 0 when the file does not say. */
  width: number;
  height: number;
  animated: boolean;
  /** EXIF orientation 1-8; 1 when absent or unreadable. */
  orientation: number;
  blocks: Block[];
}

export interface StripResult {
  structure: Structure;
  bytes: Uint8Array<ArrayBuffer>;
  /** Orientation written back as an orientation-only EXIF, or null if none was needed. */
  orientationKept: number | null;
}
