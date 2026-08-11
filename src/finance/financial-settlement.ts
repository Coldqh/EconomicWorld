import { accountIds, bankAccountsForOwner, ensureAccount, postTransaction, transferBankAccountBalance } from "../core/ledger.ts";
import type { TransactionKind, WorldState } from "../domain/model.ts";

export function currencyBankAccount(world: WorldState, ownerId: string, currencyId: string) {
  return bankAccountsForOwner(world, ownerId, currencyId).find((account) => account.isPrimary)
    ?? bankAccountsForOwner(world, ownerId, currencyId)[0]
    ?? null;
}

export function transferFinancialPrincipal(
  world: WorldState,
  payerId: string,
  recipientId: string,
  currencyId: string,
  amountMinor: number,
  kind: TransactionKind,
  memo: string,
  causeIds: string[] = [],
): string | null {
  const payer = currencyBankAccount(world, payerId, currencyId);
  const recipient = currencyBankAccount(world, recipientId, currencyId);
  if (!payer || !recipient) return null;
  return transferBankAccountBalance(world, payer.id, recipient.id, Math.floor(amountMinor), kind, memo, causeIds);
}

export function settleFinancialPayment(
  world: WorldState,
  payerId: string,
  recipientId: string,
  currencyId: string,
  amountMinor: number,
  kind: TransactionKind,
  memo: string,
  causeIds: string[] = [],
): string | null {
  amountMinor = Math.floor(amountMinor);
  if (amountMinor <= 0) return null;
  const cashTransactionId = transferFinancialPrincipal(world, payerId, recipientId, currencyId, amountMinor, kind, memo, causeIds);
  if (!cashTransactionId) return null;
  const expenseId = accountIds.derivativeExpense(payerId, currencyId);
  const incomeId = accountIds.derivativeIncome(recipientId, currencyId);
  ensureAccount(world.ledger, expenseId, payerId, `Финансовый расход · ${currencyId}`, "expense", currencyId);
  ensureAccount(world.ledger, incomeId, recipientId, `Финансовый доход · ${currencyId}`, "income", currencyId);
  return postTransaction(world, kind, memo, [
    { accountId: expenseId, side: "debit", amountCents: amountMinor },
    { accountId: incomeId, side: "credit", amountCents: amountMinor },
  ], [cashTransactionId, ...causeIds]);
}
