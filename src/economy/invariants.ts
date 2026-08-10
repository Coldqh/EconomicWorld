import { gdpReconciliationTolerance } from "../accounting/national-accounts.ts";
import { accountIds, balanceOf, entityBook, sumAccounts } from "../core/ledger.ts";
import type { InvariantResult, LedgerAccount, WorldState } from "../domain/model.ts";

function result(section: InvariantResult["section"], id: string, title: string, ok: boolean, detail: string, differenceCents?: number): InvariantResult {
  return { section, id, title, ok, detail, differenceCents };
}

export function checkInvariants(world: WorldState): InvariantResult[] {
  const results: InvariantResult[] = [];
  const brokenTransaction = world.ledger.transactions.find((transaction) => transaction.entries.filter((entry) => entry.side === "debit").reduce((sum, entry) => sum + entry.amountCents, 0) !== transaction.entries.filter((entry) => entry.side === "credit").reduce((sum, entry) => sum + entry.amountCents, 0));
  results.push(result("Бухгалтерия", "double-entry", "Дебеты равны кредитам", !brokenTransaction, brokenTransaction ? `Нарушение в ${brokenTransaction.id}` : `${world.ledger.transactions.length.toLocaleString("ru-RU")} транзакций сбалансированы`));

  const depositAssets = sumAccounts(world, (account) => account.category === "asset" && account.instrument === "deposit");
  const depositLiabilities = sumAccounts(world, (account) => account.category === "liability" && account.instrument === "deposit");
  results.push(result("Деньги", "deposit-mirror", "Депозиты имеют банковскую сторону", depositAssets === depositLiabilities, `Клиенты / банки: ${(depositAssets / 100).toLocaleString("ru-RU")} ₽`, depositAssets - depositLiabilities));

  const reserveAssets = sumAccounts(world, (account) => account.category === "asset" && account.instrument === "reserve" && world.banks.some((bank) => bank.id === account.ownerId));
  const reserveLiabilities = sumAccounts(world, (account) => account.category === "liability" && account.instrument === "reserve" && account.ownerId === world.centralBank.id);
  results.push(result("Ликвидность банков", "reserve-mirror", "Резервы сверены с центральным банком", reserveAssets === reserveLiabilities, `Резервы: ${(reserveAssets / 100).toLocaleString("ru-RU")} ₽`, reserveAssets - reserveLiabilities));

  const negativeReserves = world.banks.filter((bank) => balanceOf(world, accountIds.bankReserve(bank.id)) < 0);
  results.push(result("Ликвидность банков", "non-negative-reserves", "Резервы банков неотрицательны", negativeReserves.length === 0, negativeReserves.length ? negativeReserves.map((bank) => bank.name).join(", ") : "Межбанк и окно ЦБ закрывают расчётный дефицит"));

  const loanAssets = sumAccounts(world, (account) => account.category === "asset" && account.instrument === "loan" && world.banks.some((bank) => bank.id === account.ownerId));
  const loanLiabilities = sumAccounts(world, (account) => account.category === "liability" && account.instrument === "loan");
  const contracts = world.loans.filter((loan) => loan.status === "active").reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
  results.push(result("Кредит", "loan-mirror", "Кредитор, должник и договор совпадают", loanAssets === loanLiabilities && loanAssets === contracts, `Основной долг: ${(contracts / 100).toLocaleString("ru-RU")} ₽`, loanAssets - contracts));

  const owners = [...new Set(Object.values(world.ledger.accounts).map((account) => account.ownerId))];
  let brokenBook = "";
  let bookDifference = 0;
  for (const ownerId of owners) {
    const book = entityBook(world, ownerId);
    const difference = book.assets + book.expenses - book.liabilities - book.equity - book.income;
    if (difference !== 0) { brokenBook = ownerId; bookDifference = difference; break; }
  }
  results.push(result("Бухгалтерия", "accounting-equation", "Балансовые уравнения выполняются", !brokenBook, brokenBook ? `Не сходится книга ${brokenBook}` : `${owners.length} книг прошли проверку`, bookDifference));

  const monetaryOwners = [...new Set(Object.values(world.ledger.accounts).filter((account) => account.category === "asset" && account.instrument === "deposit").map((account) => account.ownerId))];
  const negativeDeposits = monetaryOwners.filter((id) => balanceOf(world, accountIds.deposit(id)) < 0);
  results.push(result("Деньги", "non-negative-money", "Нет неразрешённого овердрафта", negativeDeposits.length === 0, negativeDeposits.length ? negativeDeposits.join(", ") : "Все депозитные счета неотрицательны"));

  const allowedMoneyChanges = new Set(["GENESIS", "LOAN_ISSUED", "LOAN_PRINCIPAL", "LOAN_INTEREST"]);
  const unauthorized = world.ledger.transactions.find((transaction) => {
    const change = transaction.entries.reduce((sum, entry) => {
      const account: LedgerAccount = world.ledger.accounts[entry.accountId];
      return account.category === "asset" && account.instrument === "deposit" ? sum + (entry.side === "debit" ? entry.amountCents : -entry.amountCents) : sum;
    }, 0);
    return change !== 0 && !allowedMoneyChanges.has(transaction.kind);
  });
  results.push(result("Деньги", "authorized-money", "Изменения денежной массы авторизованы", !unauthorized, unauthorized ? unauthorized.id : "Только начальные проводки и банковский кредит меняют сумму депозитов"));

  const negativeGoods = world.companies.filter((company) => company.inventoryMilliUnits < 0 || Object.values(company.inputInventoryMilliUnits).some((value) => value < 0));
  results.push(result("Товары", "goods-conservation", "Товарные остатки неотрицательны", negativeGoods.length === 0, negativeGoods.length ? negativeGoods[0].name : `${world.goodsMovements.length.toLocaleString("ru-RU")} движений товаров`));

  const inventoryMismatch = world.companies.find((company) => {
    const ledgerValue = balanceOf(world, accountIds.finishedInventory(company.id)) + world.goods.reduce((sum, good) => sum + balanceOf(world, accountIds.inputInventory(company.id, good.id)), 0);
    const modelValue = company.inventoryValueCents + Object.values(company.inputInventoryValueCents).reduce((sum, value) => sum + value, 0);
    return ledgerValue !== modelValue;
  });
  results.push(result("Бухгалтерия", "inventory-valuation", "Оценка запасов сверена с книгой", !inventoryMismatch, inventoryMismatch ? inventoryMismatch.name : "Физические и денежные регистры связаны"));

  const capitalMismatch = world.companies.find((company) => balanceOf(world, accountIds.productiveCapital(company.id)) !== company.productiveCapital.bookValueCents);
  results.push(result("Бухгалтерия", "productive-capital", "Производственный капитал сверён", !capitalMismatch, capitalMismatch ? capitalMismatch.name : "Амортизация и инвестиции отражены в книге"));

  const employmentIssue = world.households.find((household) => household.employerId && !world.companies.find((company) => company.id === household.employerId && company.active && company.employees.includes(household.id)));
  results.push(result("Игрок", "employment-links", "Рынок труда согласован", !employmentIssue, employmentIssue?.id ?? "Работник и работодатель ссылаются друг на друга"));

  const person = world.people.find((item) => item.id === world.player.personId);
  const playerHousehold = world.households.find((item) => item.id === world.player.householdId);
  const playerOk = Boolean(person && playerHousehold && person.householdId === playerHousehold.id && playerHousehold.personIds.includes(person.id));
  results.push(result("Игрок", "player-link", "Игрок является экономическим агентом", playerOk, playerOk ? "Персона, домохозяйство, банк и книга связаны" : "Нарушена связь игрока"));

  const latest = world.metricsHistory.at(-1);
  const tolerance = latest ? gdpReconciliationTolerance(latest) : 100;
  const gap = latest?.gdpReconciliationGapCents ?? 0;
  results.push(result("Национальные счета", "gdp-reconciliation", "ВВП согласован двумя методами", Math.abs(gap) <= tolerance, `Расхождение: ${(gap / 100).toLocaleString("ru-RU")} ₽`, gap));

  const representedPopulation = world.populationCohorts.reduce((sum, cohort) => sum + cohort.populationCount, 0) + world.people.length;
  const invalidPopulation = world.populationCohorts.find((cohort) => cohort.populationCount < 0 || cohort.employedCount < 0 || cohort.employedCount > cohort.populationCount);
  results.push(result("Население", "population-cohorts", "Когорты населения согласованы", !invalidPopulation && representedPopulation >= 1_000_000, `${representedPopulation.toLocaleString("ru-RU")} жителей`));

  const representedFirms = world.firmCohorts.reduce((sum, cohort) => sum + cohort.firmCount, 0) + world.companies.length;
  results.push(result("Производительность", "firm-cohorts", "Агрегированные фирмы учтены", representedFirms >= 10_000 && world.firmCohorts.every((cohort) => cohort.firmCount >= 0 && cohort.inventoryMilliUnits >= 0), `${representedFirms.toLocaleString("ru-RU")} фирм`));

  const brokenCity = world.cities.find((city) => !world.countries.some((country) => country.id === city.countryId) || city.costOfLivingCents <= 0 || city.population < 0);
  const brokenCountry = world.countries.find((country) => country.cityIds.some((id) => !world.cities.some((city) => city.id === id)));
  results.push(result("География", "world-references", "Страны и города связаны", !brokenCity && !brokenCountry && world.countries.length >= 10 && world.cities.length >= 30, `${world.countries.length} стран · ${world.cities.length} городов`));

  const brokenHousing = world.housingCohorts.find((cohort) => cohort.availableUnits < 0 || cohort.availableUnits > cohort.totalUnits || cohort.monthlyRentCents <= 0 || cohort.salePriceCents <= 0);
  const brokenProperty = world.properties.find((property) => !world.housingCohorts.some((cohort) => cohort.id === property.sourceCohortId) || !world.cities.some((city) => city.id === property.cityId));
  results.push(result("Жильё", "housing-stock", "Жилищный фонд согласован", !brokenHousing && !brokenProperty, `${world.housingCohorts.reduce((sum, cohort) => sum + cohort.totalUnits, 0).toLocaleString("ru-RU")} объектов`));

  const brokenProgram = world.universityPrograms.find((program) => !world.universities.some((university) => university.id === program.universityId) || program.occupiedSeats < 0 || program.occupiedSeats > program.capacity || program.durationMonths < 12);
  const brokenUniversity = world.universities.find((university) => !world.cities.some((city) => city.id === university.cityId) || university.programIds.some((id) => !world.universityPrograms.some((program) => program.id === id)));
  results.push(result("Образование", "universities", "Вузы, программы и места согласованы", !brokenProgram && !brokenUniversity, `${world.universities.length} вузов · ${world.universityPrograms.length} программ`));

  const archiveIssue = world.ledgerArchives.find((archive) => archive.debitCents !== archive.creditCents);
  const budgetIssue = world.fidelity.materializedPersonIds.length > world.fidelity.budgets.maxActivePersons;
  results.push(result("Производительность", "fidelity-budget", "Уровни детализации укладываются в бюджет", !budgetIssue, `${world.fidelity.materializedPersonIds.length}/${world.fidelity.budgets.maxActivePersons} материализованных персон`));
  results.push(result("Бухгалтерия", "ledger-archives", "Архивы реестра сбалансированы", !archiveIssue, `${world.ledgerArchives.length} архивных сегментов`));
  return results;
}
