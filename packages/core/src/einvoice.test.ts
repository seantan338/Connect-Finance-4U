/** Integration — MyInvois submission via MockMyInvoisTransport(真库)。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '@cf4u/db';
import {
  createInvoice,
  issueInvoice,
  createContact,
  createTaxCode,
  submitInvoiceToMyInvois,
  latestSubmissionForInvoice,
  MockMyInvoisTransport,
  validateForSubmission,
  buildMyInvoisDocument,
  EinvoiceValidationError,
  NotIssuedError,
  AlreadySubmittedError,
  type SupplierProfile,
} from './index.js';
import { setupFixture, teardownFixture, type Fixture } from './test-helpers.js';

const hasDb = !!process.env.DATABASE_URL;
const transport = new MockMyInvoisTransport();

const SUPPLIER: SupplierProfile = {
  msicCode: '62010',
  phone: '+60123456789',
  email: 'billing@demo.test',
  address: { lines: ['Lot 1, Jalan Demo'], city: 'JB', postcode: '80000', state: '01', countryCode: 'MYS' },
};

async function makeIssuedSalesInvoice(f: Fixture, invoiceNo: string, customerId: string, sstId: string) {
  const inv = await createInvoice(f.db, {
    orgId: f.orgId,
    direction: 'sales',
    invoiceNo,
    contactId: customerId,
    issueDate: '2026-07-01',
    createdBy: f.userId,
    lines: [
      { description: 'Widgets', qty: '10', unitPrice: '100.00', accountId: f.salesAccountId, taxCodeId: sstId, classification: '022' },
    ],
  });
  await issueInvoice(f.db, { invoiceId: inv.id, userId: f.userId });
  return inv.id;
}

describe.skipIf(!hasDb)('e-Invoice (MyInvois) submission — mock transport', () => {
  let f: Fixture;
  let customerId: string;
  let noTinCustomerId: string;
  let sstId: string;

  beforeAll(async () => {
    f = await setupFixture();
    // org needs a TIN for supplier validation
    const { organizations } = await import('@cf4u/db');
    const { eq } = await import('drizzle-orm');
    await f.db.update(organizations).set({ tin: 'C1234567890', brn: '202601000001' }).where(eq(organizations.id, f.orgId));
    // system accounts issueInvoice needs to post a sales invoice (fixture only has 1520/4100)
    await f.db.insert(accounts).values([
      { orgId: f.orgId, code: '1400', name: 'Trade Receivables', accountType: 'asset', normalBalance: 'debit' },
      { orgId: f.orgId, code: '2200', name: 'SST Output Tax', accountType: 'liability', normalBalance: 'credit' },
    ]);
    customerId = (await createContact(f.db, { orgId: f.orgId, kind: 'customer', name: 'Acme Bhd', tin: 'C9876543210', actorUserId: f.userId })).id;
    noTinCustomerId = (await createContact(f.db, { orgId: f.orgId, kind: 'customer', name: 'NoTIN Sdn', actorUserId: f.userId })).id;
    sstId = (await createTaxCode(f.db, { orgId: f.orgId, code: 'SST-6', rate: '0.06' })).id;
  });
  afterAll(async () => {
    if (f) await teardownFixture(f);
  });

  it('submits an issued sales invoice → valid, with UUID + QR persisted', async () => {
    const invoiceId = await makeIssuedSalesInvoice(f, 'INV-E1', customerId, sstId);
    const res = await submitInvoiceToMyInvois(f.db, { invoiceId, supplierProfile: SUPPLIER, transport });
    expect(res.status).toBe('valid');
    expect(res.myinvoisUuid).toMatch(/^MOCK-/);
    expect(res.qrUrl).toContain(res.myinvoisUuid!);

    const sub = await latestSubmissionForInvoice(f.db, invoiceId);
    expect(sub?.status).toBe('valid');
    expect(sub?.myinvoisUuid).toBe(res.myinvoisUuid);
  });

  it('rejects double submission', async () => {
    const invoiceId = await makeIssuedSalesInvoice(f, 'INV-E2', customerId, sstId);
    await submitInvoiceToMyInvois(f.db, { invoiceId, supplierProfile: SUPPLIER, transport });
    await expect(
      submitInvoiceToMyInvois(f.db, { invoiceId, supplierProfile: SUPPLIER, transport }),
    ).rejects.toBeInstanceOf(AlreadySubmittedError);
  });

  it('refuses to submit a draft (not issued)', async () => {
    const inv = await createInvoice(f.db, {
      orgId: f.orgId,
      direction: 'sales',
      invoiceNo: 'INV-E3',
      contactId: customerId,
      issueDate: '2026-07-02',
      createdBy: f.userId,
      lines: [{ description: 'x', qty: '1', unitPrice: '10.00', accountId: f.salesAccountId, classification: '022' }],
    });
    await expect(
      submitInvoiceToMyInvois(f.db, { invoiceId: inv.id, supplierProfile: SUPPLIER, transport }),
    ).rejects.toBeInstanceOf(NotIssuedError);
  });

  it('validation fails when buyer has no TIN', async () => {
    const invoiceId = await makeIssuedSalesInvoice(f, 'INV-E4', noTinCustomerId, sstId);
    await expect(
      submitInvoiceToMyInvois(f.db, { invoiceId, supplierProfile: SUPPLIER, transport }),
    ).rejects.toBeInstanceOf(EinvoiceValidationError);
  });

  it('payload builder maps doc type + totals (pure)', () => {
    const doc = buildMyInvoisDocument({
      invoice: { docType: 'credit_note', invoiceNo: 'CN-1', issueDate: '2026-07-01', currency: 'MYR', subtotal: '1000.0000', taxTotal: '60.0000', grandTotal: '1060.0000' },
      org: { tin: 'C1', brn: 'B1', sstNo: null, legalName: 'Demo' },
      supplierProfile: SUPPLIER,
      buyer: { tin: 'C2', brn: null, sstNo: null, name: 'Acme', email: null },
      lines: [{ id: 'L1', classification: '022', description: 'x', qty: '10', unitPrice: '100', lineTotal: '1000.0000', taxCategoryCode: '01', taxRatePercent: '6', taxAmount: '60.0000' }],
      issueTimeUtc: '00:00:00Z',
    });
    expect(doc.invoiceTypeCode).toBe('02');
    expect(doc.payableTotal).toBe('1060.0000');
    expect(() => validateForSubmission(doc)).not.toThrow();
  });
});
