# 本地起项目 — Windows + Zeabur Postgres

> 给一台全新的 Windows PC 把 Connect Finance 4U 跑起来 review。
> 财务真相库用 Zeabur(免本地装数据库,也免 psql)。命令在 **PowerShell** 里跑。

## A. 装工具(装完**重开 PowerShell** 让 PATH 生效)
```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
# 重开 PowerShell,然后:
npm install -g pnpm
```
验证:`node -v`(≥ 22)、`pnpm -v`、`git --version` 都有输出。

## B. 拉代码 + 切分支
```powershell
git clone https://github.com/seantan338/Connect-Finance-4U.git
cd Connect-Finance-4U
git checkout claude/connect-finance-phase-1-tfeu5l
pnpm install
```

## C. Zeabur 开 Postgres
1. Zeabur 控制台 → project → **Add Service → Marketplace → PostgreSQL**,等部署完成。
2. 进该服务 → **Networking** 开 **Public**(让 PC 连得上)→ 复制**公网连接串**:
   `postgresql://root:ROOT_PW@HOST:PORT/zeabur`

## D. 建 `.env`(仓库根目录)
```powershell
Copy-Item .env.example .env
notepad .env
```
填两行(host/port/db 相同,用户/密码不同):
```
DATABASE_URL=postgresql://root:ROOT_PW@HOST:PORT/zeabur
APP_DATABASE_URL=postgresql://ledger_app:APP_PW@HOST:PORT/zeabur
```
- `DATABASE_URL` = admin(root),用于迁移/seed/verify。
- `APP_DATABASE_URL` = 运行时受限角色 `ledger_app`(由迁移创建,密码下一步设)。
- 连不上报 SSL 错就在两条末尾都加 `?sslmode=require`。

## E. 建表 → 设密码 → 灌数据 → 自检
```powershell
pnpm --filter @cf4u/db migrate
pnpm --filter @cf4u/db set-app-password APP_PW   # 与 APP_DATABASE_URL 里一致;免装 psql
pnpm --filter @cf4u/db seed
pnpm --filter @cf4u/db verify                    # 期望 19/19
```

## F. 跑起来(一条命令同时起 api + web)
```powershell
pnpm dev          # api → http://localhost:8787 · web → http://localhost:5173
```
> 想分开看日志:开两个 PowerShell,分别 `pnpm dev:api` 和 `pnpm dev:web`。

浏览器开 **http://localhost:5173**:CoA / Contacts / Invoices / New Journal Entry / Trial Balance / Reports。
试一张销售发票点 issue,看三表自动平账。

## 常见坑
- **SSL**:Zeabur 公网库通常要 SSL。两条连接串末尾都加 `?sslmode=require`(postgres.js 的 `require`
  = 加密但不校验自签证书,正合用)。仍报 `self-signed certificate` 就把报错发我。
- **`CREATE ROLE` 失败 / `permission denied to create role`**:`migrate` 在建 `ledger_app` 角色时,
  若 Zeabur 的 root **不是** superuser、也没 `CREATEROLE`,这步会失败。补救:在 Zeabur 该 Postgres 服务的
  SQL console(或任意 admin 连接)里手动跑一次下面这段,再回去重跑 `set-app-password` / `seed` / `verify`:
  ```sql
  CREATE ROLE ledger_app LOGIN;
  GRANT USAGE ON SCHEMA public TO ledger_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ledger_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledger_app;
  REVOKE INSERT, UPDATE, DELETE ON audit_log FROM ledger_app;   -- 红线:audit 只读
  GRANT SELECT ON audit_log TO ledger_app;
  ```
  (这段就是迁移 `0001` 里的角色部分;手动跑等价。)若连这段都报权限不足,说明 root 权限太低 → 发我,换方案。
- **端口被占**:8787 / 5173 被占就先关掉占用进程,或设环境变量 `API_PORT` 换 api 端口。

跑通 `verify 19/19` + 浏览器能开 = 完成 `docs/action-items.md` 第 2 条(接真库)。
