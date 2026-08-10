import { emitSimpleEvent } from "../core/events.ts";
import {
  accountIds,
  balanceOf,
  depositOf,
  ensureAccount,
  entityBook,
  postTransaction,
} from "../core/ledger.ts";
import type { Bank, Loan, WorldState } from "../domain/model.ts";
import { bankLiquidityRatioBps } from "./liquidity.ts";

export function bankCapitalCents(world: WorldState, bankId: string): number {
  return entityBook(world, bankId).capital;
}

export function bankLoanAssetsCents(world: WorldState, bankId: string): number {
  return Object.values(world.ledger.accounts)
    .filter(
      (account) =>
        account.ownerId === bankId &&
        account.category === "asset" &&
        account.instrument === "loan",
    )
    .reduce((sum, account) => sum + balanceOf(world, account.id), 0);
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
  const capital = bankCapitalCents(world, bankId);
  const newRiskAssets = bankLoanAssetsCents(world, bankId) + amountCents;
  const projectedRatio = newRiskAssets > 0 ? Math.floor((capital * 10_000) / newRiskAssets) : 100_000;
  const company = world.companies.find((item) => item.id === borrowerId);
  const recentReports = company?.financialReports.slice(-3) ?? [];
  const averageCashFlow = recentReports.length
    ? recentReports.reduce((sum, report) => sum + report.operatingCashFlowCents, 0) / recentReports.length
    : company?.lastGrossRevenueCents ?? amountCents;
  const existingDebt = world.loans
    .filter((loan) => loan.borrowerId === borrowerId && loan.status === "active")
    .reduce((sum, loan) => sum + loan.remainingPrincipalCents, 0);
  const liquidityRatio = bankLiquidityRatioBps(world, bankId);
  const reasons = {
    capitalConstraint: projectedRatio < bank.minimumCapitalRatioBps,
    liquidityConstraint: liquidityRatio < bank.minimumLiquidityRatioBps,
    borrowerRisk: riskPremiumBps > 900,
    cashFlowConstraint: averageCashFlow < 0 || existingDebt > Math.max(amountCents * 3, averageCashFlow * 24),
  };
  if (Object.values(reasons).some(Boolean)) {
    emitSimpleEvent(world, "LoanRejected", "Банк отказал в кредите", `Заявка ${borrowerId} не прошла ограничения капитала, ликвидности или денежного потока.`, [bankId, borrowerId], "attention", causeIds, { ...reasons, projectedCapitalRatioBps: projectedRatio, liquidityRatioBps: liquidityRatio, averageCashFlowCents: Math.round(averageCashFlow) });
    return null;
  }

  const depositAccount = accountIds.deposit(borrowerId);
  const depositLiability = accountIds.bankDepositLiability(bankId, borrowerId);
  const borrowerLoan = accountIds.loanLiability(borrowerId, bankId);
  const bankLoan = accountIds.bankLoanAsset(bankId, borrowerId);
  ensureAccount(world.ledger, depositAccount, borrowerId, "Банковский депозит", "asset");
  ensureAccount(world.ledger, depositLiability, bankId, `Депозит ${borrowerId}`, "liability");
  ensureAccount(world.ledger, borrowerLoan, borrowerId, `Кредит ${bankId}`, "liability");
  ensureAccount(world.ledger, bankLoan, bankId, `Кредит ${borrowerId}`, "asset");
  ensureAccount(world.ledger, accountIds.bankInterestIncome(bankId), bankId, "Процентный доход", "income");
  ensureAccount(world.ledger, accountIds.bankCreditLoss(bankId), bankId, "Кредитные убытки", "expense");

  const loan: Loan = {
    id: `loan-${String(world.nextLoanId++).padStart(7, "0")}`,
    lenderBankId: bankId,
    borrowerId,
    originalPrincipalCents: amountCents,
    remainingPrincipalCents: amountCents,
    annualRateBps: world.centralBank.policyRateBps + bank.baseSpreadBps + riskPremiumBps,
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
      { accountId: depositAccount, side: "debit", amountCents },
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
  for (const loan of world.loans) {
    if (loan.status !== "active" || loan.remainingPrincipalCents <= 0) continue;
    const principalCents = Math.min(
      loan.remainingPrincipalCents,
      Math.max(1, Math.ceil(loan.remainingPrincipalCents / Math.max(1, loan.remainingMonths))),
    );
    const interestCents = Math.max(
      1,
      Math.round((loan.remainingPrincipalCents * loan.annualRateBps) / 120_000),
    );
    const available = depositOf(world, loan.borrowerId);
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
    const bankDepositLiability = accountIds.bankDepositLiability(
      loan.lenderBankId,
      loan.borrowerId,
    );
    const borrowerExpense = accountIds.operatingExpense(loan.borrowerId);
    ensureAccount(world.ledger, borrowerExpense, loan.borrowerId, "Расходы", "expense");
    ensureAccount(
      world.ledger,
      accountIds.bankInterestIncome(loan.lenderBankId),
      loan.lenderBankId,
      "Процентный доход",
      "income",
    );
    postTransaction(world, "LOAN_INTEREST", `Проценты по ${loan.id}`, [
      { accountId: borrowerExpense, side: "debit", amountCents: interestCents },
      { accountId: accountIds.deposit(loan.borrowerId), side: "credit", amountCents: interestCents },
      { accountId: bankDepositLiability, side: "debit", amountCents: interestCents },
      {
        accountId: accountIds.bankInterestIncome(loan.lenderBankId),
        side: "credit",
        amountCents: interestCents,
      },
    ]);
    const borrowerCompany = world.companies.find((company) => company.id === loan.borrowerId);
    if (borrowerCompany) {
      borrowerCompany.lastInterestCents += interestCents;
      borrowerCompany.lastOperatingExpenseCents += interestCents;
    }
    postTransaction(world, "LOAN_PRINCIPAL", `Погашение principal ${loan.id}`, [
      { accountId: borrowerLoan, side: "debit", amountCents: principalCents },
      { accountId: accountIds.deposit(loan.borrowerId), side: "credit", amountCents: principalCents },
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
}

export function settleBorrowerLoansFromCash(
  world: WorldState,
  borrowerId: string,
  causeIds: string[] = [],
): number {
  let recovered = 0;
  for (const loan of world.loans) {
    if (loan.borrowerId !== borrowerId || loan.status !== "active") continue;
    const amountCents = Math.min(
      depositOf(world, borrowerId),
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
          accountId: accountIds.deposit(borrowerId),
          side: "credit",
          amountCents,
        },
        {
          accountId: accountIds.bankDepositLiability(loan.lenderBankId, borrowerId),
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
    ensureAccount(
      world.ledger,
      accountIds.operatingIncome(borrowerId),
      borrowerId,
      "Доход от реструктуризации",
      "income",
    );
    ensureAccount(
      world.ledger,
      accountIds.bankCreditLoss(loan.lenderBankId),
      loan.lenderBankId,
      "Кредитные убытки",
      "expense",
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
          accountId: accountIds.operatingIncome(borrowerId),
          side: "credit",
          amountCents,
        },
        {
          accountId: accountIds.bankCreditLoss(loan.lenderBankId),
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
