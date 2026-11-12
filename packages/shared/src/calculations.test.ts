import { describe, it, expect } from 'vitest';
import {
  allocateDiscount,
  decimalToInteger,
  lineTotals,
  multiply,
  safeInteger,
} from './calculations';
import { can } from './permissions';
describe('precise calculations', () => {
  it('conserves every cent when allocating an order discount', () => {
    expect(allocateDiscount(2, [1, 1, 1])).toEqual([0, 1, 1]);
    expect(allocateDiscount(0, [0, 0])).toEqual([0, 0]);
    expect(allocateDiscount(600, [100, 200, 300])).toEqual([100, 200, 300]);
    expect(() => allocateDiscount(601, [100, 200, 300])).toThrow();
  });
  it('parses currency and fractional quantities without float rounding', () => {
    expect(decimalToInteger('0.29')).toBe(29);
    expect(decimalToInteger('1.125', 3)).toBe(1125);
    expect(() => decimalToInteger('1.001')).toThrow();
    expect(() => decimalToInteger('1e3')).toThrow();
  });
  it('rounds each taxable line half-up after discount', () => {
    expect(lineTotals(1999, 1500, 100, 1800)).toEqual({
      subtotal: 2999,
      discount: 100,
      tax: 522,
      total: 3421,
    });
  });
  it('rejects invalid discounts and integer overflow', () => {
    expect(() => lineTotals(100, 1000, 101, 0)).toThrow();
    expect(() => safeInteger(9007199254740992n)).toThrow();
  });
  it('converts base units and computes cost exactly', () => {
    expect(multiply(12500, 375)).toBe(4688);
    expect(multiply(1000, 50, 1)).toBe(50000);
  });
  it('enforces the permission matrix', () => {
    expect(can('cashier', 'refund.write')).toBe(false);
    expect(can('manager', 'staff.manage')).toBe(false);
    expect(can('administrator', 'staff.manage')).toBe(true);
  });
});
