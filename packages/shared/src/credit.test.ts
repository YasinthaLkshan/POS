import { expect, it } from 'vitest';
import {
  addMonths,
  allocatePayment,
  defaultSchedule,
  driverDiscount,
  installmentState,
  monthlyDue,
  paymentLabel,
  reduceLatestFirst,
  validateSchedule,
} from './credit';

it('adds calendar months and clamps month-end dates', () => {
  expect(addMonths('2026-01-10', 1)).toBe('2026-02-10');
  expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
});

it('splits driver credit into two monthly installments with exact cents', () => {
  expect(defaultSchedule(2000000, '2026-01-10', 2)).toEqual([
    { dueDate: '2026-02-10', amount: 1000000 },
    { dueDate: '2026-03-10', amount: 1000000 },
  ]);
  expect(defaultSchedule(1200000, '2026-01-20', 2)).toEqual([
    { dueDate: '2026-02-20', amount: 600000 },
    { dueDate: '2026-03-20', amount: 600000 },
  ]);
  const odd = defaultSchedule(1000001, '2026-01-31', 2);
  expect(odd).toEqual([
    { dueDate: '2026-02-28', amount: 500000 },
    { dueDate: '2026-03-31', amount: 500001 },
  ]);
  expect(defaultSchedule(500000, '2026-01-15', 1, 1)).toEqual([
    { dueDate: '2026-02-15', amount: 500000 },
  ]);
});

it('validates custom schedules', () => {
  const ok = [
    { dueDate: '2026-02-01', amount: 700000 },
    { dueDate: '2026-04-01', amount: 300000 },
  ];
  expect(validateSchedule(ok, 1000000, '2026-01-10')).toBeNull();
  expect(validateSchedule(ok, 1000001, '2026-01-10')).toContain('add up');
  expect(validateSchedule([...ok].reverse(), 1000000, '2026-01-10')).toContain('after');
  expect(validateSchedule(ok, 1000000, '2026-03-01')).toContain('before the sale');
});

it('combines installments by month while keeping each installment', () => {
  const rows = [
    { id: 'a1', dueDate: '2026-02-10', remaining: 1000000 },
    { id: 'a2', dueDate: '2026-03-10', remaining: 1000000 },
    { id: 'b1', dueDate: '2026-02-20', remaining: 600000 },
    { id: 'b2', dueDate: '2026-03-20', remaining: 600000 },
    { id: 'paid', dueDate: '2026-02-01', remaining: 0 },
  ];
  const months = monthlyDue(rows);
  expect(months.map((m) => [m.month, m.amount])).toEqual([
    ['2026-02', 1600000],
    ['2026-03', 1600000],
  ]);
  expect(months[0]!.items.map((i) => i.id)).toEqual(['a1', 'b1']);
});

it('allocates partial payments oldest-first and never over-allocates', () => {
  const open = [
    { id: 'late', dueDate: '2026-03-10', remaining: 1000000 },
    { id: 'first', dueDate: '2026-02-10', remaining: 1000000 },
  ];
  expect(allocatePayment(open, 400000)).toEqual([{ installmentId: 'first', amount: 400000 }]);
  expect(allocatePayment(open, 1300000)).toEqual([
    { installmentId: 'first', amount: 1000000 },
    { installmentId: 'late', amount: 300000 },
  ]);
  expect(() => allocatePayment(open, 2000001)).toThrow('exceeds');
  expect(allocatePayment(open, 300000, [{ installmentId: 'late', amount: 300000 }])).toEqual([
    { installmentId: 'late', amount: 300000 },
  ]);
  expect(() => allocatePayment(open, 300000, [{ installmentId: 'late', amount: 200000 }])).toThrow(
    'add up',
  );
  expect(() =>
    allocatePayment(open, 1000001, [{ installmentId: 'late', amount: 1000001 }]),
  ).toThrow('installment balance');
});

it('reduces returned credit from the latest installment first', () => {
  const open = [
    { id: 'i1', seq: 1, dueDate: '2026-02-10', remaining: 1000000 },
    { id: 'i2', seq: 2, dueDate: '2026-03-10', remaining: 400000 },
  ];
  expect(reduceLatestFirst(open, 600000)).toEqual([
    { installmentId: 'i2', amount: 400000 },
    { installmentId: 'i1', amount: 200000 },
  ]);
  expect(() => reduceLatestFirst(open, 1400001)).toThrow();
});

it('classifies due states and partial payment labels', () => {
  const today = '2026-02-10';
  expect(installmentState('2026-02-09', 100, today, 7)).toBe('overdue');
  expect(installmentState('2026-02-10', 100, today, 7)).toBe('due_today');
  expect(installmentState('2026-02-17', 100, today, 7)).toBe('due_soon');
  expect(installmentState('2026-02-18', 100, today, 7)).toBe('upcoming');
  expect(installmentState('2026-01-01', 0, today, 7)).toBe('paid');
  expect(paymentLabel(1000000, 600000)).toBe('Partially paid');
  expect(paymentLabel(1000000, 0)).toBe('Paid');
  expect(paymentLabel(1000000, 1000000)).toBe('Unpaid');
});

it('multiplies per-bag driver discounts by quantity', () => {
  expect(driverDiscount(1000, 3000)).toBe(3000);
  expect(driverDiscount(2000, 2000)).toBe(4000);
  expect(driverDiscount(500, 1250)).toBe(625);
  expect(driverDiscount(5000, 1000, 3000)).toBe(3000);
  expect(driverDiscount(0, 5000)).toBe(0);
});
