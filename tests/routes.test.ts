import { describe, expect, it } from 'vitest';
import { ROUTES, alternatesFor } from '../src/i18n/routes';

describe('route pairs', () => {
  it('every path ends with a slash and French paths live under /fr/', () => {
    for (const { en, fr } of ROUTES) {
      expect(en.endsWith('/')).toBe(true);
      expect(fr.endsWith('/')).toBe(true);
      expect(fr.startsWith('/fr/')).toBe(true);
      expect(en.startsWith('/fr/')).toBe(false);
    }
  });

  it('no path is used twice', () => {
    const all = ROUTES.flatMap((r) => [r.en, r.fr]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('finds the pair from either language', () => {
    expect(alternatesFor('/fr/')).toEqual({ en: '/', fr: '/fr/' });
    expect(alternatesFor('/nope/')).toBeUndefined();
  });
});
