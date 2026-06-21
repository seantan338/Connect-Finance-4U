import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Build a Drizzle client.
 *
 * 铁律 5:运行时必须用受限角色 `ledger_app`(APP_DATABASE_URL)。
 * 该角色对 audit_log 只有 SELECT;审计写入由 write_audit() definer 触发器代劳。
 * 只有 migration/admin 才用 DATABASE_URL。
 */
export function createDb(connectionString: string): { db: Database; sqlClient: postgres.Sql } {
  const sqlClient = postgres(connectionString, { max: 10 });
  const db = drizzle(sqlClient, { schema });
  return { db, sqlClient };
}

/** Runtime client — uses the restricted ledger_app role. */
export function createAppDb(): { db: Database; sqlClient: postgres.Sql } {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error('APP_DATABASE_URL not set (must point at the restricted ledger_app role).');
  return createDb(url);
}

/**
 * 审计上下文:write_audit() 触发器靠 current_setting('app.user_id'/'app.ip') 读取。
 * 任何会触发审计的写事务,开头必须先注入这两个 SET LOCAL,否则 actor 为空。
 *
 *   await withAuditContext(db, { userId, ip }, async (tx) => { ... });
 */
export async function withAuditContext<T>(
  db: Database,
  ctx: { userId: string; ip?: string },
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.user_id = ${ctx.userId}`);
    if (ctx.ip) await tx.execute(sql`SET LOCAL app.ip = ${ctx.ip}`);
    return fn(tx as unknown as Database);
  });
}
