# Ledger Project — Roadmap

> **Source of truth:** `capability-design-matrix.html`
> **Data model:** `data-model-spec.html` + `schema.sql`
> **Version:** v0.1 · Phase 0
> **Owner:** Sean (Sunrise Recruit)

---

## 1. Vision

为 **JB–SG corridor 的 SME** 做一款会计软件:把马来西亚所有主流会计软件(SQL / AutoCount / QNE / Bukku / Financio / Xero / QuickBooks)的 **pro 全部收进来**,把它们的 **con 全部反转成设计原则**。

一句话定位:

> **SQL/AutoCount 的合规深度 × Xero 的云端体验 × 原生跨境多实体。**

**不做什么(防 scope 蔓延):**

- 不做 payroll(Phase 4 之后再议,先靠集成)
- 不做完整 ERP(制造排程、CRM 不碰)
- 不自建银行牌照 / 支付清算

---

## 2. 不可妥协的设计原则(Con → Principle)

| 竞品痛点(借) | 本产品原则(贷) |
|---|---|
| 界面老派 / 桌面思维 | Cloud-native,现代 UI,移动端可用 |
| 云端弱、on-prem 为主 | SaaS 优先,数据实时同步 |
| 多公司 / 多币种不灵活 | multi-entity + multi-currency 为一等公民 |
| 数据库封闭 / 依赖 reseller | 开放 API + 自助配置 |
| 生态小 / 集成少 | API-first,webhook,第三方市场 |
| 技术栈陈旧 | 现代 stack,持续迭代 |
| 复杂库存 / 制造吃力 | 模块化,轻量起步可挂深度 inventory |
| e-Invoice / SST 靠插件 | 合规内置,第一天就原生 |
| 月费高 | 分层定价,免费档 + SME 友好 |
| 会计师不熟 / 交接难 | Partner Program + 标准 CoA + 一键导出 |
| 实施周期长 / overkill | 自助 onboarding + 一键迁移 |

---

## 3. 技术栈(已拍板,不再纠结)

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | React + Vite + TypeScript + Tailwind | 既有 stack |
| **Financial truth** | **PostgreSQL (Zeabur)** | ACID、复杂 join、借贷平衡硬约束。**绝不放 Firestore** |
| 体验层 | Firebase(Auth / 实时协作 / Storage) | `app_users.firebase_uid` 桥接 Postgres |
| 部署 | Zeabur | 既有 |
| 自动化 | n8n | 既有,Phase 2 做原生 node |
| 向量 / AI | pgvector(已在用)+ Claude API | AI 分类 / OCR |

> **核心规则:** ledger 只能由 posted `journal_entries` 变动,余额永远从分录推导,任何模块都不直接写余额。

---

## 4. Phase 计划

> 节奏按 **单人 + AI 协作**;扩到 2–3 人可压到 7–8 个月到 GA。

### Phase 0 — Foundation 〔Week 1–4 / Month 1〕

**目标:** 地基定稿,脚手架跑通,合规申请并行启动。

| Deliverable | 状态 |
|---|---|
| Capability / Design Matrix | ✅ done |
| Data Model Spec + `schema.sql` | ✅ done |
| Roadmap.md | ✅ done(本文件) |
| Compliance Spec(MyInvois 55 字段 + SST + MPERS/MFRS 映射) | ☐ |
| System Architecture(Postgres↔Firebase 边界、过账时序、API 分层) | ☐ |
| PRD(分模块) | ☐ |
| Repo scaffold + `CLAUDE.md` + Postgres 迁移跑通 | ☐ |
| **MyInvois / Peppol 认证申请启动** | ☐ **CRITICAL PATH** |

**Exit criteria:** schema 在 Zeabur Postgres 跑通迁移;前端可登录(Firebase Auth)并读到一个 org;认证申请已递交。

---

### Phase 1 — MVP(单实体闭环)〔Week 5–18 / Month 2–4.5〕

**目标:** 一家公司能完整记账 + 合法开 e-Invoice + 出三表。**可内部自用。**

**P0 capabilities:**

- Double-entry ledger engine(借贷平衡 trigger)
- Chart of Accounts(MPERS 模板 + 一键导出)
- Fiscal period & close
- Immutable audit trail
- Sales / Purchase invoicing
- **MyInvois native submission**(55 字段 · UUID · 数字签名)
- Credit / debit note lifecycle
- SST module
- Trial Balance / P&L / Balance Sheet
- Granular RBAC
- Data residency / PDPA / 加密

**里程碑:**

- **M1.1**(W8):CoA + 手工 journal entry,trial balance 平账
- **M1.2**(W12):销售/采购发票 → 过账 → 三表自动生成
- **M1.3**(W16):MyInvois 原生提交跑通(sandbox),拿到 UUID + valid
- **M1.4**(W18):SST 报表 + 期间关账 + 审计留痕,内部上线自用

**Exit criteria:** 用真实 Sunrise 账目跑一个完整月度闭环;e-Invoice 在 LHDN sandbox validate 通过。

---

### Phase 2 — Beta(跨境 + 自动化)〔Week 19–32 / Month 5–8〕

**目标:** 多实体合并、多币种、自动对账,能从旧系统迁入。

**P1 capabilities:**

- Multi-entity + consolidation
- Multi-currency + exchange rates
- Peppol connectivity
- Bank feed + auto-reconciliation
- AI transaction categorization
- Recurring transactions
- Open REST API + webhooks
- **Migration tool(AutoCount / SQL 一键迁入)** — GTM 关键
- MPERS / MFRS statements
- Self-billed e-Invoice
- Consolidated reports

**里程碑:**

- **M2.1**(W22):第二实体 + 合并报表
- **M2.2**(W26):多币种 + JB–SG 跨境场景跑通
- **M2.3**(W29):AutoCount/SQL 迁移工具(导入 CoA + 余额 + 历史发票)
- **M2.4**(W32):银行对账自动化 + AI 分类,邀请 3–5 家 beta 客户

**Exit criteria:** 一家 beta 客户从 AutoCount 完整迁入并跑通一个月。

---

### Phase 3 — GA(深度 + 上市)〔Week 33–52 / Month 9–12〕

**目标:** 深度库存、自助 onboarding、伙伴体系、定价分层、安全加固。

**P2 capabilities:**

- Inventory / manufacturing 模块
- POS integration
- n8n native nodes
- AI document / OCR extraction
- Custom report builder
- Self-serve onboarding
- Free tier + tiered pricing
- Accountant Partner Program

**里程碑:**

- **M3.1**(W38):inventory 模块 + 成本核算
- **M3.2**(W42):自助 onboarding + 定价 + billing
- **M3.3**(W46):Accountant Partner Program 上线
- **M3.4**(W50):pen-test + data residency 认证
- **M3.5**(W52):**GA 发布**

**Exit criteria:** 安全审计通过;首批付费客户上线;伙伴会计师可独立 onboard 客户。

---

## 5. Critical Path 与风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **MyInvois / Peppol 认证 lead time** | 卡死 Phase 1 上线 | **Phase 0 就递交申请**,与开发并行 |
| 复式记账内核设计错误 | 全盘重来 | schema + 平衡 trigger 已 Phase 0 锁定,先写测试 |
| 迁移工具难度被低估 | Phase 2 拖期 | 先只支持 AutoCount/SQL 两家的标准导出格式 |
| 合规规则变动(LHDN 调整) | 返工 | payload 用 JSONB,字段映射可配置 |
| 单人带宽 | 全程拖期 | Phase 1 末考虑加 1 名工程师 |

> **e-Invoice 时间表背景:** Phase 4(RM 1m–5m turnover)2026/1 生效,但 LHDN 把免罚宽限延到 2027/12/31;turnover < RM 1m 永久豁免。→ 客户上线紧迫度按营业额档分级,可作为 GTM 优先级排序依据。

---

## 6. 成功指标

| 阶段 | 指标 |
|---|---|
| MVP | 内部全月闭环 · e-Invoice sandbox 通过 · trial balance 零差 |
| Beta | 3–5 家 beta · ≥1 家完成 AutoCount 迁入 · 多实体合并准确 |
| GA | 首批付费客户 · ≥3 名伙伴会计师 · 安全审计通过 |

---

## 7. 文档派生关系

```
capability-design-matrix.html   ← 真相来源
        │
        ├── Roadmap.md           ← 本文件
        ├── data-model-spec.html + schema.sql
        ├── Compliance Spec      ← 下一份
        ├── System Architecture  ← 下一份
        └── PRD(分模块)
```

---

*Ledger Project · Roadmap v0.1 · Postgres = truth · Firebase = experience · 合规内置不靠插件*
