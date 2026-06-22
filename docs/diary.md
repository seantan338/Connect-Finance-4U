# 工作日记 (Dev Diary)

> 每天/每个 session 记录做了什么、为什么、抓到什么坑。最新在上。
> Postgres = truth · Firebase = experience · 合规内置不靠插件。

---

## 2026-06-22 — M1.1 全部 + M1.2 全部(单 session)

**人物:** Sean(owner)+ Claude(lead engineer)。节奏:每步真跑(本地起 Postgres 16 跑迁移/测试/全栈),做完 commit + push 到 `claude/connect-finance-phase-1-tfeu5l`。

### M1.1 — CoA + 手工 journal entry + trial balance(✅)
- **Step 1** `6e66cd1` — pnpm monorepo(apps/web · packages/db · packages/core);docs/ 放四份真相文档;CLAUDE.md 五条铁律 + 修正 A/B;Drizzle 翻译 17 张表,两个 balance 触发器 + write_audit + ledger_app role/grant 作为手写 SQL migration(`0001`)一句不漏。
- **Step 2** `94b5ffa` — migrate + verify 脚本。**坑1**:drizzle migrator 按字面切 `--> statement-breakpoint`,连注释里的也切 → 注释腰斩出裸反引号 → 语法错。**坑2**:`ledger_app` 缺 schema `public` 的 USAGE,表级 GRANT 形同虚设 → 加显式 `GRANT USAGE`(经 Sean 批准并同步回 schema.sql)。verify 19/19。
- **Step 3** `a68e47b` — MPERS trading-SME 58 科目 CoA 模板 + 幂等 `seedChartOfAccounts`(onboarding 复用)。**坑3**:`withAuditContext` 用了 `SET LOCAL app.user_id = $1`,但 `SET` 不接受 bind 参数 → 改 `set_config(...,true)`。
- **Step 4** `21ca3a0` — core 领域逻辑(测试优先):decimal-safe money(scale-4 bigint,绝不用 number)、createJournalEntry / postEntry / getTrialBalance。11/11(含真 PG 集成)。
- **Step 5** `aaf9d15` — 前端三屏(CoA 树 / New Journal Entry 实时差额禁用 Post / Trial Balance 底部断言)+ 薄 API(Hono,跑 ledger_app 角色)。**架构新增**:`apps/api`(浏览器不能直连 Postgres = 铁律 1)。
- 决策记录 `9bcb147` — ADR-0001(凭证必须平衡才落库)、ADR-0002(trial balance as-at 累计口径);trial balance 改 as-at。

### M1.2 — 发票 → 过账 → 三表(✅)
- **Step 1** `88841c3` — contacts + SST tax codes(core + API + 前端 Contacts 页);seed SST-6/SST-0。**坑4**:drizzle 把 PostgresError 包进 `e.cause`,23505 要查两层 → 重复税码才正确映射 ConflictError。**坑5**:teardown 没删 contacts/tax_codes 撞 FK。
- **Step 2** `be1d768` — invoice 领域逻辑:createInvoice(行 × tax_code 算 subtotal/tax/grand)、issueInvoice(draft→issued 过账并回填 journal_entry_id,余额随分录派生)。抽出 `allocateAndInsertEntry` 让发票和手工分录共用同一条平衡写入路径。20/20。
- **Step 3** `e5baaa3` — 三表:抽共享 `postedBalancesAsOf`,加 getProfitAndLoss + getBalanceSheet。ADR-0003:当期损益用计算式(A=L+E+net),不在 M1.2 生成结转分录(留 M1.4 close)。23/23。
- **Step 4+5** `bc23eba` — 发票 + 三表的 API + 前端(Invoices 页带实时合计、Reports 页 P&L/BS 切换 + 平衡断言)。全栈实测:销售发票 10×100+6% SST → grand 1060、JE 自动过账;P&L net 1000;BS A1060 = L60 + E1000 平;TB Dr=Cr。

### 状态
- 测试:**23/23**(money/ledger/directory/invoice/reports);typecheck 全绿;web build 通过;全栈在 PG16 实测通过。
- **每步真跑共抓到 5 个上线才会爆的坑**——这套「跑给自己看」的纪律值。
