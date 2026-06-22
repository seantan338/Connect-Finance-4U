# CLAUDE.md — Connect Finance 4U (Ledger Project)

> Malaysian SME accounting software for the JB–SG corridor.
> **Postgres = financial truth · Firebase = experience · 合规内置不靠插件.**
> This file is the **context ritual**: read it at the start of every session, before touching code.

---

## 0. Source of truth (读这四份,冲突就停下来问)

任何决策与这四份文档冲突 → **停下来问 Sean**,不要自作主张:

| File | 作用 |
|---|---|
| `docs/capability-design-matrix.html` | 真相来源 · 能力矩阵(PRD/Roadmap/Schema 的派生源头) |
| `docs/Roadmap.md` | Phase / Milestone 计划 |
| `docs/data-model-spec.html` | 架构决策(为什么 Postgres 不是 Firestore) |
| `docs/schema.sql` | 数据库真相(含所有 CHECK / trigger / role) |
| `docs/decisions.md` | 实现层决策记录(ADR);先按行业标准,不适用再改 |

---

## 五条铁律 (违反就是 bug,不是风格问题)

### 铁律 1 — Financial truth 全部落 PostgreSQL,绝不放 Firestore
- 所有账目真相在 Postgres:`journal_entries` / `journal_lines` / `accounts` / `fiscal_periods` /
  `invoices` / `einvoice_submissions` / `payments` / `audit_log` / trial balance / 合并报表。
- Firebase 只做三件事:**Auth**(`app_users.firebase_uid` 桥接)、**实时协作**(presence/光标)、**Storage**(附件)。

**修正 A — 「草稿」的归属边界(判定标准 = 有没有落库,不是 draft/posted):**
- ✅ **已落库的草稿凭证**(`journal_entries.is_posted = false`)→ **Postgres**。
  它没 post、不进余额,但已是结构化账目实体(有 entry_no / period_id / lines),归 truth DB。
- ✅ **Firestore 只存「还没落库的瞬时态」**:正在敲还没保存的表单、协作 presence/光标、通知。
- 🔴 红线:任何一旦成为账目实体的数据(哪怕 `is_posted=false`)都在 Postgres,Firestore 永远碰不到 ledger 表。
- 一句话:**分界线不是 draft/posted,是「落没落库」**。

### 铁律 2 — 余额只能由 posted journal_entries 推导,绝不直接写账户余额
- 不存在被代码 `UPDATE` 的 `accounts.balance` 字段。
- 余额永远是 `SELECT SUM(debit) - SUM(credit) ... WHERE is_posted` 算出来。
- invoice / payment **不动余额**,它们过账生成 `journal_entries`,余额随分录派生。
- 🔴 红线:任何 `UPDATE ... SET balance` 都是 bug。

### 铁律 3 — 每张凭证 Σdebit = Σcredit(四层防线,一层都不简化)
**修正 B — 平衡现在是四层一致防线,翻译/实现时全部保留:**
1. **DB:`trg_balanced`** — constraint trigger ON `journal_lines`(`DEFERRABLE INITIALLY DEFERRED`),
   `is_posted=true` 时强制 `SUM(debit)=SUM(credit)`。防改 posted 凭证的行。
2. **DB:`trg_balanced_on_post`** — constraint trigger ON `journal_entries`(`AFTER INSERT OR UPDATE OF is_posted`),
   翻 `is_posted` false→true 时校验 `d=0 OR d<>c` 都拒。防「只 UPDATE header 把不平/空草稿翻成 posted」绕过 lines 触发器。
3. **应用层** `createJournalEntry` / `postEntry`(`/packages/core`)再算一遍 Σdebit=Σcredit,不平直接拒,不靠 DB 报错兜底。
4. **前端** New Journal Entry 表单:差额≠0 → Post 按钮禁用并标红;=0 → 变绿可提交。

### 铁律 4 — e-Invoice / SST 原生内置,不做插件
- `einvoice_submissions`(MyInvois 55 字段 JSONB payload / UUID / status / validation / 数字签名)、
  `tax_codes`(SST)、`invoices.doc_type`(含 credit_note / debit_note / self_billed)都是核心 schema 的一等公民。
- 第一天就在主表里,不是后挂模块。

### 铁律 5 — audit_log append-only,从权限层杜绝篡改
**修正 B(续)— audit 是真约束,不是约定:**
- **`write_audit()`** = `SECURITY DEFINER SET search_path = public` 触发器,挂在
  `accounts` / `journal_entries` / `invoices` / `payments` / `contacts` 上,自动写 before/after JSONB 快照。
- 读事务上下文:应用每个事务开头注入 `SET LOCAL app.user_id = '<uuid>'; SET LOCAL app.ip = '<addr>';`
- **`ledger_app`** 角色:全表 CRUD,但对 `audit_log` 是 **REVOKE INSERT/UPDATE/DELETE + 仅 GRANT SELECT**。
  审计写入由 definer 触发器代劳,应用连 INSERT 都不需要。
- 🔴 红线:任何给 `ledger_app` 授 audit_log 写权限、或绕过 `write_audit()` 手写审计的代码都是 bug。

---

## 技术栈 (固定,不再纠结)

| 层 | 选型 |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind |
| **Truth DB** | **PostgreSQL on Zeabur**(pgvector 已可用) |
| Experience | Firebase(Auth / Firestore 仅 UI 草稿 / Storage) |
| ORM | Drizzle(类型安全,贴近 SQL,schema-first) |
| 部署 | Zeabur · 自动化 n8n · 向量/AI pgvector + Claude API |

### Monorepo 结构
```
/apps/web        Vite + React + TS + Tailwind 前端
/packages/db     Drizzle schema + migrations(从 docs/schema.sql 翻译,保留全部 CHECK/trigger/role)
/packages/core   记账领域逻辑(过账 / trial balance / 平衡校验,纯函数 + 测试优先)
/docs            四份真相文档
```

### Drizzle ↔ schema.sql 翻译纪律
- Drizzle codegen 只生成表 / 索引 / CHECK。**plpgsql 函数、constraint trigger、ROLE、GRANT/REVOKE
  不会被生成** → 这些作为手写 SQL migration(`packages/db/drizzle/*.sql`)随迁移一起跑,**一句不漏**。
- 两个 balance 触发器 + `write_audit` 触发器 + `ledger_app` role/grant 是红线,改 schema 时先核对它们还在。

---

## Session ritual (每次开工前)
1. 读这份 CLAUDE.md 的五条铁律(含修正 A/B)。
2. 扫一眼 `docs/` 四份真相文档,确认改动不与之冲突。
3. 任何冲突 / 模糊 → 停下来问 Sean,不自作主张往下冲。
4. 风格:**结论先行,不堆免责声明,technical terms 保留英文。**
5. 节奏:按 Roadmap milestone 走,每步做完停下来 review,不擅自往下个 milestone 冲。

## 当前进度
- **Phase 1 · M1.1** — CoA + 手工 journal entry + trial balance 平账。**进行中**。
- 范围纪律:M1.1 建全部表(trigger/CHECK/role 不阉割),但领域逻辑 + 前端只做
  **CoA + manual journal entry + trial balance** 三块,不碰开票/收付款业务逻辑。
