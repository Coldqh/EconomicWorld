import { accountIds, balanceOf, sumAccountsByOwnerCategoryInstrument, transactionsSince } from "../core/ledger.ts";
import type { WorldState } from "../domain/model.ts";

export function bankReserveCents(world: WorldState, bankId: string): number {
  return balanceOf(world, accountIds.bankReserve(bankId));
}

export function bankDepositLiabilitiesCents(world: WorldState, bankId: string): number {
  return sumAccountsByOwnerCategoryInstrument(world, bankId, "liability", "deposit");
}

export function bankExpectedPaymentsCents(world: WorldState, bankId: string): number {
  const deposits = bankDepositLiabilitiesCents(world, bankId);
  const recentExternal = transactionsSince(world, world.clock.elapsedMonths - 2)
    .flatMap((transaction) => transaction.entries)
    .filter((entry) => entry.accountId === accountIds.bankReserve(bankId) && entry.side === "credit")
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  return Math.max(Math.round(deposits * 0.04), Math.round(recentExternal / 3));
}

export function bankLiquidityBufferCents(world: WorldState, bankId: string): number {
  return bankReserveCents(world, bankId) - bankExpectedPaymentsCents(world, bankId);
}

export function bankLiquidityRatioBps(world: WorldState, bankId: string): number {
  const deposits = bankDepositLiabilitiesCents(world, bankId);
  if (deposits <= 0) return 100_000;
  return Math.floor((bankReserveCents(world, bankId) * 10_000) / deposits);
}
