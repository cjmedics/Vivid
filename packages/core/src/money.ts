/**
 * All internal money is integer micro-USD (1 USD = 1_000_000).
 * Provider prices like $0.03363/s survive without float drift, and ledger sums stay exact.
 */
export type MicroUsd = number;

export const MICRO_PER_USD = 1_000_000;

export function usd(amount: number): MicroUsd {
  return Math.round(amount * MICRO_PER_USD);
}

export function toUsd(micro: MicroUsd): number {
  return micro / MICRO_PER_USD;
}

export function formatUsd(micro: MicroUsd, digits = 2): string {
  return `$${toUsd(micro).toFixed(digits)}`;
}
