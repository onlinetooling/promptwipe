import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, strip } from '../../src/engine';
import { MAX_DECODE_PIXELS, crashed, processFile, type Decoder, type Outcome } from '../../src/ui/process';
import { ascii, be32, cat } from '../engine/helpers';
import { fileOf, fixedDecoder, hugePng, richPng } from './samples';

const always = (): boolean => true;

function done(o: Outcome | null): Extract<Outcome, { kind: 'done' }> {
  if (o?.kind !== 'done') throw new Error(`expected a cleaned file, got ${JSON.stringify(o && o.kind === 'error' ? o.failure : o)}`);
  return o;
}

function failed(o: Outcome | null): Extract<Outcome, { kind: 'error' }> {
  if (o?.kind !== 'error') throw new Error('expected an error');
  return o;
}

describe('processFile', () => {
  it('cleans, decodes the original and the output, and names the download', async () => {
    const decode = fixedDecoder();
    const o = done(await processFile(fileOf(richPng(), 'ComfyUI_00042_.png'), 'drop', decode, always));
    expect(o.check).toBe('decoded');
    expect(decode.calls).toBe(2);
    expect(o.unchanged).toBe(false);
    expect(o.downloadName).toBe('ComfyUI_00042_-clean.png');
    expect(o.blob.type).toBe('image/png');
    expect(o.blob.size).toBe(o.result.bytes.length);
    expect(Buffer.from(await o.blob.arrayBuffer()).equals(Buffer.from(o.result.bytes))).toBe(true);
    expect(o.inspection.texts.length).toBeGreaterThan(0);
  });

  it('offers nothing and decodes nothing when the file is already clean', async () => {
    const decode = fixedDecoder();
    const clean = strip(richPng()).bytes;
    const o = done(await processFile(fileOf(clean), 'file', decode, always));
    expect(o.unchanged).toBe(true);
    expect(o.check).toBe('not-needed');
    expect(decode.calls).toBe(0);
  });

  it('refuses a file over 50 MB without reading it', async () => {
    const huge = {
      name: 'big.png',
      size: MAX_FILE_BYTES + 1,
      arrayBuffer: () => {
        throw new Error('must not be read');
      },
    } as unknown as File;
    const o = failed(await processFile(huge, 'drop', fixedDecoder(), always));
    expect(o.failure.code).toBe('too-large');
    expect(o.inspection).toBeNull();
  });

  it('names the refused format (HEIC)', async () => {
    const heic = cat(be32(24), ascii('ftypheic'), be32(0), ascii('mif1heic'));
    const o = failed(await processFile(fileOf(heic, 'IMG_0001.HEIC'), 'file', fixedDecoder(), always));
    expect(o.failure).toMatchObject({ code: 'unsupported-format', format: 'heic' });
    expect(o.detected).toBe('heic');
  });

  it('withholds the file when the output does not decode to the same size', async () => {
    let n = 0;
    const decode: Decoder = async () => (n++ === 0 ? { width: 8, height: 6 } : { width: 6, height: 8 });
    const o = failed(await processFile(fileOf(richPng()), 'drop', decode, always));
    expect(o.failure.code).toBe('decode-mismatch');
    expect(o.failure.detail).toBe('original decodes to 8x6, output 6x8');
    expect(o.inspection).not.toBeNull();
    expect('blob' in o).toBe(false);
  });

  it('withholds the file when the output does not decode at all', async () => {
    let n = 0;
    const decode: Decoder = async () => (n++ === 0 ? { width: 8, height: 6 } : null);
    expect(failed(await processFile(fileOf(richPng()), 'drop', decode, always)).failure.code).toBe('decode-mismatch');
  });

  it('falls back to the structure check when the browser cannot decode the original', async () => {
    const decode: Decoder = async () => null;
    expect(done(await processFile(fileOf(richPng()), 'drop', decode, always)).check).toBe('skipped-undecodable');
  });

  it('gives up a decode that hangs: structure check for the original, withheld for the output', async () => {
    const never: Decoder = () => new Promise(() => {});
    expect(done(await processFile(fileOf(richPng()), 'drop', never, always, 20)).check).toBe('skipped-undecodable');
    let n = 0;
    const hangsOnOutput: Decoder = (blob) => (n++ === 0 ? fixedDecoder()(blob) : new Promise(() => {}));
    const o = failed(await processFile(fileOf(richPng()), 'drop', hangsOnOutput, always, 20));
    expect(o.failure).toMatchObject({ code: 'decode-mismatch', detail: 'original decodes to 8x6, output timed out' });
  });

  it('does not decode pictures over 40 megapixels', async () => {
    const decode = fixedDecoder();
    const o = done(await processFile(fileOf(hugePng(8000, 6000)), 'drop', decode, always));
    expect(8000 * 6000).toBeGreaterThan(MAX_DECODE_PIXELS);
    expect(o.check).toBe('skipped-large');
    expect(decode.calls).toBe(0);
  });

  it('drops the result of a file replaced by a newer one, at every step', async () => {
    expect(await processFile(fileOf(richPng()), 'drop', fixedDecoder(), () => false)).toBeNull();
    let current = true;
    const decode: Decoder = async () => {
      current = false; // a new file arrives while the original is being decoded
      return { width: 8, height: 6 };
    };
    expect(await processFile(fileOf(richPng()), 'drop', decode, () => current)).toBeNull();
  });

  it('reports a file that cannot be read', async () => {
    const broken = { name: 'x.png', size: 10, arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')) } as unknown as File;
    const o = failed(await processFile(broken, 'file', fixedDecoder(), always));
    expect(o.failure).toMatchObject({ code: 'read-failed', detail: 'NotReadableError' });
  });

  it('keeps only the type of an unexpected exception, never its message', () => {
    const o = failed(crashed(fileOf(richPng()), 'drop', new TypeError('a red fox in the snow')));
    expect(o.failure).toEqual({ code: 'internal', detail: 'TypeError', format: null });
  });
});
