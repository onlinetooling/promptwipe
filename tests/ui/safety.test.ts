import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonLd } from '../../src/layouts/json-ld';

// Source guards for two promises of the site: values read from a file are
// never parsed as HTML (design §3), and nothing is sent anywhere (CSP
// connect-src 'none' blocks it too; this catches it before the browser does).

const ROOT = join(import.meta.dirname, '../..');

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p, ext);
    return ext.test(name) ? [p] : [];
  });
}

const HTML_SINKS =
  /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment|\bsrcdoc\b|set:html|\beval\s*\(|new Function\b|javascript:|setAttribute\(\s*['"`]on/i;
const NETWORK = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bWebSocket\b|\bEventSource\b|\bRTCPeerConnection\b|navigator\.share\b/;

/**
 * The one allowed raw insertion: the layout's JSON-LD, serialized by jsonLd()
 * from the site's own constants (never a value read from an image).
 */
const JSON_LD = '<script type="application/ld+json" set:html={jsonLd(data)} />';

/** Code without its comments (a comment may name what the code must not do). */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

describe('source guards', () => {
  const page = files(join(ROOT, 'src'), /\.(ts|astro)$/);

  it.each(page.map((f) => [relative(ROOT, f), f]))('%s has no HTML sink and no network call', (_name, file) => {
    const source = withoutComments(readFileSync(file, 'utf8')).replace(JSON_LD, '');
    expect(source).not.toMatch(HTML_SINKS);
    expect(source).not.toMatch(NETWORK);
  });

  it('sees through comments but not past them', () => {
    expect(withoutComments('// never innerHTML\n/* nor fetch() */ x = 1')).not.toMatch(/innerHTML|fetch/);
    expect(withoutComments('el.innerHTML = v // set')).toMatch(HTML_SINKS);
    expect("el.setAttribute('onclick', v)").toMatch(HTML_SINKS);
    expect('a.href = "javascript:alert(1)"').toMatch(HTML_SINKS);
    expect(withoutComments("const u = 'https://x'; fetch(u)")).toMatch(NETWORK); // a URL is not a comment
  });

  it('allows raw insertion only for the JSON-LD of the layout', () => {
    const users = page.filter((f) => readFileSync(f, 'utf8').includes(JSON_LD)).map((f) => relative(ROOT, f));
    expect(users).toEqual(['src/layouts/Base.astro']);
    expect(readFileSync(join(ROOT, 'src/layouts/Base.astro'), 'utf8').split(JSON_LD).length).toBe(2);
  });

  it('serializes JSON-LD so that it can never close its script tag', () => {
    const trap = '</script><script>alert(1)</script> & \u2028';
    const out = jsonLd([{ name: trap }]);
    expect(out).not.toMatch(/[<>&]/);
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(out)).toEqual({ '@context': 'https://schema.org', name: trap });
    expect(JSON.parse(jsonLd([{ a: 1 }, { b: 2 }]))['@graph']).toHaveLength(2);
  });

  it('scans the engine, the tool and the pages', () => {
    const names = page.map((f) => relative(ROOT, f));
    expect(names).toContain('src/engine/index.ts');
    expect(names).toContain('src/ui/render.ts');
    expect(names).toContain('src/components/Tool.astro');
  });
});
