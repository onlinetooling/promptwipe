import type { APIRoute } from 'astro';
import { ROUTES, absolute } from '../i18n/routes';

// Hand-built sitemap: @astrojs/sitemap pairs locales by identical paths, which
// breaks with translated French slugs.
export const GET: APIRoute = () => {
  const urls = ROUTES.flatMap((pair) =>
    [pair.en, pair.fr].map((loc) =>
      [
        '  <url>',
        `    <loc>${absolute(loc)}</loc>`,
        `    <xhtml:link rel="alternate" hreflang="en" href="${absolute(pair.en)}"/>`,
        `    <xhtml:link rel="alternate" hreflang="fr" href="${absolute(pair.fr)}"/>`,
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${absolute(pair.en)}"/>`,
        '  </url>',
      ].join('\n'),
    ),
  );
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
