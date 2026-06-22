/**
 * SST tax codes(铁律 4:SST 原生内置,不做插件)。org-scoped,UNIQUE(org_id, code)。
 * rate 对齐 NUMERIC(6,4):0..99.9999(如 SST-6 = 0.0600)。
 */
import { eq } from 'drizzle-orm';
import { type Database, taxCodes } from '@cf4u/db';
import { ConflictError, ValidationError } from './errors.js';
import { isUniqueViolation } from './pgError.js';

const RATE_RE = /^\d{1,2}(\.\d{1,4})?$/;

export interface CreateTaxCodeInput {
  orgId: string;
  code: string;
  rate: string; // decimal string, e.g. '0.06'
}

export async function createTaxCode(db: Database, input: CreateTaxCodeInput): Promise<{ id: string }> {
  if (!input.code?.trim()) throw new ValidationError('tax code is required');
  if (!RATE_RE.test(input.rate)) throw new ValidationError(`invalid tax rate: ${input.rate}`);
  try {
    const [row] = await db
      .insert(taxCodes)
      .values({ orgId: input.orgId, code: input.code.trim(), rate: input.rate })
      .returning({ id: taxCodes.id });
    return { id: row!.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`tax code already exists: ${input.code}`);
    throw e;
  }
}

export interface TaxCodeRow {
  id: string;
  code: string;
  rate: string;
}

export async function listTaxCodes(db: Database, orgId: string): Promise<TaxCodeRow[]> {
  return db
    .select({ id: taxCodes.id, code: taxCodes.code, rate: taxCodes.rate })
    .from(taxCodes)
    .where(eq(taxCodes.orgId, orgId))
    .orderBy(taxCodes.code);
}
