/**
 * Integration-test fixtures. 需要 DATABASE_URL 指向一个已 migrate 的库(admin 连接)。
 * 每个 suite 建一个独立 org,结束时清干净(含该 org 的 audit_log)。
 */
import { and, eq } from 'drizzle-orm';
import {
  createDb,
  type Database,
  accounts,
  appUsers,
  auditLog,
  currencies,
  fiscalPeriods,
  journalEntries,
  organizations,
} from '@cf4u/db';
type SqlClient = ReturnType<typeof createDb>['sqlClient'];

export interface Fixture {
  db: Database;
  sqlClient: SqlClient;
  orgId: string;
  userId: string;
  openPeriodId: string;
  closedPeriodId: string;
  cashAccountId: string;
  salesAccountId: string;
}

export async function setupFixture(): Promise<Fixture> {
  const { db, sqlClient } = createDb(process.env.DATABASE_URL!);

  await db
    .insert(currencies)
    .values({ code: 'MYR', name: 'Malaysian Ringgit', minorUnit: 2 })
    .onConflictDoNothing();

  const [org] = await db
    .insert(organizations)
    .values({ legalName: 'Core Test Sdn Bhd', baseCurrency: 'MYR' })
    .returning({ id: organizations.id });

  const [user] = await db
    .insert(appUsers)
    .values({
      firebaseUid: `core-test-${crypto.randomUUID()}`,
      email: `core-test-${crypto.randomUUID()}@example.test`,
    })
    .returning({ id: appUsers.id });

  const [openPeriod] = await db
    .insert(fiscalPeriods)
    .values({ orgId: org!.id, periodStart: '2026-01-01', periodEnd: '2026-12-31', status: 'open' })
    .returning({ id: fiscalPeriods.id });

  const [closedPeriod] = await db
    .insert(fiscalPeriods)
    .values({ orgId: org!.id, periodStart: '2025-01-01', periodEnd: '2025-12-31', status: 'closed' })
    .returning({ id: fiscalPeriods.id });

  const [cash] = await db
    .insert(accounts)
    .values({ orgId: org!.id, code: '1520', name: 'Bank', accountType: 'asset', normalBalance: 'debit' })
    .returning({ id: accounts.id });

  const [sales] = await db
    .insert(accounts)
    .values({ orgId: org!.id, code: '4100', name: 'Sales', accountType: 'income', normalBalance: 'credit' })
    .returning({ id: accounts.id });

  return {
    db,
    sqlClient,
    orgId: org!.id,
    userId: user!.id,
    openPeriodId: openPeriod!.id,
    closedPeriodId: closedPeriod!.id,
    cashAccountId: cash!.id,
    salesAccountId: sales!.id,
  };
}

export async function teardownFixture(f: Fixture): Promise<void> {
  const { db, orgId, userId } = f;
  await db.delete(journalEntries).where(eq(journalEntries.orgId, orgId)); // cascades lines
  await db.delete(accounts).where(eq(accounts.orgId, orgId));
  await db.delete(fiscalPeriods).where(eq(fiscalPeriods.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.orgId, orgId)); // admin can; cleans trigger output
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(appUsers).where(eq(appUsers.id, userId));
  await f.sqlClient.end();
}

/** 统计某 org 的凭证数(用于断言「被拒时什么都没写」)。 */
export async function countEntries(db: Database, orgId: string): Promise<number> {
  const rows = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.orgId, orgId));
  return rows.length;
}

export async function isPosted(db: Database, entryId: string): Promise<boolean> {
  const [row] = await db
    .select({ isPosted: journalEntries.isPosted })
    .from(journalEntries)
    .where(eq(journalEntries.id, entryId));
  return !!row?.isPosted;
}

export async function auditCount(
  db: Database,
  orgId: string,
  entity: string,
  action: string,
): Promise<number> {
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(eq(auditLog.orgId, orgId), eq(auditLog.entity, entity), eq(auditLog.action, action)),
    );
  return rows.length;
}
