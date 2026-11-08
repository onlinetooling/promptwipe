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

  it('ships the CSP headers file', () => {
    const headers = readFileSync(join(DIST, '_headers'), 'utf8');
    expect(headers).toContain("default-src 'none'");
    expect(headers).toContain("connect-src 'none'");
    expect(headers).toContain("frame-ancestors 'none'");
  });
});
