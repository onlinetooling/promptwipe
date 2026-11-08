import type { Budget } from './budget';
import { concat } from './bytes';

export interface Inflated {
  bytes: Uint8Array;
  /** The shared budget ran out: `bytes` is the beginning only. */
  truncated: boolean;
}

/**
 * zlib (RFC 1950) inflate with the shared text budget, via the browser's
 * DecompressionStream ("deflate" is the zlib format, as in PNG zTXt / iTXt /
 * iCCP). The stream is cancelled as soon as the budget is spent. Returns null
 * for corrupt data that produced nothing.
 */
export async function inflate(data: Uint8Array, budget: Budget): Promise<Inflated | null> {
  if (budget.remaining <= 0) {
    budget.exceeded = true;
    return { bytes: new Uint8Array(0), truncated: true };
  }
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = budget.remaining - total;
      if (value.length >= room) {
        parts.push(value.subarray(0, room));
        total += room;
        truncated = value.length > room;
        if (truncated) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      } else {
        parts.push(value);
        total += value.length;
      }
    }
  } catch {
    // Corrupt or truncated zlib stream: keep what was decoded, if anything.
    if (total === 0) return null;
  }
  budget.remaining -= total;
  if (truncated) budget.exceeded = true;
  return { bytes: concat(parts), truncated };
}
