import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { EngineError, analyze, inspect, strip } from '../../src/engine';
import { stripClean } from './assert';
import {
  ascii,
  basePng,
  c2paStore,
  cat,
  fixture,
  iTXt,
  iccProfile,
  pngChunk,
  richExif,
  splitPng,
  tEXt,
  withPngChunks,
  xmpPacket,
  zTXt,
  zlib,
} from './helpers';

const pixels = (b: Uint8Array): string => Buffer.from(PNG.sync.read(Buffer.from(b)).data).toString('hex');
const types = (b: Uint8Array): string[] => splitPng(b).chunks.map((c) => c.type);

const A1111 =
  'a lighthouse on a cliff, golden hour\nNegative prompt: blurry\nSteps: 28, Sampler: DPM++ 2M, CFG scale: 7, Seed: 3141592, Size: 512x512, Model: sdxl_base';
const COMFY_PROMPT = JSON.stringify({
  '3': { class_type: 'KSampler', inputs: { seed: 42 } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux1-dev.safetensors' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat astronaut' } },
});
const COMFY_WORKFLOW = JSON.stringify({ last_node_id: 9, nodes: [{ id: 3 }, { id: 4 }, { id: 6 }, { id: 9 }], links: [] });

describe('PNG — generator metadata', () => {
  it('removes A1111 / Forge "parameters" and keeps the pixels identical', async () => {
    const input = withPngChunks(basePng(), [tEXt('parameters', A1111)]);
    const report = await inspect(input);
    expect(report.texts).toEqual([{ source: 'tEXt', key: 'parameters', value: A1111, truncated: false }]);

    const { bytes } = stripClean(input);
    expect(types(bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(pixels(bytes)).toBe(pixels(input));
  });

  it('removes ComfyUI prompt + workflow and counts the workflow nodes', async () => {
    const input = withPngChunks(basePng(), [tEXt('prompt', COMFY_PROMPT), tEXt('workflow', COMFY_WORKFLOW)]);
    const report = await inspect(input);
    expect(report.texts.map((t) => t.key)).toEqual(['prompt', 'workflow']);
    expect(report.comfyui).toEqual({ nodes: 4 });
    expect(types(stripClean(input).bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('counts API-format prompt nodes when there is no workflow', async () => {
    const report = await inspect(withPngChunks(basePng(), [tEXt('prompt', COMFY_PROMPT)]));
    expect(report.comfyui).toEqual({ nodes: 3 });
  });

  it('removes InvokeAI and Fooocus keys in tEXt, zTXt and iTXt (compressed or not)', async () => {
    const input = withPngChunks(basePng(), [
      tEXt('invokeai_metadata', '{"positive_prompt":"a koi pond"}'),
      zTXt('invokeai_graph', '{"nodes":{}}'),
      iTXt('invokeai_workflow', '{"name":"w","nodes":[]}', true),
      iTXt('parameters', 'prompt with accents: café, 東京'),
      tEXt('fooocus_scheme', 'fooocus'),
    ]);
    const report = await inspect(input);
    expect(report.texts.map((t) => [t.source, t.key, t.value])).toEqual([
      ['tEXt', 'invokeai_metadata', '{"positive_prompt":"a koi pond"}'],
      ['zTXt', 'invokeai_graph', '{"nodes":{}}'],
      ['iTXt', 'invokeai_workflow', '{"name":"w","nodes":[]}'],
      ['iTXt', 'parameters', 'prompt with accents: café, 東京'],
      ['tEXt', 'fooocus_scheme', 'fooocus'],
    ]);
    expect(types(stripClean(input).bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('reads XMP (iTXt XML:com.adobe.xmp) as XMP, not as a text entry', async () => {
    const input = withPngChunks(basePng(), [iTXt('XML:com.adobe.xmp', xmpPacket({ creatorTool: 'Adobe Firefly', source: 'trainedAlgorithmicMedia' }))]);
    const report = await inspect(input);
    expect(report.texts).toEqual([]);
    expect(report.xmp?.creatorTool).toBe('Adobe Firefly');
    expect(report.xmp?.digitalSourceType).toBe('trainedAlgorithmicMedia');
    expect(analyze(input).blocks.find((b) => b.name === 'iTXt')).toMatchObject({ kind: 'xmp', action: 'remove' });
    stripClean(input);
  });

  it('removes C2PA (caBX) and reports the declared generator and signer', async () => {
    const store = c2paStore({ generatorInfo: { name: 'ChatGPT', version: '1.0' }, signer: { O: 'OpenAI', CN: 'Truepic Lens CLI' }, title: 'image.png' });
    const input = withPngChunks(basePng(), [pngChunk('caBX', store)]);
    const report = await inspect(input);
    expect(report.c2pa).toEqual({ bytes: store.length + 12, manifests: 1, generator: 'ChatGPT 1.0', signer: 'OpenAI', title: 'image.png', readable: true });
    expect(types(stripClean(input).bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });
});

describe('PNG — EXIF and orientation', () => {
  it('rewrites eXIf as orientation only, right after IHDR', async () => {
    const input = withPngChunks(basePng(), [pngChunk('eXIf', richExif(6))], 'before-IEND');
    const report = await inspect(input);
    expect(report.exif?.gps).toEqual({ present: true, latitude: 48.856667, longitude: -2.35 });
    expect(report.exif?.fields.map((f) => f.tag)).toContain('UserComment');

    const result = stripClean(input);
    expect(result.orientationKept).toBe(6);
    const out = splitPng(result.bytes).chunks;
    expect(out.map((c) => c.type)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND']);
    expect(out[1]!.data.length).toBe(26);
    expect(analyze(result.bytes).orientation).toBe(6);
    expect(pixels(result.bytes)).toBe(pixels(input));
  });

  it('drops eXIf entirely when the orientation is normal', () => {
    const input = withPngChunks(basePng(), [pngChunk('eXIf', richExif(1))]);
    const result = stripClean(input);
    expect(result.orientationKept).toBeNull();
    expect(types(result.bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });
});

describe('PNG — what is kept', () => {
  it('keeps colour chunks byte for byte and names the ICC profile', async () => {
    const icc = cat(ascii('ICC Profile'), Uint8Array.of(0, 0), zlib(iccProfile('Display P3')));
    const colour = [
      pngChunk('iCCP', icc),
      pngChunk('gAMA', Uint8Array.of(0, 0, 0xb1, 0x8f)),
      pngChunk('cHRM', new Uint8Array(32).fill(1)),
      pngChunk('cICP', Uint8Array.of(12, 13, 0, 1)),
      pngChunk('cLLi', new Uint8Array(8)),
    ];
    const input = withPngChunks(basePng(), [...colour, tEXt('Software', 'x')]);
    expect((await inspect(input)).colorProfile).toBe('Display P3');
    const { bytes } = stripClean(input);
    expect(types(bytes)).toEqual(['IHDR', 'iCCP', 'gAMA', 'cHRM', 'cICP', 'cLLi', 'IDAT', 'IEND']);
  });

  it('names sRGB when only an sRGB chunk is present', async () => {
    const input = withPngChunks(basePng(), [pngChunk('sRGB', Uint8Array.of(0))]);
    expect((await inspect(input)).colorProfile).toBe('sRGB');
  });

  it('removes tIME, pHYs, bKGD, sPLT, unknown ancillary chunks and bytes after IEND', () => {
    const input = cat(
      withPngChunks(basePng(), [
        pngChunk('tIME', Uint8Array.of(7, 234, 11, 8, 10, 0, 0)),
        pngChunk('pHYs', new Uint8Array(9)),
        pngChunk('bKGD', new Uint8Array(6)),
        pngChunk('sPLT', cat(ascii('p'), Uint8Array.of(0, 8))),
        pngChunk('prVt', ascii('private data')),
      ]),
      ascii('appended secret'),
    );
    const blocks = analyze(input).blocks;
    expect(blocks.at(-1)).toMatchObject({ name: 'trailing data', kind: 'trailing', action: 'remove', size: 15 });
    const { bytes } = stripClean(input);
    expect(types(bytes)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(splitPng(bytes).rest.length).toBe(0);
  });

  it('keeps an APNG animated (acTL / fcTL / fdAT) and drops its pHYs', () => {
    const input = withPngChunks(fixture('apng.png'), [tEXt('parameters', A1111)]);
    expect(analyze(input).animated).toBe(true);
    const { bytes } = stripClean(input);
    expect(types(bytes)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
  });
});

describe('PNG — refusals and limits', () => {
  it('refuses an unknown critical chunk and leaves nothing to download', () => {
    const input = withPngChunks(basePng(), [pngChunk('ZZZZ', ascii('?'))]);
    expect(() => strip(input)).toThrow(EngineError);
    try {
      strip(input);
    } catch (e) {
      expect((e as EngineError).code).toBe('unknown-critical-chunk');
    }
  });

  it('refuses a truncated file', () => {
    const input = basePng();
    for (const cut of [10, 30, input.length - 5]) {
      expect(() => strip(input.subarray(0, cut))).toThrowError(/malformed/);
    }
  });

  it('refuses a PNG that does not start with IHDR or has no IDAT', () => {
    const { chunks } = splitPng(basePng());
    const noIdat = cat(basePng().subarray(0, 8), chunks[0]!.bytes, chunks[2]!.bytes);
    expect(() => strip(noIdat)).toThrowError(/IDAT/);
    const ihdrLater = cat(basePng().subarray(0, 8), tEXt('a', 'b'), ...chunks.map((c) => c.bytes));
    expect(() => strip(ihdrLater)).toThrowError(/IHDR/);
  });

  it('caps decoded text at 5 MB in total and says so', async () => {
    const big = new Uint8Array(2 * 1024 * 1024).fill(0x41);
    const input = withPngChunks(basePng(), [zTXt('a', big), zTXt('b', big), zTXt('c', big), zTXt('d', big)]);
    const report = await inspect(input);
    const total = report.texts.reduce((n, t) => n + t.value.length, 0);
    // 5 MB, minus the fixed cost charged per text block (limits.ts TEXT_BLOCK_COST).
    expect(total).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(total).toBeGreaterThan(5 * 1024 * 1024 - 4 * 64 - 1);
    expect(report.texts.some((t) => t.truncated)).toBe(true);
    expect(report.warnings).toContain('text-budget-exceeded');
    stripClean(input);
  });

  it('reports a corrupt compressed text chunk but still cleans the file', async () => {
    const bad = pngChunk('zTXt', cat(ascii('parameters'), Uint8Array.of(0, 0), Uint8Array.of(0x78, 0x9c, 1, 2, 3, 4)));
    const input = withPngChunks(basePng(), [bad]);
    expect((await inspect(input)).warnings).toContain('compressed-text-unreadable');
    stripClean(input);
  });
});
