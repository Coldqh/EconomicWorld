import type {
  AccountCategory,
  LedgerAccount,
  LedgerEntry,
  LedgerState,
  LedgerTransaction,
  TransactionKind,
  WorldState,
} from "../domain/model.ts";
import { recordCountryTransaction } from "../accounting/country-periods.ts";
import { emitSimpleEvent } from "./events.ts";

const ownerAccountIndex = new WeakMap<LedgerState, Map<string, string[]>>();

interface BankAccountLookupIndex {
  source: WorldState["bankAccounts"];
  indexedLength: number;
  byId: Map<string, WorldState["bankAccounts"][number]>;
  byOwner: Map<string, WorldState["bankAccounts"]>;
}

const bankAccountIndexes = new WeakMap<WorldState, BankAccountLookupIndex>();

function bankAccountLookupIndex(world: WorldState): BankAccountLookupIndex {
  let index = bankAccountIndexes.get(world);
  if (!index || index.source !== world.bankAccounts || index.indexedLength > world.bankAccounts.length) {
    index = { source: world.bankAccounts, indexedLength: 0, byId: new Map(), byOwner: new Map() };
    bankAccountIndexes.set(world, index);
  }
  for (let position = index.indexedLength; position < world.bankAccounts.length; position += 1) {
    const account = world.bankAccounts[position];
    index.byId.set(account.id, account);
    const ownerAccounts = index.byOwner.get(account.ownerId) ?? [];
    ownerAccounts.push(account);
    index.byOwner.set(account.ownerId, ownerAccounts);
  }
  index.indexedLength = world.bankAccounts.length;
  return index;
}

// Aggregate ledger queries are comparatively rare. Computing them on demand is
// cheaper than maintaining three string-key indexes for every transaction leg.

interface LedgerTransactionIndex {
  source: LedgerTransaction[];
  indexedLength: number;
  byMonth: Map<number, LedgerTransaction[]>;
  byAccount: Map<string, LedgerTransaction[]>;
  byCurrency: Map<string, LedgerTransaction[]>;
  byKind: Map<TransactionKind, LedgerTransaction[]>;
  byEntity: Map<string, LedgerTransaction[]>;
}

const transactionIndexes = new WeakMap<LedgerState, LedgerTransactionIndex>();

function pushIndexed<T>(map: Map<T, LedgerTransaction[]>, key: T, transaction: LedgerTransaction): void {
  const values = map.get(key) ?? [];
  values.push(transaction);
  map.set(key, values);
}

function transactionIndex(world: WorldState): LedgerTransactionIndex {
  let index = transactionIndexes.get(world.ledger);
  if (!index || index.source !== world.ledger.transactions) {
    index = { source: world.ledger.transactions, indexedLength: 0, byMonth: new Map(), byAccount: new Map(), byCurrency: new Map(), byKind: new Map(), byEntity: new Map() };
    transactionIndexes.set(world.ledger, index);
  }
  for (let position = index.indexedLength; position < world.ledger.transactions.length; position += 1) {
    const transaction = world.ledger.transactions[position];
    pushIndexed(index.byMonth, transaction.elapsedMonth, transaction);
    pushIndexed(index.byKind, transaction.kind, transaction);
    const entryAccountIds = new Set(transaction.entries.map((entry) => entry.accountId));
    const currencies = new Set<string>();
    const entities = new Set<string>();
    for (const accountId of entryAccountIds) {
      pushIndexed(index.byAccount, accountId, transaction);
      const account = world.ledger.accounts[accountId];
      if (account) { currencies.add(account.currency); entities.add(account.ownerId); }
    }
    for (const currency of currencies) pushIndexed(index.byCurrency, currency, transaction);
    for (const entity of entities) pushIndexed(index.byEntity, entity, transaction);
  }
  index.indexedLength = world.ledger.transactions.length;
  return index;
}

export function transactionsForMonth(world: WorldState, elapsedMonth: number): readonly LedgerTransaction[] {
  return transactionIndex(world).byMonth.get(elapsedMonth) ?? [];
}

export function transactionsSince(world: WorldState, elapsedMonth: number): LedgerTransaction[] {
  const index = transactionIndex(world);
  const result: LedgerTransaction[] = [];
  for (let month = elapsedMonth; month <= world.clock.elapsedMonths; month += 1) result.push(...(index.byMonth.get(month) ?? []));
  return result;
}

export function transactionsForAccount(world: WorldState, accountId: string): readonly LedgerTransaction[] {
  return transactionIndex(world).byAccount.get(accountId) ?? [];
}

export function transactionsForEntity(world: WorldState, entityId: string): readonly LedgerTransaction[] {
  return transactionIndex(world).byEntity.get(entityId) ?? [];
}

function indexedAccountIds(ledger: LedgerState, ownerId: string): string[] {
  let index = ownerAccountIndex.get(ledger);
  if (!index) {
    index = new Map<string, string[]>();
    for (const account of Object.values(ledger.accounts)) {
      const ids = index.get(account.ownerId) ?? [];
      ids.push(account.id);
      index.set(account.ownerId, ids);
    }
    ownerAccountIndex.set(ledger, index);
  }
  return index.get(ownerId) ?? [];
}

export const accountIds = {
  deposit: (ownerId: string) => `${ownerId}:asset:deposit`,
  bankAccountDeposit: (ownerId: string, bankId: string, currencyId: string) => `${ownerId}:asset:deposit:${bankId}:${currencyId}`,
  openingEquity: (ownerId: string) => `${ownerId}:equity:opening`,
  openingEquityCurrency: (ownerId: string, currencyId: string) => `${ownerId}:equity:opening:${currencyId}`,
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
  security: (ownerId: string, securityId: string) => `${ownerId}:asset:security:${securityId}`,
  contributedEquity: (companyId: string) => `${companyId}:equity:contributed`,
  dividendIncome: (ownerId: string) => `${ownerId}:income:dividend`,
  bondAsset: (ownerId: string, bondId: string) => `${ownerId}:asset:bond:${bondId}`,
  bondLiability: (companyId: string, bondId: string) => `${companyId}:liability:bond:${bondId}`,
  interestIncome: (ownerId: string) => `${ownerId}:income:bond-interest`,
  interestExpense: (ownerId: string) => `${ownerId}:expense:bond-interest`,
  securityGain: (ownerId: string) => `${ownerId}:income:security-gain`,
  securityLoss: (ownerId: string) => `${ownerId}:expense:security-loss`,
  acquisitionInvestment: (ownerId: string, companyId: string) => `${ownerId}:asset:investment:acquisition:${companyId}`,
  goodwill: (ownerId: string, companyId: string) => `${ownerId}:asset:goodwill:${companyId}`,
  loanLiability: (ownerId: string, bankId: string) =>
    `${ownerId}:liability:loan:${bankId}`,
  bankDepositLiability: (bankId: string, depositorId: string) =>
    `${bankId}:liability:deposit:${depositorId}`,
  bankAccountLiability: (bankId: string, bankAccountId: string) => `${bankId}:liability:deposit-account:${bankAccountId}`,
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
  intercentralReceivable: (centralBankId: string, counterpartyId: string) => `${centralBankId}:asset:intercentral:${counterpartyId}`,
  intercentralPayable: (centralBankId: string, counterpartyId: string) => `${centralBankId}:liability:intercentral:${counterpartyId}`,
  fundUnits: (ownerId: string, fundId: string) => `${ownerId}:asset:fund-units:${fundId}`,
  fundUnitCapital: (fundId: string) => `${fundId}:equity:fund-units`,
  // FX clearing equity is a running currency position. The trade and its cash
  // legs remain individual records, without four permanent accounts per deal.
  fxPosition: (ownerId: string, _tradeId: string, currencyId: string) => `${ownerId}:equity:fx-position:${currencyId}`,
  marginLoanAsset: (primeBrokerId: string, marginAccountId: string) => `${primeBrokerId}:asset:margin-loan:${marginAccountId}`,
  marginLoanLiability: (ownerId: string, marginAccountId: string) => `${ownerId}:liability:margin-loan:${marginAccountId}`,
  repoAsset: (lenderId: string, repoId: string) => `${lenderId}:asset:repo:${repoId}`,
  repoLiability: (borrowerId: string, repoId: string) => `${borrowerId}:liability:repo:${repoId}`,
  derivativeAsset: (ownerId: string, contractId: string) => `${ownerId}:asset:derivative:${contractId}`,
  derivativeLiability: (ownerId: string, contractId: string) => `${ownerId}:liability:derivative:${contractId}`,
  derivativeIncome: (ownerId: string, currencyId: string) => `${ownerId}:income:derivative:${currencyId}`,
  derivativeExpense: (ownerId: string, currencyId: string) => `${ownerId}:expense:derivative:${currencyId}`,
  sovereignBondAsset: (ownerId: string, bondId: string) => `${ownerId}:asset:sovereign-bond:${bondId}`,
  sovereignBondLiability: (governmentId: string, bondId: string) => `${governmentId}:liability:sovereign-bond:${bondId}`,
  sovereignInterestIncome: (ownerId: string, currencyId: string) => `${ownerId}:income:sovereign-interest:${currencyId}`,
  sovereignInterestExpense: (governmentId: string, currencyId: string) => `${governmentId}:expense:sovereign-interest:${currencyId}`,
  sovereignLoss: (ownerId: string, currencyId: string) => `${ownerId}:expense:sovereign-loss:${currencyId}`,
  sovereignRestructuringGain: (governmentId: string, currencyId: string) => `${governmentId}:income:sovereign-restructure:${currencyId}`,
  infrastructure: (governmentId: string) => `${governmentId}:asset:infrastructure`,
  publicInvestmentExpense: (governmentId: string) => `${governmentId}:expense:public-investment`,
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
  if (id.includes(":security:")) return "security";
  if (id.includes(":bond:")) return "bond";
  if (id.includes(":sovereign-bond:")) return "sovereign-bond";
  if (id.includes(":derivative:")) return "derivative";
  if (id.includes(":infrastructure")) return "infrastructure";
  if (id.includes(":goodwill:")) return "goodwill";
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
  currency?: string,
): string {
  if (!ledger.accounts[id]) {
    ledger.accounts[id] = {
      id,
      ownerId,
      name,
      category,
      instrument: instrumentFor(category, id),
      currency: currency ?? "RUB",
    };
    ledger.balances[id] = 0;
    // A new account starts at zero, so an initialized aggregate balance index
    // remains correct and receives its first non-zero delta in postTransaction.
    const index = ownerAccountIndex.get(ledger);
    if (index) {
      const ids = index.get(ownerId) ?? [];
      ids.push(id);
      index.set(ownerId, ids);
    }
  } else if (currency && ledger.accounts[id].currency !== currency) {
    // Один ledger-счёт не может менять валюту вслед за текущим банковским счётом владельца.
    // Для мультивалютных позиций вызывающий код создаёт отдельный currency-scoped id.
  }
  return id;
}

export function ensureEntityAccounts(
  ledger: LedgerState,
  ownerId: string,
  currency?: string,
): void {
  ensureAccount(ledger, accountIds.deposit(ownerId), ownerId, "Банковский депозит", "asset", currency);
  ensureAccount(ledger, accountIds.openingEquity(ownerId), ownerId, "Начальный капитал", "equity", currency);
  ensureAccount(ledger, accountIds.operatingIncome(ownerId), ownerId, "Доходы", "income", currency);
  ensureAccount(ledger, accountIds.operatingExpense(ownerId), ownerId, "Расходы", "expense", currency);
  ensureAccount(ledger, accountIds.retainedEarnings(ownerId), ownerId, "Нераспределённая прибыль", "equity", currency);
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
  let transactionCurrency: string | null = null;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) {
      throw new Error(`Некорректная сумма проводки ${entry.amountCents}`);
    }
    const account = world.ledger.accounts[entry.accountId];
    if (!account) {
      throw new Error(`Неизвестный счёт ${entry.accountId}`);
    }
    transactionCurrency ??= account.currency;
    if (account.currency !== transactionCurrency) throw new Error(`Межвалютная транзакция ${kind} требует отдельных ledger-ног: ${transactionCurrency}/${account.currency}`);
    if (entry.side === "debit") debits += entry.amountCents;
    else credits += entry.amountCents;
  }
  if (debits !== credits) {
    throw new Error(`Несбалансированная транзакция ${kind}: ${debits} != ${credits}`);
  }

  const id = `tx-${String(world.ledger.nextTransactionId++).padStart(8, "0")}`;
  const transaction = {
    id,
    elapsedMonth: world.clock.elapsedMonths,
    kind,
    memo,
    causeIds,
    entries,
  };
  world.ledger.transactions.push(transaction);
  for (const entry of entries) {
    const account = world.ledger.accounts[entry.accountId];
    const delta = signedNaturalDelta(account, entry);
    world.ledger.balances[entry.accountId] += delta;
  }
  recordCountryTransaction(world, transaction);
  return id;
}

export function balanceOf(world: WorldState, accountId: string): number {
  return world.ledger.balances[accountId] ?? 0;
}

export function depositOf(world: WorldState, ownerId: string): number {
  const primary = bankAccountLookupIndex(world).byOwner.get(ownerId)?.find((account) => account.isPrimary && account.status === "active");
  return balanceOf(world, primary?.ledgerDepositAccountId ?? accountIds.deposit(ownerId));
}

export function bankAccountBalance(world: WorldState, bankAccountId: string): number {
  const account = bankAccountLookupIndex(world).byId.get(bankAccountId);
  return account?.status === "active" ? balanceOf(world, account.ledgerDepositAccountId) : 0;
}

export function bankAccountsForOwner(world: WorldState, ownerId: string, currencyId?: string) {
  return (bankAccountLookupIndex(world).byOwner.get(ownerId) ?? []).filter((account) => account.status === "active" && (!currencyId || account.currencyId === currencyId));
}

export function primaryBankAccount(world: WorldState, ownerId: string) {
  return bankAccountsForOwner(world, ownerId).find((account) => account.isPrimary) ?? bankAccountsForOwner(world, ownerId)[0] ?? null;
}

export function findBankIdForEntity(world: WorldState, entityId: string): string {
  const explicitAccount = primaryBankAccount(world, entityId);
  if (explicitAccount) return explicitAccount.bankId;
  const household = world.households.find((item) => item.id === entityId);
  if (household) return primaryBankAccount(world, entityId)?.bankId ?? household.bankId;
  const company = world.companies.find((item) => item.id === entityId);
  if (company) return company.bankId;
  const populationCohort = world.populationCohorts.find((item) => item.id === entityId);
  if (populationCohort) return populationCohort.bankId;
  const firmCohort = world.firmCohorts.find((item) => item.id === entityId);
  if (firmCohort) return firmCohort.bankId;
  const university = world.universities.find((item) => item.id === entityId);
  if (university) return university.bankId;
  const government = world.governments.find((item) => item.id === entityId);
  if (government) return world.banks.find((bank) => bank.countryId === government.countryId)!.id;
  const broker = world.brokers.find((item) => item.id === entityId);
  if (broker) return broker.bankId;
  const exchange = world.exchanges.find((item) => item.id === entityId);
  if (exchange) return exchange.bankId;
  const sectorCityId = entityId.includes(":") ? entityId.split(":").at(-1) : undefined;
  if (sectorCityId && world.cities.some((city) => city.id === sectorCityId)) {
    const city = world.cities.find((item) => item.id === sectorCityId)!;
    return world.banks.find((bank) => bank.countryId === city.countryId)!.id;
  }
  if (entityId === "goods-market" || entityId === "academy-provider") {
    return world.banks.find((bank) => bank.countryId === "ru")?.id ?? world.banks[0].id;
  }
  throw new Error(`Для ${entityId} не назначен коммерческий банк`);
}

export function openBankAccount(
  world: WorldState,
  ownerId: string,
  bankId: string,
  makePrimary = false,
): { ok: boolean; message: string; accountId?: string } {
  const bank = world.banks.find((item) => item.id === bankId);
  if (!bank) return { ok: false, message: "Банк не найден" };
  const existing = world.bankAccounts.find((account) => account.ownerId === ownerId && account.bankId === bankId && account.currencyId === bank.baseCurrency && account.status === "active");
  if (existing) {
    if (makePrimary) setPrimaryBankAccount(world, ownerId, existing.id);
    return { ok: true, message: makePrimary ? "Счёт выбран основным" : "Счёт уже открыт", accountId: existing.id };
  }
  const hasAccounts = world.bankAccounts.some((account) => account.ownerId === ownerId && account.status === "active");
  const id = `bank-account-${String(world.nextBankAccountId++).padStart(7, "0")}`;
  const isPrimary = makePrimary || !hasAccounts;
  if (isPrimary) world.bankAccounts.filter((account) => account.ownerId === ownerId).forEach((account) => { account.isPrimary = false; });
  const ledgerDepositAccountId = hasAccounts ? accountIds.bankAccountDeposit(ownerId, bankId, bank.baseCurrency) : accountIds.deposit(ownerId);
  const ledgerBankLiabilityAccountId = hasAccounts ? accountIds.bankAccountLiability(bankId, id) : accountIds.bankDepositLiability(bankId, ownerId);
  const account = {
    id,
    ownerId,
    bankId,
    currencyId: bank.baseCurrency,
    ledgerDepositAccountId,
    ledgerBankLiabilityAccountId,
    openedAtMonth: world.clock.elapsedMonths,
    status: "active" as const,
    isPrimary,
  };
  world.bankAccounts.push(account);
  ensureAccount(world.ledger, ledgerDepositAccountId, ownerId, `Депозит ${bank.baseCurrency} · ${bank.name}`, "asset", bank.baseCurrency);
  ensureAccount(world.ledger, ledgerBankLiabilityAccountId, bankId, `Депозитный счёт ${ownerId}`, "liability", bank.baseCurrency);
  if (isPrimary) {
    const household = world.households.find((item) => item.id === ownerId);
    if (household) {
      household.primaryBankAccountId = id;
      household.bankId = bankId;
    }
  }
  if (ownerId === world.player.householdId && !world.player.bankAccountIds.includes(id)) world.player.bankAccountIds.push(id);
  emitSimpleEvent(world, "BankAccountOpened", "Банковский счёт открыт", `${bank.name} · ${bank.baseCurrency}`, [ownerId, bankId], "positive");
  return { ok: true, message: "Счёт открыт", accountId: id };
}

export function setPrimaryBankAccount(world: WorldState, ownerId: string, bankAccountId: string): boolean {
  const selected = world.bankAccounts.find((account) => account.id === bankAccountId && account.ownerId === ownerId && account.status === "active");
  if (!selected) return false;
  world.bankAccounts.filter((account) => account.ownerId === ownerId).forEach((account) => { account.isPrimary = account.id === selected.id; });
  const household = world.households.find((item) => item.id === ownerId);
  if (household) {
    household.primaryBankAccountId = selected.id;
    household.bankId = selected.bankId;
  }
  return true;
}

export function centralBankIdForBank(world: WorldState, bankId: string): string {
  return world.banks.find((bank) => bank.id === bankId)?.centralBankId ?? world.centralBank.id;
}

function reserveSettlementEntries(world: WorldState, payerBankId: string, recipientBankId: string, amountCents: number): LedgerEntry[] {
  const payerCurrency = world.banks.find((bank) => bank.id === payerBankId)?.baseCurrency;
  const recipientCurrency = world.banks.find((bank) => bank.id === recipientBankId)?.baseCurrency;
  if (!payerCurrency || payerCurrency !== recipientCurrency) throw new Error("Межвалютный платёж требует FX-конвертации");
  const payerCentralBankId = centralBankIdForBank(world, payerBankId);
  const recipientCentralBankId = centralBankIdForBank(world, recipientBankId);
  const entries: LedgerEntry[] = [
    { accountId: accountIds.bankReserve(payerBankId), side: "credit", amountCents },
    { accountId: accountIds.bankReserve(recipientBankId), side: "debit", amountCents },
    { accountId: accountIds.centralBankReserveLiability(payerCentralBankId, payerBankId), side: "debit", amountCents },
    { accountId: accountIds.centralBankReserveLiability(recipientCentralBankId, recipientBankId), side: "credit", amountCents },
  ];
  return entries;
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
    annualRateBps: (world.centralBanks.find((bank) => bank.id === centralBankIdForBank(world, borrowerBankId))?.policyRateBps ?? world.centralBank.policyRateBps) + (kind === "interbank" ? 180 : 450),
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
  const centralBankId = centralBankIdForBank(world, bankId);
  const currency = world.banks.find((bank) => bank.id === bankId)?.baseCurrency ?? "RUB";
  for (const lender of world.banks
    .filter((bank) => bank.id !== bankId && bank.centralBankId === centralBankId)
    .sort((left, right) => balanceOf(world, accountIds.bankReserve(right.id)) - balanceOf(world, accountIds.bankReserve(left.id)))) {
    const reserve = balanceOf(world, accountIds.bankReserve(lender.id));
    const buffer = Math.floor((bankDepositLiabilities(world, lender.id) * lender.minimumLiquidityRatioBps) / 10_000);
    const available = Math.max(0, reserve - buffer);
    const amountCents = Math.min(shortfall, available);
    if (amountCents <= 0) continue;
    ensureAccount(world.ledger, accountIds.interbankAsset(lender.id, bankId), lender.id, `Межбанковский кредит ${bankId}`, "asset", currency);
    ensureAccount(world.ledger, accountIds.interbankLiability(bankId, lender.id), bankId, `Межбанковское обязательство ${lender.id}`, "liability", currency);
    postTransaction(world, "INTERBANK_LOAN", `Межбанковская ликвидность: ${lender.name} → ${bankId}`, [
      { accountId: accountIds.bankReserve(bankId), side: "debit", amountCents },
      { accountId: accountIds.interbankLiability(bankId, lender.id), side: "credit", amountCents },
      { accountId: accountIds.interbankAsset(lender.id, bankId), side: "debit", amountCents },
      { accountId: accountIds.bankReserve(lender.id), side: "credit", amountCents },
      { accountId: accountIds.centralBankReserveLiability(centralBankId, lender.id), side: "debit", amountCents },
      { accountId: accountIds.centralBankReserveLiability(centralBankId, bankId), side: "credit", amountCents },
    ]);
    createFundingRecord(world, lender.id, bankId, amountCents, "interbank");
    shortfall -= amountCents;
    if (shortfall <= 0) break;
  }
  if (shortfall > 0) {
    ensureAccount(world.ledger, accountIds.centralBankFacilityAsset(centralBankId, bankId), centralBankId, `Кредит ликвидности ${bankId}`, "asset", currency);
    ensureAccount(world.ledger, accountIds.centralBankFacilityLiability(bankId), bankId, "Кредит ликвидности ЦБ", "liability", currency);
    postTransaction(world, "CENTRAL_BANK_FACILITY", `Кредит ликвидности ЦБ для ${bankId}`, [
      { accountId: accountIds.bankReserve(bankId), side: "debit", amountCents: shortfall },
      { accountId: accountIds.centralBankFacilityLiability(bankId), side: "credit", amountCents: shortfall },
      { accountId: accountIds.centralBankFacilityAsset(centralBankId, bankId), side: "debit", amountCents: shortfall },
      { accountId: accountIds.centralBankReserveLiability(centralBankId, bankId), side: "credit", amountCents: shortfall },
    ]);
    createFundingRecord(world, centralBankId, bankId, shortfall, "central-bank");
    emitSimpleEvent(world, "BankLiquidityFunded", "Банк получил ликвидность", `${bankId} привлёк ликвидность у своего центрального банка.`, [bankId, centralBankId], "attention", [], { amountCents: shortfall });
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
  const payerAccount = primaryBankAccount(world, payerId);
  const recipientAccount = primaryBankAccount(world, recipientId);
  if (amountCents <= 0 || !payerAccount || !recipientAccount || payerAccount.currencyId !== recipientAccount.currencyId || bankAccountBalance(world, payerAccount.id) < amountCents) return null;
  const currency = payerAccount.currencyId;
  const payerDebit = world.ledger.accounts[payerDebitAccountId];
  const recipientCredit = world.ledger.accounts[recipientCreditAccountId];
  if (!payerDebit || !recipientCredit) return null;
  if (payerDebit.currency !== currency) {
    payerDebitAccountId = `${payerDebitAccountId}:${currency}`;
    ensureAccount(world.ledger, payerDebitAccountId, payerDebit.ownerId, `${payerDebit.name} · ${currency}`, payerDebit.category, currency);
  }
  if (recipientCredit.currency !== currency) {
    recipientCreditAccountId = `${recipientCreditAccountId}:${currency}`;
    ensureAccount(world.ledger, recipientCreditAccountId, recipientCredit.ownerId, `${recipientCredit.name} · ${currency}`, recipientCredit.category, currency);
  }
  const payerBankId = payerAccount.bankId;
  const recipientBankId = recipientAccount.bankId;
  ensureBankingAccounts(world, payerId, payerBankId);
  ensureBankingAccounts(world, recipientId, recipientBankId);
  if (payerBankId !== recipientBankId) ensureSettlementLiquidity(world, payerBankId, amountCents);
  const entries: LedgerEntry[] = [
    { accountId: payerDebitAccountId, side: "debit", amountCents },
    { accountId: payerAccount.ledgerDepositAccountId, side: "credit", amountCents },
    { accountId: recipientAccount.ledgerDepositAccountId, side: "debit", amountCents },
    { accountId: recipientCreditAccountId, side: "credit", amountCents },
    { accountId: payerAccount.ledgerBankLiabilityAccountId, side: "debit", amountCents },
    { accountId: recipientAccount.ledgerBankLiabilityAccountId, side: "credit", amountCents },
  ];
  if (payerBankId !== recipientBankId) {
    entries.push(...reserveSettlementEntries(world, payerBankId, recipientBankId, amountCents));
  }
  return postTransaction(world, kind, memo, entries, causeIds);
}

export function transferBankAccountBalance(
  world: WorldState,
  payerBankAccountId: string,
  recipientBankAccountId: string,
  amountMinor: number,
  kind: TransactionKind,
  memo: string,
  causeIds: string[] = [],
): string | null {
  const payer = world.bankAccounts.find((account) => account.id === payerBankAccountId && account.status === "active");
  const recipient = world.bankAccounts.find((account) => account.id === recipientBankAccountId && account.status === "active");
  amountMinor = Math.floor(amountMinor);
  if (!payer || !recipient || amountMinor <= 0 || payer.currencyId !== recipient.currencyId || bankAccountBalance(world, payer.id) < amountMinor) return null;
  ensureBankingAccounts(world, payer.ownerId, payer.bankId);
  ensureBankingAccounts(world, recipient.ownerId, recipient.bankId);
  if (payer.bankId !== recipient.bankId) ensureSettlementLiquidity(world, payer.bankId, amountMinor);
  const entries: LedgerEntry[] = [
    { accountId: payer.ledgerDepositAccountId, side: "credit", amountCents: amountMinor },
    { accountId: recipient.ledgerDepositAccountId, side: "debit", amountCents: amountMinor },
    { accountId: payer.ledgerBankLiabilityAccountId, side: "debit", amountCents: amountMinor },
    { accountId: recipient.ledgerBankLiabilityAccountId, side: "credit", amountCents: amountMinor },
  ];
  if (payer.bankId !== recipient.bankId) entries.push(...reserveSettlementEntries(world, payer.bankId, recipient.bankId, amountMinor));
  return postTransaction(world, kind, memo, entries, causeIds);
}

function ensureBankingAccounts(world: WorldState, entityId: string, bankId: string): void {
  const centralBankId = centralBankIdForBank(world, bankId);
  const currency = world.banks.find((bank) => bank.id === bankId)?.baseCurrency ?? "RUB";
  ensureEntityAccounts(world.ledger, entityId, currency);
  ensureAccount(
    world.ledger,
    accountIds.bankDepositLiability(bankId, entityId),
    bankId,
    `Депозит ${entityId}`,
    "liability",
    currency,
  );
  ensureAccount(
    world.ledger,
    accountIds.bankReserve(bankId),
    bankId,
    "Резервы в центральном банке",
    "asset",
    currency,
  );
  ensureAccount(
    world.ledger,
    accountIds.centralBankReserveLiability(centralBankId, bankId),
    centralBankId,
    `Резервный счёт ${bankId}`,
    "liability",
    currency,
  );
}

export function seedDeposit(
  world: WorldState,
  ownerId: string,
  bankId: string,
  amountCents: number,
): void {
  const centralBankId = centralBankIdForBank(world, bankId);
  const currency = world.banks.find((bank) => bank.id === bankId)?.baseCurrency ?? "RUB";
  let bankAccount = world.bankAccounts.find((account) => account.ownerId === ownerId && account.bankId === bankId && account.currencyId === currency && account.status === "active");
  if (!bankAccount) {
    const opened = openBankAccount(world, ownerId, bankId, !world.bankAccounts.some((account) => account.ownerId === ownerId));
    bankAccount = world.bankAccounts.find((account) => account.id === opened.accountId);
  }
  if (!bankAccount) throw new Error(`Не удалось открыть стартовый счёт ${ownerId}`);
  ensureBankingAccounts(world, ownerId, bankId);
  const ownerBankAccounts = world.bankAccounts.filter((account) => account.ownerId === ownerId && account.status === "active");
  const openingEquityId = ownerBankAccounts.length === 1 ? accountIds.openingEquity(ownerId) : accountIds.openingEquityCurrency(ownerId, currency);
  ensureAccount(world.ledger, openingEquityId, ownerId, `Начальный капитал ${currency}`, "equity", currency);
  ensureAccount(
    world.ledger,
    accountIds.centralBankMonetaryAsset(centralBankId),
    centralBankId,
    "Актив денежной базы",
    "asset",
    currency,
  );
  postTransaction(world, "GENESIS", `Начальный депозит: ${ownerId}`, [
    { accountId: bankAccount.ledgerDepositAccountId, side: "debit", amountCents },
    { accountId: openingEquityId, side: "credit", amountCents },
    { accountId: accountIds.bankReserve(bankId), side: "debit", amountCents },
    { accountId: bankAccount.ledgerBankLiabilityAccountId, side: "credit", amountCents },
    {
      accountId: accountIds.centralBankMonetaryAsset(centralBankId),
      side: "debit",
      amountCents,
    },
    {
      accountId: accountIds.centralBankReserveLiability(centralBankId, bankId),
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
  const centralBankId = centralBankIdForBank(world, bankId);
  const currency = world.banks.find((bank) => bank.id === bankId)?.baseCurrency ?? "RUB";
  ensureAccount(world.ledger, accountIds.bankReserve(bankId), bankId, "Резервы в ЦБ", "asset", currency);
  ensureAccount(world.ledger, accountIds.bankEquity(bankId), bankId, "Капитал банка", "equity", currency);
  ensureAccount(
    world.ledger,
    accountIds.centralBankMonetaryAsset(centralBankId),
    centralBankId,
    "Актив денежной базы",
    "asset",
    currency,
  );
  ensureAccount(
    world.ledger,
    accountIds.centralBankReserveLiability(centralBankId, bankId),
    centralBankId,
    `Резервный счёт ${bankId}`,
    "liability",
    currency,
  );
  postTransaction(world, "GENESIS", `Регулятивный капитал: ${bankId}`, [
    { accountId: accountIds.bankReserve(bankId), side: "debit", amountCents },
    { accountId: accountIds.bankEquity(bankId), side: "credit", amountCents },
    {
      accountId: accountIds.centralBankMonetaryAsset(centralBankId),
      side: "debit",
      amountCents,
    },
    {
      accountId: accountIds.centralBankReserveLiability(centralBankId, bankId),
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
    | "PROCUREMENT"
    | "CAPITAL_INVESTMENT"
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
    ...reserveSettlementEntries(world, fromBankId, toBankId, amountCents),
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
    ...reserveSettlementEntries(world, buyerBankId, sellerBankId, amountCents),
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
  const bankId = findBankIdForEntity(world, ownerId);
  const currency = world.banks.find((bank) => bank.id === bankId)?.baseCurrency ?? "RUB";
  ensureEntityAccounts(world.ledger, ownerId, currency);
  ensureAccount(world.ledger, accountId, ownerId, name, "asset", currency);
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
  const payerCurrency = world.banks.find((bank) => bank.id === payerBankId)?.baseCurrency ?? "RUB";
  const recipientCurrency = world.banks.find((bank) => bank.id === recipientBankId)?.baseCurrency ?? "RUB";
  if (payerCurrency !== recipientCurrency) return null;
  ensureBankingAccounts(world, householdId, payerBankId);
  ensureBankingAccounts(world, companyId, recipientBankId);
  if (!primaryBankAccount(world, companyId)) openBankAccount(world, companyId, recipientBankId, true);
  const payerAccount = primaryBankAccount(world, householdId);
  const recipientAccount = primaryBankAccount(world, companyId);
  if (!payerAccount || !recipientAccount) return null;
  ensureAccount(
    world.ledger,
    accountIds.investment(householdId, companyId),
    householdId,
    `Доля в ${companyId}`,
    "asset",
    payerCurrency,
  );
  if (payerBankId !== recipientBankId) ensureSettlementLiquidity(world, payerBankId, amountCents);
  const entries: LedgerEntry[] = [
    { accountId: accountIds.investment(householdId, companyId), side: "debit", amountCents },
    { accountId: payerAccount.ledgerDepositAccountId, side: "credit", amountCents },
    { accountId: recipientAccount.ledgerDepositAccountId, side: "debit", amountCents },
    { accountId: accountIds.openingEquity(companyId), side: "credit", amountCents },
    { accountId: payerAccount.ledgerBankLiabilityAccountId, side: "debit", amountCents },
    { accountId: recipientAccount.ledgerBankLiabilityAccountId, side: "credit", amountCents },
  ];
  if (payerBankId !== recipientBankId) {
    entries.push(...reserveSettlementEntries(world, payerBankId, recipientBankId, amountCents));
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

export function sumAccountsByCategoryInstrument(world: WorldState, category: AccountCategory, instrument: LedgerAccount["instrument"]): number {
  return sumAccounts(world, (account) => account.category === category && account.instrument === instrument);
}

export function sumAccountsByCurrencyCategoryInstrument(world: WorldState, currencyId: string, category: AccountCategory, instrument: LedgerAccount["instrument"]): number {
  return sumAccounts(world, (account) => account.currency === currencyId && account.category === category && account.instrument === instrument);
}

export function sumAccountsByOwnerCategoryInstrument(world: WorldState, ownerId: string, category: AccountCategory, instrument: LedgerAccount["instrument"]): number {
  return indexedAccountIds(world.ledger, ownerId).reduce((sum, accountId) => {
    const account = world.ledger.accounts[accountId];
    return account?.category === category && account.instrument === instrument ? sum + balanceOf(world, accountId) : sum;
  }, 0);
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
  for (const accountId of indexedAccountIds(world.ledger, ownerId)) {
    const account = world.ledger.accounts[accountId];
    if (!account) continue;
    const balance = balanceOf(world, account.id);
    if (account.category === "asset") totals.assets += balance;
    if (account.category === "liability") totals.liabilities += balance;
    if (account.category === "equity") totals.equity += balance;
    if (account.category === "income") totals.income += balance;
    if (account.category === "expense") totals.expenses += balance;
  }
  return { ...totals, capital: totals.equity + totals.income - totals.expenses };
}
