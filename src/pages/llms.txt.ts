import type { APIRoute } from 'astro';
import { ROUTES, absolute } from '../i18n/routes';

// Short llms.txt (llmstxt.org): what the site is, its pages, the privacy facts.
// Built from the route table so it never lists a page that does not exist.
export const GET: APIRoute = () => {
  const list = (kind: string, lang: 'en' | 'fr') =>
    ROUTES.filter((r) => r.kind === kind).map((r) => `- [${r.label[lang]}](${absolute(r[lang])})`);
  const body = [
    '# PromptWipe',
    '',
    '> Free web tool that shows and removes the metadata embedded in images, especially AI-generated ones: prompts,',
    '> seeds and settings (AUTOMATIC1111, Forge, Fooocus, InvokeAI), ComfyUI workflows, C2PA Content Credentials,',
    '> EXIF, XMP and GPS location. Everything runs in the browser; images are never uploaded.',
    '',
    'Facts:',
    '- Formats: PNG, JPEG and WebP. AVIF, HEIC and GIF are not supported yet.',
    '- Removal is lossless: image data is copied byte for byte, metadata blocks are left out. The colour profile and the',
    '  EXIF orientation are kept.',
    '- It does not remove invisible watermarks in the pixels (such as SynthID) and does not make an image undetectable',
    '  as AI-generated.',
    "- No server receives images; the site's Content-Security-Policy sets connect-src 'none'. Source code (MIT):",
    '  https://github.com/onlinetooling/promptwipe',
    '',
    '## Tools',
    ...list('tool', 'en'),
    '',
    '## Guides',
    ...list('guide', 'en'),
    '',
    '## About',
    ...list('about', 'en'),
    '',
    '## En français',
    ...ROUTES.map((r) => `- [${r.label.fr}](${absolute(r.fr)})`),
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
