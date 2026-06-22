import { describe, it, expect } from 'vitest';
import {
  parseMoney,
  formatMoney,
  addMoney,
  subMoney,
  sumMoney,
  eqMoney,
  applyRate,
  mulMoney,
  MoneyParseError,
} from './money.js';

describe('money — decimal-safe', () => {
  it('parses and formats round-trip at scale 4', () => {
    expect(formatMoney(parseMoney('100'))).toBe('100.0000');
    expect(formatMoney(parseMoney('100.5'))).toBe('100.5000');
    expect(formatMoney(parseMoney('0.0001'))).toBe('0.0001');
    expect(formatMoney(parseMoney('-12.34'))).toBe('-12.3400');
  });

  it('sums without float error (0.1 + 0.2 === 0.3)', () => {
    const total = sumMoney([parseMoney('0.1'), parseMoney('0.2')]);
    expect(formatMoney(total)).toBe('0.3000');
    expect(eqMoney(total, parseMoney('0.3'))).toBe(true);
  });

  it('adds and subtracts exactly on a long list', () => {
    const cents = Array.from({ length: 1000 }, () => parseMoney('0.01'));
    expect(formatMoney(sumMoney(cents))).toBe('10.0000');
    expect(formatMoney(subMoney(parseMoney('100'), parseMoney('33.33')))).toBe('66.6700');
    expect(formatMoney(addMoney(parseMoney('999999999999.9999'), parseMoney('0.0001')))).toBe(
      '1000000000000.0000',
    );
  });

  it('rejects more than 4 decimal places instead of silently truncating', () => {
    expect(() => parseMoney('1.00001')).toThrow(MoneyParseError);
    expect(() => parseMoney('abc')).toThrow(MoneyParseError);
    expect(() => parseMoney('')).toThrow(MoneyParseError);
  });

  it('mulMoney: qty × unit_price rounds half-up to scale 4', () => {
    expect(formatMoney(mulMoney(parseMoney('3'), parseMoney('10.50')))).toBe('31.5000');
    expect(formatMoney(mulMoney(parseMoney('2.5'), parseMoney('4.4444')))).toBe('11.1110');
    // 1.0001 * 1.0001 = 1.00020001 → 1.0002
    expect(formatMoney(mulMoney(parseMoney('1.0001'), parseMoney('1.0001')))).toBe('1.0002');
  });

  it('applyRate: rate 1 is exact, otherwise round half-up to scale 4', () => {
    expect(formatMoney(applyRate(parseMoney('100'), '1'))).toBe('100.0000');
    // 100 * 3.4567 = 345.67
    expect(formatMoney(applyRate(parseMoney('100'), '3.4567'))).toBe('345.6700');
    // 10 * 0.33335 = 3.3335
    expect(formatMoney(applyRate(parseMoney('10'), '0.33335'))).toBe('3.3335');
    // round half-up: 1 * 0.00005 = 0.00005 → 0.0001
    expect(formatMoney(applyRate(parseMoney('1'), '0.00005'))).toBe('0.0001');
    // negative amount keeps sign and rounds away from zero on .5
    expect(formatMoney(applyRate(parseMoney('-1'), '0.00005'))).toBe('-0.0001');
  });
});
