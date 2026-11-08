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
```

`src/engine/` removes metadata from PNG, JPEG and WebP by container surgery: image data is copied byte for byte,
nothing is decoded or re-encoded.

`cli/strip-image-metadata` is the command-line version (ImageMagick 7; PNG, JPEG, WebP, GIF). It re-encodes the
image, unlike the web tool.
