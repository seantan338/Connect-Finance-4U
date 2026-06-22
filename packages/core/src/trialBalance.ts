/**
 * Trial balance — 余额只从 POSTED journal_entries 推导(铁律 2)。
 * 汇总某期间每个 account 的 Σdebit / Σcredit,断言总额相等(铁律 3 的可观测体现)。
 */
import { and, eq, sql } from 'drizzle-orm';
import { type Database, accounts, journalEntries, journalLines } from '@cf4u/db';
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
        eq(journalEntries.periodId, periodId),
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
    rows: out,
    totalDebit: formatMoney(totalDebit),
    totalCredit: formatMoney(totalCredit),
    balanced: eqMoney(totalDebit, totalCredit),
  };
}
