/**
 * Trial balance — 余额只从 POSTED journal_entries 推导(铁律 2),as-at 口径(ADR-0002)。
 * 汇总截至期末每个 account 的累计 Σdebit / Σcredit,断言总额相等。
 */
import { type Database } from '@cf4u/db';
import { postedBalancesAsOf } from './balances.js';
import { eqMoney, formatMoney, subMoney, sumMoney, type Money } from './money.js';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  normalBalance: string;
  debit: string; // Σdebit (scale 4 string)
  credit: string; // Σcredit
}

export interface TrialBalance {
  orgId: string;
  periodId: string;
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebit: string;
  totalCredit: string;
  /** Σdebit === Σcredit。posted 凭证恒平,这里恒应为 true。 */
  balanced: boolean;
}

export async function getTrialBalance(
  db: Database,
  orgId: string,
  periodId: string,
): Promise<TrialBalance> {
  const { asOf, balances } = await postedBalancesAsOf(db, orgId, periodId);

  const debits: Money[] = [];
  const credits: Money[] = [];
  const rows: TrialBalanceRow[] = balances.map((b) => {
    debits.push(b.debit);
    credits.push(b.credit);
    return {
      accountId: b.accountId,
      code: b.code,
      name: b.name,
      accountType: b.accountType,
      normalBalance: b.normalBalance,
      debit: formatMoney(b.debit),
      credit: formatMoney(b.credit),
    };
  });

  const totalDebit = sumMoney(debits);
  const totalCredit = sumMoney(credits);

  return {
    orgId,
    periodId,
    asOf,
    rows,
    totalDebit: formatMoney(totalDebit),
    totalCredit: formatMoney(totalCredit),
    balanced: eqMoney(subMoney(totalDebit, totalCredit), 0n),
  };
}
