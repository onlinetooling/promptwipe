import { decodeLatin1, fourcc, trimText, u32be } from './bytes';

/**
 * The profile description ("sRGB IEC61966-2.1", "Display P3"…) of an ICC
 * profile, shown in the report because the profile is kept (design D3, review
 * L2). Null when absent or unreadable.
 */
export function iccDescription(p: Uint8Array): string | null {
  if (p.length < 132) return null;
  const count = Math.min(u32be(p, 128), 200);
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12;
    if (at + 12 > p.length) return null;
    if (fourcc(p, at) !== 'desc') continue;
    const off = u32be(p, at + 4);
    const size = u32be(p, at + 8);
    if (off + size > p.length || size < 12) return null;
    const type = fourcc(p, off);
    if (type === 'desc') {
      // ICC v2 textDescriptionType: ASCII count (with NUL), then ASCII.
      const n = Math.min(u32be(p, off + 8), size - 12, 1000);
      return tidy(decodeLatin1(p.subarray(off + 12, off + 12 + n)));
    }
    if (type === 'mluc' && size >= 28) {
      // ICC v4 multiLocalizedUnicodeType: first record, UTF-16BE.
      const len = u32be(p, off + 20);
      const start = off + u32be(p, off + 24);
      if (start + len > off + size) return null;
      return tidy(new TextDecoder('utf-16be').decode(p.subarray(start, start + Math.min(len, 2000))));
    }
    return null;
  }
  return null;
}

function tidy(s: string): string | null {
  const v = trimText(s);
  return v ? v : null;
}
