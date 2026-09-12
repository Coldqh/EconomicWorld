import { accountIds, bankAccountsForOwner, ensureAccount, postTransaction, primaryBankAccount, transferBankAccountBalance } from "../../core/ledger.ts";
import type { WorldState } from "../../domain/model.ts";
import { runBankruptcyWaterfall } from "../../corporate/finance.ts";
import { clearAuction, createAuction, settleAuction, submitBid } from "./index.ts";

export function runProcurementTender(world: WorldState, governmentId: string, supplierIds: string[], budgetMinor: number): string | null {
  const auction = createAuction(world, { sellerId: governmentId, objectType: "procurement", objectId: `contract-${world.clock.elapsedMonths}`, mechanism: "reverse-first-price", quantity: 1, reserveMinor: budgetMinor, eligibleBidderIds: supplierIds, durationMonths: 0 });
  for (const [index, supplierId] of supplierIds.entries()) {
    const supplier = world.companies.find((item) => item.id === supplierId && item.active);
    if (supplier) submitBid(world, auction.id, supplierId, Math.max(1, Math.round(budgetMinor * (0.75 + index * 0.04))), 1);
  }
  const winner = clearAuction(world, auction.id)[0];
  if (!winner) return null;
  const government = primaryBankAccount(world, governmentId);
  const supplier = primaryBankAccount(world, winner.bidderId);
  if (!government || !supplier) return null;
  const amount = winner.clearingPriceMinor;
  const settled = settleAuction(world, auction.id, () => Boolean(transferBankAccountBalance(world, government.id, supplier.id, amount, "PROCUREMENT", `Контракт ${auction.id}`)));
  if (!settled) return null;
  ensureAccount(world.ledger, accountIds.operatingExpense(governmentId), governmentId, "Расходы на закупки", "expense", government.currencyId);
  ensureAccount(world.ledger, accountIds.operatingIncome(winner.bidderId), winner.bidderId, "Выручка по контракту", "income", supplier.currencyId);
  postTransaction(world, "PROCUREMENT", `Признание контракта ${auction.id}`, [
    { accountId: accountIds.operatingExpense(governmentId), side: "debit", amountCents: amount },
    { accountId: accountIds.operatingIncome(winner.bidderId), side: "credit", amountCents: amount },
  ], [auction.id]);
  return winner.bidderId;
}

export function runBankruptcyAssetAuction(world: WorldState, companyId: string, bidderIds: string[]): boolean {
  const company = world.companies.find((item) => item.id === companyId);
  if (!company || company.productiveCapital.bookValueCents <= 0) return false;
  const book = company.productiveCapital.bookValueCents;
  const auction = createAuction(world, { sellerId: company.id, objectType: "bankruptcy-asset", objectId: `${company.id}:productive-capital`, mechanism: "first-price", quantity: 1, reserveMinor: Math.round(book * 0.35), eligibleBidderIds: bidderIds, durationMonths: 0 });
  bidderIds.forEach((bidderId, index) => submitBid(world, auction.id, bidderId, Math.round(book * (0.45 + index * 0.05)), 1));
  const allocation = clearAuction(world, auction.id)[0];
  if (!allocation) return false;
  const buyer = world.companies.find((item) => item.id === allocation.bidderId);
  const payer = bankAccountsForOwner(world, allocation.bidderId)[0];
  const estate = primaryBankAccount(world, company.id);
  if (!buyer || !payer || !estate) return false;
  const cash = transferBankAccountBalance(world, payer.id, estate.id, allocation.clearingPriceMinor, "AUCTION_SETTLEMENT", `Продажа активов ${company.id}`);
  if (!cash) return false;
  const buyerAsset = accountIds.productiveCapital(allocation.bidderId);
  const sellerAsset = accountIds.productiveCapital(company.id);
  ensureAccount(world.ledger, buyerAsset, allocation.bidderId, "Приобретённый производственный актив", "asset", payer.currencyId);
  postTransaction(world, "AUCTION_SETTLEMENT", `Передача актива ${company.id}`, [
    { accountId: buyerAsset, side: "debit", amountCents: allocation.clearingPriceMinor },
    { accountId: sellerAsset, side: "credit", amountCents: allocation.clearingPriceMinor },
  ], [cash, auction.id]);
  buyer.productiveCapital.bookValueCents += allocation.clearingPriceMinor;
  buyer.capacityMilliUnits += company.capacityMilliUnits;
  company.productiveCapital.bookValueCents = 0;
  company.capacityMilliUnits = 0;
  auction.status = "settled";
  return runBankruptcyWaterfall(world, company.id).ok;
}
