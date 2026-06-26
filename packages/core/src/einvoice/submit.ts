/**
 * 提交 issued 发票到 MyInvois(经 transport:mock 或真 http)。
 * 写 einvoice_submissions 状态机:pending → valid/invalid/rejected。
 * 余额/账目不动(铁律 2);这里只产合规提交记录(铁律 4)。
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  type Database,
  contacts,
  einvoiceSubmissions,
  invoices,
  invoiceLines,
  organizations,
  taxCodes,
} from '@cf4u/db';
import {
  AlreadySubmittedError,
  InvoiceNotFoundError,
  NotIssuedError,
  NotSubmittableError,
} from '../errors.js';
import { applyRate, formatMoney, parseMoney } from '../money.js';
import { buildMyInvoisDocument, validateForSubmission, type BuildInput } from './payload.js';
import { canonicalJson, sha256Hex, toBase64 } from './hash.js';
import type { DocStatus, MyInvoisTransport, SupplierProfile } from './types.js';

const SANDBOX_PORTAL = 'https://preprod.myinvois.hasil.gov.my';

const STATUS_MAP: Record<DocStatus, 'pending' | 'valid' | 'invalid' | 'cancelled'> = {
  Submitted: 'pending',
  Valid: 'valid',
  Invalid: 'invalid',
  Cancelled: 'cancelled',
};

export interface SubmitOptions {
  invoiceId: string;
  supplierProfile: SupplierProfile;
  transport: MyInvoisTransport;
  portalBase?: string;
}

export interface SubmissionResult {
  submissionId: string;
  status: string;
  myinvoisUuid: string | null;
  qrUrl: string | null;
}

export async function submitInvoiceToMyInvois(
  db: Database,
  opts: SubmitOptions,
): Promise<SubmissionResult> {
  const [inv] = await db
    .select({
      id: invoices.id,
      orgId: invoices.orgId,
      direction: invoices.direction,
      docType: invoices.docType,
      invoiceNo: invoices.invoiceNo,
      contactId: invoices.contactId,
      issueDate: invoices.issueDate,
      currency: invoices.currency,
      subtotal: invoices.subtotal,
      taxTotal: invoices.taxTotal,
      grandTotal: invoices.grandTotal,
      status: invoices.status,
    })
    .from(invoices)
    .where(eq(invoices.id, opts.invoiceId));
  if (!inv) throw new InvoiceNotFoundError(opts.invoiceId);
  if (inv.status !== 'issued') throw new NotIssuedError(inv.status);
  // 普通采购发票应由供应商提交;我们只提交 sales 与 self-billed。
  if (inv.direction === 'purchase' && inv.docType !== 'self_billed') {
    throw new NotSubmittableError('purchase invoices are submitted by the supplier (unless self-billed)');
  }

  const existing = await db
    .select({ status: einvoiceSubmissions.status })
    .from(einvoiceSubmissions)
    .where(
      and(
        eq(einvoiceSubmissions.invoiceId, inv.id),
        inArray(einvoiceSubmissions.status, ['pending', 'valid']),
      ),
    );
  if (existing[0]) throw new AlreadySubmittedError(existing[0].status);

  const [org] = await db
    .select({ tin: organizations.tin, brn: organizations.brn, sstNo: organizations.sstNo, legalName: organizations.legalName })
    .from(organizations)
    .where(eq(organizations.id, inv.orgId));
  const [buyer] = await db
    .select({ tin: contacts.tin, brn: contacts.brn, sstNo: contacts.sstNo, name: contacts.name, email: contacts.email, address: contacts.address })
    .from(contacts)
    .where(eq(contacts.id, inv.contactId));

  const lineRows = await db
    .select({
      id: invoiceLines.id,
      classification: invoiceLines.classification,
      description: invoiceLines.description,
      qty: invoiceLines.qty,
      unitPrice: invoiceLines.unitPrice,
      lineTotal: invoiceLines.lineTotal,
      rate: taxCodes.rate,
    })
    .from(invoiceLines)
    .leftJoin(taxCodes, eq(taxCodes.id, invoiceLines.taxCodeId))
    .where(eq(invoiceLines.invoiceId, inv.id));

  const lines: BuildInput['lines'] = lineRows.map((l) => {
    const rate = l.rate ?? '0';
    const taxable = parseMoney(l.lineTotal);
    const taxAmount = applyRate(taxable, rate);
    const ratePct = (Number(rate) * 100).toString();
    const hasTax = parseMoney(rate) > 0n;
    return {
      id: l.id,
      classification: l.classification,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      taxCategoryCode: hasTax ? '01' : '06', // G6 fallback
      taxRatePercent: ratePct,
      taxAmount: formatMoney(taxAmount),
    };
  });

  const issueTimeUtc = new Date().toISOString().slice(11, 19) + 'Z';
  const doc = buildMyInvoisDocument({
    invoice: {
      docType: inv.docType as BuildInput['invoice']['docType'],
      invoiceNo: inv.invoiceNo,
      issueDate: inv.issueDate,
      currency: inv.currency,
      subtotal: inv.subtotal,
      taxTotal: inv.taxTotal,
      grandTotal: inv.grandTotal,
    },
    org: org!,
    supplierProfile: opts.supplierProfile,
    buyer: { ...buyer!, address: buyer!.address ?? undefined },
    lines,
    issueTimeUtc,
  });

  validateForSubmission(doc); // 缺字段直接抛,不发请求

  const canonical = canonicalJson(doc);
  const documentHash = sha256Hex(canonical);
  const document = toBase64(canonical);

  const [row] = await db
    .insert(einvoiceSubmissions)
    .values({
      orgId: inv.orgId,
      invoiceId: inv.id,
      channel: 'api',
      status: 'pending',
      payload: doc,
      submittedAt: new Date(),
    })
    .returning({ id: einvoiceSubmissions.id });
  const submissionId = row!.id;

  const res = await opts.transport.submit([
    { codeNumber: inv.invoiceNo, format: 'JSON', document, documentHash },
  ]);

  if (res.rejected.length > 0 || res.accepted.length === 0) {
    await db
      .update(einvoiceSubmissions)
      .set({ status: 'rejected', submissionUid: res.submissionUid, validation: { rejected: res.rejected } })
      .where(eq(einvoiceSubmissions.id, submissionId));
    return { submissionId, status: 'rejected', myinvoisUuid: null, qrUrl: null };
  }

  const accepted = res.accepted[0]!;
  await db
    .update(einvoiceSubmissions)
    .set({ myinvoisUuid: accepted.uuid, submissionUid: res.submissionUid })
    .where(eq(einvoiceSubmissions.id, submissionId));

  // 轮询一次状态(真实环境可能要重试到 Valid)
  const st = await opts.transport.getStatus(accepted.uuid);
  const mapped = STATUS_MAP[st.status];
  const longId = accepted.longId ?? st.longId;
  const qrUrl =
    mapped === 'valid' && longId
      ? `${opts.portalBase ?? SANDBOX_PORTAL}/${accepted.uuid}/share/${longId}`
      : null;

  await db
    .update(einvoiceSubmissions)
    .set({
      status: mapped,
      validation: (st.validation ?? null) as object | null,
      qrUrl,
      validatedAt: mapped === 'valid' || mapped === 'invalid' ? new Date() : null,
    })
    .where(eq(einvoiceSubmissions.id, submissionId));

  return { submissionId, status: mapped, myinvoisUuid: accepted.uuid, qrUrl };
}

export interface SubmissionRow {
  id: string;
  invoiceId: string;
  status: string;
  myinvoisUuid: string | null;
  qrUrl: string | null;
  submittedAt: Date | null;
}

export async function latestSubmissionForInvoice(
  db: Database,
  invoiceId: string,
): Promise<SubmissionRow | null> {
  const rows = await db
    .select({
      id: einvoiceSubmissions.id,
      invoiceId: einvoiceSubmissions.invoiceId,
      status: einvoiceSubmissions.status,
      myinvoisUuid: einvoiceSubmissions.myinvoisUuid,
      qrUrl: einvoiceSubmissions.qrUrl,
      submittedAt: einvoiceSubmissions.submittedAt,
    })
    .from(einvoiceSubmissions)
    .where(eq(einvoiceSubmissions.invoiceId, invoiceId))
    .orderBy(sql`${einvoiceSubmissions.submittedAt} DESC NULLS LAST`)
    .limit(1);
  return rows[0] ?? null;
}
