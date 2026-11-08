/**
 * One budget for all text decoded from a file (design §3, review L3): 10 000
 * small compressed chunks must not inflate to gigabytes of strings.
 */
export const TEXT_BUDGET_BYTES = 5 * 1024 * 1024;

export interface Budget {
  remaining: number;
  exceeded: boolean;
}

export function newBudget(bytes: number = TEXT_BUDGET_BYTES): Budget {
  return { remaining: bytes, exceeded: false };
}

/** Charges a fixed cost (per text block), so many empty blocks still use the budget up. */
export function charge(budget: Budget, bytes: number): void {
  if (budget.remaining < bytes) budget.exceeded = true;
  budget.remaining = Math.max(0, budget.remaining - bytes);
}

/** Takes up to the remaining budget from `data`. */
export function take(budget: Budget, data: Uint8Array): { bytes: Uint8Array; truncated: boolean } {
  if (data.length <= budget.remaining) {
    budget.remaining -= data.length;
    return { bytes: data, truncated: false };
  }
  const bytes = data.subarray(0, Math.max(0, budget.remaining));
  budget.remaining = 0;
  budget.exceeded = true;
  return { bytes, truncated: true };
}
