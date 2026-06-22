import type { Account } from './api.js';

export const ACCOUNT_TYPE_ORDER: Account['accountType'][] = [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
];

export const ACCOUNT_TYPE_META: Record<
  Account['accountType'],
  { label: string; text: string; dot: string; soft: string }
> = {
  asset: { label: 'Asset 资产', text: 'text-ink', dot: 'bg-ink', soft: 'bg-ink/5' },
  liability: { label: 'Liability 负债', text: 'text-debit', dot: 'bg-debit', soft: 'bg-debit/5' },
  equity: { label: 'Equity 权益', text: 'text-gold', dot: 'bg-gold', soft: 'bg-gold/10' },
  income: { label: 'Income 收入', text: 'text-credit', dot: 'bg-credit', soft: 'bg-credit/5' },
  expense: { label: 'Expense 费用', text: 'text-expense', dot: 'bg-expense', soft: 'bg-expense/5' },
};
