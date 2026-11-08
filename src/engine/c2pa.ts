import { decodeLatin1, decodeUtf8, fourcc, indexOfNul, u16be, u32be } from './bytes';

// Content Credentials (C2PA 2.2): a JUMBF manifest store whose active manifest
// holds a CBOR claim and a COSE signature. The engine reads only what the
// report shows — who the file *says* made and signed it. Nothing is verified
// (review L8): the UI must label these values "declared, signature not
// verified".

export interface C2paSummary {
  /** Bytes of the C2PA blocks in the file. */
  bytes: number;
  manifests: number;
  /** claim_generator(_info) of the active manifest. */
  generator: string | null;
  /** Organisation (or common name) of the signing certificate. */
  signer: string | null;
  title: string | null;
  /** False when the store could not be parsed (it is removed all the same). */
  readable: boolean;
}

// ---------- JUMBF boxes (ISO 19566-5) ----------

interface Box {
  type: string;
  content: number;
  end: number;
}

function readBoxes(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end && out.length < 10000) {
    const lbox = u32be(b, o);
    let header = 8;
    let size = lbox;
    if (lbox === 1) {
      if (o + 16 > end) break;
      size = u32be(b, o + 8) * 2 ** 32 + u32be(b, o + 12);
      header = 16;
    } else if (lbox === 0) size = end - o;
    if (size < header || o + size > end) break;
    out.push({ type: fourcc(b, o + 4), content: o + header, end: o + size });
    o += size;
  }
  return out;
}

interface Superbox {
  label: string | null;
  children: Box[];
}

function superbox(b: Uint8Array, box: Box): Superbox | null {
  if (box.type !== 'jumb') return null;
  const kids = readBoxes(b, box.content, box.end);
  const d = kids[0];
  if (!d || d.type !== 'jumd' || d.end - d.content < 17) return null;
  const toggles = b[d.content + 16]!;
  let label: string | null = null;
  if (toggles & 0x02) {
    const nul = indexOfNul(b, d.content + 17, d.end);
    if (nul > 0) label = decodeUtf8(b.subarray(d.content + 17, nul));
  }
  return { label, children: kids.slice(1) };
}

function child(b: Uint8Array, parent: Superbox, test: (label: string) => boolean): Superbox | null {
  for (const k of parent.children) {
    const s = superbox(b, k);
    if (s?.label && test(s.label)) return s;
  }
  return null;
}

function cborContent(b: Uint8Array, s: Superbox | null): unknown {
  const box = s?.children.find((k) => k.type === 'cbor');
  return box ? decodeCbor(b.subarray(box.content, box.end)) : undefined;
}

// ---------- CBOR (RFC 8949), bounded ----------

class CborError extends Error {}

interface Tagged {
  tag: number;
  value: unknown;
}

export function decodeCbor(b: Uint8Array): unknown {
  const state = { pos: 0, items: 0 };
  const BREAK = Symbol('break');

  const arg = (ai: number): number => {
    if (ai < 24) return ai;
    const n = ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : ai === 27 ? 8 : 0;
    if (n === 0) throw new CborError('bad additional info');
    if (state.pos + n > b.length) throw new CborError('truncated');
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + b[state.pos + i]!;
    state.pos += n;
    return v;
  };

  const bytesOf = (n: number): Uint8Array => {
    if (state.pos + n > b.length) throw new CborError('truncated');
    const out = b.subarray(state.pos, state.pos + n);
    state.pos += n;
    return out;
  };

  const item = (depth: number): unknown => {
    if (depth > 32 || ++state.items > 100000) throw new CborError('too deep or too large');
    if (state.pos >= b.length) throw new CborError('truncated');
    const ib = b[state.pos++]!;
    const major = ib >> 5;
    const ai = ib & 31;
    if (ai === 31) {
      if (major === 7) return BREAK;
      if (major === 2 || major === 3) {
        const parts: Uint8Array[] = [];
        for (;;) {
          const v = item(depth + 1);
          if (v === BREAK) break;
          if (!(v instanceof Uint8Array) && typeof v !== 'string') throw new CborError('bad chunk');
          parts.push(typeof v === 'string' ? new TextEncoder().encode(v) : v);
        }
        const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) {
          all.set(p, o);
          o += p.length;
        }
        return major === 3 ? decodeUtf8(all) : all;
      }
      if (major === 4) {
        const out: unknown[] = [];
        for (let v = item(depth + 1); v !== BREAK; v = item(depth + 1)) out.push(v);
        return out;
      }
      if (major === 5) {
        const out = new Map<unknown, unknown>();
        for (let k = item(depth + 1); k !== BREAK; k = item(depth + 1)) out.set(k, item(depth + 1));
        return out;
      }
      throw new CborError('bad indefinite length');
    }
    switch (major) {
      case 0:
        return arg(ai);
      case 1:
        return -1 - arg(ai);
      case 2:
        return bytesOf(arg(ai));
      case 3:
        return decodeUtf8(bytesOf(arg(ai)));
      case 4: {
        const n = arg(ai);
        if (n > b.length) throw new CborError('array too long');
        const out: unknown[] = [];
        for (let i = 0; i < n; i++) out.push(item(depth + 1));
        return out;
      }
      case 5: {
        const n = arg(ai);
        if (n > b.length) throw new CborError('map too long');
        const out = new Map<unknown, unknown>();
        for (let i = 0; i < n; i++) out.set(item(depth + 1), item(depth + 1));
        return out;
      }
      case 6: {
        const tag = arg(ai);
        return { tag, value: item(depth + 1) } satisfies Tagged;
      }
      default: {
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        if (ai === 23) return undefined;
        if (ai === 25 || ai === 26 || ai === 27) {
          const n = ai === 25 ? 2 : ai === 26 ? 4 : 8;
          const raw = bytesOf(n);
          const view = new DataView(raw.buffer, raw.byteOffset, n);
          if (n === 4) return view.getFloat32(0);
          if (n === 8) return view.getFloat64(0);
          return u16be(raw, 0); // half float: value not needed, keep the bits
        }
        if (ai < 24) return ai;
        if (ai === 24) return arg(ai);
        throw new CborError('bad simple value');
      }
    }
  };

  const v = item(0);
  if (v === BREAK) throw new CborError('unexpected break');
  return v;
}

function get(m: unknown, key: unknown): unknown {
  return m instanceof Map ? m.get(key) : undefined;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// ---------- X.509 subject (DER), bounded ----------

interface Der {
  tag: number;
  start: number;
  end: number;
}

function der(b: Uint8Array, o: number, limit: number): Der | null {
  if (o + 2 > limit) return null;
  const tag = b[o]!;
  let len = b[o + 1]!;
  let start = o + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4 || start + n > limit) return null;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[start + i]!;
    start += n;
  }
  return start + len <= limit ? { tag, start, end: start + len } : null;
}

function derChildren(b: Uint8Array, node: Der): Der[] {
  const out: Der[] = [];
  for (let o = node.start; o < node.end && out.length < 1000; ) {
    const d = der(b, o, node.end);
    if (!d) break;
    out.push(d);
    o = d.end;
  }
  return out;
}

function derString(b: Uint8Array, d: Der): string | null {
  const raw = b.subarray(d.start, d.end);
  if (d.tag === 0x0c) return decodeUtf8(raw);
  if (d.tag === 0x13 || d.tag === 0x16 || d.tag === 0x14) return decodeLatin1(raw);
  if (d.tag === 0x1e) return new TextDecoder('utf-16be').decode(raw);
  return null;
}

/** Subject O (else CN) of a DER certificate. */
export function certificateSubject(b: Uint8Array): string | null {
  const cert = der(b, 0, b.length);
  if (!cert || cert.tag !== 0x30) return null;
  const tbs = derChildren(b, cert)[0];
  if (!tbs || tbs.tag !== 0x30) return null;
  const parts = derChildren(b, tbs);
  const skip = parts[0]?.tag === 0xa0 ? 1 : 0; // explicit version
  const subject = parts[skip + 4]; // serial, signature, issuer, validity, subject
  if (!subject || subject.tag !== 0x30) return null;
  let org: string | null = null;
  let cn: string | null = null;
  for (const rdn of derChildren(b, subject)) {
    for (const atv of derChildren(b, rdn)) {
      const [oid, value] = derChildren(b, atv);
      if (!oid || !value || oid.tag !== 0x06 || oid.end - oid.start !== 3) continue;
      if (b[oid.start] !== 0x55 || b[oid.start + 1] !== 0x04) continue;
      const kind = b[oid.start + 2];
      if (kind === 0x0a) org ??= derString(b, value);
      else if (kind === 0x03) cn ??= derString(b, value);
    }
  }
  return str(org) ?? str(cn);
}

// ---------- Manifest store ----------

function generatorOf(claim: unknown): string | null {
  const info = get(claim, 'claim_generator_info');
  const first = Array.isArray(info) ? info[0] : info;
  const name = str(get(first, 'name'));
  if (name) {
    const version = str(get(first, 'version'));
    return version ? `${name} ${version}` : name;
  }
  return str(get(claim, 'claim_generator'));
}

function signerOf(signature: unknown): string | null {
  const cose = signature && typeof signature === 'object' && 'tag' in signature ? (signature as Tagged).value : signature;
  if (!Array.isArray(cose) || cose.length < 4) return null;
  const [prot, unprot] = cose;
  let header: unknown;
  if (prot instanceof Uint8Array && prot.length > 0) {
    try {
      header = decodeCbor(prot);
    } catch {
      header = undefined;
    }
  }
  const chain = get(header, 33) ?? get(unprot, 33) ?? get(unprot, 'x5chain');
  const leaf = Array.isArray(chain) ? chain[0] : chain;
  return leaf instanceof Uint8Array ? certificateSubject(leaf) : null;
}

/** Reads one manifest store (the content of a PNG caBX, a WebP C2PA chunk, or reassembled JPEG APP11 segments). */
export function readC2pa(store: Uint8Array, totalBytes: number): C2paSummary {
  const summary: C2paSummary = { bytes: totalBytes, manifests: 0, generator: null, signer: null, title: null, readable: false };
  try {
    const top = readBoxes(store, 0, store.length)
      .map((box) => superbox(store, box))
      .find((s) => s?.label === 'c2pa');
    if (!top) return summary;
    const manifests = top.children.map((k) => superbox(store, k)).filter((s): s is Superbox => s !== null);
    summary.manifests = manifests.length;
    const active = manifests[manifests.length - 1];
    if (!active) return summary;
    const claim = cborContent(store, child(store, active, (l) => l === 'c2pa.claim' || l === 'c2pa.claim.v2'));
    summary.generator = generatorOf(claim);
    summary.title = str(get(claim, 'dc:title'));
    summary.signer = signerOf(cborContent(store, child(store, active, (l) => l === 'c2pa.signature')));
    summary.readable = true;
  } catch {
    summary.readable = false;
  }
  return summary;
}

/**
 * Rebuilds the JUMBF boxes carried by JPEG APP11 segments (JPEG XT / C2PA 2.2
 * A.3.1): each segment holds "JP", a box instance number, a sequence number,
 * then the box header (repeated in every segment) and the next slice of
 * content.
 */
export function jumbfFromApp11(payloads: readonly Uint8Array[]): Uint8Array[] {
  const groups = new Map<number, { seq: number; data: Uint8Array }[]>();
  for (const p of payloads) {
    if (p.length < 16 || p[0] !== 0x4a || p[1] !== 0x50) continue;
    const instance = u16be(p, 2);
    const seq = u32be(p, 4);
    const list = groups.get(instance) ?? [];
    list.push({ seq, data: p.subarray(8) });
    groups.set(instance, list);
  }
  const stores: Uint8Array[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.seq - b.seq);
    const parts = list.map((x, i) => {
      if (i === 0) return x.data;
      const header = u32be(x.data, 0) === 1 ? 16 : 8;
      return x.data.subarray(header);
    });
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    stores.push(all);
  }
  return stores;
}
