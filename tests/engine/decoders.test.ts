// Real decoders on cleaned files (L1 code review L3). Needs ImageMagick 7,
// libjpeg-turbo (djpeg) and libwebp (dwebp): runs where they are installed,
// and is reported as skipped elsewhere (CI decodes with pngjs / jpeg-js).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { strip } from '../../src/engine';
import { app11Segments, ascii, basePng, c2paStore, cat, fixture, jpegSegment, pngChunk, richExif, riffChunk, splitRiff, tEXt, webpFile, withJpegSegments, withPngChunks } from './helpers';

const has = (cmd: string): boolean => {
  try {
    execFileSync('/bin/sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const tools = ['magick', 'djpeg', 'dwebp', 'webpmux'].every(has);

describe.skipIf(!tools)('real decoders (local, needs magick + djpeg + dwebp + webpmux)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'promptwipe-decoders-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const lossy = splitRiff(fixture('lossy-alpha.webp'));
  const vp8x = lossy[0]!.data.slice();
  vp8x[0] = vp8x[0]! | 0x0c;
  const cases: Record<string, Uint8Array> = {
    'png.png': withPngChunks(basePng(), [tEXt('parameters', 'p'), pngChunk('eXIf', richExif(6)), pngChunk('caBX', c2paStore())]),
    'apng.png': withPngChunks(fixture('apng.png'), [tEXt('parameters', 'p')]),
    'progressive.jpg': withJpegSegments(fixture('progressive.jpg'), [jpegSegment(0xe1, cat(ascii('Exif\0\0'), richExif(6))), ...app11Segments(c2paStore({ padding: 200 }), 120)], ascii('tail')),
    'alpha.webp': webpFile([riffChunk('VP8X', vp8x), ...lossy.slice(1).map((c) => c.bytes), riffChunk('EXIF', richExif(6, true)), riffChunk('XMP ', ascii('<x/>'))]),
    'animated.webp': cat(fixture('animated.webp'), ascii('trailing')),
  };

  for (const [name, input] of Object.entries(cases)) {
    it(`${name}: decodes, same pixels, same orientation`, () => {
      const src = join(dir, `in-${name}`);
      const out = join(dir, name);
      writeFileSync(src, input);
      writeFileSync(out, strip(input).bytes);
      const id = (f: string): string => execFileSync('magick', ['identify', '-format', '%m %wx%h %[orientation] %n;', f], { encoding: 'utf8' });
      expect(id(out)).toBe(id(src));
      // compare prints the number of differing pixels and exits 0 when it is 0;
      // animations are compared frame by frame.
      const frames = Number(execFileSync('magick', ['identify', '-format', '%n,', src], { encoding: 'utf8' }).split(',')[0]);
      for (let i = 0; i < frames; i++) {
        expect(() => execFileSync('magick', ['compare', '-metric', 'AE', `${src}[${i}]`, `${out}[${i}]`, 'null:'], { stdio: 'pipe' }), `frame ${i}`).not.toThrow();
      }
      if (name.endsWith('.jpg')) execFileSync('djpeg', ['-outfile', '/dev/null', out]);
      // dwebp does not decode animations: magick decoded every frame above, webpmux checks the container.
      if (name.endsWith('.webp')) {
        if (frames > 1) expect(execFileSync('webpmux', ['-info', out], { encoding: 'utf8' })).toContain(`Number of frames: ${frames}`);
        else execFileSync('dwebp', ['-quiet', out, '-o', '/dev/null']);
      }
    });
  }
});
