import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_BLOCKS, TOOL_VERSION, diagnostic } from '../../src/ui/diagnostic';
import { cleanName, cut, formatBytes } from '../../src/ui/format';
import { processFile, type Outcome } from '../../src/ui/process';
import { buildReport, type Item, type Section } from '../../src/ui/report';
import { ascii, be32, cat, basePng, iTXt, tEXt, withPngChunks, xmpPacket } from '../engine/helpers';
import { PROMPT, WORKFLOW, fileOf, fixedDecoder, richPng } from './samples';

async function outcome(bytes: Uint8Array, name = 'my-secret-name.png'): Promise<Outcome> {
  const o = await processFile(fileOf(bytes, name), 'drop', fixedDecoder(), () => true);
  if (!o) throw new Error('superseded');
  return o;
}

function section(sections: Section[], title: string): Item[] {
  const s = sections.find((x) => x.title === title);
  if (!s) throw new Error(`no section ${title}: ${sections.map((x) => x.title).join(', ')}`);
  return s.items;
}

function values(items: Item[]): Record<string, string> {
  return Object.fromEntries(items.flatMap((i) => (i.type === 'value' ? [[i.label, i.value]] : [])));
}

function notes(items: Item[]): string[] {
  return items.flatMap((i) => (i.type === 'note' ? [i.text] : []));
}

describe('report', () => {
  it('lists what the image holds, with the writer when the key is known', async () => {
    const o = await outcome(richPng());
    if (o.kind !== 'done') throw new Error('not cleaned');
    const r = buildReport(o.inspection, o.result, 'en');

    const texts = section(r.sections, 'Prompt and generation settings');
    const parameters = texts.find((i) => i.type === 'value' && i.label === 'parameters');
    expect(parameters).toMatchObject({ value: PROMPT, hint: 'written by AUTOMATIC1111, Forge or Fooocus', folded: false });
    const workflow = texts.find((i) => i.type === 'value' && i.label === 'workflow');
    expect(workflow).toMatchObject({ value: WORKFLOW, hint: 'ComfyUI workflow, 2 nodes', folded: true });

    const exif = section(r.sections, 'EXIF (camera, software, date, location)');
    expect(values(exif)).toMatchObject({
      'Camera maker (Make)': 'Pixel Maker',
      'Software': 'Fooocus v2.5.5',
      'Camera serial number (BodySerialNumber)': 'SN-998877',
      'GPS location': '48.85667, -2.35000',
    });
    expect(notes(exif)).toEqual(['Maker note: 40\u00a0bytes of manufacturer data', 'Embedded thumbnail: 8\u00a0bytes']);

    const xmp = values(section(r.sections, 'XMP'));
    expect(xmp).toMatchObject({
      'Creator tool': 'SECRET-TOOL 1.0',
      'Digital source type': 'Created using generative AI (trainedAlgorithmicMedia)',
    });

    const c2pa = section(r.sections, 'Content Credentials (C2PA)');
    expect(values(c2pa)).toMatchObject({ 'Made with': 'SECRET-GENERATOR/2.0', 'Signed by (declared, signature not verified)': 'Example Signer Inc.' });
    expect(notes(c2pa)[0]).toMatch(/^1 manifest, /);

    expect(r.removed.map((g) => g.kind)).toEqual(['text', 'exif', 'xmp', 'c2pa', 'other']);
    expect(r.removed.find((g) => g.kind === 'text')?.count).toBe(2);
    expect(r.removedCount).toBe(6);
    expect(r.kept).toEqual([
      'The picture itself, byte for byte: no re-encoding, no quality loss',
      'Colour profile: Display P3',
      'The rotation of the photo (EXIF orientation, nothing else)',
    ]);
  });

  it('speaks French on the French page', async () => {
    const o = await outcome(richPng());
    if (o.kind !== 'done') throw new Error('not cleaned');
    const r = buildReport(o.inspection, o.result, 'fr');
    expect(r.sections.map((s) => s.title)).toEqual([
      'Prompt et réglages de génération',
      'EXIF (appareil, logiciel, date, position)',
      'XMP',
      'Content Credentials (C2PA)',
    ]);
    expect(values(section(r.sections, 'XMP'))['Type de source numérique']).toBe('Créée par IA générative (trainedAlgorithmicMedia)');
  });

  it('looks up file-controlled keys among its own labels only', async () => {
    const png = withPngChunks(basePng(), [iTXt('XML:com.adobe.xmp', xmpPacket({ creatorTool: 'T', source: 'constructor' }))]);
    const o = await outcome(png);
    if (o.kind !== 'done') throw new Error('not cleaned');
    const xmp = values(section(buildReport(o.inspection, o.result, 'en').sections, 'XMP'));
    expect(xmp['Digital source type']).toBe('constructor');
  });

  it('has no section for an image without metadata', async () => {
    const o = await outcome(basePng());
    if (o.kind !== 'done') throw new Error('not cleaned');
    const r = buildReport(o.inspection, o.result, 'en');
    expect(r.sections).toEqual([]);
    expect(r.removedCount).toBe(0);
    expect(o.unchanged).toBe(true);
  });
});

describe('diagnostic', () => {
  it('describes the structure and never a value from the file, nor its name', async () => {
    const o = await outcome(richPng());
    const text = diagnostic(o);
    expect(text).toContain('input: png,');
    expect(text).toContain('image: 8x6, animated no, orientation 6');
    expect(text).toContain('result: cleaned,');
    expect(text).toMatch(/@\d+ tEXt text remove \d+/);
    expect(text).toMatch(/@\d+ caBX c2pa remove \d+/);
    for (const secret of ['SECRET', 'fox', 'Pixel Maker', 'Fooocus', 'Example Signer', '48.8', '2.35', 'SN-998877', 'KSampler', 'my-secret-name', 'Display P3']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('gives the error code of a refused file', async () => {
    const o = await outcome(cat(be32(24), ascii('ftypavif'), be32(0), ascii('mif1avif')), 'x.avif');
    expect(diagnostic(o)).toContain('input: avif,');
    expect(diagnostic(o)).toContain('error: unsupported-format: format avif is not supported');
  });

  it(`lists at most ${DIAGNOSTIC_BLOCKS} blocks`, async () => {
    const many = withPngChunks(basePng(), Array.from({ length: 400 }, (_, i) => tEXt(`k${i}`, 'v')));
    const text = diagnostic(await outcome(many));
    expect(text).toContain('blocks (403):');
    expect(text).toContain('  … 103 more');
    expect(text.split('\n').filter((l) => l.startsWith('  @'))).toHaveLength(DIAGNOSTIC_BLOCKS);
  });

  it('carries the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(TOOL_VERSION).toBe(pkg.version);
  });
});

describe('formatting', () => {
  it('formats sizes the way each language writes them', () => {
    expect(formatBytes(1, 'en')).toBe('1\u00a0byte');
    expect(formatBytes(812, 'fr')).toBe('812\u00a0octets');
    expect(formatBytes(1536, 'en')).toBe('1.5\u00a0KB');
    expect(formatBytes(1536, 'fr')).toBe('1,5\u00a0Ko');
    expect(formatBytes(14_540, 'en')).toBe('14\u00a0KB');
    expect(formatBytes(1.3 * 1024 * 1024, 'fr')).toBe('1,3\u00a0Mo');
  });

  it('adds "-clean" before the extension, which never changes', () => {
    expect(cleanName('photo.png', 'png')).toBe('photo-clean.png');
    expect(cleanName('ChatGPT Image 8 nov. 2026.webp', 'webp')).toBe('ChatGPT Image 8 nov. 2026-clean.webp');
    expect(cleanName('IMG_0042.JPEG', 'jpeg')).toBe('IMG_0042-clean.JPEG');
    expect(cleanName('no-extension', 'jpeg')).toBe('no-extension-clean.jpg');
    expect(cleanName('', 'png')).toBe('image-clean.png');
    expect(cleanName('C:\\Users\\me\\x.png', 'png')).toBe('x-clean.png');
  });

  it('cuts long values without splitting a surrogate pair', () => {
    expect(cut('abc', 5)).toBe('abc');
    expect(cut('abcdef', 3)).toBe('abc');
    expect(cut('ab😀', 3)).toBe('ab');
  });
});
