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

## F. 跑起来(两个 PowerShell 窗口,都在项目目录)
```powershell
pnpm --filter @cf4u/api dev     # 窗口1 → http://localhost:8787
pnpm --filter @cf4u/web dev     # 窗口2 → http://localhost:5173
```
浏览器开 **http://localhost:5173**:CoA / Contacts / Invoices / New Journal Entry / Trial Balance / Reports。
试一张销售发票点 issue,看三表自动平账。

## 常见坑
- **SSL**:Zeabur 公网库常要 SSL → 连接串末尾加 `?sslmode=require`。
- **`CREATE ROLE` 失败**:Zeabur 的 root 没 `CREATEROLE` 权限 → 把报错发出来,改用不靠应用建角色的方案。
- **端口被占**:8787 / 5173 被占就先关掉占用进程,或改 `API_PORT` 环境变量。

跑通 `verify 19/19` + 浏览器能开 = 完成 `docs/action-items.md` 第 2 条(接真库)。
