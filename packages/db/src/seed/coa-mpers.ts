/**
 * MPERS standard Chart of Accounts — Malaysian trading SME.
 *
 * onboarding 默认模板:新 org 开通时按此套用一份(seedChartOfAccounts)。
 * 编号区间:1xxx 资产 · 2xxx 负债 · 3xxx 权益 · 4xxx 收入 · 5xxx 销货成本 · 6xxx 营运费用。
 *
 * normal_balance 规则:asset/expense=debit,liability/equity/income=credit;
 * contra 科目(累计折旧 / 销售退回 / 进货退回 / 期末存货)用 `contra` 翻转方向。
 * 这正是把方向单独存一列的意义——schema 允许 normal_balance 与 account_type 不一致。
 */
import { eq, and } from 'drizzle-orm';
import type { Database } from '../client.js';
import { accounts } from '../schema.js';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface AccountSeed {
  code: string;
  name: string;
  type: AccountType;
  /** parent account code(层级),省略 = 顶层 */
  parent?: string;
  /** contra 科目:把按 type 推出的 normal_balance 反向 */
  contra?: boolean;
}

/** asset/expense 借方增,其余贷方增;contra 翻转。 */
export function normalBalanceOf(a: AccountSeed): 'debit' | 'credit' {
  const base: 'debit' | 'credit' = a.type === 'asset' || a.type === 'expense' ? 'debit' : 'credit';
  if (!a.contra) return base;
  return base === 'debit' ? 'credit' : 'debit';
}

// 顺序很重要:parent 必须排在 child 之前(FK accounts.parent_id 即时校验)。
export const MPERS_TRADING_COA: AccountSeed[] = [
  // ───────────── 1xxx ASSETS ─────────────
  { code: '1000', name: 'Non-Current Assets', type: 'asset' },
  { code: '1100', name: 'Property, Plant & Equipment', type: 'asset', parent: '1000' },
  { code: '1110', name: 'Accumulated Depreciation — PPE', type: 'asset', parent: '1000', contra: true },
  { code: '1200', name: 'Intangible Assets', type: 'asset', parent: '1000' },

  { code: '1300', name: 'Current Assets', type: 'asset' },
  { code: '1310', name: 'Inventory / Stock', type: 'asset', parent: '1300' },
  { code: '1400', name: 'Trade Receivables', type: 'asset', parent: '1300' },
  { code: '1410', name: 'Other Receivables & Deposits', type: 'asset', parent: '1300' },
  { code: '1420', name: 'Prepayments', type: 'asset', parent: '1300' },
  { code: '1500', name: 'Cash and Bank', type: 'asset', parent: '1300' },
  { code: '1510', name: 'Cash in Hand', type: 'asset', parent: '1500' },
  { code: '1520', name: 'Bank — Current Account (MYR)', type: 'asset', parent: '1500' },
  { code: '1530', name: 'Bank — Current Account (SGD)', type: 'asset', parent: '1500' },
  { code: '1600', name: 'SST Input Tax Receivable', type: 'asset', parent: '1300' },

  // ───────────── 2xxx LIABILITIES ─────────────
  { code: '2000', name: 'Current Liabilities', type: 'liability' },
  { code: '2100', name: 'Trade Payables', type: 'liability', parent: '2000' },
  { code: '2110', name: 'Other Payables & Accruals', type: 'liability', parent: '2000' },
  { code: '2200', name: 'SST Output Tax Payable', type: 'liability', parent: '2000' },
  { code: '2300', name: 'Bank Overdraft', type: 'liability', parent: '2000' },
  { code: '2400', name: 'Short-term Borrowings', type: 'liability', parent: '2000' },
  { code: '2500', name: 'Provision for Taxation', type: 'liability', parent: '2000' },

  { code: '2600', name: 'Non-Current Liabilities', type: 'liability' },
  { code: '2610', name: 'Long-term Borrowings', type: 'liability', parent: '2600' },
  { code: '2620', name: 'Hire Purchase Creditors', type: 'liability', parent: '2600' },

  // ───────────── 3xxx EQUITY ─────────────
  { code: '3000', name: 'Equity', type: 'equity' },
  { code: '3100', name: 'Share Capital', type: 'equity', parent: '3000' },
  { code: '3200', name: 'Retained Earnings', type: 'equity', parent: '3000' },
  { code: '3300', name: 'Current Year Earnings', type: 'equity', parent: '3000' },

  // ───────────── 4xxx INCOME ─────────────
  { code: '4000', name: 'Revenue', type: 'income' },
  { code: '4100', name: 'Sales — Local', type: 'income', parent: '4000' },
  { code: '4110', name: 'Sales — Export', type: 'income', parent: '4000' },
  { code: '4200', name: 'Sales Returns & Discounts', type: 'income', parent: '4000', contra: true },

  { code: '4500', name: 'Other Income', type: 'income' },
  { code: '4510', name: 'Interest Income', type: 'income', parent: '4500' },
  { code: '4520', name: 'Foreign Exchange Gain', type: 'income', parent: '4500' },
  { code: '4530', name: 'Sundry Income', type: 'income', parent: '4500' },

  // ───────────── 5xxx COST OF SALES ─────────────
  { code: '5000', name: 'Cost of Sales', type: 'expense' },
  { code: '5100', name: 'Opening Stock', type: 'expense', parent: '5000' },
  { code: '5110', name: 'Purchases', type: 'expense', parent: '5000' },
  { code: '5120', name: 'Purchase Returns', type: 'expense', parent: '5000', contra: true },
  { code: '5130', name: 'Carriage Inwards / Freight', type: 'expense', parent: '5000' },
  { code: '5190', name: 'Closing Stock', type: 'expense', parent: '5000', contra: true },

  // ───────────── 6xxx OPERATING EXPENSES ─────────────
  { code: '6000', name: 'Operating Expenses', type: 'expense' },
  { code: '6100', name: 'Salaries & Wages', type: 'expense', parent: '6000' },
  { code: '6110', name: 'EPF & SOCSO', type: 'expense', parent: '6000' },
  { code: '6200', name: 'Rental', type: 'expense', parent: '6000' },
  { code: '6210', name: 'Utilities', type: 'expense', parent: '6000' },
  { code: '6220', name: 'Telephone & Internet', type: 'expense', parent: '6000' },
  { code: '6300', name: 'Repair & Maintenance', type: 'expense', parent: '6000' },
  { code: '6310', name: 'Motor Vehicle Expenses', type: 'expense', parent: '6000' },
  { code: '6400', name: 'Depreciation', type: 'expense', parent: '6000' },
  { code: '6500', name: 'Professional Fees', type: 'expense', parent: '6000' },
  { code: '6510', name: 'Audit Fees', type: 'expense', parent: '6000' },
  { code: '6600', name: 'Bank Charges', type: 'expense', parent: '6000' },
  { code: '6610', name: 'Foreign Exchange Loss', type: 'expense', parent: '6000' },
  { code: '6700', name: 'Marketing & Advertising', type: 'expense', parent: '6000' },
  { code: '6800', name: 'Office Supplies & Printing', type: 'expense', parent: '6000' },
  { code: '6900', name: 'General Expenses', type: 'expense', parent: '6000' },
];

/** 模板自检:code 唯一、parent 存在且排在前面、type 合法。malformed 直接抛。 */
export function validateCoa(template: AccountSeed[] = MPERS_TRADING_COA): void {
  const seen = new Set<string>();
  for (const a of template) {
    if (seen.has(a.code)) throw new Error(`duplicate account code: ${a.code}`);
    if (a.parent && !seen.has(a.parent)) {
      throw new Error(`account ${a.code} references parent ${a.parent} not defined before it`);
    }
    seen.add(a.code);
  }
}

/**
 * 把 MPERS 模板套进某个 org。幂等:已存在的 code 跳过(ON CONFLICT (org_id, code))。
 * 解析 parent code → id 时按插入顺序累积 map,所以模板必须 parent 在前。
 * 返回新插入的科目数。
 */
export async function seedChartOfAccounts(
  db: Database,
  orgId: string,
  template: AccountSeed[] = MPERS_TRADING_COA,
): Promise<number> {
  validateCoa(template);
  const codeToId = new Map<string, string>();

  // 预载该 org 已有科目(幂等重跑时也能解析 parent)
  const existing = await db
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(eq(accounts.orgId, orgId));
  for (const row of existing) codeToId.set(row.code, row.id);

  let inserted = 0;
  for (const a of template) {
    if (codeToId.has(a.code)) continue; // 已存在,跳过
    const parentId = a.parent ? codeToId.get(a.parent) ?? null : null;
    const [row] = await db
      .insert(accounts)
      .values({
        orgId,
        code: a.code,
        name: a.name,
        accountType: a.type,
        normalBalance: normalBalanceOf(a),
        parentId,
      })
      .onConflictDoNothing({ target: [accounts.orgId, accounts.code] })
      .returning({ id: accounts.id });
    if (row) {
      codeToId.set(a.code, row.id);
      inserted++;
    } else {
      // 并发或已存在:回查 id 以便后续 child 解析 parent
      const [found] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.orgId, orgId), eq(accounts.code, a.code)));
      if (found) codeToId.set(a.code, found.id);
    }
  }
  return inserted;
}
