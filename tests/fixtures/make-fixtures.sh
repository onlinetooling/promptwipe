#!/usr/bin/env bash
# Regenerates the base images used by the engine tests. They are synthetic
# patterns made by real encoders (ImageMagick 7, libwebp); the tests inject
# metadata into them. Output is committed so CI needs neither tool.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# 16x12 RGBA gradient with a transparent corner.
magick -size 16x12 gradient:'#ff0000-#0000ff' -alpha set \
  -channel A -fx '(i<4 && j<4) ? 0 : 1' +channel "PNG32:$tmp/rgba.png"
magick -size 16x12 gradient:'#00ff00-#ff00ff' -alpha set "PNG32:$tmp/b.png"

magick "$tmp/rgba.png" -background white -flatten -strip -interlace JPEG -quality 85 progressive.jpg
magick "$tmp/rgba.png" -background white -flatten -strip -quality 85 baseline.jpg
magick -delay 10 "$tmp/rgba.png" "$tmp/b.png" -strip APNG:apng.png
cwebp -quiet -q 80 -alpha_q 100 -metadata none "$tmp/rgba.png" -o lossy-alpha.webp
cwebp -quiet -q 80 -metadata none -noalpha "$tmp/b.png" -o lossy.webp
cwebp -quiet -lossless -metadata none "$tmp/rgba.png" -o lossless.webp
magick -delay 10 "$tmp/rgba.png" "$tmp/b.png" -strip -define webp:lossless=true animated.webp
chmod 644 ./*.png ./*.jpg ./*.webp
ls -l
