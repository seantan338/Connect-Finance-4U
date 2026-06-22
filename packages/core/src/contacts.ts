/**
 * Contacts(customer / supplier)— M1.2 invoicing 的对手方。
 * 写操作走 withAuditContext(contacts 挂了 write_audit 触发器,铁律 5)。
 *
 * 注:e-Invoice 对手方 tin 必填属 M1.3 校验,这里 tin 仍可选。
 */
import { and, eq } from 'drizzle-orm';
import { type Database, withAuditContext, contacts } from '@cf4u/db';
import { ValidationError } from './errors.js';

export type ContactKind = 'customer' | 'supplier' | 'both';

export interface CreateContactInput {
  orgId: string;
  kind: ContactKind;
  name: string;
  tin?: string;
  brn?: string;
  sstNo?: string;
  email?: string;
  address?: unknown;
  actorUserId: string;
  ip?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function createContact(db: Database, input: CreateContactInput): Promise<{ id: string }> {
  if (!(['customer', 'supplier', 'both'] as const).includes(input.kind)) {
    throw new ValidationError(`invalid contact kind: ${input.kind}`);
  }
  if (!input.name?.trim()) throw new ValidationError('contact name is required');
  if (input.email && !EMAIL_RE.test(input.email)) {
    throw new ValidationError(`invalid email: ${input.email}`);
  }

  return withAuditContext(db, { userId: input.actorUserId, ip: input.ip }, async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({
        orgId: input.orgId,
        kind: input.kind,
        name: input.name.trim(),
        tin: input.tin,
        brn: input.brn,
        sstNo: input.sstNo,
        email: input.email,
        address: input.address ?? null,
      })
      .returning({ id: contacts.id });
    return { id: row!.id };
  });
}

export interface ContactRow {
  id: string;
  kind: ContactKind;
  name: string;
  tin: string | null;
  brn: string | null;
  sstNo: string | null;
  email: string | null;
}

export async function listContacts(
  db: Database,
  orgId: string,
  kind?: ContactKind,
): Promise<ContactRow[]> {
  const where =
    kind && kind !== 'both'
      ? and(eq(contacts.orgId, orgId)) // 'both' 联系人也属于该 kind,过滤见下
      : eq(contacts.orgId, orgId);
  const rows = await db
    .select({
      id: contacts.id,
      kind: contacts.kind,
      name: contacts.name,
      tin: contacts.tin,
      brn: contacts.brn,
      sstNo: contacts.sstNo,
      email: contacts.email,
    })
    .from(contacts)
    .where(where)
    .orderBy(contacts.name);
  const all = rows as ContactRow[];
  // customer/supplier 查询时,'both' 也应纳入
  if (kind && kind !== 'both') return all.filter((c) => c.kind === kind || c.kind === 'both');
  return all;
}
