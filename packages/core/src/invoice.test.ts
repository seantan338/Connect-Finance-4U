/** Integration — invoicing + posting(真库,DATABASE_URL)。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '@cf4u/db';
import {
  createInvoice,
  issueInvoice,
  getTrialBalance,
  createContact,
  createTaxCode,
  InvalidInvoiceStateError,
  ClosedPeriodError,
  ConflictError,
} from './index.js';
import { setupFixture, teardownFixture, type Fixture } from './test-helpers.js';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('invoicing', () => {
  let f: Fixture;
  let customerId: string;
  let supplierId: string;
  let sstId: string;
  let expenseAccId: string; // 5110 Purchases

  beforeAll(async () => {
    f = await setupFixture();
    // 系统科目 + 一个费用科目(fixture 已有 1520 Bank、4100 Sales)
    const sys: [string, string, 'asset' | 'liability', 'debit' | 'credit'][] = [
      ['1400', 'Trade Receivables', 'asset', 'debit'],
      ['2100', 'Trade Payables', 'liability', 'credit'],
      ['2200', 'SST Output Tax Payable', 'liability', 'credit'],
      ['1600', 'SST Input Tax Receivable', 'asset', 'debit'],
      ['5110', 'Purchases', 'asset', 'debit'], // 用 expense 更准,这里 type 仅占位
    ];
    for (const [code, name, type, nb] of sys) {
      const [row] = await f.db
        .insert(accounts)
        .values({ orgId: f.orgId, code, name, accountType: code === '5110' ? 'expense' : type, normalBalance: nb })
        .returning({ id: accounts.id });
      if (code === '5110') expenseAccId = row!.id;
    }
    customerId = (await createContact(f.db, { orgId: f.orgId, kind: 'customer', name: 'Acme', actorUserId: f.userId })).id;
    supplierId = (await createContact(f.db, { orgId: f.orgId, kind: 'supplier', name: 'Bolt', actorUserId: f.userId })).id;
    sstId = (await createTaxCode(f.db, { orgId: f.orgId, code: 'SST-6', rate: '0.06' })).id;
  });
  afterAll(async () => {
    if (f) await teardownFixture(f);
  });

  it('computes subtotal/tax/grand on a sales invoice', async () => {
    const inv = await createInvoice(f.db, {
      orgId: f.orgId,
      direction: 'sales',
      invoiceNo: 'INV-1001',
      contactId: customerId,
      issueDate: '2026-07-01',
      createdBy: f.userId,
      lines: [
        { description: 'Widgets', qty: '10', unitPrice: '100.00', accountId: f.salesAccountId, taxCodeId: sstId },
      ],
    });
    expect(inv.subtotal).toBe('1000.0000');
    expect(inv.taxTotal).toBe('60.0000');
    expect(inv.grandTotal).toBe('1060.0000');
  });

  it('issues a sales invoice → posts Dr AR / Cr Revenue + Cr SST, trial balance stays balanced', async () => {
    const inv = await createInvoice(f.db, {
      orgId: f.orgId,
      direction: 'sales',
      invoiceNo: 'INV-1001-B',
      contactId: customerId,
      issueDate: '2026-07-01',
      createdBy: f.userId,
      lines: [
        { description: 'Widgets', qty: '10', unitPrice: '100.00', accountId: f.salesAccountId, taxCodeId: sstId },
      ],
    });
    const issued = await issueInvoice(f.db, { invoiceId: inv.id, userId: f.userId });
    expect(issued.entryNo).toBeGreaterThan(0);

    const tb = await getTrialBalance(f.db, f.orgId, f.openPeriodId);
    expect(tb.balanced).toBe(true);
    const ar = tb.rows.find((r) => r.code === '1400');
    const rev = tb.rows.find((r) => r.code === '4100');
    const sst = tb.rows.find((r) => r.code === '2200');
    expect(ar?.debit).toBe('1060.0000');
    expect(rev?.credit).toBe('1000.0000');
    expect(sst?.credit).toBe('60.0000');

    // 再 issue 一次 → 拒绝
    await expect(issueInvoice(f.db, { invoiceId: inv.id, userId: f.userId })).rejects.toBeInstanceOf(
      InvalidInvoiceStateError,
    );
  });

  it('issues a purchase invoice → Dr Expense + Dr SST Input / Cr AP, still balanced', async () => {
    const inv = await createInvoice(f.db, {
      orgId: f.orgId,
      direction: 'purchase',
      invoiceNo: 'BILL-2001',
      contactId: supplierId,
      issueDate: '2026-07-02',
      createdBy: f.userId,
      lines: [{ description: 'Stock', qty: '5', unitPrice: '20.00', accountId: expenseAccId, taxCodeId: sstId }],
    });
    expect(inv.grandTotal).toBe('106.0000');
    await issueInvoice(f.db, { invoiceId: inv.id, userId: f.userId });

    const tb = await getTrialBalance(f.db, f.orgId, f.openPeriodId);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.code === '2100')?.credit).toBe('106.0000');
    expect(tb.rows.find((r) => r.code === '5110')?.debit).toBe('100.0000');
    expect(tb.rows.find((r) => r.code === '1600')?.debit).toBe('6.0000');
  });

  it('decimal-safe tax rounding (99.99 @ 6% = 5.9994)', async () => {
    const inv = await createInvoice(f.db, {
      orgId: f.orgId,
      direction: 'sales',
      invoiceNo: 'INV-1002',
      contactId: customerId,
      issueDate: '2026-07-03',
      createdBy: f.userId,
      lines: [
        { description: 'Odd', qty: '3', unitPrice: '33.33', accountId: f.salesAccountId, taxCodeId: sstId },
      ],
    });
    expect(inv.subtotal).toBe('99.9900');
    expect(inv.taxTotal).toBe('5.9994');
    expect(inv.grandTotal).toBe('105.9894');
  });

  it('rejects issuing into a closed period and duplicate invoice_no', async () => {
    const inv = await createInvoice(f.db, {
      orgId: f.orgId,
      direction: 'sales',
      invoiceNo: 'INV-CLOSED',
      contactId: customerId,
      issueDate: '2025-06-15', // closed period
      createdBy: f.userId,
      lines: [{ description: 'x', qty: '1', unitPrice: '10.00', accountId: f.salesAccountId }],
    });
    await expect(issueInvoice(f.db, { invoiceId: inv.id, userId: f.userId })).rejects.toBeInstanceOf(
      ClosedPeriodError,
    );

    await expect(
      createInvoice(f.db, {
        orgId: f.orgId,
        direction: 'sales',
        invoiceNo: 'INV-1001',
        contactId: customerId,
        issueDate: '2026-07-04',
        createdBy: f.userId,
        lines: [{ description: 'dup', qty: '1', unitPrice: '10.00', accountId: f.salesAccountId }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
