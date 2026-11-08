// @vitest-environment happy-dom
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME, ROUTES, absolute, type Lang } from '../../src/i18n/routes';

// SEO checks on the built site (design §6), run in CI after the build:
// title, description, canonical, hreflang pair, one h1, valid JSON-LD,
// sitemap with the dates the pages show, no broken internal link or anchor.

const DIST = join(import.meta.dirname, '../../dist');
const LANGS: readonly Lang[] = ['en', 'fr'];

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    return name.endsWith('.html') ? [p] : [];
  });
}

/** /fr/guides/x/ -> dist/fr/guides/x/index.html */
function pageFile(url: string): string {
  return join(DIST, ...url.split('/').filter(Boolean), 'index.html');
}

/** dist/fr/index.html -> /fr/ ; dist/404.html -> /404.html */
function urlOf(file: string): string {
  return `/${relative(DIST, file).split(sep).join('/').replace(/index\.html$/, '')}`;
}

const docs = new Map<string, Document>();
function doc(file: string): Document {
  let d = docs.get(file);
  if (!d) {
    d = new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/html');
    docs.set(file, d);
  }
  return d;
}

interface Thing {
  '@type': string;
  [key: string]: unknown;
}

function structuredData(d: Document): Thing[] {
  return [...d.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
    const json = JSON.parse(s.textContent ?? '') as { '@context'?: string; '@graph'?: Thing[] } & Thing;
    expect(json['@context']).toBe('https://schema.org');
    return json['@graph'] ?? [json];
  });
}

const pages = ROUTES.flatMap((pair) => LANGS.map((lang) => ({ pair, lang, url: pair[lang] })));

// No skip when dist/ is missing: reading the sitemap throws and the suite fails.
describe('SEO of the built site', () => {
  const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
  const lastmod = new Map(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
  );

  it.each(pages.map((p) => [p.url, p] as const))('%s', (_url, { pair, lang, url }) => {
    const file = pageFile(url);
    expect(existsSync(file), `${url} is in routes.ts but was not built`).toBe(true);
    const d = doc(file);
    expect(d.documentElement.getAttribute('lang')).toBe(lang);

    // Title and description (design §6: title ≤ 60 characters; the privacy promise on tool pages).
    expect(d.title.length, d.title).toBeGreaterThanOrEqual(15);
    expect(d.title.length, d.title).toBeLessThanOrEqual(60);
    const description = d.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    expect(description.length, description).toBeGreaterThanOrEqual(70);
    expect(description.length, description).toBeLessThanOrEqual(165);
    if (pair.kind === 'tool') {
      expect(description).toMatch(lang === 'en' ? /nothing is uploaded|never uploaded/i : /rien n’est envoyé|jamais envoyée/i);
    }

    // Canonical and the reciprocal hreflang set.
    expect(d.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(absolute(url));
    const alt = (h: string) => d.querySelector(`link[rel="alternate"][hreflang="${h}"]`)?.getAttribute('href');
    expect(alt('en')).toBe(absolute(pair.en));
    expect(alt('fr')).toBe(absolute(pair.fr));
    expect(alt('x-default')).toBe(absolute(pair.en));
    expect(d.querySelector('meta[name="robots"]')).toBeNull();

    // Answer-first paragraph of 40 to 60 words right under the h1 (design §6).
    const lead = d.querySelector('main h1 + p.lead')?.textContent ?? '';
    const words = lead.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    expect(words, `lead of ${url}`).toBeGreaterThanOrEqual(40);
    expect(words, `lead of ${url}`).toBeLessThanOrEqual(60);

    // One h1; the limits box; the date shown is the sitemap's lastmod.
    const h1 = d.querySelectorAll('h1');
    expect(h1).toHaveLength(1);
    expect(d.querySelector('.limits')).not.toBeNull();
    expect(d.querySelector('.updated time')?.getAttribute('datetime')).toBe(pair.updated);
    expect(lastmod.get(absolute(url))).toBe(pair.updated);

    // Tool pages carry the tool, loaded as an external module (CSP).
    if (pair.kind === 'tool') {
      expect(d.querySelector('[data-tool]')).not.toBeNull();
      expect(d.querySelector('script[type="module"][src^="/_astro/"]')).not.toBeNull();
    }

    // Structured data matching the visible page.
    const data = structuredData(d);
    const types = data.map((t) => t['@type']);
    if (pair === HOME) {
      expect(types).toEqual(['WebSite', 'WebApplication']);
      expect(data[0]?.['@id']).toBe(`${absolute(url)}#website`);
    } else {
      const crumbs = data.find((t) => t['@type'] === 'BreadcrumbList')?.['itemListElement'] as { item: string; name: string }[];
      expect(crumbs.map((c) => c.item)).toEqual([absolute(HOME[lang]), absolute(url)]);
      expect(crumbs[1]?.name).toBe(pair.label[lang]);
      expect(d.querySelector('.breadcrumb [aria-current="page"]')?.textContent).toBe(pair.label[lang]);
    }
    if (pair.kind === 'guide') {
      const article = data.find((t) => t['@type'] === 'Article');
      expect(article?.['dateModified']).toBe(pair.updated);
      expect(article?.['datePublished']).toBe(pair.published);
      expect(article?.['headline']).toBe(h1[0]?.textContent);
      expect(article?.['inLanguage']).toBe(lang);
    }
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|FAQPage/);
  });

  it('gives every page its own title and description', () => {
    const files = pages.map((p) => doc(pageFile(p.url)));
    const titles = files.map((d) => d.title);
    const descriptions = files.map((d) => d.querySelector('meta[name="description"]')?.getAttribute('content'));
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('lists exactly the pages of the route table in the sitemap, each with its language alternates', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual(pages.map((p) => absolute(p.url)).sort());
    const blocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1] ?? '');
    expect(blocks).toHaveLength(pages.length);
    for (const block of blocks) {
      const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1] ?? '';
      const pair = pages.find((p) => absolute(p.url) === loc)?.pair;
      const alternates = [...block.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
      expect(alternates, loc).toEqual([
        `en ${absolute(pair?.en ?? '')}`,
        `fr ${absolute(pair?.fr ?? '')}`,
        `x-default ${absolute(pair?.en ?? '')}`,
      ]);
    }
  });

  it('has no broken internal link or anchor, and no relative link', () => {
    const problems: string[] = [];
    for (const file of htmlFiles(DIST)) {
      const d = doc(file);
      const from = urlOf(file);
      for (const a of d.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') ?? '';
        if (/^https:\/\//.test(href)) continue;
        if (/^(http:|mailto:|\/\/)/.test(href) || (!href.startsWith('/') && !href.startsWith('#'))) {
          problems.push(`${from}: ${href} (use https:// or a path from the root)`);
          continue;
        }
        const [path = '', hash] = href.split('#');
        let target = file;
        if (path) {
          if (!path.endsWith('/') && !/\.[a-z]+$/.test(path)) problems.push(`${from}: ${href} (no trailing slash)`);
          target = path.endsWith('/') ? pageFile(path) : join(DIST, path);
          if (!existsSync(target)) {
            problems.push(`${from}: ${href} (missing)`);
            continue;
          }
        }
        if (hash && target.endsWith('.html') && !doc(target).getElementById(decodeURIComponent(hash))) {
          problems.push(`${from}: ${href} (no #${hash})`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('links every tool page, in both languages, from every footer', () => {
    const tools = ROUTES.filter((r) => r.kind === 'tool').flatMap((r) => [r.en, r.fr]);
    for (const p of pages) {
      const links = [...doc(pageFile(p.url)).querySelectorAll('footer a')].map((a) => a.getAttribute('href'));
      for (const t of tools) expect(links, p.url).toContain(t);
    }
  });

  it('serves a real 404 page that is not indexed', () => {
    const d = doc(join(DIST, '404.html'));
    expect(d.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    expect(d.querySelector('link[rel="canonical"]')).toBeNull();
    expect(d.querySelectorAll('h1')).toHaveLength(1);
    const links = [...d.querySelectorAll('main a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(expect.arrayContaining([HOME.en, HOME.fr]));
  });

  it('opens robots.txt to every crawler and points to the sitemap', () => {
    const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
    expect(robots).toMatch(/^User-agent: \*\nAllow: \/$/m);
    expect(robots).not.toMatch(/Disallow/);
    expect(robots).toContain(`Sitemap: ${absolute('/sitemap.xml')}`);
  });

  it('carries the Search Console tag once in the head of every page', () => {
    for (const file of htmlFiles(DIST)) {
      const tags = doc(file).querySelectorAll('meta[name="google-site-verification"]');
      expect(tags, urlOf(file)).toHaveLength(1);
      expect(tags[0]?.parentElement?.tagName, urlOf(file)).toBe('HEAD');
      expect(tags[0]?.getAttribute('content'), urlOf(file)).toMatch(/^[\w-]{40,}$/);
    }
  });

  it('serves one IndexNow key file whose content is its own name', () => {
    const keys = readdirSync(DIST).filter((name) => /^[0-9a-f]{32}\.txt$/.test(name));
    expect(keys).toHaveLength(1);
    const key = keys[0] ?? '';
    expect(readFileSync(join(DIST, key), 'utf8')).toBe(key.replace(/\.txt$/, ''));
  });

  it('lists in llms.txt only pages that exist, and all of them', () => {
    const llms = readFileSync(join(DIST, 'llms.txt'), 'utf8');
    const urls = [...llms.matchAll(/\]\((https:\/\/promptwipe\.pages\.dev[^)]*)\)/g)].map((m) => m[1]);
    expect(urls.sort()).toEqual(pages.map((p) => absolute(p.url)).sort());
  });

  it('caches the hashed bundles, not the pages', () => {
    const headers = readFileSync(join(DIST, '_headers'), 'utf8');
    expect(headers).toMatch(/^\/_astro\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m);
    expect(headers.match(/Cache-Control/g)).toHaveLength(1);
  });
});
