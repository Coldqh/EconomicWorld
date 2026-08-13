import { emitSimpleEvent } from "../core/events.ts";
import {
  accountIds,
  bankAccountBalance,
  bankAccountsForOwner,
  ensureAccount,
  entityBook,
  openBankAccount,
  postTransaction,
  settleDepositPayment,
  sumAccountsByOwnerCategoryInstrument,
} from "../core/ledger.ts";
import type { Bank, Loan, WorldState } from "../domain/model.ts";
import { bankLiquidityRatioBps } from "./liquidity.ts";

export function bankCapitalCents(world: WorldState, bankId: string): number {
  return entityBook(world, bankId).capital;
}

export function bankLoanAssetsCents(world: WorldState, bankId: string): number {
  return sumAccountsByOwnerCategoryInstrument(world, bankId, "asset", "loan");
}

export function bankCapitalRatioBps(world: WorldState, bankId: string): number {
  const riskAssets = bankLoanAssetsCents(world, bankId);
  if (riskAssets <= 0) return 100_000;
  return Math.floor((bankCapitalCents(world, bankId) * 10_000) / riskAssets);
}

function bankFor(world: WorldState, bankId: string): Bank {
  const bank = world.banks.find((item) => item.id === bankId);
  if (!bank) throw new Error(`Банк ${bankId} не найден`);
  return bank;
}

export function issueLoan(
  world: WorldState,
  bankId: string,
  borrowerId: string,
  amountCents: number,
  termMonths: number,
  riskPremiumBps: number,
  causeIds: string[] = [],
): Loan | null {
  amountCents = Math.floor(amountCents);
  if (amountCents <= 0 || termMonths <= 0) return null;
  const bank = bankFor(world, bankId);
  const creditSensitivity = world.countryCalibratedParameters[bank.countryId]?.creditDemandSensitivityBps ?? world.calibratedParameters.creditDemandSensitivityBps;
  const policyRateBps = world.centralBanks.find((item) => item.id === bank.centralBankId)?.policyRateBps ?? world.centralBank.policyRateBps;
  amountCents = Math.max(1, Math.round(amountCents * Math.max(2_500, 10_000 - Math.round(policyRateBps * creditSensitivity / 5_000)) / 10_000));
  const capital = bankCapitalCents(world, bankId);
  const newRiskAssets = bankLoanAssetsCents(world, bankId) + amountCents;
  const projectedRatio = newRiskAssets > 0 ? Math.floor((capital * 10_000) / newRiskAssets) : 100_000;
  const company = world.companies.find((item) => item.id === borrowerId);
  const firmCohort = world.firmCohorts.find((item) => item.id === borrowerId);
  const recentReports = company?.financialReports.slice(-3) ?? [];
  const averageCashFlow = recentReports.length
    ? recentReports.reduce((sum, report) => sum + report.operatingCashFlowCents, 0) / recentReports.length
    : company?.lastGrossRevenueCents ?? firmCohort?.revenueCents ?? amountCents;
  const existingDebt = world.loans
    .filter((loan) => loan.borrowerId === borrowerId && loan.status === "active")
    .reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
  const liquidityRatio = bankLiquidityRatioBps(world, bankId);
  const isAggregateFirm = Boolean(firmCohort);
  const reasons = {
    capitalConstraint: projectedRatio < bank.minimumCapitalRatioBps,
    liquidityConstraint: liquidityRatio < bank.minimumLiquidityRatioBps,
    borrowerRisk: riskPremiumBps > 900,
    cashFlowConstraint: averageCashFlow < 0 || existingDebt > Math.max(amountCents * (isAggregateFirm ? 12 : 3), averageCashFlow * (isAggregateFirm ? 60 : 24)),
  };
  if (Object.values(reasons).some(Boolean)) {
    emitSimpleEvent(world, "LoanRejected", "Банк отказал в кредите", `Заявка ${borrowerId} не прошла ограничения капитала, ликвидности или денежного потока.`, [bankId, borrowerId], "attention", causeIds, { ...reasons, projectedCapitalRatioBps: projectedRatio, liquidityRatioBps: liquidityRatio, averageCashFlowCents: Math.round(averageCashFlow) });
    return null;
  }

  let settlement = bankAccountsForOwner(world, borrowerId, bank.baseCurrency).find((account) => account.bankId === bankId);
  if (!settlement) {
    const opened = openBankAccount(world, borrowerId, bankId, !bankAccountsForOwner(world, borrowerId).length);
    settlement = world.bankAccounts.find((account) => account.id === opened.accountId);
  }
  if (!settlement) return null;
  const settlementDepositAccount = settlement.ledgerDepositAccountId;
  const depositLiability = settlement.ledgerBankLiabilityAccountId;
  const borrowerLoan = accountIds.loanLiability(borrowerId, bankId);
  const bankLoan = accountIds.bankLoanAsset(bankId, borrowerId);
  ensureAccount(world.ledger, settlementDepositAccount, borrowerId, "Банковский депозит", "asset", bank.baseCurrency);
  ensureAccount(world.ledger, depositLiability, bankId, `Депозит ${borrowerId}`, "liability", bank.baseCurrency);
  ensureAccount(world.ledger, borrowerLoan, borrowerId, `Кредит ${bankId}`, "liability", bank.baseCurrency);
  ensureAccount(world.ledger, bankLoan, bankId, `Кредит ${borrowerId}`, "asset", bank.baseCurrency);
  ensureAccount(world.ledger, accountIds.bankInterestIncome(bankId), bankId, "Процентный доход", "income", bank.baseCurrency);
  ensureAccount(world.ledger, accountIds.bankCreditLoss(bankId), bankId, "Кредитные убытки", "expense", bank.baseCurrency);

  const loan: Loan = {
    id: `loan-${String(world.nextLoanId++).padStart(7, "0")}`,
    lenderBankId: bankId,
    borrowerId,
    currencyId: bank.baseCurrency,
    settlementBankAccountId: settlement.id,
    originalPrincipalCents: amountCents,
    remainingPrincipalCents: amountCents,
    annualRateBps: Math.round(policyRateBps
      + bank.baseSpreadBps
      + riskPremiumBps
      + Math.max(0, bank.minimumCapitalRatioBps + 250 - projectedRatio) / 4
      + Math.max(0, bank.minimumLiquidityRatioBps + 250 - liquidityRatio) / 4
      + (world.countryMacroStates.find((state) => state.countryId === bank.countryId)?.lendingStandardsBps ?? 4_000) / 20),
    remainingMonths: termMonths,
    missedPayments: 0,
    status: "active",
    issuedAtMonth: world.clock.elapsedMonths,
  };
  const txId = postTransaction(
    world,
    "LOAN_ISSUED",
    `${bank.name} выдал кредит ${borrowerId}`,
    [
      { accountId: settlementDepositAccount, side: "debit", amountCents },
      { accountId: borrowerLoan, side: "credit", amountCents },
      { accountId: bankLoan, side: "debit", amountCents },
      { accountId: depositLiability, side: "credit", amountCents },
    ],
    causeIds,
  );
  world.loans.push(loan);
  emitSimpleEvent(
    world,
    "LoanIssued",
    "Банк расширил кредит",
    `${bank.name} создал депозит и требование к ${borrowerId} на ${(amountCents / 100).toLocaleString("ru-RU")} ₽.`,
    [bankId, borrowerId],
    "info",
    [txId, ...causeIds],
    { amountCents, annualRateBps: loan.annualRateBps },
  );
  return loan;
}

export function serviceLoans(world: WorldState): void {
  const ownerByBank = new Map(world.banks.map((bank) => {
    const owners = world.populationCohorts.filter((cohort) => cohort.countryId === bank.countryId && cohort.bankId === bank.id);
    return [bank.id, owners.length ? owners[(world.clock.elapsedMonths + bank.id.length) % owners.length] : undefined] as const;
  }));
  for (const loan of world.loans) {
    if (loan.status !== "active" || loan.remainingPrincipalCents <= 0) continue;
    const aggregateWorkingCapital = world.firmCohorts.some((cohort) => cohort.id === loan.borrowerId);
    let principalCents = aggregateWorkingCapital && loan.remainingMonths > 1 ? 0 : Math.min(
      loan.remainingPrincipalCents,
      Math.max(1, Math.ceil(loan.remainingPrincipalCents / Math.max(1, loan.remainingMonths))),
    );
    const interestCents = Math.max(
      1,
      Math.round((loan.remainingPrincipalCents * loan.annualRateBps) / 120_000),
    );
    const settlement = world.bankAccounts.find((account) => account.id === loan.settlementBankAccountId && account.status === "active");
    const available = settlement ? bankAccountBalance(world, settlement.id) : 0;
    if (aggregateWorkingCapital && loan.remainingMonths <= 1 && available >= interestCents && available < principalCents + interestCents) {
      loan.remainingMonths = 12;
      const lender = bankFor(world, loan.lenderBankId);
      const policyRate = world.centralBanks.find((item) => item.id === lender.centralBankId)?.policyRateBps ?? 0;
      loan.annualRateBps = policyRate + lender.baseSpreadBps + 350;
      principalCents = 0;
    }
    if (available < principalCents + interestCents) {
      loan.missedPayments += 1;
      if (loan.missedPayments === 1 || loan.missedPayments === 3) {
        emitSimpleEvent(
          world,
          "LoanPaymentMissed",
          "Платёж по кредиту пропущен",
          `${loan.borrowerId} не располагает ликвидностью для платежа по ${loan.id}.`,
          [loan.borrowerId, loan.lenderBankId],
          loan.missedPayments >= 3 ? "critical" : "attention",
          [],
          { missedPayments: loan.missedPayments, requiredCents: principalCents + interestCents },
        );
      }
      continue;
    }

    const borrowerLoan = accountIds.loanLiability(loan.borrowerId, loan.lenderBankId);
    const bankLoan = accountIds.bankLoanAsset(loan.lenderBankId, loan.borrowerId);
    if (!settlement) continue;
    const bankDepositLiability = settlement.ledgerBankLiabilityAccountId;
    const baseExpense = accountIds.operatingExpense(loan.borrowerId);
    const borrowerExpense = world.ledger.accounts[baseExpense]?.currency === loan.currencyId ? baseExpense : `${baseExpense}:${loan.currencyId}`;
    const baseInterestIncome = accountIds.bankInterestIncome(loan.lenderBankId);
    const bankInterestIncome = world.ledger.accounts[baseInterestIncome]?.currency === loan.currencyId ? baseInterestIncome : `${baseInterestIncome}:${loan.currencyId}`;
    ensureAccount(world.ledger, borrowerExpense, loan.borrowerId, "Расходы", "expense", loan.currencyId);
    ensureAccount(
      world.ledger,
      bankInterestIncome,
      loan.lenderBankId,
      "Процентный доход",
      "income",
      loan.currencyId,
    );
    postTransaction(world, "LOAN_INTEREST", `Проценты по ${loan.id}`, [
      { accountId: borrowerExpense, side: "debit", amountCents: interestCents },
      { accountId: settlement.ledgerDepositAccountId, side: "credit", amountCents: interestCents },
      { accountId: bankDepositLiability, side: "debit", amountCents: interestCents },
      {
        accountId: bankInterestIncome,
        side: "credit",
        amountCents: interestCents,
      },
    ]);
    // Проценты не должны навсегда изымать депозиты из реального оборота:
    // часть банковской прибыли распределяется владельцам капитала.
    const borrowerCompany = world.companies.find((company) => company.id === loan.borrowerId);
    if (borrowerCompany) {
      borrowerCompany.lastInterestCents += interestCents;
      borrowerCompany.lastOperatingExpenseCents += interestCents;
    }
    if (principalCents > 0) postTransaction(world, "LOAN_PRINCIPAL", `Погашение principal ${loan.id}`, [
      { accountId: borrowerLoan, side: "debit", amountCents: principalCents },
      { accountId: settlement.ledgerDepositAccountId, side: "credit", amountCents: principalCents },
      { accountId: bankDepositLiability, side: "debit", amountCents: principalCents },
      { accountId: bankLoan, side: "credit", amountCents: principalCents },
    ]);
    loan.remainingPrincipalCents -= principalCents;
    loan.remainingMonths = Math.max(0, loan.remainingMonths - 1);
    loan.missedPayments = 0;
    if (loan.remainingPrincipalCents === 0) {
      loan.status = "repaid";
      emitSimpleEvent(
        world,
        "LoanRepaid",
        "Кредит погашен",
        `${loan.borrowerId} полностью погасил ${loan.id}. Депозитные деньги principal уничтожены.`,
        [loan.borrowerId, loan.lenderBankId],
        "positive",
      );
    }
  }
  if (world.clock.elapsedMonths % 3 !== 0) return;
  for (const bank of world.banks) {
    const owner = ownerByBank.get(bank.id);
    const bankAccount = bankAccountsForOwner(world, bank.id, bank.baseCurrency)[0];
    if (!owner || !bankAccount) continue;
    const distribution = Math.floor(bankAccountBalance(world, bankAccount.id) / 40);
    if (distribution <= 0) continue;
    const expense = accountIds.operatingExpense(bank.id);
    const income = accountIds.dividendIncome(owner.id);
    ensureAccount(world.ledger, expense, bank.id, "Распределение банковской прибыли", "expense", bank.baseCurrency);
    ensureAccount(world.ledger, income, owner.id, "Доход от банковского капитала", "income", bank.baseCurrency);
    settleDepositPayment(world, bank.id, owner.id, distribution, "DIVIDEND", `Распределение прибыли ${bank.id}`, expense, income);
  }
}

export function settleBorrowerLoansFromCash(
  world: WorldState,
  borrowerId: string,
  causeIds: string[] = [],
): number {
  let recovered = 0;
  for (const loan of world.loans) {
    if (loan.borrowerId !== borrowerId || loan.status !== "active") continue;
    const settlement = world.bankAccounts.find((account) => account.id === loan.settlementBankAccountId && account.status === "active");
    const amountCents = Math.min(
      settlement ? bankAccountBalance(world, settlement.id) : 0,
      loan.remainingPrincipalCents,
    );
    if (amountCents <= 0) continue;
    postTransaction(
      world,
      "LOAN_PRINCIPAL",
      `Ликвидационное погашение ${loan.id}`,
      [
        {
          accountId: accountIds.loanLiability(borrowerId, loan.lenderBankId),
          side: "debit",
          amountCents,
        },
        {
          accountId: settlement!.ledgerDepositAccountId,
          side: "credit",
          amountCents,
        },
        {
          accountId: settlement!.ledgerBankLiabilityAccountId,
          side: "debit",
          amountCents,
        },
        {
          accountId: accountIds.bankLoanAsset(loan.lenderBankId, borrowerId),
          side: "credit",
          amountCents,
        },
      ],
      causeIds,
    );
    loan.remainingPrincipalCents -= amountCents;
    recovered += amountCents;
    if (loan.remainingPrincipalCents === 0) {
      loan.status = "repaid";
    }
  }
  return recovered;
}

export function defaultBorrowerLoans(
  world: WorldState,
  borrowerId: string,
  causeIds: string[] = [],
): number {
  let writtenOff = 0;
  for (const loan of world.loans) {
    if (loan.borrowerId !== borrowerId || loan.status !== "active") continue;
    const amountCents = loan.remainingPrincipalCents;
    if (amountCents <= 0) continue;
    const baseIncome = accountIds.operatingIncome(borrowerId);
    const borrowerIncome = world.ledger.accounts[baseIncome]?.currency === loan.currencyId ? baseIncome : `${baseIncome}:${loan.currencyId}`;
    const baseLoss = accountIds.bankCreditLoss(loan.lenderBankId);
    const bankLoss = world.ledger.accounts[baseLoss]?.currency === loan.currencyId ? baseLoss : `${baseLoss}:${loan.currencyId}`;
    ensureAccount(
      world.ledger,
      borrowerIncome,
      borrowerId,
      "Доход от реструктуризации",
      "income",
      loan.currencyId,
    );
    ensureAccount(
      world.ledger,
      bankLoss,
      loan.lenderBankId,
      "Кредитные убытки",
      "expense",
      loan.currencyId,
    );
    postTransaction(
      world,
      "LOAN_DEFAULT",
      `Списание кредита ${loan.id}`,
      [
        {
          accountId: accountIds.loanLiability(borrowerId, loan.lenderBankId),
          side: "debit",
          amountCents,
        },
        {
          accountId: borrowerIncome,
          side: "credit",
          amountCents,
        },
        {
          accountId: bankLoss,
          side: "debit",
          amountCents,
        },
        {
          accountId: accountIds.bankLoanAsset(loan.lenderBankId, borrowerId),
          side: "credit",
          amountCents,
        },
      ],
      causeIds,
    );
    loan.status = "defaulted";
    loan.remainingPrincipalCents = 0;
    writtenOff += amountCents;
  }
  return writtenOff;
}
