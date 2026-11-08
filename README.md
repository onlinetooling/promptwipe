# PromptWipe

See and remove the metadata hidden in AI-generated images (prompts, seeds, ComfyUI workflows, C2PA / Content
Credentials, EXIF, GPS). Everything runs in your browser: images are never uploaded.

Status: under construction.

## Development

```sh
pnpm install
pnpm dev        # local site
pnpm test       # unit tests (vitest)
pnpm typecheck
pnpm build      # static site in dist/
pnpm test:dist  # checks on dist/ (no inline script or style, CSP headers)
pnpm serve:dist # serves dist/ with the headers of public/_headers (CSP), which `astro preview` ignores
```

`src/engine/` removes metadata from PNG, JPEG and WebP by container surgery: image data is copied byte for byte,
nothing is decoded or re-encoded.

`src/ui/` is the tool page: drop, choose or paste one image, see what it holds, download the clean copy. Before the
download is offered, the original and the output are both decoded by the browser and their sizes compared. Values
read from a file only ever reach the page as text, and the page makes no network request.

`cli/strip-image-metadata` is the command-line version (ImageMagick 7; PNG, JPEG, WebP, GIF). It re-encodes the
image, unlike the web tool.
