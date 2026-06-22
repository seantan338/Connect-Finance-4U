/**
 * Invoicing(铁律 4:含 doc_type credit_note/debit_note/self_billed)+ 过账。
 *
 *   createInvoice  落库 draft 发票:行 × tax_code 算 subtotal/tax/grand。
 *   issueInvoice   draft → issued,过账生成 journal_entry 并回填 journal_entry_id。
 *                  余额随分录派生,绝不直接写余额(铁律 2)。
 *
 * 标准记账方向(系统科目按 code 解析,收入/费用科目由 invoice line 指定):
 *   sales    : Dr Trade Receivables(1400) / Cr Revenue(line.account) + Cr SST Output(2200)
 *   purchase : Dr Expense|Inventory(line.account) + Dr SST Input(1600) / Cr Trade Payables(2100)
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  type Database,
  withAuditContext,
  accounts,
  contacts,
  invoices,
  invoiceLines,
  taxCodes,
} from '@cf4u/db';
import {
  ConflictError,
  InvalidAccountError,
  InvalidInvoiceStateError,
  InvoiceNotFoundError,
  ValidationError,
} from './errors.js';
import { isUniqueViolation } from './pgError.js';
import {
  allocateAndInsertEntry,
  prepareAndValidate,
  resolveOpenPeriod,
  type JournalLineInput,
} from './journal.js';
import { addMoney, applyRate, formatMoney, mulMoney, parseMoney, type Money } from './money.js';

export type InvoiceDirection = 'sales' | 'purchase';
export type InvoiceDocType = 'invoice' | 'credit_note' | 'debit_note' | 'self_billed';

// 系统科目(MPERS 模板 code)。多租户后可做成 org 级可配置映射。
const SYS = { ar: '1400', ap: '2100', sstOutput: '2200', sstInput: '1600' } as const;

export interface InvoiceLineInput {
  description: string;
  qty?: string | number; // default 1
  unitPrice: string | number;
  accountId: string; // revenue(sales) / expense|inventory(purchase)
  taxCodeId?: string;
  classification?: string;
}

export interface CreateInvoiceInput {
  orgId: string;
  direction: InvoiceDirection;
  docType?: InvoiceDocType;
  invoiceNo: string;
  contactId: string;
  issueDate: string;
  currency?: string; // default 'MYR'
  createdBy: string;
  ip?: string;
  lines: InvoiceLineInput[];
}

export interface CreatedInvoice {
  id: string;
  invoiceNo: string;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
}

export async function createInvoice(db: Database, input: CreateInvoiceInput): Promise<CreatedInvoice> {
  if (!(['sales', 'purchase'] as const).includes(input.direction)) {
    throw new ValidationError(`invalid direction: ${input.direction}`);
  }
  if (!input.invoiceNo?.trim()) throw new ValidationError('invoice_no is required');
  if (!input.lines || input.lines.length === 0) throw new ValidationError('invoice has no lines');
  const currency = input.currency ?? 'MYR';

  return withAuditContext(db, { userId: input.createdBy, ip: input.ip }, async (tx) => {
    // contact 必须属于该 org,且 kind 与方向相符
    const [contact] = await tx
      .select({ kind: contacts.kind })
      .from(contacts)
      .where(and(eq(contacts.id, input.contactId), eq(contacts.orgId, input.orgId)));
    if (!contact) throw new ValidationError('contact not found in org');
    const wantKind = input.direction === 'sales' ? 'customer' : 'supplier';
    if (contact.kind !== wantKind && contact.kind !== 'both') {
      throw new ValidationError(`contact kind ${contact.kind} not valid for ${input.direction}`);
    }

    // 行上的收入/费用科目必须属于该 org 且 active
    const lineAccountIds = [...new Set(input.lines.map((l) => l.accountId))];
    const acctRows = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(eq(accounts.orgId, input.orgId), eq(accounts.isActive, true), inArray(accounts.id, lineAccountIds)),
      );
    if (acctRows.length !== lineAccountIds.length) {
      throw new InvalidAccountError('one or more line accounts not in org / inactive');
    }

    // tax codes → rate map
    const taxIds = [...new Set(input.lines.map((l) => l.taxCodeId).filter(Boolean) as string[])];
    const rateMap = new Map<string, string>();
    if (taxIds.length > 0) {
      const tcs = await tx
        .select({ id: taxCodes.id, rate: taxCodes.rate })
        .from(taxCodes)
        .where(and(eq(taxCodes.orgId, input.orgId), inArray(taxCodes.id, taxIds)));
      if (tcs.length !== taxIds.length) throw new ValidationError('unknown tax code');
      for (const t of tcs) rateMap.set(t.id, t.rate);
    }

    // 逐行算 line_total(净额)与税额
    let subtotal: Money = 0n;
    let taxTotal: Money = 0n;
    const preparedLines = input.lines.map((l) => {
      const qty = parseMoney(l.qty ?? '1');
      const unit = parseMoney(l.unitPrice);
      if (qty <= 0n) throw new ValidationError('qty must be > 0');
      if (unit < 0n) throw new ValidationError('unit_price must be >= 0');
      const lineTotal = mulMoney(qty, unit);
      const rate = l.taxCodeId ? rateMap.get(l.taxCodeId)! : '0';
      const lineTax = applyRate(lineTotal, rate);
      subtotal = addMoney(subtotal, lineTotal);
      taxTotal = addMoney(taxTotal, lineTax);
      return {
        description: l.description,
        classification: l.classification,
        qty: formatMoney(qty),
        unitPrice: formatMoney(unit),
        accountId: l.accountId,
        taxCodeId: l.taxCodeId,
        lineTotal: formatMoney(lineTotal),
      };
    });
    const grandTotal = addMoney(subtotal, taxTotal);
    if (grandTotal <= 0n) throw new ValidationError('invoice grand total must be > 0');

    try {
      const [inv] = await tx
        .insert(invoices)
        .values({
          orgId: input.orgId,
          direction: input.direction,
          docType: input.docType ?? 'invoice',
          invoiceNo: input.invoiceNo.trim(),
          contactId: input.contactId,
          issueDate: input.issueDate,
          currency,
          subtotal: formatMoney(subtotal),
          taxTotal: formatMoney(taxTotal),
          grandTotal: formatMoney(grandTotal),
          status: 'draft',
        })
        .returning({ id: invoices.id });

      await tx.insert(invoiceLines).values(
        preparedLines.map((p) => ({
          invoiceId: inv!.id,
          description: p.description,
          classification: p.classification,
          qty: p.qty,
          unitPrice: p.unitPrice,
          accountId: p.accountId,
          taxCodeId: p.taxCodeId,
          lineTotal: p.lineTotal,
        })),
      );

      return {
        id: inv!.id,
        invoiceNo: input.invoiceNo.trim(),
        subtotal: formatMoney(subtotal),
        taxTotal: formatMoney(taxTotal),
        grandTotal: formatMoney(grandTotal),
      };
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(`invoice_no already exists: ${input.invoiceNo}`);
      throw e;
    }
  });
}

export interface InvoiceListRow {
  id: string;
  direction: InvoiceDirection;
  docType: InvoiceDocType;
  invoiceNo: string;
  contactName: string;
  issueDate: string;
  currency: string;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  status: string;
  journalEntryId: string | null;
}

export async function listInvoices(db: Database, orgId: string): Promise<InvoiceListRow[]> {
  const rows = await db
    .select({
      id: invoices.id,
      direction: invoices.direction,
      docType: invoices.docType,
      invoiceNo: invoices.invoiceNo,
      contactName: contacts.name,
      issueDate: invoices.issueDate,
      currency: invoices.currency,
      subtotal: invoices.subtotal,
      taxTotal: invoices.taxTotal,
      grandTotal: invoices.grandTotal,
      status: invoices.status,
      journalEntryId: invoices.journalEntryId,
    })
    .from(invoices)
    .innerJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(eq(invoices.orgId, orgId))
    .orderBy(invoices.issueDate);
  return rows as InvoiceListRow[];
}

async function resolveSystemAccount(tx: Database, orgId: string, code: string): Promise<string> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.code, code), eq(accounts.isActive, true)));
  if (!row) throw new InvalidAccountError(`missing system account ${code} (seed the MPERS CoA)`);
  return row.id;
}

export interface IssueInvoiceInput {
  invoiceId: string;
  userId: string;
  ip?: string;
}

export interface IssuedInvoice {
  journalEntryId: string;
  entryNo: number;
}

export async function issueInvoice(db: Database, input: IssueInvoiceInput): Promise<IssuedInvoice> {
  return withAuditContext(db, { userId: input.userId, ip: input.ip }, async (tx) => {
    const [inv] = await tx
      .select({
        id: invoices.id,
        orgId: invoices.orgId,
        direction: invoices.direction,
        invoiceNo: invoices.invoiceNo,
        issueDate: invoices.issueDate,
        currency: invoices.currency,
        taxTotal: invoices.taxTotal,
        grandTotal: invoices.grandTotal,
        status: invoices.status,
      })
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .for('update');
    if (!inv) throw new InvoiceNotFoundError(input.invoiceId);
    if (inv.status !== 'draft') throw new InvalidInvoiceStateError(inv.status);

    const period = await resolveOpenPeriod(tx, inv.orgId, undefined, inv.issueDate);

    const lines = await tx
      .select({ accountId: invoiceLines.accountId, lineTotal: invoiceLines.lineTotal })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, inv.id));

    const taxTotal = parseMoney(inv.taxTotal);
    const jlines: JournalLineInput[] = [];

    if (inv.direction === 'sales') {
      const ar = await resolveSystemAccount(tx, inv.orgId, SYS.ar);
      jlines.push({ accountId: ar, debit: inv.grandTotal, currency: inv.currency });
      for (const l of lines)
        jlines.push({ accountId: l.accountId, credit: l.lineTotal, currency: inv.currency });
      if (taxTotal > 0n) {
        const out = await resolveSystemAccount(tx, inv.orgId, SYS.sstOutput);
        jlines.push({ accountId: out, credit: inv.taxTotal, currency: inv.currency });
      }
    } else {
      for (const l of lines)
        jlines.push({ accountId: l.accountId, debit: l.lineTotal, currency: inv.currency });
      if (taxTotal > 0n) {
        const inp = await resolveSystemAccount(tx, inv.orgId, SYS.sstInput);
        jlines.push({ accountId: inp, debit: inv.taxTotal, currency: inv.currency });
      }
      const ap = await resolveSystemAccount(tx, inv.orgId, SYS.ap);
      jlines.push({ accountId: ap, credit: inv.grandTotal, currency: inv.currency });
    }

    // 应用层平衡校验(AR = Σrevenue + tax,理应恒平);不平直接拒。
    const { prepared } = prepareAndValidate(jlines);

    const entry = await allocateAndInsertEntry(
      tx,
      {
        orgId: inv.orgId,
        entryDate: inv.issueDate,
        periodId: period.id,
        memo: `${inv.direction} invoice ${inv.invoiceNo}`,
        source: 'invoice',
        sourceId: inv.id,
        createdBy: input.userId,
      },
      prepared,
      true, // 直接 posted,trg_balanced_on_post 在 commit 兜底
    );

    await tx
      .update(invoices)
      .set({ status: 'issued', journalEntryId: entry.id })
      .where(eq(invoices.id, inv.id));

    return { journalEntryId: entry.id, entryNo: entry.entryNo };
  });
}
