// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { LINKS } from '../../src/ui/links';
import { messages } from '../../src/ui/messages';
import { processFile, type Outcome } from '../../src/ui/process';
import { LISTED_BLOCKS, renderOutcome, type RenderContext } from '../../src/ui/render';
import { ascii, basePng, be32, cat, tEXt, withPngChunks } from '../engine/helpers';
import { TRAP, fileOf, fixedDecoder, richPng } from './samples';

async function outcome(bytes: Uint8Array, name = 'photo.png', source: 'drop' | 'paste' = 'drop'): Promise<Outcome> {
  const o = await processFile(fileOf(bytes, name), source, fixedDecoder(), () => true);
  if (!o) throw new Error('superseded');
  return o;
}

function render(o: Outcome, ctx: Partial<RenderContext> = {}): HTMLElement {
  const panel = document.createElement('div');
  document.body.replaceChildren(panel);
  renderOutcome(panel, o, { lang: 'en', url: 'blob:test', copy: async () => {}, ...ctx });
  return panel;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('rendering values read from the file', () => {
  it('shows a trapped value as text, never as HTML', async () => {
    const bytes = richPng({ key: TRAP, prompt: `${TRAP}<script>alert(2)</script>`, maker: TRAP });
    const panel = render(await outcome(bytes, `${TRAP}.png`));
    // The only image is the preview of the cleaned file.
    const imgs = [...panel.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['blob:test']);
    expect(panel.querySelectorAll('script, [onerror]')).toHaveLength(0);
    const text = panel.textContent ?? '';
    expect(text).toContain(`${TRAP}<script>alert(2)</script>`); // the prompt
    const makerRow = [...panel.querySelectorAll('li.row')].find((li) => li.querySelector('.value-label')?.textContent === 'Camera maker (Make)');
    expect(makerRow?.querySelector('.value-inline')?.textContent).toBe(TRAP); // an EXIF value
    expect(text).toContain(`File name: ${TRAP}-clean.png`); // the file name
    expect(panel.querySelector('a[download]')?.getAttribute('download')).toBe(`${TRAP}-clean.png`);
  });

  it('cuts very long values on screen, and copies them whole', async () => {
    const long = 'x'.repeat(30_000);
    const copied: string[] = [];
    const panel = render(await outcome(withPngChunks(basePng(), [tEXt('parameters', long)])), {
      copy: async (t) => {
        copied.push(t);
      },
    });
    const pre = panel.querySelector('pre.value');
    expect(pre?.textContent).toHaveLength(20_000);
    expect(panel.textContent).toContain('Only the first 20,000 characters are shown.');
    const button = panel.querySelector<HTMLButtonElement>('.value-item button.copy');
    button?.click();
    await flush();
    expect(copied).toEqual([long]);
    expect(button?.textContent).toBe('Copied');
  });

  it('says so when copying fails', async () => {
    const panel = render(await outcome(richPng()), { copy: () => Promise.reject(new Error('denied')) });
    const button = panel.querySelector<HTMLButtonElement>('.value-item button.copy');
    button?.click();
    await flush();
    expect(button?.textContent).toBe(messages.en.copyFailed);
  });
});

describe('result panel', () => {
  it('offers the clean file with its name, sizes, report and a closed diagnostic', async () => {
    const panel = render(await outcome(richPng(), 'ComfyUI_00042_.png'));
    const link = panel.querySelector('a.button');
    expect(link?.getAttribute('href')).toBe('blob:test');
    expect(link?.getAttribute('download')).toBe('ComfyUI_00042_-clean.png');
    expect(panel.querySelector('.verdict-text')?.textContent).toBe('6 metadata blocks removed.');
    expect([...panel.querySelectorAll('h3')].map((x) => x.textContent)).toEqual(['What the image contained', 'What was removed', 'What was kept']);
    const diag = panel.querySelector<HTMLDetailsElement>('details.diagnostic');
    expect(diag?.open).toBe(false);
    expect(diag?.textContent).toContain('PromptWipe diagnostic');
  });

  it('offers nothing for a file that is already clean', async () => {
    const panel = render(await outcome(basePng()), { url: null });
    expect(panel.querySelector('a[download]')).toBeNull();
    expect(panel.textContent).toContain(messages.en.alreadyClean);
    expect(panel.textContent).toContain(messages.en.nothingReadable);
  });

  it('reminds that pasted images often lost their metadata already', async () => {
    const panel = render(await outcome(basePng(), 'image.png', 'paste'), { url: null });
    expect(panel.textContent).toContain(messages.en.pastedNote);
  });

  it('links a refused format to the feature requests, in French on the French page', async () => {
    const heic = cat(be32(24), ascii('ftypheic'), be32(0), ascii('mif1heic'));
    const panel = render(await outcome(heic, 'IMG_0001.HEIC'), { lang: 'fr' });
    expect(panel.querySelector('.verdict-text')?.textContent).toBe(messages.fr.errHeic);
    expect(panel.querySelector('a')?.getAttribute('href')).toBe(LINKS.discussions);
    expect(panel.querySelector('details.diagnostic')).toBeNull();
    expect(panel.querySelector('a[download]')).toBeNull();
  });

  it('opens the diagnostic when the failure looks like a PromptWipe bug', async () => {
    const o = await outcome(richPng());
    if (o.kind !== 'done') throw new Error('not cleaned');
    const failed: Outcome = {
      kind: 'error',
      file: o.file,
      failure: { code: 'decode-mismatch', detail: 'original decodes to 8x6, output 6x8', format: 'png' },
      detected: 'png',
      inspection: o.inspection,
    };
    const panel = render(failed);
    expect(panel.querySelector('a[download]')).toBeNull();
    expect(panel.querySelector<HTMLDetailsElement>('details.diagnostic')?.open).toBe(true);
    expect(panel.querySelector('a[href^="https://github.com/onlinetooling/promptwipe/issues/new"]')).not.toBeNull();
    // What the file holds is still shown; what "was removed" is not, since nothing was.
    expect([...panel.querySelectorAll('h3')].map((x) => x.textContent)).toEqual(['What the image contained']);
  });

  it(`lists at most ${LISTED_BLOCKS} blocks`, async () => {
    const many = withPngChunks(basePng(), Array.from({ length: 600 }, (_, i) => tEXt(`k${i}`, 'v')));
    const panel = render(await outcome(many));
    const items = panel.querySelectorAll('details.all-blocks li');
    expect(items).toHaveLength(LISTED_BLOCKS + 1);
    expect(items[LISTED_BLOCKS]?.textContent).toBe('… and 103 more');
  });
});
