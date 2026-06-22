/**
 * Journal posting — 铁律 3 应用层防线(第 3 层)。
 *
 *   createJournalEntry  落库一张 balanced draft(is_posted=false)
 *   postEntry           draft → posted,DB 的 trg_balanced_on_post 在 commit 时做最后兜底
 *
 * 平账用 money.ts 的整数运算,绝不用 JS number。写操作都在 withAuditContext 里跑,
 * 让 write_audit() 记到操作人名下(铁律 5)。
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  type Database,
  withAuditContext,
  accounts,
  fiscalPeriods,
  journalEntries,
  journalLines,
} from '@cf4u/db';
import {
  AlreadyPostedError,
  ClosedPeriodError,
  EmptyEntryError,
  EntryNotFoundError,
  InvalidAccountError,
  InvalidLineError,
  NoFiscalPeriodError,
  UnbalancedEntryError,
} from './errors.js';
import {
  applyRate,
  eqMoney,
  formatMoney,
  type Money,
  parseMoney,
  subMoney,
  sumMoney,
} from './money.js';

export type JournalSource = 'manual' | 'invoice' | 'payment' | 'bank' | 'system';

export interface JournalLineInput {
  accountId: string;
  /** decimal string preferred, e.g. "100.00". 一行只能借或贷之一 > 0。 */
  debit?: string | number;
  credit?: string | number;
  currency?: string; // default 'MYR'
  fxRate?: string | number; // default '1'
  lineMemo?: string;
}

export interface CreateJournalEntryInput {
  orgId: string;
  entryDate: string; // 'YYYY-MM-DD'
  /** 指定期间;省略则按 entryDate 落到覆盖它的 open period。 */
  periodId?: string;
  memo?: string;
  source?: JournalSource;
  createdBy: string; // app_users.id,同时作为 audit actor
  ip?: string;
  lines: JournalLineInput[];
}

interface PreparedLine {
  accountId: string;
  debit: Money;
  credit: Money;
  currency: string;
  fxRate: string;
  baseAmount: Money;
  lineMemo?: string;
}

/** 逐行校验 + 平衡校验(纯函数,不碰 DB)。balanced 才返回 prepared lines。 */
export function prepareAndValidate(lines: JournalLineInput[]): {
  prepared: PreparedLine[];
  totalDebit: Money;
  totalCredit: Money;
} {
  if (lines.length === 0) throw new EmptyEntryError();

  const prepared: PreparedLine[] = lines.map((l, i) => {
    const debit = parseMoney(l.debit ?? '0');
    const credit = parseMoney(l.credit ?? '0');
    if (debit < 0n || credit < 0n) {
      throw new InvalidLineError(`line ${i}: debit/credit must be >= 0`);
    }
    if (debit > 0n && credit > 0n) {
      throw new InvalidLineError(`line ${i}: a line cannot be both debit and credit`);
    }
    if (debit === 0n && credit === 0n) {
      throw new InvalidLineError(`line ${i}: a line must have a non-zero debit or credit`);
    }
    const fxRate = String(l.fxRate ?? '1');
    return {
      accountId: l.accountId,
      debit,
      credit,
      currency: l.currency ?? 'MYR',
      fxRate,
      baseAmount: applyRate(subMoney(debit, credit), fxRate),
      lineMemo: l.lineMemo,
    };
  });

  const totalDebit = sumMoney(prepared.map((p) => p.debit));
  const totalCredit = sumMoney(prepared.map((p) => p.credit));
  if (!eqMoney(totalDebit, totalCredit)) {
    throw new UnbalancedEntryError(formatMoney(totalDebit), formatMoney(totalCredit));
  }
  if (totalDebit === 0n) throw new EmptyEntryError();

  return { prepared, totalDebit, totalCredit };
}

async function resolveOpenPeriod(
  tx: Database,
  orgId: string,
  periodId: string | undefined,
  entryDate: string,
): Promise<{ id: string; status: string }> {
  const rows = periodId
    ? await tx
        .select({ id: fiscalPeriods.id, status: fiscalPeriods.status })
        .from(fiscalPeriods)
        .where(and(eq(fiscalPeriods.id, periodId), eq(fiscalPeriods.orgId, orgId)))
    : await tx
        .select({ id: fiscalPeriods.id, status: fiscalPeriods.status })
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.orgId, orgId),
            sql`${fiscalPeriods.periodStart} <= ${entryDate}`,
            sql`${fiscalPeriods.periodEnd} >= ${entryDate}`,
          ),
        );

  const period = rows[0];
  if (!period) throw new NoFiscalPeriodError(periodId ?? entryDate);
  if (period.status !== 'open') throw new ClosedPeriodError(period.status);
  return period;
}

async function assertAccountsValid(tx: Database, orgId: string, accountIds: string[]): Promise<void> {
  const ids = [...new Set(accountIds)];
  const rows = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.isActive, true), inArray(accounts.id, ids)));
  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => r.id));
    const bad = ids.filter((id) => !found.has(id));
    throw new InvalidAccountError(`accounts not in org / inactive: ${bad.join(', ')}`);
  }
}

export interface CreatedEntry {
  id: string;
  entryNo: number;
  periodId: string;
}

export async function createJournalEntry(
  db: Database,
  input: CreateJournalEntryInput,
): Promise<CreatedEntry> {
  // 应用层平衡校验先行,不平直接拒(不依赖 DB 报错兜底)。
  const { prepared } = prepareAndValidate(input.lines);

  return withAuditContext(db, { userId: input.createdBy, ip: input.ip }, async (tx) => {
    // 串行化每个 org 的 entry_no 分配,避免并发撞 UNIQUE(org_id, entry_no)。
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.orgId}))`);

    const period = await resolveOpenPeriod(tx, input.orgId, input.periodId, input.entryDate);
    await assertAccountsValid(tx, input.orgId, prepared.map((p) => p.accountId));

    const [seq] = await tx
      .select({ next: sql<number>`COALESCE(MAX(${journalEntries.entryNo}), 0) + 1` })
      .from(journalEntries)
      .where(eq(journalEntries.orgId, input.orgId));
    const nextNo = Number(seq!.next);

    const [entry] = await tx
      .insert(journalEntries)
      .values({
        orgId: input.orgId,
        entryNo: nextNo,
        entryDate: input.entryDate,
        periodId: period.id,
        memo: input.memo,
        source: input.source ?? 'manual',
        isPosted: false,
        createdBy: input.createdBy,
      })
      .returning({ id: journalEntries.id, entryNo: journalEntries.entryNo });

    await tx.insert(journalLines).values(
      prepared.map((p) => ({
        entryId: entry!.id,
        accountId: p.accountId,
        debit: formatMoney(p.debit),
        credit: formatMoney(p.credit),
        currency: p.currency,
        fxRate: p.fxRate,
        baseAmount: formatMoney(p.baseAmount),
        lineMemo: p.lineMemo,
      })),
    );

    return { id: entry!.id, entryNo: Number(entry!.entryNo), periodId: period.id };
  });
}

export interface PostEntryInput {
  entryId: string;
  userId: string; // audit actor
  ip?: string;
}

export async function postEntry(db: Database, input: PostEntryInput): Promise<void> {
  await withAuditContext(db, { userId: input.userId, ip: input.ip }, async (tx) => {
    const [entry] = await tx
      .select({
        id: journalEntries.id,
        orgId: journalEntries.orgId,
        periodId: journalEntries.periodId,
        isPosted: journalEntries.isPosted,
      })
      .from(journalEntries)
      .where(eq(journalEntries.id, input.entryId))
      .for('update');

    if (!entry) throw new EntryNotFoundError(input.entryId);
    if (entry.isPosted) throw new AlreadyPostedError(input.entryId);

    // 期间必须仍 open
    const [period] = await tx
      .select({ status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.id, entry.periodId));
    if (!period) throw new NoFiscalPeriodError(entry.periodId);
    if (period.status !== 'open') throw new ClosedPeriodError(period.status);

    // 过账前应用层再算一遍平衡(防 draft 落库后被人改过 lines)。
    const lines = await tx
      .select({ debit: journalLines.debit, credit: journalLines.credit })
      .from(journalLines)
      .where(eq(journalLines.entryId, input.entryId));
    if (lines.length === 0) throw new EmptyEntryError();

    const totalDebit = sumMoney(lines.map((l) => parseMoney(l.debit)));
    const totalCredit = sumMoney(lines.map((l) => parseMoney(l.credit)));
    if (!eqMoney(totalDebit, totalCredit)) {
      throw new UnbalancedEntryError(formatMoney(totalDebit), formatMoney(totalCredit));
    }
    if (totalDebit === 0n) throw new EmptyEntryError();

    await tx
      .update(journalEntries)
      .set({ isPosted: true })
      .where(eq(journalEntries.id, input.entryId));
    // commit 时 trg_balanced_on_post 做最后兜底(铁律 3 · DB 防线 2)。
  });
}
