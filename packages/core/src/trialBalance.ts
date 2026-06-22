/**
 * Trial balance — 余额只从 POSTED journal_entries 推导(铁律 2)。
 * as-at 口径(ADR-0002):汇总截至该 period 期末(entry_date <= period_end)的所有
 * posted 分录的累计 Σdebit / Σcredit,断言总额相等(铁律 3 的可观测体现)。
 */
import { and, eq, lte, sql } from 'drizzle-orm';
import { type Database, accounts, fiscalPeriods, journalEntries, journalLines } from '@cf4u/db';
import { NoFiscalPeriodError } from './errors.js';
import { eqMoney, formatMoney, parseMoney, sumMoney, type Money } from './money.js';

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
  asOf: string; // period_end:余额截至此日
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
  const [period] = await db
    .select({ end: fiscalPeriods.periodEnd })
    .from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.orgId, orgId)));
  if (!period) throw new NoFiscalPeriodError(periodId);
  const asOf = period.end;

  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      accountType: accounts.accountType,
      normalBalance: accounts.normalBalance,
      debit: sql<string>`COALESCE(SUM(${journalLines.debit}), 0)`,
      credit: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.orgId, orgId),
        lte(journalEntries.entryDate, asOf), // as-at 期末累计
        eq(journalEntries.isPosted, true), // 铁律 2:只看 posted
      ),
    )
    .groupBy(
      accounts.id,
      accounts.code,
      accounts.name,
      accounts.accountType,
      accounts.normalBalance,
    )
    .orderBy(accounts.code);

  const debits: Money[] = [];
  const credits: Money[] = [];
  const out: TrialBalanceRow[] = rows.map((r) => {
    const d = parseMoney(r.debit);
    const c = parseMoney(r.credit);
    debits.push(d);
    credits.push(c);
    return {
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      accountType: r.accountType,
      normalBalance: r.normalBalance,
      debit: formatMoney(d),
      credit: formatMoney(c),
    };
  });

  const totalDebit = sumMoney(debits);
  const totalCredit = sumMoney(credits);

  return {
    orgId,
    periodId,
    asOf,
    rows: out,
    totalDebit: formatMoney(totalDebit),
    totalCredit: formatMoney(totalCredit),
    balanced: eqMoney(totalDebit, totalCredit),
  };
}
