# 设计决策记录 (Design Decisions / ADR)

> 记录会与「四份真相文档」并列、但属于实现层的取舍。原则:**先按行业标准执行,
> 到时候不适用再改**。每条注明 status,改动时更新而不是删除。

---

## ADR-0001 — Journal entry 必须平衡才能落库(draft = balanced-but-unposted)

- **Status:** Accepted · M1.1 · 2026-06
- **Context:** `createJournalEntry` 是否允许保存一张「借贷不平的半成品 draft」?

- **行业标准:** Xero / QuickBooks / SQL Account / AutoCount / MYOB 的手工日记账,
  **保存/过账前都要求 Σdebit = Σcredit**,不平的凭证根本无法记录入账。编辑中的、
  还没平的内容是客户端临时态,不进总账库。

- **Decision:**
  - `createJournalEntry` 在落库前做应用层平衡校验,不平直接拒(`UnbalancedEntryError`)。
  - 落库的 draft(`is_posted=false`)是**已平衡但未过账**的结构化账目实体,归 Postgres。
  - 「还没平、还在敲」的半成品属瞬时态,归 Firestore(对齐 CLAUDE.md 修正 A)。
  - `postEntry` 只负责 draft → posted,过账时再校验一次 + DB `trg_balanced_on_post` 兜底。

- **Consequences:** 与四层平衡防线一致;不支持「存一张不平的 draft」。若将来真有
  「先存残稿、回头再补平」的产品需求,再引入一个独立的 client-side / Firestore 草稿态,
  **不**放宽 Postgres 落库的平衡红线。

---

## ADR-0002 — Trial Balance 采用 as-at 累计口径(截至期末的余额)

- **Status:** Accepted · M1.1 · 2026-06
- **Context:** `getTrialBalance(orgId, periodId)` 汇总「该期间内的发生额」还是「截至期末的累计余额」?

- **行业标准:** 标准 Trial Balance 报表列示**每个账户截至某一日期的余额**,且
  Σ(debit balances) = Σ(credit balances)。「本期发生额」是另一种视图(movement),
  但被称作 *Trial Balance* 的那张表是 **as-at 累计**。

- **Decision:** `getTrialBalance` 取该 period 的 `period_end`,汇总该 org **所有 posted**
  且 `entry_date <= period_end` 的分录(跨期累计),断言 Σdr = Σcr。结果带 `asOf` 日期。
  - 只算 **posted**(铁律 2:余额只从 posted 推导)。
  - draft 不计入。

- **MVP 注记:** M1.1 只有单个 open period,as-at-period-end 与「本期发生额」结果**完全相同**,
  所以现在行为无差异;as-at 口径在多期间出现时才显出正确性(M1.2+)。

- **Consequences:** 多期间下会把往期 posted 余额累计进来(符合 trial balance 定义)。
  期末结转 / retained earnings 的处理属 close 流程,不在 M1.1。若将来需要「本期发生额」
  视图,作为**额外**报表加,不改这张 as-at 的语义。

---

## ADR-0003 — Balance Sheet 的当期损益用「计算式」,不在 M1.2 生成结转分录

- **Status:** Accepted · M1.2 · 2026-06
- **Context:** Balance Sheet 要平(A = L + E),但 income/expense 还没结转进 equity。
  M1.2 是否真的生成一张「P&L → Retained Earnings」的结转分录?

- **行业标准:** 期间内的 BS 普遍把「current year earnings / net profit」作为 equity 段的
  一个**计算行**列示;真正的结转分录(close income/expense to retained earnings)在
  **年度结账(close)**时才做。M1.2 不含 close。

- **Decision:** `getBalanceSheet` 把 `currentYearEarnings = ΣIncome − ΣExpense`(同 P&L 的
  netProfit)作为 equity 段的计算行加入,使 A = L + E + netProfit 恒平。**不**生成结转分录。
  - 依据会计恒等式:posted 凭证 Σ(debit−credit)=0 ⇒ Assets = Liabilities + Equity + (Income−Expense),
    所以计算式天然平。

- **Consequences:** 期末 close(把 P&L 结转进 Retained Earnings 3200、清零 income/expense)
  留到 **M1.4 期间关账**。届时结转分录落地后,BS 的 equity 不再需要这个计算行(改读 Retained Earnings)。
