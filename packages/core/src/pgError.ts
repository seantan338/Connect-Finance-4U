/** drizzle 把 PostgresError 包了一层,unique_violation(23505)可能在 e 或 e.cause 上。 */
export function isUniqueViolation(e: unknown): boolean {
  const code = (x: unknown) =>
    x && typeof x === 'object' && 'code' in x ? (x as { code?: string }).code : undefined;
  return code(e) === '23505' || code((e as { cause?: unknown })?.cause) === '23505';
}
