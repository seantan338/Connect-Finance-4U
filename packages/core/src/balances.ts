/**
 * 共享:某 org 截至期末(as-at)的 posted 科目余额。trial balance 与三表都建在这上面。
 * 只看 posted(铁律 2);as-at 口径见 ADR-0002(entry_date <= period_end)。
 */
import { and, eq, lte, sql } from 'drizzle-orm';
import { type Database, accounts, fiscalPeriods, journalEntries, journalLines } from '@cf4u/db';
import { NoFiscalPeriodError } from './errors.js';
import { parseMoney, type Money } from './money.js';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: 'debit' | 'credit';
  debit: Money; // Σdebit
  credit: Money; // Σcredit
}

export interface PostedBalances {
  asOf: string; // period_end
  balances: AccountBalance[];
}

export async function postedBalancesAsOf(
  db: Database,
  orgId: string,
  periodId: string,
): Promise<PostedBalances> {
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
        lte(journalEntries.entryDate, asOf),
        eq(journalEntries.isPosted, true),
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

  return {
    asOf,
    balances: rows.map((r) => ({
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      accountType: r.accountType as AccountType,
      normalBalance: r.normalBalance as 'debit' | 'credit',
      debit: parseMoney(r.debit),
      credit: parseMoney(r.credit),
    })),
  };
}
