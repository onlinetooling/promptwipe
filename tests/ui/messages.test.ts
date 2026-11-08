import { describe, expect, it } from 'vitest';
import { messages } from '../../src/ui/messages';

type Tree = Record<string, unknown>;

function shape(v: unknown): unknown {
  if (typeof v === 'function') return 'function';
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Tree).map(([k, x]) => [k, shape(x)]).sort());
  return typeof v;
}

/** Every string a message can produce, with sample arguments. */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') return [String((v as (...a: unknown[]) => unknown)(1, '2 KB')), String((v as (...a: unknown[]) => unknown)(1234, '3 KB'))];
  if (v && typeof v === 'object') return Object.values(v as Tree).flatMap(strings);
  return [];
}

describe('messages', () => {
  it('has the same keys in English and French', () => {
    expect(shape(messages.fr)).toEqual(shape(messages.en));
  });

  it('never gives an empty string', () => {
    for (const lang of ['en', 'fr'] as const) for (const s of strings(messages[lang])) expect(s.trim(), lang).not.toBe('');
  });

  it('follows French typography: ’ apostrophes, no-break space before : ; ? ! and inside « »', () => {
    for (const s of strings(messages.fr)) {
      expect(s, s).not.toContain("'");
      expect(s, s).not.toMatch(/ [:;?!»]/);
      expect(s, s).not.toMatch(/« /);
    }
  });
});
