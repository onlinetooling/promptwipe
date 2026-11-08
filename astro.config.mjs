// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://promptwipe.pages.dev',
  // Folder URLs with a trailing slash everywhere: Cloudflare Pages serves
  // /page/ from page/index.html, so canonical, sitemap and links all agree.
  trailingSlash: 'always',
  // Strict CSP (design §3, review M1): no inline CSS or JS in pages, so
  // `style-src 'self'` and `script-src 'self'` hold. tests/dist checks it.
  build: { format: 'directory', inlineStylesheets: 'never' },
  vite: { build: { assetsInlineLimit: 0 } },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
    routing: { prefixDefaultLocale: false },
  },
});
