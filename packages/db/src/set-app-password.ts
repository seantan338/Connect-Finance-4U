/**
 * 给受限角色 ledger_app 设密码 —— 免去本机装 psql。
 * migrate 之后跑(ledger_app 由迁移创建,初始无密码):
 *
 *   pnpm --filter @cf4u/db set-app-password <password>
 *   # 或 set LEDGER_APP_PASSWORD=... 再跑
 *
 * 用 admin DATABASE_URL 连接执行 ALTER ROLE。把同一个密码填进 .env 的 APP_DATABASE_URL。
 */
import postgres from 'postgres';

const pw = process.argv[2] ?? process.env.LEDGER_APP_PASSWORD;
const url = process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL not set (admin connection). Fill .env first.');
  process.exit(2);
}
if (!pw || !/^[A-Za-z0-9_\-.!@#%^*+=]{6,}$/.test(pw)) {
  console.error(
    'Usage: pnpm --filter @cf4u/db set-app-password <password>\n' +
      '(>=6 chars, letters/digits/_-.!@#%^*+= only)',
  );
  process.exit(2);
}

const sql = postgres(url, { max: 1 });
try {
  // ALTER ROLE ... PASSWORD 只接受字符串字面量(不能 bind);单引号转义后内联。
  const escaped = pw.replace(/'/g, "''");
  await sql.unsafe(`ALTER ROLE ledger_app PASSWORD '${escaped}'`);
  console.log('✓ ledger_app password set. Put the same password in APP_DATABASE_URL in .env.');
} catch (e) {
  console.error('Failed to set password:', e instanceof Error ? e.message : e);
  console.error('(role ledger_app must exist — run `pnpm --filter @cf4u/db migrate` first.)');
  process.exitCode = 1;
} finally {
  await sql.end();
}
