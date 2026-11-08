import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../../src/i18n/routes';

const DIST = join(import.meta.dirname, '../../dist');

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    return name.endsWith('.html') ? [p] : [];
  });
}

/** dist/fr/index.html -> /fr/ */
function urlOf(file: string): string {
  const rel = relative(DIST, file).split(sep).join('/');
  return `/${rel.replace(/index\.html$/, '')}`;
}

describe('built site', () => {
  it('exists (run pnpm build first)', () => {
    expect(existsSync(DIST)).toBe(true);
  });

  const files = existsSync(DIST) ? htmlFiles(DIST) : [];

  it.each(files.map((f) => [urlOf(f), f]))('%s has no inline script or style (CSP)', (_url, file) => {
    const html = readFileSync(file, 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1] ?? '');
    for (const attrs of scripts) {
      const external = /\ssrc\s*=/.test(attrs);
      const data = /type\s*=\s*["']?application\/ld\+json/i.test(attrs);
      expect(external || data, `inline <script${attrs}>`).toBe(true);
    }
    expect(html, 'inline <style>').not.toMatch(/<style\b/i);
    expect(html, 'style attribute').not.toMatch(/\sstyle\s*=/i);
  });

  it('every page is in the EN / FR route table (except the 404)', () => {
    const known = new Set(ROUTES.flatMap((r) => [r.en, r.fr]));
    const pages = files.map(urlOf).filter((u) => u !== '/404.html');
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect(known, page).toContain(page);
  });

  it('loads the tool as an external module on both tool pages', () => {
    for (const page of ['index.html', 'fr/index.html']) {
      const html = readFileSync(join(DIST, page), 'utf8');
      expect(html, page).toMatch(/<script type="module" src="\/_astro\/[^"]+\.js"><\/script>/);
      expect(html, page).toContain('data-tool');
    }
  });

  it('bundles no HTML sink and no network call (CSP connect-src none)', () => {
    const js = htmlFiles(DIST).length ? readdirSync(join(DIST, '_astro')).filter((f) => f.endsWith('.js')) : [];
    expect(js.length).toBeGreaterThan(0);
    for (const name of js) {
      const code = readFileSync(join(DIST, '_astro', name), 'utf8');
      expect(code, name).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser/);
      expect(code, name).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    }
  });

  it('follows French typography on French pages (no-break space before : ; ? ! and inside « »)', () => {
    const fr = files.filter((f) => urlOf(f).startsWith('/fr/'));
    expect(fr.length).toBeGreaterThan(0);
    for (const file of fr) {
      const html = readFileSync(file, 'utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '');
      const attrs = [...html.matchAll(/\s(?:content|alt|title|aria-label)="([^"]*)"/g)].map((m) => m[1] ?? '');
      const text = [html.replace(/<[^>]*>/g, ' '), ...attrs].join('\n').replace(/&nbsp;/g, '\u00a0');
      // Ordinary space (not U+00A0 / U+202F) right before French high punctuation; skips URLs ("https:").
      const bad = text.match(/[^\s] [:;?!»]|« /g);
      expect(bad, urlOf(file)).toBeNull();
    }
  });

  it('ships the CSP headers file', () => {
    const headers = readFileSync(join(DIST, '_headers'), 'utf8');
    expect(headers).toContain("default-src 'none'");
    expect(headers).toContain("connect-src 'none'");
    expect(headers).toContain("frame-ancestors 'none'");
  });
});
