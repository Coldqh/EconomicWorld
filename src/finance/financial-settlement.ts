import { accountIds, bankAccountsForOwner, ensureAccount, postTransaction, transferBankAccountBalance } from "../core/ledger.ts";
import type { TransactionKind, WorldState } from "../domain/model.ts";
import { evaluateEconomicPolicyAccess } from "../geoeconomics/access.ts";

function ownerCountryId(world: WorldState, ownerId: string): string | null {
  const direct = world.governments.find((item) => item.id === ownerId)?.countryId
    ?? world.banks.find((item) => item.id === ownerId)?.countryId
    ?? world.companies.find((item) => item.id === ownerId)?.headquartersCountryId
    ?? world.populationCohorts.find((item) => item.id === ownerId)?.countryId
    ?? world.firmCohorts.find((item) => item.id === ownerId)?.countryId;
  if (direct) return direct;
  const account = world.bankAccounts.find((item) => item.ownerId === ownerId && item.status === "active");
  if (account) return world.banks.find((item) => item.id === account.bankId)?.countryId ?? null;
  return null;
}

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
  const sourceCountryId = ownerCountryId(world, payerId);
  const destinationCountryId = ownerCountryId(world, recipientId);
  if (sourceCountryId && destinationCountryId && sourceCountryId !== destinationCountryId
    && !evaluateEconomicPolicyAccess(world, { sourceCountryId, destinationCountryId, kind: "finance" }).allowed) return null;
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
