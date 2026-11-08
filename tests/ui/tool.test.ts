// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { messages } from '../../src/ui/messages';
import type { Decoder } from '../../src/ui/process';
import { type ToolDeps, mountTool } from '../../src/ui/tool';
import { ascii, be32, cat } from '../engine/helpers';
import { fileOf, fixedDecoder, richPng } from './samples';

// The same markup as src/components/Tool.astro.
function markup(lang: 'en' | 'fr' = 'en'): HTMLElement {
  document.body.innerHTML = `
    <section class="tool" data-tool data-lang="${lang}">
      <label class="drop" data-drop><input type="file" data-input /></label>
      <p data-status></p>
      <div data-result hidden></div>
    </section>`;
  return document.querySelector<HTMLElement>('[data-tool]')!;
}

function deps(decode: Decoder = fixedDecoder()): ToolDeps & { created: string[]; revoked: string[] } {
  const created: string[] = [];
  const revoked: string[] = [];
  return {
    decode,
    createUrl: () => {
      const url = `blob:${created.length + 1}`;
      created.push(url);
      return url;
    },
    revokeUrl: (url) => revoked.push(url),
    copy: async () => {},
    created,
    revoked,
  };
}

const heic = (): File => fileOf(cat(be32(24), ascii('ftypheic'), be32(0), ascii('mif1heic')), 'IMG_0001.HEIC');

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
}

/** A drop / paste event carrying files, as the browser builds it. */
function event(type: string, files: File[], key: 'dataTransfer' | 'clipboardData'): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, key, { value: { types: ['Files'], files, dropEffect: 'none' } });
  return e;
}

describe('tool', () => {
  it('shows the result, then frees the previous file when a new one comes', async () => {
    const root = markup();
    const d = deps();
    const tool = mountTool(root, d);
    await tool.handle(fileOf(richPng()), 'file');
    const panel = root.querySelector<HTMLElement>('[data-result]')!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('a[download]')?.getAttribute('href')).toBe('blob:1');
    expect(root.querySelector('[data-status]')?.textContent).toBe(`${messages.en.done} 6 metadata blocks removed.`);

    await tool.handle(heic(), 'file');
    expect(d.revoked).toEqual(['blob:1']);
    expect(panel.querySelector('a[download]')).toBeNull();
    expect(root.querySelector('[data-status]')?.textContent).toBe(`${messages.en.failed} ${messages.en.errHeic}`);
  });

  it('never stays on "Reading…" when showing the result fails', async () => {
    const root = markup();
    const d = deps();
    d.createUrl = () => {
      throw new Error('out of memory');
    };
    const tool = mountTool(root, d);
    await tool.handle(fileOf(richPng()), 'file');
    const panel = root.querySelector<HTMLElement>('[data-result]')!;
    expect(panel.hidden).toBe(false);
    expect(root.classList.contains('busy')).toBe(false);
    expect(panel.querySelector('a[download]')).toBeNull();
    expect(panel.querySelector('.verdict-text')?.textContent).toBe(messages.en.errInternal);
    expect(panel.textContent).toContain('error: internal: Error');
  });

  it('ignores the result of a file replaced while it was being checked', async () => {
    let release: () => void = () => {};
    let started = false;
    const slow: Decoder = async () => {
      started = true;
      await new Promise<void>((r) => {
        release = r;
      });
      return { width: 8, height: 6 };
    };
    const root = markup();
    const d = deps(slow);
    const tool = mountTool(root, d);
    const first = tool.handle(fileOf(richPng()), 'drop');
    await until(() => started);
    await tool.handle(heic(), 'drop'); // replaces the first file
    release();
    await first;
    const panel = root.querySelector<HTMLElement>('[data-result]')!;
    expect(panel.querySelector('.verdict-text')?.textContent).toBe(messages.en.errHeic);
    expect(d.created).toEqual([]); // the first file's result was never offered
  });

  it('takes a dropped file, one at a time, and keeps the browser on the page', async () => {
    const root = markup('fr');
    mountTool(root, deps());
    const drop = event('drop', [fileOf(richPng()), heic()], 'dataTransfer');
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await until(() => !root.querySelector<HTMLElement>('[data-result]')!.hidden);
    const panel = root.querySelector<HTMLElement>('[data-result]')!;
    expect(panel.querySelector('a[download]')?.getAttribute('download')).toBe('photo-clean.png');
    expect(panel.textContent).toContain(messages.fr.oneAtATime);
  });

  it('takes a pasted image', async () => {
    const root = markup();
    mountTool(root, deps());
    const paste = event('paste', [fileOf(richPng(), 'image.png')], 'clipboardData');
    document.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    await until(() => !root.querySelector<HTMLElement>('[data-result]')!.hidden);
    expect(root.querySelector('a[download]')?.getAttribute('download')).toBe('image-clean.png');
  });

  it('takes a chosen file', async () => {
    const root = markup();
    mountTool(root, deps());
    const input = root.querySelector<HTMLInputElement>('[data-input]')!;
    Object.defineProperty(input, 'files', { value: [fileOf(richPng(), 'chosen.png')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => !root.querySelector<HTMLElement>('[data-result]')!.hidden);
    expect(root.querySelector('a[download]')?.getAttribute('download')).toBe('chosen-clean.png');
  });

  it('leaves drags without files (text, links) to the browser', () => {
    const root = markup();
    mountTool(root, deps());
    const e = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
