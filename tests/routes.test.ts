import { describe, expect, it } from 'vitest';
import { HOME, ROUTES, alternatesFor, longDate } from '../src/i18n/routes';

describe('route pairs', () => {
  it('every path ends with a slash and French paths live under /fr/', () => {
    for (const { en, fr } of ROUTES) {
      expect(en.endsWith('/')).toBe(true);
      expect(fr.endsWith('/')).toBe(true);
      expect(fr.startsWith('/fr/')).toBe(true);
      expect(en.startsWith('/fr/')).toBe(false);
      expect(`${en}${fr}`).toMatch(/^[a-z0-9/-]+$/); // plain ASCII slugs
    }
  });

  it('no path is used twice', () => {
    const all = ROUTES.flatMap((r) => [r.en, r.fr]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('finds the pair from either language', () => {
    expect(alternatesFor('/fr/')).toBe(HOME);
    expect(HOME.en).toBe('/');
    expect(alternatesFor('/nope/')).toBeUndefined();
  });

  it('gives every page a label in both languages and real dates, never in the future', () => {
    const today = new Date().toISOString().slice(0, 10);
    const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
    for (const r of ROUTES) {
      expect(r.label.en.trim()).not.toBe('');
      expect(r.label.fr.trim()).not.toBe('');
      expect(valid(r.updated), r.updated).toBe(true);
      expect(r.updated >= '2026-11-08' && r.updated <= today, r.updated).toBe(true);
      if (r.kind === 'guide') {
        expect(valid(r.published ?? ''), `${r.en} needs a published date`).toBe(true);
        expect((r.published ?? '') <= r.updated).toBe(true);
      } else {
        expect(r.published).toBeUndefined();
      }
    }
  });

  it('writes French labels with French typography (they also appear on English pages)', () => {
    for (const r of ROUTES) {
      expect(r.label.fr, r.fr).not.toMatch(/[^\s\u00a0] [:;?!»]|« |'/);
    }
  });

  it('writes the date the way each language does', () => {
    expect(longDate('2026-11-08', 'en')).toBe('8 November 2026');
    expect(longDate('2026-11-08', 'fr')).toBe('8 novembre 2026');
  });
});
