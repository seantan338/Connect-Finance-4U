/**
 * Step 2 verification — run AFTER `pnpm --filter @cf4u/db migrate`.
 *
 *   pnpm --filter @cf4u/db verify
 *
 * 证明 schema.sql 的红线真的生效:
 *   铁律 3 · 防线 1+2 — trg_balanced / trg_balanced_on_post 强制 Σdebit=Σcredit、拒空凭证
 *   铁律 5            — write_audit() 自动留痕 + ledger_app 对 audit_log 只 SELECT
 *
 * 所有写操作都在一个最终 ROLLBACK 的事务里 → 不留任何测试数据。
 * 用 DATABASE_URL(admin)做功能验证;用 APP_DATABASE_URL(ledger_app)做权限验证。
 */
import postgres from 'postgres';

const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.APP_DATABASE_URL;

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
};

// Sentinel error used to force the whole verification transaction to roll back.
const ROLLBACK = new Error('__verify_rollback__');

async function introspect(sql: postgres.Sql) {
  console.log('\n\x1b[1mSchema introspection\x1b[0m');

  const fns = await sql<{ proname: string }[]>`
    SELECT proname FROM pg_proc
    WHERE proname IN ('assert_entry_balanced','assert_balanced_on_post','write_audit')`;
  const fnNames = new Set(fns.map((r) => r.proname));
  for (const f of ['assert_entry_balanced', 'assert_balanced_on_post', 'write_audit']) {
    record(`function ${f}() exists`, fnNames.has(f));
  }

  const trigs = await sql<{ tgname: string; tgdeferrable: boolean; tginitdeferred: boolean }[]>`
    SELECT tgname, tgdeferrable, tginitdeferred FROM pg_trigger WHERE NOT tgisinternal`;
  const byName = new Map(trigs.map((t) => [t.tgname, t]));
  for (const t of [
    'trg_audit_accounts',
    'trg_audit_journal',
    'trg_audit_invoices',
    'trg_audit_payments',
    'trg_audit_contacts',
  ]) {
    record(`trigger ${t} attached`, byName.has(t));
  }
  // 两个 balance 触发器必须是 DEFERRABLE INITIALLY DEFERRED(铁律 3)
  for (const t of ['trg_balanced', 'trg_balanced_on_post']) {
    const row = byName.get(t);
    record(
      `constraint trigger ${t} is DEFERRABLE INITIALLY DEFERRED`,
      !!row && row.tgdeferrable && row.tginitdeferred,
      row ? '' : 'missing',
    );
  }

  const role = await sql`SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app'`;
  record('role ledger_app exists', role.length === 1);

  // ledger_app 对 audit_log 的授权必须恰好 = {SELECT}(铁律 5)
  const grants = await sql<{ privilege_type: string }[]>`
    SELECT privilege_type FROM information_schema.role_table_grants
    WHERE grantee = 'ledger_app' AND table_schema = 'public' AND table_name = 'audit_log'`;
  const privs = new Set(grants.map((g) => g.privilege_type));
  record(
    'ledger_app audit_log grants == {SELECT} only',
    privs.has('SELECT') && !privs.has('INSERT') && !privs.has('UPDATE') && !privs.has('DELETE'),
    `[${[...privs].join(', ') || 'none'}]`,
  );
  // sanity: 普通表上 ledger_app 应当有 INSERT
  const acctGrants = await sql<{ privilege_type: string }[]>`
    SELECT privilege_type FROM information_schema.role_table_grants
    WHERE grantee = 'ledger_app' AND table_schema = 'public' AND table_name = 'accounts'`;
  record(
    'ledger_app has INSERT on accounts (broad grant applied)',
    new Set(acctGrants.map((g) => g.privilege_type)).has('INSERT'),
  );
}

/** Insert an entry + lines, flip to posted, then force deferred constraints to check now. */
async function attemptPost(
  q: postgres.TransactionSql,
  ctx: { orgId: string; periodId: string; userId: string },
  entryNo: number,
  lines: { accountId: string; debit: number; credit: number }[],
) {
  await q`SET CONSTRAINTS ALL DEFERRED`;
  const [e] = await q<{ id: string }[]>`
    INSERT INTO journal_entries (org_id, entry_no, entry_date, period_id, created_by)
    VALUES (${ctx.orgId}, ${entryNo}, '2026-06-01', ${ctx.periodId}, ${ctx.userId})
    RETURNING id`;
  const entryId = e!.id;
  for (const l of lines) {
    await q`
      INSERT INTO journal_lines (entry_id, account_id, debit, credit, currency, base_amount)
      VALUES (${entryId}, ${l.accountId}, ${l.debit}, ${l.credit}, 'MYR', ${l.debit - l.credit})`;
  }
  await q`UPDATE journal_entries SET is_posted = true WHERE id = ${entryId}`;
  // 触发两个 deferred constraint trigger 立即校验;不平/空在此抛错。
  await q`SET CONSTRAINTS ALL IMMEDIATE`;
}

async function functionalBalance(sql: postgres.Sql) {
  console.log('\n\x1b[1mBalance triggers (铁律 3) — functional, rolled back\x1b[0m');
  try {
    await sql.begin(async (q) => {
      await q`INSERT INTO currencies (code, name) VALUES ('MYR', 'Malaysian Ringgit') ON CONFLICT DO NOTHING`;
      const [org] = await q<{ id: string }[]>`
        INSERT INTO organizations (legal_name) VALUES ('VERIFY SDN BHD') RETURNING id`;
      const [user] = await q<{ id: string }[]>`
        INSERT INTO app_users (firebase_uid, email)
        VALUES ('verify-uid', 'verify@example.com') RETURNING id`;
      const [period] = await q<{ id: string }[]>`
        INSERT INTO fiscal_periods (org_id, period_start, period_end)
        VALUES (${org!.id}, '2026-01-01', '2026-12-31') RETURNING id`;
      const [cash] = await q<{ id: string }[]>`
        INSERT INTO accounts (org_id, code, name, account_type, normal_balance)
        VALUES (${org!.id}, '1000', 'Cash', 'asset', 'debit') RETURNING id`;
      const [sales] = await q<{ id: string }[]>`
        INSERT INTO accounts (org_id, code, name, account_type, normal_balance)
        VALUES (${org!.id}, '4000', 'Sales', 'income', 'credit') RETURNING id`;

      const ctx = { orgId: org!.id, periodId: period!.id, userId: user!.id };

      // Case A — balanced (cash debit 100 / sales credit 100) → posts cleanly.
      let aErr: unknown;
      try {
        await q.savepoint((sp) =>
          attemptPost(sp, ctx, 1, [
            { accountId: cash!.id, debit: 100, credit: 0 },
            { accountId: sales!.id, debit: 0, credit: 100 },
          ]),
        );
      } catch (e) {
        aErr = e;
      }
      record('balanced entry can be posted', !aErr, aErr ? String(aErr) : '');

      // Case B — unbalanced (100 vs 90) → must be rejected.
      let bErr: unknown;
      try {
        await q.savepoint((sp) =>
          attemptPost(sp, ctx, 2, [
            { accountId: cash!.id, debit: 100, credit: 0 },
            { accountId: sales!.id, debit: 0, credit: 90 },
          ]),
        );
      } catch (e) {
        bErr = e;
      }
      record('unbalanced entry rejected on post', !!bErr, bErr ? firstLine(bErr) : 'NOT rejected!');

      // Case C — empty (no lines) → must be rejected by trg_balanced_on_post.
      let cErr: unknown;
      try {
        await q.savepoint((sp) => attemptPost(sp, ctx, 3, []));
      } catch (e) {
        cErr = e;
      }
      record('empty entry rejected on post', !!cErr, cErr ? firstLine(cErr) : 'NOT rejected!');

      // 铁律 5 — write_audit() fires on a ledger write, actor read from app.user_id.
      await q`SELECT set_config('app.user_id', ${user!.id}, true)`; // true = SET LOCAL
      const [acct3] = await q<{ id: string }[]>`
        INSERT INTO accounts (org_id, code, name, account_type, normal_balance)
        VALUES (${org!.id}, '1010', 'Bank', 'asset', 'debit') RETURNING id`;
      const audit = await q<{ actor_user_id: string; action: string }[]>`
        SELECT actor_user_id, action FROM audit_log
        WHERE entity = 'accounts' AND entity_id = ${acct3!.id}`;
      record(
        'write_audit() logged the account insert with actor',
        audit.length === 1 && audit[0]!.action === 'insert' && audit[0]!.actor_user_id === user!.id,
        audit.length ? `actor=${audit[0]!.actor_user_id}` : 'no audit row',
      );

      throw ROLLBACK; // discard everything above
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

async function ledgerAppPerms() {
  console.log('\n\x1b[1mledger_app privileges (铁律 5) — live connection\x1b[0m');
  if (!APP_URL) {
    record('ledger_app live audit_log check', false, 'APP_DATABASE_URL not set — skipped');
    return;
  }
  const app = postgres(APP_URL, { max: 1 });
  try {
    let selectOk = false;
    try {
      await app`SELECT count(*) FROM audit_log`;
      selectOk = true;
    } catch (e) {
      selectOk = false;
      record('ledger_app can SELECT audit_log', false, firstLine(e));
    }
    if (selectOk) record('ledger_app can SELECT audit_log', true);

    let denied = false;
    try {
      await app`INSERT INTO audit_log (org_id, action, entity) VALUES (gen_random_uuid(), 'x', 'y')`;
    } catch (e) {
      denied = /permission denied/i.test(String(e));
    }
    record('ledger_app INSERT into audit_log denied', denied);
  } finally {
    await app.end();
  }
}

const firstLine = (e: unknown) => String(e instanceof Error ? e.message : e).split('\n')[0];

async function main() {
  if (!ADMIN_URL) {
    console.error('DATABASE_URL not set. Fill .env (see .env.example) then re-run.');
    process.exit(2);
  }
  console.log('\x1b[1mConnect Finance 4U — schema verification\x1b[0m');
  const sql = postgres(ADMIN_URL, { max: 1 });
  try {
    await introspect(sql);
    await functionalBalance(sql);
    await ledgerAppPerms();
  } finally {
    await sql.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? '\x1b[32m' : '\x1b[31m'}${results.length - failed.length}/${results.length} checks passed\x1b[0m`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
