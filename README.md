# PromptWipe

See and remove the metadata hidden in AI-generated images (prompts, seeds, ComfyUI workflows, C2PA / Content
Credentials, EXIF, GPS). Everything runs in your browser: images are never uploaded.

Live at https://promptwipe.pages.dev (English) and https://promptwipe.pages.dev/fr/ (French).

## Development

```sh
pnpm install
pnpm dev        # local site
pnpm test       # unit tests (vitest)
pnpm typecheck
pnpm build      # static site in dist/
pnpm test:dist  # checks on dist/: no inline script or style (CSP), SEO (titles, canonical, hreflang, JSON-LD, sitemap, links)
pnpm serve:dist # serves dist/ with the headers of public/_headers (CSP), which `astro preview` ignores
```

`src/engine/` removes metadata from PNG, JPEG and WebP by container surgery: image data is copied byte for byte,
nothing is decoded or re-encoded.

`src/ui/` is the tool page: drop, choose or paste one image, see what it holds, download the clean copy. Before the
download is offered, the original and the output are both decoded by the browser and their dimensions compared. Values
read from a file only ever reach the page as text, and the page makes no network request.

Pages are listed in `src/i18n/routes.ts` (English at `/`, French under `/fr/` with translated addresses); the
layout, the sitemap and `llms.txt` are built from that table, and the build fails if a page is missing from it.
