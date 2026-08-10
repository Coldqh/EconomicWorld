import type {
  AccountCategory,
  LedgerAccount,
  LedgerEntry,
  LedgerState,
  TransactionKind,
  WorldState,
} from "../domain/model.ts";

export const accountIds = {
  deposit: (ownerId: string) => `${ownerId}:asset:deposit`,
  openingEquity: (ownerId: string) => `${ownerId}:equity:opening`,
  operatingIncome: (ownerId: string) => `${ownerId}:income:operating`,
  operatingExpense: (ownerId: string) => `${ownerId}:expense:operating`,
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
  if (entityId === world.government.id || entityId === "goods-market") {
    return world.banks[0].id;
  }
  throw new Error(`Для ${entityId} не назначен коммерческий банк`);
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
  >,
  memo: string,
  causeIds: string[] = [],
): string | null {
  amountCents = Math.floor(amountCents);
  if (amountCents <= 0) return null;
  if (depositOf(world, payerId) < amountCents) return null;

  const payerBankId = findBankIdForEntity(world, payerId);
  const recipientBankId = findBankIdForEntity(world, recipientId);
  ensureBankingAccounts(world, payerId, payerBankId);
  ensureBankingAccounts(world, recipientId, recipientBankId);

  const entries: LedgerEntry[] = [
    { accountId: accountIds.operatingExpense(payerId), side: "debit", amountCents },
    { accountId: accountIds.deposit(payerId), side: "credit", amountCents },
    { accountId: accountIds.deposit(recipientId), side: "debit", amountCents },
    { accountId: accountIds.operatingIncome(recipientId), side: "credit", amountCents },
    {
      accountId: accountIds.bankDepositLiability(payerBankId, payerId),
      side: "debit",
      amountCents,
    },
    {
      accountId: accountIds.bankDepositLiability(recipientBankId, recipientId),
      side: "credit",
      amountCents,
    },
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
  return postTransaction(world, kind, memo, entries, causeIds);
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
