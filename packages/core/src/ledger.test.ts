/**
 * Integration tests — 真库(DATABASE_URL)。覆盖:
 *   平衡通过 / 不平衡被拒 / 空 / 非法行 / 关账期间拒写 / post 生命周期 / trial balance 平账。
 * 没有 DATABASE_URL 时整套跳过(money.test.ts 仍会跑)。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createJournalEntry,
  postEntry,
  getTrialBalance,
  UnbalancedEntryError,
  EmptyEntryError,
  InvalidLineError,
  ClosedPeriodError,
  AlreadyPostedError,
} from './index.js';
import {
  setupFixture,
  teardownFixture,
  countEntries,
  isPosted,
  auditCount,
  type Fixture,
} from './test-helpers.js';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('ledger integration', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setupFixture();
  });
  afterAll(async () => {
    if (f) await teardownFixture(f);
  });

  const balancedLines = () => [
    { accountId: f.cashAccountId, debit: '100.00' },
    { accountId: f.salesAccountId, credit: '100.00' },
  ];

  it('creates a balanced draft entry (unposted)', async () => {
    const entry = await createJournalEntry(f.db, {
      orgId: f.orgId,
      entryDate: '2026-06-15',
      createdBy: f.userId,
      memo: 'cash sale',
      lines: balancedLines(),
    });
    expect(entry.entryNo).toBeGreaterThan(0);
    expect(entry.periodId).toBe(f.openPeriodId);
    expect(await isPosted(f.db, entry.id)).toBe(false);
  });

  it('rejects an unbalanced entry and writes nothing', async () => {
    const before = await countEntries(f.db, f.orgId);
    await expect(
      createJournalEntry(f.db, {
        orgId: f.orgId,
        entryDate: '2026-06-15',
        createdBy: f.userId,
        lines: [
          { accountId: f.cashAccountId, debit: '100.00' },
          { accountId: f.salesAccountId, credit: '90.00' },
        ],
      }),
    ).rejects.toBeInstanceOf(UnbalancedEntryError);
    expect(await countEntries(f.db, f.orgId)).toBe(before);
  });

  it('rejects empty and invalid lines', async () => {
    await expect(
      createJournalEntry(f.db, {
        orgId: f.orgId,
        entryDate: '2026-06-15',
        createdBy: f.userId,
        lines: [],
      }),
    ).rejects.toBeInstanceOf(EmptyEntryError);

    await expect(
      createJournalEntry(f.db, {
        orgId: f.orgId,
        entryDate: '2026-06-15',
        createdBy: f.userId,
        lines: [
          { accountId: f.cashAccountId, debit: '100.00', credit: '100.00' },
          { accountId: f.salesAccountId, credit: '100.00' },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidLineError);
  });

  it('refuses to write into a closed period', async () => {
    const before = await countEntries(f.db, f.orgId);
    // by explicit periodId
    await expect(
      createJournalEntry(f.db, {
        orgId: f.orgId,
        entryDate: '2025-06-15',
        periodId: f.closedPeriodId,
        createdBy: f.userId,
        lines: balancedLines(),
      }),
    ).rejects.toBeInstanceOf(ClosedPeriodError);
    // by entryDate falling in the closed period
    await expect(
      createJournalEntry(f.db, {
        orgId: f.orgId,
        entryDate: '2025-06-15',
        createdBy: f.userId,
        lines: balancedLines(),
      }),
    ).rejects.toBeInstanceOf(ClosedPeriodError);
    expect(await countEntries(f.db, f.orgId)).toBe(before);
  });

  it('posts a draft and is idempotent-guarded against double post', async () => {
    const entry = await createJournalEntry(f.db, {
      orgId: f.orgId,
      entryDate: '2026-06-15',
      createdBy: f.userId,
      lines: balancedLines(),
    });
    await postEntry(f.db, { entryId: entry.id, userId: f.userId });
    expect(await isPosted(f.db, entry.id)).toBe(true);

    await expect(postEntry(f.db, { entryId: entry.id, userId: f.userId })).rejects.toBeInstanceOf(
      AlreadyPostedError,
    );
    // 铁律 5:post 这步在 audit 留痕(update on journal_entries)
    expect(await auditCount(f.db, f.orgId, 'journal_entries', 'update')).toBeGreaterThan(0);
  });

  it('trial balance counts only posted entries and is balanced', async () => {
    // one more posted entry + one draft that must NOT show up
    const posted = await createJournalEntry(f.db, {
      orgId: f.orgId,
      entryDate: '2026-06-20',
      createdBy: f.userId,
      lines: [
        { accountId: f.cashAccountId, debit: '250.00' },
        { accountId: f.salesAccountId, credit: '250.00' },
      ],
    });
    await postEntry(f.db, { entryId: posted.id, userId: f.userId });

    await createJournalEntry(f.db, {
      orgId: f.orgId,
      entryDate: '2026-06-21',
      createdBy: f.userId,
      lines: [
        { accountId: f.cashAccountId, debit: '999.00' },
        { accountId: f.salesAccountId, credit: '999.00' },
      ],
    }); // left as draft

    const tb = await getTrialBalance(f.db, f.orgId, f.openPeriodId);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);

    const cash = tb.rows.find((r) => r.accountId === f.cashAccountId);
    const sales = tb.rows.find((r) => r.accountId === f.salesAccountId);
    expect(cash?.debit).toBe(sales?.credit); // 借方现金 == 贷方销售
    // draft 的 999 不计入(只算 posted)
    expect(Number(tb.totalDebit)).toBeLessThan(999);
  });
});
