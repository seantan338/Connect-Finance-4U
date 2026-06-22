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
};
