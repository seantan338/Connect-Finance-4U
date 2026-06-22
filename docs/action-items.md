# 待 Sean 处理 (Action Items)

> Claude 做不了、需要你拍板或动手的事。按优先级排。最后更新:2026-06-22。

## 🔴 关键路径 / 尽快

1. **MyInvois / Peppol 认证申请**(Roadmap critical path,Phase 0 就该启动)
   - 这是 LHDN/MDEC 的**外部审批**,有 lead time,不是写代码能解决的。
   - M1.3(W16)要在 sandbox 跑通 e-Invoice 提交,**没有这个申请会卡死**。
   - 需要你:以 Sunrise 公司身份递交 MyInvois API / Peppol 接入申请,拿到 sandbox 凭据。

2. **Zeabur Postgres 接上真库**(才能脱离本地验证)
   - 在仓库根建 `.env`(参考 `.env.example`),填:
     - `DATABASE_URL`(admin/owner,需有 `CREATEROLE` 权限)
     - `APP_DATABASE_URL`(运行时用的 `ledger_app` 角色)
   - 跑:`pnpm --filter @cf4u/db migrate`
   - 设密码:`psql "$DATABASE_URL" -c "ALTER ROLE ledger_app PASSWORD '<挑一个>';"`,把密码填进 `APP_DATABASE_URL`
   - 跑:`pnpm --filter @cf4u/db seed` 然后 `pnpm --filter @cf4u/db verify`(期望 19/19)
   - ⚠️ 若 Zeabur 主账号没有 `CREATEROLE`,告诉我,我改用 migration 外建角色的方案。

## 🟡 需要你确认 / 决定

3. **决策确认**:`docs/decisions.md` 的 ADR-0001/0002/0003(凭证平衡才落库、trial balance as-at、当期损益计算式)。你之前口头认可,确认就当 Accepted。
4. **下一里程碑**:确认走 **M1.3**(MyInvois sandbox)还是先补 **payments 收付款核销**(M1.2 我按计划没做,Roadmap 也把它放在更后)。
5. **是否开 PR / 合并到 main**:目前所有工作在 `claude/connect-finance-phase-1-tfeu5l`,**未开 PR**(按规矩没你指示不自动开)。要合并/开 PR 告诉我。

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
