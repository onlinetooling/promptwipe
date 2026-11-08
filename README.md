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
```

`cli/strip-image-metadata` is the command-line version (ImageMagick 7).
