import { PLANS, type MicroUsd, type PlanId } from "@vivid/core";

/**
 * Usage ledger (cost doc §15 rules 4 & 6, §23).
 *  - Build Minutes are stored as integer tenths, so balances never drift.
 *  - Estimates are reserved before execution, charged on acceptance, released on failure.
 *  - Every generation attempt and fixed cost is recorded for the admin cost view.
 *
 * InMemoryLedger is the reference implementation; the Postgres one must match its semantics.
 */

export type AttemptOutcome = "accepted" | "rejected" | "failed" | "unavailable";

export interface AttemptRecord {
  productionId: string;
  shotId: string;
  attempt: number;
  modelKey: string;
  providerJobId?: string;
  outcome: AttemptOutcome;
  generatedSec: number;
  cost: MicroUsd;
  latencyMs: number;
  reason?: string;
  at: string;
}

export type FixedCostCategory = "planning" | "browser" | "rendering" | "storage";

export interface Reservation {
  id: string;
  accountId: string;
  productionId: string;
  buildMinuteTenths: number;
  refinementUnits: number;
  state: "held" | "charged" | "released";
}

export interface AccountUsage {
  accountId: string;
  planId: PlanId;
  buildMinutes: { included: number; used: number; reserved: number; available: number };
  refinementUnits: { included: number; used: number; reserved: number; available: number };
}

export interface ModelCostLine {
  modelKey: string;
  calls: number;
  accepted: number;
  rejected: number;
  failed: number;
  generatedSec: number;
  spend: MicroUsd;
  acceptanceRate: number;
}

export interface ProductionCostReport {
  productionId: string;
  generation: MicroUsd;
  retries: MicroUsd;
  fixed: Record<FixedCostCategory, MicroUsd>;
  total: MicroUsd;
  acceptedGeneratedSec: number;
  byModel: ModelCostLine[];
}

export class InsufficientBalanceError extends Error {}

interface Account {
  planId: PlanId;
  bmIncludedTenths: number;
  bmUsedTenths: number;
  ruIncluded: number;
  ruUsed: number;
}

export interface UsageLedger {
  openAccount(accountId: string, planId: PlanId): void;
  usage(accountId: string): AccountUsage;
  reserve(accountId: string, req: { productionId: string; buildMinutes: number; refinementUnits: number }): Reservation;
  charge(reservationId: string): void;
  release(reservationId: string): void;
  recordAttempt(record: AttemptRecord): void;
  recordFixedCost(productionId: string, category: FixedCostCategory, cost: MicroUsd): void;
  costReport(productionId: string): ProductionCostReport;
}

export const toTenths = (minutes: number) => Math.round(minutes * 10);

export class InMemoryLedger implements UsageLedger {
  private accounts = new Map<string, Account>();
  private reservations = new Map<string, Reservation>();
  private attempts: AttemptRecord[] = [];
  private fixed: Array<{ productionId: string; category: FixedCostCategory; cost: MicroUsd }> = [];
  private seq = 0;

  openAccount(accountId: string, planId: PlanId): void {
    const plan = PLANS[planId];
    this.accounts.set(accountId, {
      planId,
      bmIncludedTenths: toTenths(plan.buildMinutes),
      bmUsedTenths: 0,
      ruIncluded: plan.refinementUnits,
      ruUsed: 0,
    });
  }

  usage(accountId: string): AccountUsage {
    const a = this.account(accountId);
    const held = [...this.reservations.values()].filter((r) => r.accountId === accountId && r.state === "held");
    const bmReserved = held.reduce((s, r) => s + r.buildMinuteTenths, 0);
    const ruReserved = held.reduce((s, r) => s + r.refinementUnits, 0);
    return {
      accountId,
      planId: a.planId,
      buildMinutes: {
        included: a.bmIncludedTenths / 10,
        used: a.bmUsedTenths / 10,
        reserved: bmReserved / 10,
        available: (a.bmIncludedTenths - a.bmUsedTenths - bmReserved) / 10,
      },
      refinementUnits: {
        included: a.ruIncluded,
        used: a.ruUsed,
        reserved: ruReserved,
        available: a.ruIncluded - a.ruUsed - ruReserved,
      },
    };
  }

  reserve(accountId: string, req: { productionId: string; buildMinutes: number; refinementUnits: number }): Reservation {
    const u = this.usage(accountId);
    const tenths = toTenths(req.buildMinutes);
    if (tenths > toTenths(u.buildMinutes.available)) {
      throw new InsufficientBalanceError(`Needs ${req.buildMinutes} Build Minutes, ${u.buildMinutes.available} available`);
    }
    if (req.refinementUnits > u.refinementUnits.available) {
      throw new InsufficientBalanceError(`Needs ${req.refinementUnits} Refinement Units, ${u.refinementUnits.available} available`);
    }
    const r: Reservation = {
      id: `res-${++this.seq}`,
      accountId,
      productionId: req.productionId,
      buildMinuteTenths: tenths,
      refinementUnits: req.refinementUnits,
      state: "held",
    };
    this.reservations.set(r.id, r);
    return { ...r };
  }

  /** A reservation holds one job (production or refinement); charging consumes everything it held. */
  charge(reservationId: string): void {
    const r = this.held(reservationId);
    const a = this.account(r.accountId);
    a.bmUsedTenths += r.buildMinuteTenths;
    a.ruUsed += r.refinementUnits;
    r.state = "charged";
  }

  release(reservationId: string): void {
    this.held(reservationId).state = "released";
  }

  recordAttempt(record: AttemptRecord): void {
    this.attempts.push({ ...record });
  }

  recordFixedCost(productionId: string, category: FixedCostCategory, cost: MicroUsd): void {
    this.fixed.push({ productionId, category, cost });
  }

  costReport(productionId: string): ProductionCostReport {
    const attempts = this.attempts.filter((a) => a.productionId === productionId);
    const fixed: Record<FixedCostCategory, MicroUsd> = { planning: 0, browser: 0, rendering: 0, storage: 0 };
    for (const f of this.fixed) if (f.productionId === productionId) fixed[f.category] += f.cost;

    const byModelMap = new Map<string, ModelCostLine>();
    for (const a of attempts) {
      const line = byModelMap.get(a.modelKey) ?? {
        modelKey: a.modelKey,
        calls: 0,
        accepted: 0,
        rejected: 0,
        failed: 0,
        generatedSec: 0,
        spend: 0,
        acceptanceRate: 0,
      };
      if (a.outcome !== "unavailable") line.calls += 1;
      if (a.outcome === "accepted") line.accepted += 1;
      if (a.outcome === "rejected") line.rejected += 1;
      if (a.outcome === "failed") line.failed += 1;
      line.generatedSec += a.generatedSec;
      line.spend += a.cost;
      line.acceptanceRate = line.calls > 0 ? line.accepted / line.calls : 0;
      byModelMap.set(a.modelKey, line);
    }

    const generation = attempts.filter((a) => a.outcome === "accepted").reduce((s, a) => s + a.cost, 0);
    const retries = attempts.filter((a) => a.outcome !== "accepted").reduce((s, a) => s + a.cost, 0);
    const fixedTotal = Object.values(fixed).reduce((s, c) => s + c, 0);
    return {
      productionId,
      generation,
      retries,
      fixed,
      total: generation + retries + fixedTotal,
      acceptedGeneratedSec: attempts.filter((a) => a.outcome === "accepted").reduce((s, a) => s + a.generatedSec, 0),
      byModel: [...byModelMap.values()],
    };
  }

  private account(accountId: string): Account {
    const a = this.accounts.get(accountId);
    if (!a) throw new Error(`Unknown account ${accountId}`);
    return a;
  }

  private held(reservationId: string): Reservation {
    const r = this.reservations.get(reservationId);
    if (!r) throw new Error(`Unknown reservation ${reservationId}`);
    if (r.state !== "held") throw new Error(`Reservation ${reservationId} is already ${r.state}`);
    return r;
  }
}
