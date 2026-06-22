/** Integration — contacts + tax codes(真库,DATABASE_URL)。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createContact,
  listContacts,
  createTaxCode,
  listTaxCodes,
  ValidationError,
  ConflictError,
} from './index.js';
import { setupFixture, teardownFixture, type Fixture } from './test-helpers.js';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('contacts + tax codes', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setupFixture();
  });
  afterAll(async () => {
    if (f) await teardownFixture(f);
  });

  it('creates and lists contacts, filtering by kind (both included)', async () => {
    await createContact(f.db, { orgId: f.orgId, kind: 'customer', name: 'Acme Trading', actorUserId: f.userId });
    await createContact(f.db, { orgId: f.orgId, kind: 'supplier', name: 'Bolt Supplies', actorUserId: f.userId });
    await createContact(f.db, { orgId: f.orgId, kind: 'both', name: 'Both Co', actorUserId: f.userId });

    const customers = await listContacts(f.db, f.orgId, 'customer');
    expect(customers.map((c) => c.name).sort()).toEqual(['Acme Trading', 'Both Co']);
    const all = await listContacts(f.db, f.orgId);
    expect(all.length).toBe(3);
  });

  it('rejects invalid contact input', async () => {
    await expect(
      createContact(f.db, { orgId: f.orgId, kind: 'customer', name: '  ', actorUserId: f.userId }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createContact(f.db, {
        orgId: f.orgId,
        kind: 'customer',
        name: 'Bad Email',
        email: 'not-an-email',
        actorUserId: f.userId,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates SST tax codes and rejects duplicates + bad rates', async () => {
    await createTaxCode(f.db, { orgId: f.orgId, code: 'SST-6', rate: '0.06' });
    await createTaxCode(f.db, { orgId: f.orgId, code: 'SST-0', rate: '0' });
    const codes = await listTaxCodes(f.db, f.orgId);
    expect(codes.map((t) => t.code)).toEqual(['SST-0', 'SST-6']);
    expect(codes.find((t) => t.code === 'SST-6')?.rate).toBe('0.0600');

    await expect(createTaxCode(f.db, { orgId: f.orgId, code: 'SST-6', rate: '0.06' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(createTaxCode(f.db, { orgId: f.orgId, code: 'BAD', rate: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
