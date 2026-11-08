import type { Budget } from './budget';
import { inflateZlib } from './zlib';

export interface Inflated {
  bytes: Uint8Array;
  /** The shared budget ran out: `bytes` is the beginning only. */
  truncated: boolean;
}

/**
 * zlib inflate (PNG zTXt / iTXt / iCCP) within the shared text budget, with
 * the engine's own synchronous inflater: the output stops at the remaining
 * budget, and every browser decodes the same way. Returns null for data that
 * is not zlib or decodes to nothing.
 */
export function inflate(data: Uint8Array, budget: Budget): Inflated | null {
  if (budget.remaining <= 0) {
    budget.exceeded = true;
    return { bytes: new Uint8Array(0), truncated: true };
  }
  const r = inflateZlib(data, budget.remaining);
  if (!r) return null;
  budget.remaining -= r.bytes.length;
  if (r.truncated) budget.exceeded = true;
  return { bytes: r.bytes, truncated: r.truncated };
}
