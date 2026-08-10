import type {
  AccountCategory,
  LedgerAccount,
  LedgerEntry,
  LedgerState,
  TransactionKind,
  WorldState,
} from "../domain/model.ts";
import { emitSimpleEvent } from "./events.ts";

export const accountIds = {
  deposit: (ownerId: string) => `${ownerId}:asset:deposit`,
  openingEquity: (ownerId: string) => `${ownerId}:equity:opening`,
  operatingIncome: (ownerId: string) => `${ownerId}:income:operating`,
  operatingExpense: (ownerId: string) => `${ownerId}:expense:operating`,
  cogsExpense: (ownerId: string) => `${ownerId}:expense:cogs`,
  depreciationExpense: (ownerId: string) => `${ownerId}:expense:depreciation`,
  retainedEarnings: (ownerId: string) => `${ownerId}:equity:retained-earnings`,
  finishedInventory: (ownerId: string) => `${ownerId}:asset:inventory:finished`,
  inputInventory: (ownerId: string, goodId: string) => `${ownerId}:asset:inventory:input:${goodId}`,
  productiveCapital: (ownerId: string) => `${ownerId}:asset:productive-capital`,
  property: (ownerId: string, propertyId: string) => `${ownerId}:asset:property:${propertyId}`,
  durable: (ownerId: string, assetId: string) => `${ownerId}:asset:durable:${assetId}`,
  cohortCapital: (ownerId: string) => `${ownerId}:asset:cohort-capital`,
  materializationEquity: (ownerId: string) => `${ownerId}:equity:materialization`,
  investment: (ownerId: string, companyId = "portfolio") =>
    `${ownerId}:asset:investment:${companyId}`,
  loanLiability: (ownerId: string, bankId: string) =>
    `${ownerId}:liability:loan:${bankId}`,
  bankDepositLiability: (bankId: string, depositorId: string) =>
    `${bankId}:liability:deposit:${depositorId}`,
  bankReserve: (bankId: string) => `${bankId}:asset:reserve`,
  bankLoanAsset: (bankId: string, borrowerId: string) =>
    `${bankId}:asset:loan:${borrowerId}`,
  bankEquity: (bankId: string) => `${bankId}:equity:opening`,
  bankInterestIncome: (bankId: string) => `${bankId}:income:interest`,
  bankCreditLoss: (bankId: string) => `${bankId}:expense:credit-loss`,
  centralBankReserveLiability: (centralBankId: string, bankId: string) =>
    `${centralBankId}:liability:reserve:${bankId}`,
  centralBankMonetaryAsset: (centralBankId: string) =>
    `${centralBankId}:asset:monetary-base`,
  interbankAsset: (lenderBankId: string, borrowerBankId: string) =>
    `${lenderBankId}:asset:interbank:${borrowerBankId}`,
  interbankLiability: (borrowerBankId: string, lenderBankId: string) =>
    `${borrowerBankId}:liability:interbank:${lenderBankId}`,
  centralBankFacilityAsset: (centralBankId: string, bankId: string) =>
    `${centralBankId}:asset:central-bank-facility:${bankId}`,
  centralBankFacilityLiability: (bankId: string) =>
    `${bankId}:liability:central-bank-facility`,
};

export function createLedger(): LedgerState {
  return {
    accounts: {},
    balances: {},
    transactions: [],
    nextTransactionId: 1,
  };
}

function instrumentFor(
  category: AccountCategory,
  id: string,
): LedgerAccount["instrument"] {
  if (id.includes(":deposit")) return "deposit";
  if (id.includes(":reserve")) return "reserve";
  if (id.includes(":loan")) return "loan";
  if (id.includes(":inventory")) return "inventory";
  if (id.includes(":productive-capital")) return "productive-capital";
  if (id.includes(":property:")) return "property";
  if (id.includes(":durable:")) return "durable";
  if (id.includes(":cohort-capital")) return "cohort-capital";
  if (id.includes(":interbank")) return "interbank";
  if (id.includes(":central-bank-facility")) return "central-bank-facility";
  if (id.includes(":investment")) return "investment";
  if (id.includes(":monetary-base")) return "monetary-base";
  if (category === "equity") return "equity";
  if (category === "income") return "income";
  return "expense";
}

export function ensureAccount(
  ledger: LedgerState,
  id: string,
  ownerId: string,
  name: string,
  category: AccountCategory,
): string {
  if (!ledger.accounts[id]) {
    ledger.accounts[id] = {
      id,
      ownerId,
      name,
      category,
      instrument: instrumentFor(category, id),
      currency: "RUB",
    };
    ledger.balances[id] = 0;
  }
  return id;
}

export function ensureEntityAccounts(
  ledger: LedgerState,
  ownerId: string,
): void {
  ensureAccount(ledger, accountIds.deposit(ownerId), ownerId, "Банковский депозит", "asset");
  ensureAccount(ledger, accountIds.openingEquity(ownerId), ownerId, "Начальный капитал", "equity");
  ensureAccount(ledger, accountIds.operatingIncome(ownerId), ownerId, "Доходы", "income");
  ensureAccount(ledger, accountIds.operatingExpense(ownerId), ownerId, "Расходы", "expense");
  ensureAccount(ledger, accountIds.retainedEarnings(ownerId), ownerId, "Нераспределённая прибыль", "equity");
}

function signedNaturalDelta(account: LedgerAccount, entry: LedgerEntry): number {
  const debitNormal = account.category === "asset" || account.category === "expense";
  const positive = debitNormal ? entry.side === "debit" : entry.side === "credit";
  return positive ? entry.amountCents : -entry.amountCents;
}

export function postTransaction(
  world: WorldState,
  kind: TransactionKind,
  memo: string,
  entries: LedgerEntry[],
  causeIds: string[] = [],
): string {
  if (entries.length < 2) throw new Error(`Транзакция ${kind} не имеет двух сторон`);
  let debits = 0;
  let credits = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) {
      throw new Error(`Некорректная сумма проводки ${entry.amountCents}`);
    }
    if (!world.ledger.accounts[entry.accountId]) {
      throw new Error(`Неизвестный счёт ${entry.accountId}`);
    }
    if (entry.side === "debit") debits += entry.amountCents;
    else credits += entry.amountCents;
  }
  if (debits !== credits) {
    throw new Error(`Несбалансированная транзакция ${kind}: ${debits} != ${credits}`);
  }

  const id = `tx-${String(world.ledger.nextTransactionId++).padStart(8, "0")}`;
  world.ledger.transactions.push({
    id,
    elapsedMonth: world.clock.elapsedMonths,
    kind,
    memo,
    causeIds,
    entries,
  });
  for (const entry of entries) {
    const account = world.ledger.accounts[entry.accountId];
    world.ledger.balances[entry.accountId] += signedNaturalDelta(account, entry);
  }
  return id;
}

export function balanceOf(world: WorldState, accountId: string): number {
  return world.ledger.balances[accountId] ?? 0;
}

export function depositOf(world: WorldState, ownerId: string): number {
  return balanceOf(world, accountIds.deposit(ownerId));
}

export function findBankIdForEntity(world: WorldState, entityId: string): string {
  const household = world.households.find((item) => item.id === entityId);
  if (household) return household.bankId;
  const company = world.companies.find((item) => item.id === entityId);
  if (company) return company.bankId;
  const populationCohort = world.populationCohorts.find((item) => item.id === entityId);
  if (populationCohort) return populationCohort.bankId;
  const firmCohort = world.firmCohorts.find((item) => item.id === entityId);
  if (firmCohort) return firmCohort.bankId;
  const university = world.universities.find((item) => item.id === entityId);
  if (university) return university.bankId;
  const sectorCityId = entityId.includes(":") ? entityId.split(":").at(-1) : undefined;
  if (sectorCityId && world.cities.some((city) => city.id === sectorCityId)) {
    const cityIndex = world.cities.findIndex((city) => city.id === sectorCityId);
    return world.banks[Math.max(0, cityIndex) % world.banks.length].id;
  }
  if (entityId === world.government.id || entityId === "goods-market" || entityId === "academy-provider") {
    return world.banks[0].id;
  }
  throw new Error(`Для ${entityId} не назначен коммерческий банк`);
}

function bankDepositLiabilities(world: WorldState, bankId: string): number {
  return Object.values(world.ledger.accounts)
    .filter((account) => account.ownerId === bankId && account.category === "liability" && account.instrument === "deposit")
    .reduce((sum, account) => sum + balanceOf(world, account.id), 0);
}

function createFundingRecord(
  world: WorldState,
  lenderId: string,
  borrowerBankId: string,
  amountCents: number,
  kind: "interbank" | "central-bank",
): void {
  world.bankFunding.push({
    id: `funding-${String(world.nextFundingId++).padStart(7, "0")}`,
    lenderId,
    borrowerBankId,
    principalCents: amountCents,
    remainingCents: amountCents,
    annualRateBps: world.centralBank.policyRateBps + (kind === "interbank" ? 180 : 450),
    issuedAtMonth: world.clock.elapsedMonths,
    kind,
    status: "active",
  });
}

export function ensureSettlementLiquidity(
  world: WorldState,
  bankId: string,
  requiredCents: number,
): void {
  let shortfall = Math.max(0, requiredCents - balanceOf(world, accountIds.bankReserve(bankId)));
  if (shortfall <= 0) return;
  for (const lender of world.banks
    .filter((bank) => bank.id !== bankId)
    .sort((left, right) => balanceOf(world, accountIds.bankReserve(right.id)) - balanceOf(world, accountIds.bankReserve(left.id)))) {
    const reserve = balanceOf(world, accountIds.bankReserve(lender.id));
    const buffer = Math.floor((bankDepositLiabilities(world, lender.id) * lender.minimumLiquidityRatioBps) / 10_000);
    const available = Math.max(0, reserve - buffer);
    const amountCents = Math.min(shortfall, available);
    if (amountCents <= 0) continue;
    ensureAccount(world.ledger, accountIds.interbankAsset(lender.id, bankId), lender.id, `Межбанковский кредит ${bankId}`, "asset");
    ensureAccount(world.ledger, accountIds.interbankLiability(bankId, lender.id), bankId, `Межбанковское обязательство ${lender.id}`, "liability");
    postTransaction(world, "INTERBANK_LOAN", `Межбанковская ликвидность: ${lender.name} → ${bankId}`, [
      { accountId: accountIds.bankReserve(bankId), side: "debit", amountCents },
      { accountId: accountIds.interbankLiability(bankId, lender.id), side: "credit", amountCents },
      { accountId: accountIds.interbankAsset(lender.id, bankId), side: "debit", amountCents },
      { accountId: accountIds.bankReserve(lender.id), side: "credit", amountCents },
      { accountId: accountIds.centralBankReserveLiability(world.centralBank.id, lender.id), side: "debit", amountCents },
      { accountId: accountIds.centralBankReserveLiability(world.centralBank.id, bankId), side: "credit", amountCents },
    ]);
    createFundingRecord(world, lender.id, bankId, amountCents, "interbank");
    shortfall -= amountCents;
    if (shortfall <= 0) break;
  }
  if (shortfall > 0) {
    ensureAccount(world.ledger, accountIds.centralBankFacilityAsset(world.centralBank.id, bankId), world.centralBank.id, `Кредит ликвидности ${bankId}`, "asset");
    ensureAccount(world.ledger, accountIds.centralBankFacilityLiability(bankId), bankId, "Кредит ликвидности ЦБ", "liability");
    postTransaction(world, "CENTRAL_BANK_FACILITY", `Кредит ликвидности ЦБ для ${bankId}`, [
      { accountId: accountIds.bankReserve(bankId), side: "debit", amountCents: shortfall },
      { accountId: accountIds.centralBankFacilityLiability(bankId), side: "credit", amountCents: shortfall },
      { accountId: accountIds.centralBankFacilityAsset(world.centralBank.id, bankId), side: "debit", amountCents: shortfall },
      { accountId: accountIds.centralBankReserveLiability(world.centralBank.id, bankId), side: "credit", amountCents: shortfall },
    ]);
    createFundingRecord(world, world.centralBank.id, bankId, shortfall, "central-bank");
    emitSimpleEvent(world, "BankLiquidityFunded", "Банк получил ликвидность", `${bankId} привлёк у центрального банка ${(shortfall / 100).toLocaleString("ru-RU")} ₽ для расчётов.`, [bankId, world.centralBank.id], "attention", [], { amountCents: shortfall });
  }
}

export function settleDepositPayment(
  world: WorldState,
  payerId: string,
  recipientId: string,
  amountCents: number,
  kind: TransactionKind,
  memo: string,
  payerDebitAccountId: string,
  recipientCreditAccountId: string,
  causeIds: string[] = [],
): string | null {
  amountCents = Math.floor(amountCents);
  if (amountCents <= 0 || depositOf(world, payerId) < amountCents) return null;
  const payerBankId = findBankIdForEntity(world, payerId);
  const recipientBankId = findBankIdForEntity(world, recipientId);
  ensureBankingAccounts(world, payerId, payerBankId);
  ensureBankingAccounts(world, recipientId, recipientBankId);
  if (payerBankId !== recipientBankId) ensureSettlementLiquidity(world, payerBankId, amountCents);
  const entries: LedgerEntry[] = [
    { accountId: payerDebitAccountId, side: "debit", amountCents },
    { accountId: accountIds.deposit(payerId), side: "credit", amountCents },
    { accountId: accountIds.deposit(recipientId), side: "debit", amountCents },
    { accountId: recipientCreditAccountId, side: "credit", amountCents },
    { accountId: accountIds.bankDepositLiability(payerBankId, payerId), side: "debit", amountCents },
    { accountId: accountIds.bankDepositLiability(recipientBankId, recipientId), side: "credit", amountCents },
  ];
  if (payerBankId !== recipientBankId) {
    entries.push(
      { accountId: accountIds.bankReserve(payerBankId), side: "credit", amountCents },
      { accountId: accountIds.bankReserve(recipientBankId), side: "debit", amountCents },
      { accountId: accountIds.centralBankReserveLiability(world.centralBank.id, payerBankId), side: "debit", amountCents },
      { accountId: accountIds.centralBankReserveLiability(world.centralBank.id, recipientBankId), side: "credit", amountCents },
    );
  }
  return postTransaction(world, kind, memo, entries, causeIds);
}

function ensureBankingAccounts(world: WorldState, entityId: string, bankId: string): void {
  ensureEntityAccounts(world.ledger, entityId);
  ensureAccount(
    world.ledger,
    accountIds.bankDepositLiability(bankId, entityId),
    bankId,
    `Депозит ${entityId}`,
    "liability",
  );
  ensureAccount(
    world.ledger,
    accountIds.bankReserve(bankId),
    bankId,
    "Резервы в центральном банке",
    "asset",
  );
  ensureAccount(
    world.ledger,
    accountIds.centralBankReserveLiability(world.centralBank.id, bankId),
    world.centralBank.id,
    `Резервный счёт ${bankId}`,
    "liability",
  );
}

export function seedDeposit(
  world: WorldState,
  ownerId: string,
  bankId: string,
  amountCents: number,
): void {
  ensureBankingAccounts(world, ownerId, bankId);
  ensureAccount(
    world.ledger,
    accountIds.centralBankMonetaryAsset(world.centralBank.id),
    world.centralBank.id,
    "Актив денежной базы",
    "asset",
  );
  postTransaction(world, "GENESIS", `Начальный депозит: ${ownerId}`, [
    { accountId: accountIds.deposit(ownerId), side: "debit", amountCents },
    { accountId: accountIds.openingEquity(ownerId), side: "credit", amountCents },
    { accountId: accountIds.bankReserve(bankId), side: "debit", amountCents },
    { accountId: accountIds.bankDepositLiability(bankId, ownerId), side: "credit", amountCents },
    {
      accountId: accountIds.centralBankMonetaryAsset(world.centralBank.id),
      side: "debit",
      amountCents,
    },
    {
      accountId: accountIds.centralBankReserveLiability(world.centralBank.id, bankId),
      side: "credit",
      amountCents,
    },
  ]);
}

export function seedBankCapital(
  world: WorldState,
  bankId: string,
  amountCents: number,
): void {
  ensureAccount(world.ledger, accountIds.bankReserve(bankId), bankId, "Резервы в ЦБ", "asset");
  ensureAccount(world.ledger, accountIds.bankEquity(bankId), bankId, "Капитал банка", "equity");
  ensureAccount(
    world.ledger,
    accountIds.centralBankMonetaryAsset(world.centralBank.id),
    world.centralBank.id,
    "Актив денежной базы",
    "asset",
  );
  ensureAccount(
    world.ledger,
    accountIds.centralBankReserveLiability(world.centralBank.id, bankId),
    world.centralBank.id,
    `Резервный счёт ${bankId}`,
    "liability",
  );
  postTransaction(world, "GENESIS", `Регулятивный капитал: ${bankId}`, [
    { accountId: accountIds.bankReserve(bankId), side: "debit", amountCents },
    { accountId: accountIds.bankEquity(bankId), side: "credit", amountCents },
    {
      accountId: accountIds.centralBankMonetaryAsset(world.centralBank.id),
      side: "debit",
      amountCents,
    },
    {
      accountId: accountIds.centralBankReserveLiability(world.centralBank.id, bankId),
      side: "credit",
      amountCents,
    },
  ]);
}

export function transferDeposit(
  world: WorldState,
  payerId: string,
  recipientId: string,
  amountCents: number,
  kind: Extract<
    TransactionKind,
    | "TRANSFER"
    | "WAGE"
    | "INCOME_TAX"
    | "SALES_TAX"
    | "CORPORATE_TAX"
    | "SOCIAL_TRANSFER"
    | "GOODS_CLEARING"
    | "INPUT_PURCHASE"
    | "EDUCATION"
    | "UNIVERSITY_TUITION"
    | "COHORT_INCOME"
    | "COHORT_CONSUMPTION"
    | "TRAVEL"
    | "RENT"
    | "PROPERTY_PURCHASE"
    | "DURABLE_PURCHASE"
    | "USED_ASSET"
    | "LOGISTICS"
  >,
  memo: string,
  causeIds: string[] = [],
): string | null {
  ensureEntityAccounts(world.ledger, payerId);
  ensureEntityAccounts(world.ledger, recipientId);
  return settleDepositPayment(world, payerId, recipientId, amountCents, kind, memo, accountIds.operatingExpense(payerId), accountIds.operatingIncome(recipientId), causeIds);
}

export function reallocateDepositOwnership(
  world: WorldState,
  fromId: string,
  toId: string,
  amountCents: number,
  kind: "MATERIALIZATION" | "DEMATERIALIZATION",
  memo: string,
): string | null {
  amountCents = Math.floor(amountCents);
  if (amountCents <= 0 || depositOf(world, fromId) < amountCents) return null;
  const fromBankId = findBankIdForEntity(world, fromId);
  const toBankId = findBankIdForEntity(world, toId);
  ensureBankingAccounts(world, fromId, fromBankId);
  ensureBankingAccounts(world, toId, toBankId);
  ensureAccount(world.ledger, accountIds.materializationEquity(fromId), fromId, "Перенос из агрегата", "equity");
  ensureAccount(world.ledger, accountIds.materializationEquity(toId), toId, "Перенос из агрегата", "equity");
  if (fromBankId !== toBankId) ensureSettlementLiquidity(world, fromBankId, amountCents);
  const entries: LedgerEntry[] = [
    { accountId: accountIds.materializationEquity(fromId), side: "debit", amountCents },
    { accountId: accountIds.deposit(fromId), side: "credit", amountCents },
    { accountId: accountIds.deposit(toId), side: "debit", amountCents },
    { accountId: accountIds.materializationEquity(toId), side: "credit", amountCents },
    { accountId: accountIds.bankDepositLiability(fromBankId, fromId), side: "debit", amountCents },
    { accountId: accountIds.bankDepositLiability(toBankId, toId), side: "credit", amountCents },
  ];
  if (fromBankId !== toBankId) entries.push(
    { accountId: accountIds.bankReserve(fromBankId), side: "credit", amountCents },
    { accountId: accountIds.bankReserve(toBankId), side: "debit", amountCents },
    { accountId: accountIds.centralBankReserveLiability(world.centralBank.id, fromBankId), side: "debit", amountCents },
    { accountId: accountIds.centralBankReserveLiability(world.centralBank.id, toBankId), side: "credit", amountCents },
  );
  return postTransaction(world, kind, memo, entries);
}

export function transferOwnedAsset(
  world: WorldState,
  buyerId: string,
  sellerId: string,
  amountCents: number,
  buyerAssetAccountId: string,
  sellerAssetAccountId: string,
  assetName: string,
): string | null {
  amountCents = Math.floor(amountCents);
  if (amountCents <= 0 || depositOf(world, buyerId) < amountCents) return null;
  const buyerBankId = findBankIdForEntity(world, buyerId);
  const sellerBankId = findBankIdForEntity(world, sellerId);
  ensureBankingAccounts(world, buyerId, buyerBankId);
  ensureBankingAccounts(world, sellerId, sellerBankId);
  ensureAccount(world.ledger, buyerAssetAccountId, buyerId, assetName, "asset");
  ensureAccount(world.ledger, sellerAssetAccountId, sellerId, assetName, "asset");
  if (balanceOf(world, sellerAssetAccountId) < amountCents) return null;
  if (buyerBankId !== sellerBankId) ensureSettlementLiquidity(world, buyerBankId, amountCents);
  const entries: LedgerEntry[] = [
    { accountId: buyerAssetAccountId, side: "debit", amountCents },
    { accountId: accountIds.deposit(buyerId), side: "credit", amountCents },
    { accountId: accountIds.deposit(sellerId), side: "debit", amountCents },
    { accountId: sellerAssetAccountId, side: "credit", amountCents },
    { accountId: accountIds.bankDepositLiability(buyerBankId, buyerId), side: "debit", amountCents },
    { accountId: accountIds.bankDepositLiability(sellerBankId, sellerId), side: "credit", amountCents },
  ];
  if (buyerBankId !== sellerBankId) entries.push(
    { accountId: accountIds.bankReserve(buyerBankId), side: "credit", amountCents },
    { accountId: accountIds.bankReserve(sellerBankId), side: "debit", amountCents },
    { accountId: accountIds.centralBankReserveLiability(world.centralBank.id, buyerBankId), side: "debit", amountCents },
    { accountId: accountIds.centralBankReserveLiability(world.centralBank.id, sellerBankId), side: "credit", amountCents },
  );
  return postTransaction(world, "USED_ASSET", `Сделка с подержанным активом: ${assetName}`, entries);
}

export function seedNonCashAsset(
  world: WorldState,
  ownerId: string,
  accountId: string,
  name: string,
  amountCents: number,
): void {
  if (amountCents <= 0) return;
  ensureEntityAccounts(world.ledger, ownerId);
  ensureAccount(world.ledger, accountId, ownerId, name, "asset");
  postTransaction(world, "INVENTORY_SEED", `Начальная стоимость: ${name}`, [
    { accountId, side: "debit", amountCents },
    { accountId: accountIds.openingEquity(ownerId), side: "credit", amountCents },
  ]);
}

export function capitalContribution(
  world: WorldState,
  householdId: string,
  companyId: string,
  amountCents: number,
  causeIds: string[] = [],
): string | null {
  if (amountCents <= 0 || depositOf(world, householdId) < amountCents) return null;
  const payerBankId = findBankIdForEntity(world, householdId);
  const recipientBankId = findBankIdForEntity(world, companyId);
  ensureBankingAccounts(world, householdId, payerBankId);
  ensureBankingAccounts(world, companyId, recipientBankId);
  ensureAccount(
    world.ledger,
    accountIds.investment(householdId, companyId),
    householdId,
    `Доля в ${companyId}`,
    "asset",
  );
  if (payerBankId !== recipientBankId) ensureSettlementLiquidity(world, payerBankId, amountCents);
  const entries: LedgerEntry[] = [
    { accountId: accountIds.investment(householdId, companyId), side: "debit", amountCents },
    { accountId: accountIds.deposit(householdId), side: "credit", amountCents },
    { accountId: accountIds.deposit(companyId), side: "debit", amountCents },
    { accountId: accountIds.openingEquity(companyId), side: "credit", amountCents },
    { accountId: accountIds.bankDepositLiability(payerBankId, householdId), side: "debit", amountCents },
    { accountId: accountIds.bankDepositLiability(recipientBankId, companyId), side: "credit", amountCents },
  ];
  if (payerBankId !== recipientBankId) {
    entries.push(
      { accountId: accountIds.bankReserve(payerBankId), side: "credit", amountCents },
      { accountId: accountIds.bankReserve(recipientBankId), side: "debit", amountCents },
      {
        accountId: accountIds.centralBankReserveLiability(world.centralBank.id, payerBankId),
        side: "debit",
        amountCents,
      },
      {
        accountId: accountIds.centralBankReserveLiability(world.centralBank.id, recipientBankId),
        side: "credit",
        amountCents,
      },
    );
  }
  return postTransaction(
    world,
    "CAPITAL_CONTRIBUTION",
    `Вклад ${householdId} в капитал ${companyId}`,
    entries,
    causeIds,
  );
}

export function sumAccounts(
  world: WorldState,
  predicate: (account: LedgerAccount) => boolean,
): number {
  let total = 0;
  for (const account of Object.values(world.ledger.accounts)) {
    if (predicate(account)) total += balanceOf(world, account.id);
  }
  return total;
}

export function entityBook(world: WorldState, ownerId: string): {
  assets: number;
  liabilities: number;
  equity: number;
  income: number;
  expenses: number;
  capital: number;
} {
  const totals = { assets: 0, liabilities: 0, equity: 0, income: 0, expenses: 0 };
  for (const account of Object.values(world.ledger.accounts)) {
    if (account.ownerId !== ownerId) continue;
    const balance = balanceOf(world, account.id);
    if (account.category === "asset") totals.assets += balance;
    if (account.category === "liability") totals.liabilities += balance;
    if (account.category === "equity") totals.equity += balance;
    if (account.category === "income") totals.income += balance;
    if (account.category === "expense") totals.expenses += balance;
  }
  return { ...totals, capital: totals.equity + totals.income - totals.expenses };
}
