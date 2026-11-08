// Serves dist/ on http://127.0.0.1:4322 with the headers of public/_headers
// (CSP, cache…), which `astro preview` ignores, and dist/404.html with a 404
// status for unknown paths, as Cloudflare Pages does. For local checks:
//   pnpm build && pnpm serve:dist
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');
const PORT = Number(process.env.PORT ?? 4322);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** The blocks of _headers: a path pattern ("/*", "/_astro/*") and its headers. */
async function headerRules() {
  const lines = (await readFile(join(DIST, '_headers'), 'utf8')).split('\n');
  const rules = [];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: {} });
      continue;
    }
    const at = line.indexOf(':');
    const rule = rules.at(-1);
    if (rule && at > 0) rule.headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return rules;
}

const rules = await headerRules();

/** Headers of every rule whose pattern matches (only a trailing "*" is used). */
function headersFor(path) {
  const out = {};
  for (const { pattern, headers } of rules) {
    const match = pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
    if (match) Object.assign(out, headers);
  }
  return out;
}

createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST + sep) && file !== DIST) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { ...headersFor(path), 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    const page = await readFile(join(DIST, '404.html')).catch(() => 'Not found');
    // Headers of the 404 page itself, never the year-long cache of a missing /_astro/ file.
    res.writeHead(404, { ...headersFor('/404.html'), 'Content-Type': TYPES['.html'] }).end(page);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`dist/ on http://127.0.0.1:${PORT}/ with _headers applied`));
