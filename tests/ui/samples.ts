import type { Decoder } from '../../src/ui/process';
import {
  PNG_SIG,
  ascii,
  basePng,
  be32,
  c2paStore,
  cat,
  iTXt,
  iccProfile,
  pngChunk,
  richExif,
  tEXt,
  tiff,
  xmpPacket,
  zTXt,
  zlib,
} from '../engine/helpers';

export const TRAP = '<img src=x onerror=alert(1)>';
export const PROMPT = 'SECRET-PROMPT-7731, a red fox in the snow\nSteps: 30, Seed: 1234';
export const WORKFLOW = JSON.stringify({ nodes: [{ id: 1, type: 'KSampler' }, { id: 2, type: 'SaveImage' }] });

/** An 8x6 PNG carrying every kind of metadata the report shows. */
export function richPng(opts: { prompt?: string; key?: string; maker?: string } = {}): Uint8Array {
  return withAfterIhdr(basePng(), [
    pngChunk('iCCP', cat(ascii('ICC Profile'), Uint8Array.of(0, 0), zlib(iccProfile('Display P3')))),
    tEXt(opts.key ?? 'parameters', opts.prompt ?? PROMPT),
    zTXt('workflow', WORKFLOW),
    iTXt('XML:com.adobe.xmp', xmpPacket({ creatorTool: 'SECRET-TOOL 1.0', source: 'trainedAlgorithmicMedia' })),
    pngChunk('eXIf', opts.maker ? richExifWithMaker(opts.maker) : richExif(6)),
    pngChunk('caBX', c2paStore({ generator: 'SECRET-GENERATOR/2.0' })),
    pngChunk('tIME', new Uint8Array(7)),
  ]);
}

function richExifWithMaker(maker: string): Uint8Array {
  return tiff({ ifd0: [{ tag: 0x010f, ascii: maker }, { tag: 0x0112, short: 6 }] });
}

function withAfterIhdr(png: Uint8Array, extra: Uint8Array[]): Uint8Array {
  const ihdrEnd = 8 + 12 + 13;
  return cat(png.subarray(0, ihdrEnd), ...extra, png.subarray(ihdrEnd));
}

/** A PNG whose header claims width x height; the pixel data is not a real image. */
export function hugePng(width: number, height: number): Uint8Array {
  const ihdr = cat(be32(width), be32(height), Uint8Array.of(8, 6, 0, 0, 0));
  return cat(PNG_SIG, pngChunk('IHDR', ihdr), tEXt('parameters', 'x'), pngChunk('IDAT', zlib(new Uint8Array(10))), pngChunk('IEND', new Uint8Array(0)));
}

export function fileOf(bytes: Uint8Array, name = 'photo.png'): File {
  return new File([new Uint8Array(bytes)], name);
}

/** A decoder that reports the same size for every image, and counts its calls. */
export function fixedDecoder(width = 8, height = 6): Decoder & { calls: number } {
  const decode = Object.assign(
    async () => {
      decode.calls++;
      return { width, height };
    },
    { calls: 0 },
  );
  return decode;
}
