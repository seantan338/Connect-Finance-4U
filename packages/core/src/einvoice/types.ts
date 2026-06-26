// MyInvois v1.1 — 我们的规范化文档结构(存进 einvoice_submissions.payload)。
// 真正提交时再序列化成 UBL 2.1 JSON(toUbl,随真 httpTransport 一起来,需对照 SDK 校验)。

/** 01 Invoice · 02 Credit Note · 03 Debit Note · 11/12/13 Self-billed Invoice/CN/DN */
export type InvoiceTypeCode = '01' | '02' | '03' | '11' | '12' | '13';

export interface PartyAddress {
  lines: string[];
  city?: string;
  postcode?: string;
  state?: string; // MyInvois state code
  countryCode: string; // ISO-3166 alpha-3,e.g. 'MYS'
}

/** Supplier(我们 org)缺失字段的配置注入(缺口 G1):MSIC / phone / address。 */
export interface SupplierProfile {
  msicCode: string;
  msicDescription?: string;
  phone: string;
  email?: string;
  address: PartyAddress;
}

export interface Party {
  tin: string;
  registrationNo?: string;
  registrationScheme?: string; // BRN / NRIC / PASSPORT / ARMY
  sstNo?: string;
  legalName: string;
  msicCode?: string;
  phone?: string;
  email?: string;
  address?: PartyAddress;
}

export interface DocumentLine {
  id: string;
  classificationCode: string;
  classificationListId: string; // 'CLASS'(MyInvois classification)
  description: string;
  quantity: string;
  unitCode: string; // UOM,默认 'C62'
  unitPrice: string;
  lineExtensionAmount: string;
  taxCategoryCode: string; // 01 Sales / 02 Service / 06 NA / E Exempt
  taxRatePercent: string;
  taxAmount: string;
}

export interface MyInvoisDocument {
  invoiceTypeCode: InvoiceTypeCode;
  versionId: '1.1';
  codeNumber: string; // invoice_no
  issueDate: string; // YYYY-MM-DD (UTC)
  issueTime: string; // HH:mm:ssZ (UTC)
  currencyCode: string;
  supplier: Party;
  buyer: Party;
  lines: DocumentLine[];
  taxableAmount: string;
  taxAmount: string;
  lineExtensionTotal: string;
  taxExclusiveTotal: string;
  taxInclusiveTotal: string;
  payableTotal: string;
}

// ── transport ──────────────────────────────────────────────────────
export interface SubmitDocument {
  codeNumber: string;
  format: 'JSON';
  document: string; // base64(canonical JSON)
  documentHash: string; // sha256 hex
}
export interface SubmitAccepted {
  uuid: string;
  invoiceCodeNumber: string;
  longId?: string;
}
export interface SubmitRejected {
  invoiceCodeNumber: string;
  error: string;
}
export interface SubmitResult {
  submissionUid: string;
  accepted: SubmitAccepted[];
  rejected: SubmitRejected[];
}
export type DocStatus = 'Submitted' | 'Valid' | 'Invalid' | 'Cancelled';
export interface StatusResult {
  uuid: string;
  status: DocStatus;
  longId?: string;
  validation?: unknown;
}

/** MyInvois 传输层:mock(本地)/ http(真 sandbox/prod)实现同一接口。 */
export interface MyInvoisTransport {
  readonly name: string;
  submit(docs: SubmitDocument[]): Promise<SubmitResult>;
  getStatus(uuid: string): Promise<StatusResult>;
}
