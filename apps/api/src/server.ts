/**
 * Minimal dev API — 浏览器不能直连 Postgres(铁律 1),所以经这层薄 API 走 @cf4u/core。
 * 运行时用 ledger_app 角色(createAppDb);M1.1 的 org/user 用 demo seed 常量。
 *
 *   pnpm --filter @cf4u/api dev      # :8787
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { eq } from 'drizzle-orm';
import {
  createAppDb,
  accounts,
  fiscalPeriods,
  DEMO_ORG_ID,
  DEMO_USER_ID,
} from '@cf4u/db';
import {
  createJournalEntry,
  postEntry,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  createContact,
  listContacts,
  createTaxCode,
  listTaxCodes,
  createInvoice,
  issueInvoice,
  listInvoices,
  DomainError,
  type ContactKind,
  type InvoiceDirection,
  type InvoiceDocType,
  type InvoiceLineInput,
  type JournalLineInput,
} from '@cf4u/core';

const { db } = createAppDb();
const ORG = DEMO_ORG_ID;
const USER = DEMO_USER_ID;

const app = new Hono();
app.use('/api/*', cors({ origin: ['http://localhost:5173'] }));

// 领域错误 → 400 {code,message};其余 → 500。
const fail = (e: unknown) => {
  if (e instanceof DomainError) return { status: 400 as const, body: { code: e.code, message: e.message } };
  console.error(e);
  return { status: 500 as const, body: { code: 'INTERNAL', message: 'internal error' } };
};

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/accounts', async (c) => {
  const rows = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      accountType: accounts.accountType,
      normalBalance: accounts.normalBalance,
      parentId: accounts.parentId,
      isActive: accounts.isActive,
    })
    .from(accounts)
    .where(eq(accounts.orgId, ORG))
    .orderBy(accounts.code);
  return c.json(rows);
});

app.get('/api/periods', async (c) => {
  const rows = await db
    .select({
      id: fiscalPeriods.id,
      periodStart: fiscalPeriods.periodStart,
      periodEnd: fiscalPeriods.periodEnd,
      status: fiscalPeriods.status,
    })
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.orgId, ORG))
    .orderBy(fiscalPeriods.periodStart);
  return c.json(rows);
});

app.get('/api/contacts', async (c) => {
  const kind = c.req.query('kind') as ContactKind | undefined;
  return c.json(await listContacts(db, ORG, kind));
});

app.post('/api/contacts', async (c) => {
  try {
    const b = await c.req.json<{
      kind: ContactKind;
      name: string;
      tin?: string;
      brn?: string;
      sstNo?: string;
      email?: string;
    }>();
    const res = await createContact(db, { orgId: ORG, actorUserId: USER, ...b });
    return c.json(res, 201);
  } catch (e) {
    const { status, body } = fail(e);
    return c.json(body, status);
  }
});

app.get('/api/tax-codes', async (c) => c.json(await listTaxCodes(db, ORG)));

app.post('/api/tax-codes', async (c) => {
  try {
    const b = await c.req.json<{ code: string; rate: string }>();
    const res = await createTaxCode(db, { orgId: ORG, ...b });
    return c.json(res, 201);
  } catch (e) {
    const { status, body } = fail(e);
    return c.json(body, status);
  }
});

interface CreateBody {
  entryDate: string;
  memo?: string;
  post?: boolean;
  lines: JournalLineInput[];
}

app.post('/api/journal-entries', async (c) => {
  let body: CreateBody;
  try {
    body = await c.req.json<CreateBody>();
  } catch {
    return c.json({ code: 'BAD_JSON', message: 'invalid JSON body' }, 400);
  }
  try {
    const entry = await createJournalEntry(db, {
      orgId: ORG,
      entryDate: body.entryDate,
      memo: body.memo,
      createdBy: USER,
      lines: body.lines ?? [],
    });
    if (body.post) await postEntry(db, { entryId: entry.id, userId: USER });
    return c.json({ ...entry, posted: !!body.post }, 201);
  } catch (e) {
    const { status, body: b } = fail(e);
    return c.json(b, status);
  }
});

app.post('/api/journal-entries/:id/post', async (c) => {
  try {
    await postEntry(db, { entryId: c.req.param('id'), userId: USER });
    return c.json({ ok: true });
  } catch (e) {
    const { status, body: b } = fail(e);
    return c.json(b, status);
  }
});

app.get('/api/invoices', async (c) => c.json(await listInvoices(db, ORG)));

interface InvoiceBody {
  direction: InvoiceDirection;
  docType?: InvoiceDocType;
  invoiceNo: string;
  contactId: string;
  issueDate: string;
  issue?: boolean;
  lines: InvoiceLineInput[];
}

app.post('/api/invoices', async (c) => {
  try {
    const b = await c.req.json<InvoiceBody>();
    const inv = await createInvoice(db, {
      orgId: ORG,
      createdBy: USER,
      direction: b.direction,
      docType: b.docType,
      invoiceNo: b.invoiceNo,
      contactId: b.contactId,
      issueDate: b.issueDate,
      lines: b.lines ?? [],
    });
    let issued = null;
    if (b.issue) issued = await issueInvoice(db, { invoiceId: inv.id, userId: USER });
    return c.json({ ...inv, issued }, 201);
  } catch (e) {
    const { status, body } = fail(e);
    return c.json(body, status);
  }
});

app.post('/api/invoices/:id/issue', async (c) => {
  try {
    return c.json(await issueInvoice(db, { invoiceId: c.req.param('id'), userId: USER }));
  } catch (e) {
    const { status, body } = fail(e);
    return c.json(body, status);
  }
});

const statement =
  (fn: typeof getTrialBalance | typeof getProfitAndLoss | typeof getBalanceSheet) =>
  async (c: import('hono').Context) => {
    const periodId = c.req.query('periodId');
    if (!periodId) return c.json({ code: 'BAD_REQUEST', message: 'periodId required' }, 400);
    try {
      return c.json(await fn(db, ORG, periodId));
    } catch (e) {
      const { status, body } = fail(e);
      return c.json(body, status);
    }
  };

app.get('/api/trial-balance', statement(getTrialBalance));
app.get('/api/profit-and-loss', statement(getProfitAndLoss));
app.get('/api/balance-sheet', statement(getBalanceSheet));

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`@cf4u/api listening on http://localhost:${port}  (org ${ORG})`);
