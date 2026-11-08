// JSON-LD for <script type="application/ld+json">. The data is the site's own
// constant text (never a value read from an image), and "<", ">", "&" and the
// JS line separators are escaped so the JSON can never close the script tag.
const UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

export function jsonLd(items: readonly object[]): string {
  const graph =
    items.length === 1
      ? { '@context': 'https://schema.org', ...items[0] }
      : { '@context': 'https://schema.org', '@graph': items };
  return JSON.stringify(graph).replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
