/**
 * 三表中的两张:P&L 与 Balance Sheet。建在 postedBalancesAsOf 之上(铁律 2 + as-at)。
 *
 * 当期损益(current year earnings)用「计算式」体现(ADR-0003):BS 的 equity 段
 * 把 net profit 算进去让 A = L + E 平,而不在 M1.2 真生成结转分录(那属期末 close,M1.4)。
 * 会计恒等式保证:posted 凭证 Σ(debit-credit)=0 ⇒ Assets = Liabilities + Equity + (Income-Expense)。
 */
import { type Database } from '@cf4u/db';
import { type AccountBalance, postedBalancesAsOf } from './balances.js';
import { addMoney, eqMoney, formatMoney, subMoney, type Money } from './money.js';

export interface StatementRow {
  accountId: string;
  code: string;
  name: string;
  amount: string; // 各段按其正向(收入/负债/权益 = credit-debit;资产/费用 = debit-credit)
}

/** 该 section 的正向净额。 */
function sectionAmount(b: AccountBalance): Money {
  const debitPositive = b.accountType === 'asset' || b.accountType === 'expense';
  return debitPositive ? subMoney(b.debit, b.credit) : subMoney(b.credit, b.debit);
}

function toRows(balances: AccountBalance[], type: AccountBalance['accountType']) {
  const rows: StatementRow[] = [];
  let total: Money = 0n;
  for (const b of balances) {
    if (b.accountType !== type) continue;
    const amt = sectionAmount(b);
    total = addMoney(total, amt);
    if (amt !== 0n) {
      rows.push({ accountId: b.accountId, code: b.code, name: b.name, amount: formatMoney(amt) });
    }
  }
  return { rows, total };
}

export interface ProfitAndLoss {
  orgId: string;
  periodId: string;
  asOf: string;
  income: StatementRow[];
  expense: StatementRow[];
  totalIncome: string;
  totalExpense: string;
  netProfit: string; // ΣIncome − ΣExpense
}

export async function getProfitAndLoss(
  db: Database,
  orgId: string,
  periodId: string,
): Promise<ProfitAndLoss> {
  const { asOf, balances } = await postedBalancesAsOf(db, orgId, periodId);
  const income = toRows(balances, 'income');
  const expense = toRows(balances, 'expense');
  const netProfit = subMoney(income.total, expense.total);
  return {
    orgId,
    periodId,
    asOf,
    income: income.rows,
    expense: expense.rows,
    totalIncome: formatMoney(income.total),
    totalExpense: formatMoney(expense.total),
    netProfit: formatMoney(netProfit),
  };
}

export interface BalanceSheet {
  orgId: string;
  periodId: string;
  asOf: string;
  assets: StatementRow[];
  liabilities: StatementRow[];
  equity: StatementRow[];
  currentYearEarnings: string; // 计算式当期损益(ADR-0003)
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string; // 含 currentYearEarnings
  /** Assets === Liabilities + Equity(含当期损益)。恒应为 true。 */
  balanced: boolean;
}

export async function getBalanceSheet(
  db: Database,
  orgId: string,
  periodId: string,
): Promise<BalanceSheet> {
  const { asOf, balances } = await postedBalancesAsOf(db, orgId, periodId);
  const assets = toRows(balances, 'asset');
  const liabilities = toRows(balances, 'liability');
  const equity = toRows(balances, 'equity');
  const income = toRows(balances, 'income');
  const expense = toRows(balances, 'expense');
  const cye = subMoney(income.total, expense.total); // 当期损益

  const totalEquity = addMoney(equity.total, cye);
  const rhs = addMoney(liabilities.total, totalEquity);

  return {
    orgId,
    periodId,
    asOf,
    assets: assets.rows,
    liabilities: liabilities.rows,
    equity: equity.rows,
    currentYearEarnings: formatMoney(cye),
    totalAssets: formatMoney(assets.total),
    totalLiabilities: formatMoney(liabilities.total),
    totalEquity: formatMoney(totalEquity),
    balanced: eqMoney(assets.total, rhs),
  };
}
