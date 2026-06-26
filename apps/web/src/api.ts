// API client for the @cf4u/api dev server. 浏览器经此层访问 Postgres truth(铁律 1)。
const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

export interface Account {
  id: string;
  code: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  normalBalance: 'debit' | 'credit';
  parentId: string | null;
  isActive: boolean;
}

export interface Period {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: 'open' | 'closed' | 'locked';
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: Account['accountType'];
  normalBalance: 'debit' | 'credit';
  debit: string;
  credit: string;
}

export interface TrialBalance {
  orgId: string;
  periodId: string;
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
}

export type ContactKind = 'customer' | 'supplier' | 'both';

export interface Contact {
  id: string;
  kind: ContactKind;
  name: string;
  tin: string | null;
  brn: string | null;
  sstNo: string | null;
  email: string | null;
}

export interface TaxCode {
  id: string;
  code: string;
  rate: string;
}

export interface Invoice {
  id: string;
  direction: 'sales' | 'purchase';
  docType: string;
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

export interface InvoiceLineInput {
  description: string;
  qty?: string;
  unitPrice: string;
  accountId: string;
  taxCodeId?: string;
  classification?: string;
}

export interface EinvoiceSubmission {
  id: string;
  invoiceId: string;
  status: string;
  myinvoisUuid: string | null;
  qrUrl: string | null;
}

export interface StatementRow {
  accountId: string;
  code: string;
  name: string;
  amount: string;
}

export interface ProfitAndLoss {
  asOf: string;
  income: StatementRow[];
  expense: StatementRow[];
  totalIncome: string;
  totalExpense: string;
  netProfit: string;
}

export interface BalanceSheet {
  asOf: string;
  assets: StatementRow[];
  liabilities: StatementRow[];
  equity: StatementRow[];
  currentYearEarnings: string;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  balanced: boolean;
}

export interface JournalLineInput {
  accountId: string;
  debit?: string;
  credit?: string;
  lineMemo?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const code = (data && data.code) || 'HTTP_' + res.status;
    const message = (data && data.message) || res.statusText;
    throw new ApiError(code, message);
  }
  return data as T;
}

export const api = {
  accounts: () => req<Account[]>('/api/accounts'),
  periods: () => req<Period[]>('/api/periods'),
  trialBalance: (periodId: string) =>
    req<TrialBalance>(`/api/trial-balance?periodId=${encodeURIComponent(periodId)}`),
  createEntry: (body: { entryDate: string; memo?: string; post?: boolean; lines: JournalLineInput[] }) =>
    req<{ id: string; entryNo: number; periodId: string; posted: boolean }>('/api/journal-entries', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  contacts: (kind?: ContactKind) =>
    req<Contact[]>(`/api/contacts${kind ? `?kind=${kind}` : ''}`),
  createContact: (body: {
    kind: ContactKind;
    name: string;
    tin?: string;
    brn?: string;
    sstNo?: string;
    email?: string;
  }) => req<{ id: string }>('/api/contacts', { method: 'POST', body: JSON.stringify(body) }),
  taxCodes: () => req<TaxCode[]>('/api/tax-codes'),
  invoices: () => req<Invoice[]>('/api/invoices'),
  createInvoice: (body: {
    direction: 'sales' | 'purchase';
    invoiceNo: string;
    contactId: string;
    issueDate: string;
    issue?: boolean;
    lines: InvoiceLineInput[];
  }) =>
    req<{ id: string; invoiceNo: string; subtotal: string; taxTotal: string; grandTotal: string }>(
      '/api/invoices',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  issueInvoice: (id: string) =>
    req<{ journalEntryId: string; entryNo: number }>(`/api/invoices/${id}/issue`, { method: 'POST' }),
  submitEinvoice: (id: string) =>
    req<{ submissionId: string; status: string; myinvoisUuid: string | null; qrUrl: string | null; transport: string }>(
      `/api/invoices/${id}/einvoice`,
      { method: 'POST' },
    ),
  getEinvoice: (id: string) => req<EinvoiceSubmission | null>(`/api/invoices/${id}/einvoice`),
  profitAndLoss: (periodId: string) =>
    req<ProfitAndLoss>(`/api/profit-and-loss?periodId=${encodeURIComponent(periodId)}`),
  balanceSheet: (periodId: string) =>
    req<BalanceSheet>(`/api/balance-sheet?periodId=${encodeURIComponent(periodId)}`),
};
