// Single source of truth for page URLs in both languages. The layout reads it
// for hreflang links, the breadcrumb, the footer and the language switcher;
// the sitemap and llms.txt read it too. French slugs are translated, so pairs
// are explicit. Every page must be listed here (the layout throws otherwise),
// except the 404.
export type Lang = 'en' | 'fr';

/** tool: embeds the tool; guide: dated article; about: trust and legal pages. */
export type PageKind = 'tool' | 'guide' | 'about';

export interface RoutePair {
  readonly en: string;
  readonly fr: string;
  /** Short name for the breadcrumb, the footer and llms.txt. */
  readonly label: { readonly en: string; readonly fr: string };
  readonly kind: PageKind;
  /** "Last updated" date (YYYY-MM-DD): shown on the page, sitemap lastmod, Article dateModified. */
  readonly updated: string;
  /** First publication (YYYY-MM-DD), for guides: Article datePublished. */
  readonly published?: string;
}

export const ROUTES: readonly RoutePair[] = [
  {
    en: '/',
    fr: '/fr/',
    label: { en: 'Remove AI image metadata', fr: 'Supprimer les métadonnées d’une image IA' },
    kind: 'tool',
    updated: '2026-11-08',
  },
  {
    en: '/view-ai-image-prompt/',
    fr: '/fr/voir-prompt-image-ia/',
    label: { en: 'View the prompt of an AI image', fr: 'Voir le prompt d’une image IA' },
    kind: 'tool',
    updated: '2026-11-08',
  },
  {
    en: '/remove-stable-diffusion-metadata/',
    fr: '/fr/supprimer-metadonnees-stable-diffusion/',
    label: { en: 'Stable Diffusion metadata', fr: 'Métadonnées Stable Diffusion' },
    kind: 'tool',
    updated: '2026-11-08',
  },
  {
    en: '/remove-comfyui-workflow-from-image/',
    fr: '/fr/supprimer-workflow-comfyui/',
    label: { en: 'ComfyUI workflow', fr: 'Workflow ComfyUI' },
    kind: 'tool',
    updated: '2026-11-08',
  },
  {
    en: '/remove-c2pa-content-credentials/',
    fr: '/fr/supprimer-c2pa-content-credentials/',
    label: { en: 'C2PA Content Credentials', fr: 'Content Credentials (C2PA)' },
    kind: 'tool',
    updated: '2026-11-08',
  },
  {
    en: '/remove-photo-metadata-gps/',
    fr: '/fr/supprimer-metadonnees-photo/',
    label: { en: 'Photo metadata and GPS', fr: 'Métadonnées et GPS d’une photo' },
    kind: 'tool',
    updated: '2026-11-08',
  },
  {
    en: '/guides/what-metadata-do-ai-images-contain/',
    fr: '/fr/guides/metadonnees-images-ia/',
    label: { en: 'What metadata AI images contain', fr: 'Les métadonnées des images IA' },
    kind: 'guide',
    updated: '2026-11-08',
    published: '2026-11-08',
  },
  {
    en: '/how-it-works/',
    fr: '/fr/comment-ca-marche/',
    label: { en: 'How it works', fr: 'Comment ça marche' },
    kind: 'about',
    updated: '2026-11-08',
  },
  {
    en: '/privacy/',
    fr: '/fr/confidentialite/',
    label: { en: 'Privacy', fr: 'Confidentialité' },
    kind: 'about',
    updated: '2026-11-08',
  },
  {
    en: '/legal/',
    fr: '/fr/mentions-legales/',
    label: { en: 'Legal notice', fr: 'Mentions légales' },
    kind: 'about',
    updated: '2026-11-08',
  },
];

export const SITE = 'https://promptwipe.pages.dev';

export const HOME: RoutePair = ROUTES[0]!;

export function alternatesFor(path: string): RoutePair | undefined {
  return ROUTES.find((r) => r.en === path || r.fr === path);
}

export function absolute(path: string): string {
  return new URL(path, SITE).href;
}

/** "8 November 2026" / "8 novembre 2026", from a YYYY-MM-DD date. */
export function longDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}
