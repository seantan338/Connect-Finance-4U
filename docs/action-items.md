# 待 Sean 处理 (Action Items)

> Claude 做不了、需要你拍板或动手的事。按优先级排。最后更新:2026-06-22。

## 🔴 关键路径 / 尽快

1. **MyInvois 认证申请 + 数字证书**(Roadmap critical path)— **M1.3 真提交就卡这**
   - LHDN 外部审批,有 lead time。M1.3 的管线我已写好并用 mock 测通;接真 sandbox 只差:
     - **client_id / client_secret**(MyInvois portal 注册「ERP 系统」)→ 填 `.env` 的 `MYINVOIS_CLIENT_ID/SECRET` + `MYINVOIS_ENV=sandbox`。
     - **LHDN 认可的数字证书**(文档签名 XAdES/JAdES 用,缺口 G7)→ 没它 sandbox 也只能「提交」拿不到 Valid。
   - 拿到后告诉我,我写真 httpTransport(OAuth + submit + poll + 签名),把 mock 换掉跑通 UUID+valid。

2. **Zeabur Postgres 接上真库**(才能脱离本地验证)
   - 在仓库根建 `.env`(参考 `.env.example`),填:
     - `DATABASE_URL`(admin/owner,需有 `CREATEROLE` 权限)
     - `APP_DATABASE_URL`(运行时用的 `ledger_app` 角色)
   - 跑:`pnpm --filter @cf4u/db migrate`
   - 设密码(免装 psql):`pnpm --filter @cf4u/db set-app-password <挑一个>`,把同一个密码填进 `APP_DATABASE_URL`
   - 跑:`pnpm --filter @cf4u/db seed` 然后 `pnpm --filter @cf4u/db verify`(期望 19/19)
   - ⚠️ 若 Zeabur 主账号没有 `CREATEROLE`,告诉我,我改用 migration 外建角色的方案。

## 🟡 需要你确认 / 决定

3. **决策确认**:`docs/decisions.md` 的 ADR-0001/0002/0003(凭证平衡才落库、trial balance as-at、当期损益计算式)。你之前口头认可,确认就当 Accepted。
4. **下一里程碑**:确认走 **M1.3**(MyInvois sandbox)还是先补 **payments 收付款核销**(M1.2 我按计划没做,Roadmap 也把它放在更后)。
5. **是否开 PR / 合并到 main**:目前所有工作在 `claude/connect-finance-phase-1-tfeu5l`,**未开 PR**(按规矩没你指示不自动开)。要合并/开 PR 告诉我。

6. **M1.3 e-Invoice 字段缺口 G1–G7**(详见 `docs/compliance-einvoice.md`)。要紧的几个:
   - **G1**:org 缺 address / MSIC / phone(MyInvois 必填)。现在从 `MYINVOIS_SUPPLIER_*` env 注入兜底。要不要正式加进 `organizations` 表(改 schema)?
   - **G4**:每行必填 classification code,前端已加输入框。要不要给个常用码下拉(而非手填)?
   - **G6**:`tax_codes` 只有 rate,没 MyInvois 税类(01 Sales / 02 Service / 06 NA / E)。SST-6 算 Service(02)还是 Sales(01)?建议给 `tax_codes` 加一列 `myinvois_category`。
   - **G2**:要不要支持 B2C(个人买家无 TIN,用通用 TIN)?

## 🟢 之后会需要(还不急)

6. **Firebase 项目**:M1.x 真实多租户登录要用 Firebase Auth。现在前端用 demo org/user 常量(`DEMO_ORG_ID/DEMO_USER_ID`)。届时给我 Firebase config 填 `.env` 的 `VITE_FIREBASE_*`。
7. **n8n / Zeabur 部署**:apps/api + apps/web 上 Zeabur 的部署配置(M1.4 内部上线前)。

## 本地怎么跑(给你 review 用)
```bash
# 填好 .env(见上)后:
pnpm install
pnpm --filter @cf4u/db migrate
psql "$DATABASE_URL" -c "ALTER ROLE ledger_app PASSWORD '...';"   # 然后填进 APP_DATABASE_URL
pnpm --filter @cf4u/db seed
pnpm --filter @cf4u/api dev      # http://localhost:8787
pnpm --filter @cf4u/web dev      # http://localhost:5173
```
