/**
 * Decimal-safe money for the ledger. 绝不用 JS number 加钱(0.1+0.2 问题)。
 *
 * 表示:金额按 scale 4 存成 bigint(NUMERIC(20,4) 对齐);汇率按 scale 10 解析。
 * 所有借贷加总、平衡比较都走整数运算,精确无浮点误差。
 */

export type Money = bigint; // scaled by 10^4

const AMOUNT_SCALE = 4;
const AMOUNT_FACTOR = 10n ** BigInt(AMOUNT_SCALE);
const RATE_SCALE = 10;
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE);

export class MoneyParseError extends Error {
  readonly code = 'MONEY_PARSE';
  constructor(public readonly input: string, reason: string) {
    super(`invalid money value "${input}": ${reason}`);
    this.name = 'MoneyParseError';
  }
}

/** 解析十进制字符串/数字到指定 scale 的 bigint。小数位超过 maxDecimals → 抛(不静默丢精度)。 */
function parseToScale(value: string | number, scale: number, maxDecimals: number): bigint {
  const raw = typeof value === 'number' ? numberToDecimalString(value) : value.trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!m) throw new MoneyParseError(raw, 'not a decimal number');
  const sign = m[1] === '-' ? -1n : 1n;
  const intPart = m[2]!;
  const fracRaw = m[3] ?? '';
  if (fracRaw.length > maxDecimals) {
    throw new MoneyParseError(raw, `more than ${maxDecimals} decimal places`);
  }
  const frac = (fracRaw + '0'.repeat(scale)).slice(0, scale);
  return sign * BigInt(intPart + frac);
}

/** number → 十进制串,避免指数记法;>15 位有效数字请改用 string 入参。 */
function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n)) throw new MoneyParseError(String(n), 'not finite');
  // toFixed 到 amount scale,杜绝 1e-7 之类的浮点尾巴
  return n.toFixed(AMOUNT_SCALE);
}

export function parseMoney(value: string | number): Money {
  return parseToScale(value, AMOUNT_SCALE, AMOUNT_SCALE);
}

export function formatMoney(m: Money): string {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const int = abs / AMOUNT_FACTOR;
  const frac = (abs % AMOUNT_FACTOR).toString().padStart(AMOUNT_SCALE, '0');
  return `${neg ? '-' : ''}${int.toString()}.${frac}`;
}

export const ZERO: Money = 0n;

export const addMoney = (a: Money, b: Money): Money => a + b;
export const subMoney = (a: Money, b: Money): Money => a - b;
export const negMoney = (a: Money): Money => -a;
export const isZero = (a: Money): boolean => a === 0n;
export const eqMoney = (a: Money, b: Money): boolean => a === b;
export const gtZero = (a: Money): boolean => a > 0n;
export const sumMoney = (xs: Money[]): Money => xs.reduce((acc, x) => acc + x, 0n);

/** 两个 scale-4 金额相乘(如 qty × unit_price),round half-up 回 scale 4。 */
export function mulMoney(a: Money, b: Money): Money {
  return divRoundHalfUp(a * b, AMOUNT_FACTOR);
}

/**
 * 按汇率折算:base = amount * rate,结果 round half-up 到 scale 4。
 * 单币种 M1.1 下 rate='1' → 精确返回原值。
 */
export function applyRate(amount: Money, rate: string | number): Money {
  const r = parseToScale(rate, RATE_SCALE, RATE_SCALE); // scale 10
  const product = amount * r; // scale 14
  return divRoundHalfUp(product, RATE_FACTOR); // back to scale 4
}

/** 带符号的 round half-up 整数除法。 */
function divRoundHalfUp(num: bigint, den: bigint): bigint {
  const neg = num < 0n;
  const a = neg ? -num : num;
  const q = a / den;
  const r = a % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return neg ? -rounded : rounded;
}
