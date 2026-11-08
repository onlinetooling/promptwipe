// Single source of truth for page URLs in both languages. The layout reads it
// for hreflang links and the language switcher; the sitemap reads it for the
// <xhtml:link> alternates. French slugs are translated, so pairs are explicit.
export type Lang = 'en' | 'fr';

export interface RoutePair {
  readonly en: string;
  readonly fr: string;
}

export const ROUTES: readonly RoutePair[] = [
  { en: '/', fr: '/fr/' },
];

export const SITE = 'https://promptwipe.pages.dev';

export function alternatesFor(path: string): RoutePair | undefined {
  return ROUTES.find((r) => r.en === path || r.fr === path);
}

export function absolute(path: string): string {
  return new URL(path, SITE).href;
}
