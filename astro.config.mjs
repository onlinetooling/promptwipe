// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://promptwipe.pages.dev',
  // Folder URLs with a trailing slash everywhere: Cloudflare Pages serves
  // /page/ from page/index.html, so canonical, sitemap and links all agree.
  trailingSlash: 'always',
  build: { format: 'directory' },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
    routing: { prefixDefaultLocale: false },
  },
});
