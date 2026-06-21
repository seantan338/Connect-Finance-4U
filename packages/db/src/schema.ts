// =====================================================================
// Drizzle schema — translated from docs/schema.sql (v0.1, hardened).
//
// SCOPE NOTE (铁律纪律):
//   Drizzle codegen 只生成表/索引/CHECK/UNIQUE/FK。下列对象 codegen 生成不了,
//   它们作为手写 SQL migration(drizzle/0001_triggers_roles.sql)随迁移一起跑:
//     - uuid-ossp / pgcrypto extensions
//     - assert_entry_balanced()      + trg_balanced            (铁律 3 · 防线 1)
//     - assert_balanced_on_post()    + trg_balanced_on_post    (铁律 3 · 防线 2)
//     - write_audit() SECURITY DEFINER + 5 audit triggers      (铁律 5)
//     - CREATE ROLE ledger_app + GRANT/REVOKE                  (铁律 5)
//   改 schema 时先核对这些红线对象还在。
// =====================================================================

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  char,
  smallint,
  numeric,
  boolean,
  date,
  timestamp,
  jsonb,
  bigint,
  customType,
  index,
  unique,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// Postgres INET — Drizzle 无内置类型,自定义以保证 codegen 输出 `inet`。
const inet = customType<{ data: string }>({
  dataType() {
    return 'inet';
  },
});

// 与 schema.sql 一致:UUID 主键默认走 uuid-ossp 的 uuid_generate_v4()。
const pk = () => uuid('id').primaryKey().default(sql`uuid_generate_v4()`);

// ---------------------------------------------------------------------
// 1. TENANCY / MULTI-ENTITY
// ---------------------------------------------------------------------
export const organizations = pgTable('organizations', {
  id: pk(),
  legalName: text('legal_name').notNull(),
  brn: text('brn'), // SSM business reg no
  tin: text('tin'), // LHDN tax id (e-Invoice 必填)
  sstNo: text('sst_no'),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('MYR'),
  country: char('country', { length: 2 }).notNull().default('MY'),
  parentOrgId: uuid('parent_org_id').references((): AnyPgColumn => organizations.id), // 集团合并
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const appUsers = pgTable('app_users', {
  id: pk(),
  firebaseUid: text('firebase_uid').notNull().unique(), // 桥接 Firebase Auth
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id),
    role: text('role').notNull(),
  },
  (t) => [
    check('memberships_role_check', sql`${t.role} IN ('owner','admin','accountant','clerk','viewer')`),
    unique('memberships_org_user_unique').on(t.orgId, t.userId),
  ],
);

// ---------------------------------------------------------------------
// 2. CURRENCY
// ---------------------------------------------------------------------
export const currencies = pgTable('currencies', {
  code: char('code', { length: 3 }).primaryKey(), // ISO 4217
  name: text('name').notNull(),
  minorUnit: smallint('minor_unit').notNull().default(2),
});

export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    fromCcy: char('from_ccy', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    toCcy: char('to_ccy', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    rateDate: date('rate_date').notNull(),
  },
  (t) => [unique('exchange_rates_unique').on(t.orgId, t.fromCcy, t.toCcy, t.rateDate)],
);

// ---------------------------------------------------------------------
// 3. CHART OF ACCOUNTS
// ---------------------------------------------------------------------
export const accounts = pgTable(
  'accounts',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(), // e.g. '1000'
    name: text('name').notNull(),
    accountType: text('account_type').notNull(),
    // 借增/贷增方向:asset/expense=debit,其余=credit
    normalBalance: text('normal_balance').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => accounts.id), // 科目层级
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    check(
      'accounts_account_type_check',
      sql`${t.accountType} IN ('asset','liability','equity','income','expense')`,
    ),
    check('accounts_normal_balance_check', sql`${t.normalBalance} IN ('debit','credit')`),
    unique('accounts_org_code_unique').on(t.orgId, t.code),
  ],
);

// ---------------------------------------------------------------------
// 4. FISCAL PERIOD / CLOSE
// ---------------------------------------------------------------------
export const fiscalPeriods = pgTable(
  'fiscal_periods',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    status: text('status').notNull().default('open'),
  },
  (t) => [
    check('fiscal_periods_status_check', sql`${t.status} IN ('open','closed','locked')`),
    unique('fiscal_periods_org_start_unique').on(t.orgId, t.periodStart),
  ],
);

// ---------------------------------------------------------------------
// 5. DOUBLE-ENTRY CORE  ★★★ 这块错了全盘重来 ★★★
// ---------------------------------------------------------------------
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    entryNo: bigint('entry_no', { mode: 'number' }).notNull(), // 每个 org 连续编号
    entryDate: date('entry_date').notNull(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    memo: text('memo'),
    source: text('source').notNull().default('manual'),
    sourceId: uuid('source_id'), // 指向 invoices/payments 等
    isPosted: boolean('is_posted').notNull().default(false), // draft vs posted
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'journal_entries_source_check',
      sql`${t.source} IN ('manual','invoice','payment','bank','system')`,
    ),
    unique('journal_entries_org_no_unique').on(t.orgId, t.entryNo),
    index('idx_entries_org_date').on(t.orgId, t.entryDate),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: pk(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    // 一行只能是借或贷之一,另一为 0
    debit: numeric('debit', { precision: 20, scale: 4 }).notNull().default('0'),
    credit: numeric('credit', { precision: 20, scale: 4 }).notNull().default('0'),
    currency: char('currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }).notNull().default('1'),
    // base currency 金额(合并报表用),= (debit-credit)*fx_rate
    baseAmount: numeric('base_amount', { precision: 20, scale: 4 }).notNull(),
    lineMemo: text('line_memo'),
  },
  (t) => [
    check('journal_lines_debit_check', sql`${t.debit} >= 0`),
    check('journal_lines_credit_check', sql`${t.credit} >= 0`),
    check('journal_lines_not_both_check', sql`NOT (${t.debit} > 0 AND ${t.credit} > 0)`),
    index('idx_lines_entry').on(t.entryId),
    index('idx_lines_account').on(t.accountId),
  ],
);

// ---------------------------------------------------------------------
// 6. CONTACTS / INVOICING
// ---------------------------------------------------------------------
export const contacts = pgTable(
  'contacts',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    tin: text('tin'), // e-Invoice 对手方必填
    brn: text('brn'),
    sstNo: text('sst_no'),
    email: text('email'),
    address: jsonb('address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('contacts_kind_check', sql`${t.kind} IN ('customer','supplier','both')`)],
);

export const taxCodes = pgTable(
  'tax_codes',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(), // e.g. 'SST-6', 'SST-0'
    rate: numeric('rate', { precision: 6, scale: 4 }).notNull(),
  },
  (t) => [unique('tax_codes_org_code_unique').on(t.orgId, t.code)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    direction: text('direction').notNull(),
    docType: text('doc_type').notNull().default('invoice'),
    invoiceNo: text('invoice_no').notNull(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id),
    issueDate: date('issue_date').notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    subtotal: numeric('subtotal', { precision: 20, scale: 4 }).notNull().default('0'),
    taxTotal: numeric('tax_total', { precision: 20, scale: 4 }).notNull().default('0'),
    grandTotal: numeric('grand_total', { precision: 20, scale: 4 }).notNull().default('0'),
    status: text('status').notNull().default('draft'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id), // 过账后回填
  },
  (t) => [
    check('invoices_direction_check', sql`${t.direction} IN ('sales','purchase')`),
    check(
      'invoices_doc_type_check',
      sql`${t.docType} IN ('invoice','credit_note','debit_note','self_billed')`,
    ),
    check('invoices_status_check', sql`${t.status} IN ('draft','issued','paid','void')`),
    unique('invoices_org_no_unique').on(t.orgId, t.invoiceNo),
  ],
);

export const invoiceLines = pgTable('invoice_lines', {
  id: pk(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  classification: text('classification'), // MyInvois 产品分类码
  qty: numeric('qty', { precision: 20, scale: 4 }).notNull().default('1'),
  unitPrice: numeric('unit_price', { precision: 20, scale: 4 }).notNull(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id), // 收入/费用科目
  taxCodeId: uuid('tax_code_id').references(() => taxCodes.id),
  lineTotal: numeric('line_total', { precision: 20, scale: 4 }).notNull(),
});

// ---------------------------------------------------------------------
// 7. E-INVOICE / MyInvois
// ---------------------------------------------------------------------
export const einvoiceSubmissions = pgTable(
  'einvoice_submissions',
  {
    id: pk(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    myinvoisUuid: text('myinvois_uuid'), // LHDN 回传的 UUID
    submissionUid: text('submission_uid'),
    channel: text('channel').notNull().default('api'),
    status: text('status').notNull().default('pending'),
    payload: jsonb('payload').notNull(), // 提交的 55 字段结构
    validation: jsonb('validation'), // LHDN validation 返回
    qrUrl: text('qr_url'),
    digitalSig: text('digital_sig'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
  },
  (t) => [
    check('einvoice_channel_check', sql`${t.channel} IN ('api','peppol')`),
    check(
      'einvoice_status_check',
      sql`${t.status} IN ('pending','valid','invalid','cancelled','rejected')`,
    ),
    index('idx_einv_invoice').on(t.invoiceId),
  ],
);

// ---------------------------------------------------------------------
// 8. PAYMENTS
// ---------------------------------------------------------------------
export const payments = pgTable('payments', {
  id: pk(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id),
  amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
  currency: char('currency', { length: 3 })
    .notNull()
    .references(() => currencies.code),
  payDate: date('pay_date').notNull(),
  method: text('method'),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
});

export const paymentAllocations = pgTable('payment_allocations', {
  id: pk(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
});

// ---------------------------------------------------------------------
// 9. IMMUTABLE AUDIT TRAIL (append-only — 写入由 write_audit() definer 触发器代劳)
// ---------------------------------------------------------------------
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: uuid('org_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(), // create/update/post/void...
    entity: text('entity').notNull(), // table name
    entityId: uuid('entity_id'),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    ip: inet('ip'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_org_at').on(t.orgId, t.at.desc()),
    index('idx_audit_entity').on(t.entity, t.entityId),
  ],
);
