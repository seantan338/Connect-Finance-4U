/** Integration — P&L + Balance Sheet(真库)。复用 invoice 过账产生的余额。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '@cf4u/db';
import {
  createInvoice,
  issueInvoice,
  createContact,
  createTaxCode,
  getProfitAndLoss,
  getBalanceSheet,
  getTrialBalance,
} from './index.js';
import { setupFixture, teardownFixture, type Fixture } from './test-helpers.js';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('financial statements', () => {
  let f: Fixture;
  let customerId: string;
  let supplierId: string;
  let sstId: string;
  let expenseAccId: string;

  beforeAll(async () => {
    f = await setupFixture();
    const sys: [string, string, 'asset' | 'liability' | 'expense', 'debit' | 'credit'][] = [
      ['1400', 'Trade Receivables', 'asset', 'debit'],
      ['2100', 'Trade Payables', 'liability', 'credit'],
      ['2200', 'SST Output Tax Payable', 'liability', 'credit'],
      ['1600', 'SST Input Tax Receivable', 'asset', 'debit'],
      ['5110', 'Purchases', 'expense', 'debit'],
    ];
    for (const [code, name, type, nb] of sys) {
      const [row] = await f.db
        .insert(accounts)
        .values({ orgId: f.orgId, code, name, accountType: type, normalBalance: nb })
        .returning({ id: accounts.id });
      if (code === '5110') expenseAccId = row!.id;
    }
    customerId = (await createContact(f.db, { orgId: f.orgId, kind: 'customer', name: 'Acme', actorUserId: f.userId })).id;
    supplierId = (await createContact(f.db, { orgId: f.orgId, kind: 'supplier', name: 'Bolt', actorUserId: f.userId })).id;
    sstId = (await createTaxCode(f.db, { orgId: f.orgId, code: 'SST-6', rate: '0.06' })).id;

    // sales 1000 + 6% SST;purchase (expense) 100 + 6% SST
    const s = await createInvoice(f.db, {
      orgId: f.orgId, direction: 'sales', invoiceNo: 'INV-1', contactId: customerId,
      issueDate: '2026-07-01', createdBy: f.userId,
      lines: [{ description: 'Sale', qty: '10', unitPrice: '100.00', accountId: f.salesAccountId, taxCodeId: sstId }],
    });
    await issueInvoice(f.db, { invoiceId: s.id, userId: f.userId });
    const p = await createInvoice(f.db, {
      orgId: f.orgId, direction: 'purchase', invoiceNo: 'BILL-1', contactId: supplierId,
      issueDate: '2026-07-02', createdBy: f.userId,
      lines: [{ description: 'Buy', qty: '5', unitPrice: '20.00', accountId: expenseAccId, taxCodeId: sstId }],
    });
    await issueInvoice(f.db, { invoiceId: p.id, userId: f.userId });
  });
  afterAll(async () => {
    if (f) await teardownFixture(f);
  });

  it('P&L: net profit = ΣIncome − ΣExpense', async () => {
    const pl = await getProfitAndLoss(f.db, f.orgId, f.openPeriodId);
    expect(pl.totalIncome).toBe('1000.0000'); // revenue net of SST
    expect(pl.totalExpense).toBe('100.0000');
    expect(pl.netProfit).toBe('900.0000');
    expect(pl.income.find((r) => r.code === '4100')?.amount).toBe('1000.0000');
    expect(pl.expense.find((r) => r.code === '5110')?.amount).toBe('100.0000');
  });

  it('Balance Sheet balances: Assets = Liabilities + Equity (incl. current year earnings)', async () => {
    const bs = await getBalanceSheet(f.db, f.orgId, f.openPeriodId);
    expect(bs.balanced).toBe(true);
    expect(bs.currentYearEarnings).toBe('900.0000');
    // Assets: AR 1060 + SST input 6 = 1066
    expect(bs.totalAssets).toBe('1066.0000');
    // Liabilities: AP 106 + SST output 60 = 166; Equity: 0 + CYE 900 = 900; 166+900 = 1066
    expect(bs.totalLiabilities).toBe('166.0000');
    expect(bs.totalEquity).toBe('900.0000');
  });

  it('trial balance still ties out alongside the statements', async () => {
    const tb = await getTrialBalance(f.db, f.orgId, f.openPeriodId);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});
