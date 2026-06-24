# Connect Finance 4U — Ledger Project

Malaysian SME accounting software for the JB–SG corridor.
**Postgres = financial truth · Firebase = experience · 合规内置不靠插件.**

> Read `CLAUDE.md` (five iron rules + stack) and `docs/` (four source-of-truth docs +
> `decisions.md`, `diary.md`, `action-items.md`) before touching code.

## Monorepo

```
apps/web        Vite + React + TS + Tailwind v4  (CoA · Contacts · Invoices · Journal · TB · Reports)
apps/api        Hono — thin API over @cf4u/core (browsers can't touch Postgres → 铁律 1)
packages/db     Drizzle schema + migrations (CHECK/trigger/role from docs/schema.sql, verbatim)
packages/core   accounting domain logic (money / journal / invoice / trial balance / P&L / BS) — test-first
docs/           source-of-truth + ADRs + diary + action items
```

## Status (2026-06-22)

- **M1.1 ✅** CoA + manual journal entry + trial balance
- **M1.2 ✅** sales/purchase invoicing → posting → Trial Balance / P&L / Balance Sheet
- Tests: 23/23 (unit + real-Postgres integration). Next: **M1.3** MyInvois sandbox.

## Quickstart

```bash
pnpm install
cp .env.example .env            # fill DATABASE_URL (admin) + APP_DATABASE_URL (ledger_app)

pnpm --filter @cf4u/db migrate                                  # tables + triggers + role
pnpm --filter @cf4u/db set-app-password <pw>                    # set ledger_app pw (no psql needed); same pw → APP_DATABASE_URL
pnpm --filter @cf4u/db seed                                     # demo org + MPERS CoA + SST codes
pnpm --filter @cf4u/db verify                                   # asserts the red-line invariants (19/19)

pnpm dev                        # api :8787 + web :5173 together (or dev:api / dev:web)
```

Windows + Zeabur walkthrough: `docs/local-setup-windows.md`.

Tests: `pnpm -r test` (integration auto-skips without `DATABASE_URL`). Typecheck: `pnpm -r typecheck`.

See `docs/action-items.md` for what needs Sean (Zeabur creds, MyInvois cert, etc.).
