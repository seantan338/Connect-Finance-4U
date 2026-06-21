/**
 * Dev seed runner — `pnpm --filter @cf4u/db seed`.
 *
 * 用 admin DATABASE_URL 建一套可跑的开发数据:
 *   currencies(MYR/SGD/USD) → demo org + user + 当年 fiscal_period → MPERS CoA 模板。
 * 幂等:固定 UUID + ON CONFLICT,重复跑不重复建。
 *
 * 注:真实 onboarding 只会调 seedChartOfAccounts(orgId);这里的 demo org/user/period
 * 仅供 step 4/5 本地开发与测试。
 */
import { createDb, withAuditContext } from '../client.js';
import { appUsers, currencies, fiscalPeriods, organizations } from '../schema.js';
import { MPERS_TRADING_COA, seedChartOfAccounts } from './coa-mpers.js';

// 固定 demo 标识,保证幂等
const DEMO_ORG_ID = '00000000-0000-0000-0000-0000000000a1';
const DEMO_USER_ID = '00000000-0000-0000-0000-0000000000b1';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set. Fill .env (see .env.example) then re-run.');
    process.exit(2);
  }
  const { db, sqlClient } = createDb(url);
  try {
    // 1. currencies(journal_lines.currency FK 依赖)
    await db
      .insert(currencies)
      .values([
        { code: 'MYR', name: 'Malaysian Ringgit', minorUnit: 2 },
        { code: 'SGD', name: 'Singapore Dollar', minorUnit: 2 },
        { code: 'USD', name: 'United States Dollar', minorUnit: 2 },
      ])
      .onConflictDoNothing();

    // 2. demo org + user
    await db
      .insert(organizations)
      .values({
        id: DEMO_ORG_ID,
        legalName: 'Demo Trading Sdn Bhd',
        brn: '202601000001',
        tin: 'C1234567890',
        sstNo: 'B16-1234-56789012',
        baseCurrency: 'MYR',
        country: 'MY',
      })
      .onConflictDoNothing();
    await db
      .insert(appUsers)
      .values({
        id: DEMO_USER_ID,
        firebaseUid: 'demo-seed-user',
        email: 'demo@connectfinance4u.test',
        displayName: 'Demo Seed User',
      })
      .onConflictDoNothing();

    // 3. 当年 fiscal_period(open)
    const year = new Date().getUTCFullYear();
    await db
      .insert(fiscalPeriods)
      .values({
        orgId: DEMO_ORG_ID,
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-12-31`,
        status: 'open',
      })
      .onConflictDoNothing();

    // 4. MPERS CoA — 在 audit 上下文里跑,write_audit 记到 demo user 名下
    const inserted = await withAuditContext(db, { userId: DEMO_USER_ID }, (tx) =>
      seedChartOfAccounts(tx, DEMO_ORG_ID),
    );

    console.log(`✓ currencies ensured (MYR, SGD, USD)`);
    console.log(`✓ demo org ${DEMO_ORG_ID} (Demo Trading Sdn Bhd)`);
    console.log(`✓ fiscal period ${year}-01-01 … ${year}-12-31 (open)`);
    console.log(
      `✓ MPERS CoA: ${inserted} accounts inserted` +
        (inserted === 0 ? ' (already seeded — idempotent)' : '') +
        ` / template defines ${MPERS_TRADING_COA.length}`,
    );
  } finally {
    await sqlClient.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
