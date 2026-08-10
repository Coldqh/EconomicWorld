import { accountIds, balanceOf, entityBook, sumAccounts } from "../core/ledger.ts";
import type { InvariantResult, LedgerAccount, WorldState } from "../domain/model.ts";

function result(
  id: string,
  title: string,
  ok: boolean,
  detail: string,
  differenceCents?: number,
): InvariantResult {
  return { id, title, ok, detail, differenceCents };
}

export function checkInvariants(world: WorldState): InvariantResult[] {
  const results: InvariantResult[] = [];
  let firstBrokenTransaction = "";
  for (const transaction of world.ledger.transactions) {
    const debits = transaction.entries
      .filter((entry) => entry.side === "debit")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    const credits = transaction.entries
      .filter((entry) => entry.side === "credit")
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    if (debits !== credits) {
      firstBrokenTransaction = transaction.id;
      break;
    }
  }
  results.push(
    result(
      "double-entry",
      "Дебеты равны кредитам",
      firstBrokenTransaction === "",
      firstBrokenTransaction ? `Нарушение в ${firstBrokenTransaction}` : `${world.ledger.transactions.length.toLocaleString("ru-RU")} транзакций сбалансированы`,
    ),
  );

  const depositAssets = sumAccounts(
    world,
    (account) => account.category === "asset" && account.instrument === "deposit",
  );
  const depositLiabilities = sumAccounts(
    world,
    (account) => account.category === "liability" && account.instrument === "deposit",
  );
  results.push(
    result(
      "deposit-mirror",
      "Депозиты имеют банковскую сторону",
      depositAssets === depositLiabilities,
      `Активы клиентов и обязательства банков: ${(depositAssets / 100).toLocaleString("ru-RU")} ₽`,
      depositAssets - depositLiabilities,
    ),
  );

  const reserveAssets = sumAccounts(
    world,
    (account) =>
      account.category === "asset" &&
      account.instrument === "reserve" &&
      world.banks.some((bank) => bank.id === account.ownerId),
  );
  const reserveLiabilities = sumAccounts(
    world,
    (account) =>
      account.category === "liability" &&
      account.instrument === "reserve" &&
      account.ownerId === world.centralBank.id,
  );
  results.push(
    result(
      "reserve-mirror",
      "Резервы сверены с центральным банком",
      reserveAssets === reserveLiabilities,
      `Резервная система: ${(reserveAssets / 100).toLocaleString("ru-RU")} ₽`,
      reserveAssets - reserveLiabilities,
    ),
  );

  const loanAssets = sumAccounts(
    world,
    (account) =>
      account.category === "asset" &&
      account.instrument === "loan" &&
      world.banks.some((bank) => bank.id === account.ownerId),
  );
  const loanLiabilities = sumAccounts(
    world,
    (account) => account.category === "liability" && account.instrument === "loan",
  );
  const contracts = world.loans
    .filter((loan) => loan.status === "active")
    .reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
  results.push(
    result(
      "loan-mirror",
      "Кредитор, должник и договор совпадают",
      loanAssets === loanLiabilities && loanAssets === contracts,
      `Непогашенный principal: ${(contracts / 100).toLocaleString("ru-RU")} ₽`,
      loanAssets - contracts,
    ),
  );

  const relevantOwners = [
    ...world.households.map((item) => item.id),
    ...world.companies.map((item) => item.id),
    ...world.banks.map((item) => item.id),
    world.government.id,
    world.centralBank.id,
    "goods-market",
  ];
  let brokenBook = "";
  let bookDifference = 0;
  for (const ownerId of relevantOwners) {
    const book = entityBook(world, ownerId);
    const difference = book.assets + book.expenses - book.liabilities - book.equity - book.income;
    if (difference !== 0) {
      brokenBook = ownerId;
      bookDifference = difference;
      break;
    }
  }
  results.push(
    result(
      "accounting-equation",
      "Балансовые уравнения выполняются",
      brokenBook === "",
      brokenBook ? `Не сходится книга ${brokenBook}` : `${relevantOwners.length} книг прошли проверку`,
      bookDifference,
    ),
  );

  const negativeDeposits = world.households
    .map((household) => household.id)
    .concat(world.companies.map((company) => company.id), [world.government.id, "goods-market"])
    .filter((id) => balanceOf(world, accountIds.deposit(id)) < 0);
  results.push(
    result(
      "non-negative-money",
      "Нет неразрешённого овердрафта",
      negativeDeposits.length === 0,
      negativeDeposits.length ? `Отрицательные депозиты: ${negativeDeposits.join(", ")}` : "Все депозитные счета неотрицательны",
    ),
  );

  const allowedMoneyChanges = new Set(["GENESIS", "LOAN_ISSUED", "LOAN_PRINCIPAL", "LOAN_INTEREST"]);
  let unauthorized = "";
  for (const transaction of world.ledger.transactions) {
    let depositDelta = 0;
    for (const entry of transaction.entries) {
      const account: LedgerAccount = world.ledger.accounts[entry.accountId];
      if (account.category !== "asset" || account.instrument !== "deposit") continue;
      depositDelta += entry.side === "debit" ? entry.amountCents : -entry.amountCents;
    }
    if (depositDelta !== 0 && !allowedMoneyChanges.has(transaction.kind)) {
      unauthorized = transaction.id;
      break;
    }
  }
  results.push(
    result(
      "authorized-money",
      "Изменения денежной массы авторизованы",
      unauthorized === "",
      unauthorized ? `Необъяснимое изменение в ${unauthorized}` : "Создание и уничтожение депозитов связано с genesis или банковским кредитом",
    ),
  );

  const negativeGoods = world.companies.filter(
    (company) =>
      company.inventoryMilliUnits < 0 ||
      Object.values(company.inputInventoryMilliUnits).some((quantity) => quantity < 0),
  );
  results.push(
    result(
      "goods-conservation",
      "Товарные остатки неотрицательны",
      negativeGoods.length === 0,
      negativeGoods.length ? `Нарушение у ${negativeGoods[0].name}` : `${world.goodsMovements.length.toLocaleString("ru-RU")} движений товаров учтены`,
    ),
  );

  let employmentIssue = "";
  for (const household of world.households) {
    if (!household.employerId) continue;
    const company = world.companies.find((item) => item.id === household.employerId);
    if (!company?.active || !company.employees.includes(household.id)) {
      employmentIssue = household.id;
      break;
    }
  }
  if (!employmentIssue) {
    for (const company of world.companies) {
      const unique = new Set(company.employees);
      if (unique.size !== company.employees.length) {
        employmentIssue = company.id;
        break;
      }
    }
  }
  results.push(
    result(
      "employment-links",
      "Рынок труда согласован",
      employmentIssue === "",
      employmentIssue ? `Нарушенная связь: ${employmentIssue}` : "Работник и работодатель ссылаются друг на друга",
    ),
  );

  const marketDeposit = balanceOf(world, accountIds.deposit("goods-market"));
  results.push(
    result(
      "market-clearing",
      "Товарный рынок рассчитался",
      marketDeposit === 0,
      marketDeposit === 0 ? "Клиринговый счёт закрыт в ноль" : `На клиринге осталось ${(marketDeposit / 100).toLocaleString("ru-RU")} ₽`,
      marketDeposit,
    ),
  );
  return results;
}
