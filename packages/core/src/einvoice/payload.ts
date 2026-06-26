/**
 * 构造 + 校验 MyInvois 文档(纯函数,不碰 DB)。字段映射见 docs/compliance-einvoice.md。
 */
import { EinvoiceValidationError } from '../errors.js';
import type { InvoiceTypeCode, MyInvoisDocument, Party, SupplierProfile } from './types.js';

export interface BuildInput {
  invoice: {
    docType: 'invoice' | 'credit_note' | 'debit_note' | 'self_billed';
    invoiceNo: string;
    issueDate: string; // YYYY-MM-DD
    currency: string;
    subtotal: string;
    taxTotal: string;
    grandTotal: string;
  };
  org: { tin: string | null; brn: string | null; sstNo: string | null; legalName: string };
  supplierProfile: SupplierProfile;
  buyer: {
    tin: string | null;
    brn: string | null;
    sstNo: string | null;
    name: string;
    email: string | null;
    address?: unknown;
  };
  /** 每行已算好税(submit.ts 用 money + tax_code 算)。 */
  lines: {
    id: string;
    classification: string | null;
    description: string;
    qty: string;
    unitPrice: string;
    lineTotal: string;
    taxCategoryCode: string;
    taxRatePercent: string;
    taxAmount: string;
  }[];
  /** 提交时刻(UTC)。submit.ts 注入,保持 payload 纯。 */
  issueTimeUtc: string; // HH:mm:ssZ
}

const DOC_TYPE_CODE: Record<BuildInput['invoice']['docType'], InvoiceTypeCode> = {
  invoice: '01',
  credit_note: '02',
  debit_note: '03',
  self_billed: '11',
};

export function buildMyInvoisDocument(input: BuildInput): MyInvoisDocument {
  const { invoice, org, supplierProfile, buyer, lines } = input;

  const supplier: Party = {
    tin: org.tin ?? '',
    registrationNo: org.brn ?? undefined,
    registrationScheme: org.brn ? 'BRN' : undefined,
    sstNo: org.sstNo ?? undefined,
    legalName: org.legalName,
    msicCode: supplierProfile.msicCode,
    phone: supplierProfile.phone,
    email: supplierProfile.email,
    address: supplierProfile.address,
  };

  const buyerParty: Party = {
    tin: buyer.tin ?? '',
    registrationNo: buyer.brn ?? undefined,
    registrationScheme: buyer.brn ? 'BRN' : undefined,
    sstNo: buyer.sstNo ?? undefined,
    legalName: buyer.name,
    email: buyer.email ?? undefined,
  };

  return {
    invoiceTypeCode: DOC_TYPE_CODE[invoice.docType],
    versionId: '1.1',
    codeNumber: invoice.invoiceNo,
    issueDate: invoice.issueDate,
    issueTime: input.issueTimeUtc,
    currencyCode: invoice.currency,
    supplier,
    buyer: buyerParty,
    lines: lines.map((l) => ({
      id: l.id,
      classificationCode: l.classification ?? '',
      classificationListId: 'CLASS',
      description: l.description,
      quantity: l.qty,
      unitCode: 'C62', // G5: UOM 默认 unit
      unitPrice: l.unitPrice,
      lineExtensionAmount: l.lineTotal,
      taxCategoryCode: l.taxCategoryCode,
      taxRatePercent: l.taxRatePercent,
      taxAmount: l.taxAmount,
    })),
    taxableAmount: invoice.subtotal,
    taxAmount: invoice.taxTotal,
    lineExtensionTotal: invoice.subtotal,
    taxExclusiveTotal: invoice.subtotal,
    taxInclusiveTotal: invoice.grandTotal,
    payableTotal: invoice.grandTotal,
  };
}

/** 提交前必填校验(应用层防线)。缺失抛 EinvoiceValidationError。 */
export function validateForSubmission(doc: MyInvoisDocument): void {
  const missing: string[] = [];
  if (!doc.supplier.tin) missing.push('supplier.tin');
  if (!doc.supplier.legalName) missing.push('supplier.legalName');
  if (!doc.supplier.msicCode) missing.push('supplier.msicCode');
  if (!doc.supplier.phone) missing.push('supplier.phone');
  if (!doc.supplier.address?.lines?.length) missing.push('supplier.address');
  if (!doc.buyer.tin) missing.push('buyer.tin');
  if (!doc.buyer.legalName) missing.push('buyer.legalName');
  if (doc.lines.length === 0) missing.push('lines');
  doc.lines.forEach((l, i) => {
    if (!l.classificationCode) missing.push(`lines[${i}].classificationCode`);
  });
  if (missing.length > 0) throw new EinvoiceValidationError(missing);
}
