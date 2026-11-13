import { multiply, safeInteger } from './calculations';

/** Business dates are ISO `YYYY-MM-DD` strings in Asia/Colombo. */
export function businessDate(at: Date | string | number = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

const parts = (date: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('Use a YYYY-MM-DD date');
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};
const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar months from the original day; a missing day becomes the month's last day (Jan 31 → Feb 28/29). */
export function addMonths(date: string, months: number) {
  if (!Number.isInteger(months)) throw new Error('Months must be a whole number');
  const { year, month, day } = parts(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12),
    targetMonth = (index % 12) + 1;
  const last = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${pad(targetMonth)}-${pad(Math.min(day, last))}`;
}

export function addDays(date: string, days: number) {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string) {
  const a = parts(from),
    b = parts(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000,
  );
}

export interface ScheduleItem {
  dueDate: string;
  amount: number;
}

/** Equal monthly installments; the last installment absorbs the remaining cents. */
export function defaultSchedule(
  credit: number,
  saleDate: string,
  count: number,
  months = count,
): ScheduleItem[] {
  if (!Number.isSafeInteger(credit) || credit <= 0) return [];
  if (!Number.isInteger(count) || count < 1 || count > 24)
    throw new Error('Invalid installment count');
  if (!Number.isInteger(months) || months < count) throw new Error('Invalid credit period');
  const count_ = Math.min(count, credit);
  const base = Math.floor(credit / count_);
  return Array.from({ length: count_ }, (_, i) => ({
    dueDate: addMonths(saleDate, Math.round(((i + 1) * months) / count_)),
    amount: i === count_ - 1 ? credit - base * (count_ - 1) : base,
  }));
}

/** Returns a problem description, or null when the schedule is valid. */
export function validateSchedule(schedule: ScheduleItem[], credit: number, saleDate: string) {
  if (!schedule.length) return 'Add at least one installment';
  if (schedule.length > 24) return 'Use at most 24 installments';
  let total = 0n,
    previous = saleDate;
  for (const [i, item] of schedule.entries()) {
    if (!Number.isSafeInteger(item.amount) || item.amount <= 0)
      return 'Each installment must be more than zero';
    try {
      parts(item.dueDate);
    } catch {
      return 'Enter a valid due date for every installment';
    }
    if (item.dueDate < saleDate) return 'Due dates cannot be before the sale date';
    if (i > 0 && item.dueDate <= previous) return 'Each due date must be after the previous one';
    previous = item.dueDate;
    total += BigInt(item.amount);
  }
  if (total !== BigInt(credit)) return 'Installments must add up to the credit amount';
  return null;
}

export interface OpenInstallment {
  id: string;
  dueDate: string;
  remaining: number;
}
export interface Allocation {
  installmentId: string;
  amount: number;
}

/**
 * Splits a repayment across installments: the listed `explicit` allocations, or oldest due first.
 * Never allocates more than an installment's remaining balance.
 */
export function allocatePayment(
  installments: OpenInstallment[],
  amount: number,
  explicit?: Allocation[],
): Allocation[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a payment amount');
  const open = new Map(installments.map((i) => [i.id, i]));
  const outstanding = installments.reduce((sum, i) => sum + BigInt(i.remaining), 0n);
  if (BigInt(amount) > outstanding) throw new Error('Payment exceeds the outstanding balance');
  if (explicit?.length) {
    const seen = new Set<string>();
    let total = 0n;
    for (const a of explicit) {
      const installment = open.get(a.installmentId);
      if (!installment) throw new Error('Choose installments that are still unpaid');
      if (seen.has(a.installmentId)) throw new Error('Choose each installment once');
      seen.add(a.installmentId);
      if (!Number.isSafeInteger(a.amount) || a.amount <= 0 || a.amount > installment.remaining)
        throw new Error('An allocation exceeds the installment balance');
      total += BigInt(a.amount);
    }
    if (total !== BigInt(amount)) throw new Error('Allocations must add up to the payment');
    return explicit.map((a) => ({ installmentId: a.installmentId, amount: a.amount }));
  }
  let remaining = amount;
  const result: Allocation[] = [];
  for (const installment of [...installments]
    .filter((i) => i.remaining > 0)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))) {
    if (!remaining) break;
    const take = Math.min(remaining, installment.remaining);
    result.push({ installmentId: installment.id, amount: take });
    remaining -= take;
  }
  return result;
}

/** Applies a returned credit amount to the latest installments first, keeping the nearest due dates. */
export function reduceLatestFirst(
  installments: (OpenInstallment & { seq: number })[],
  amount: number,
): Allocation[] {
  let remaining = amount;
  const result: Allocation[] = [];
  for (const installment of [...installments].sort((a, b) => b.seq - a.seq)) {
    if (!remaining) break;
    const take = Math.min(remaining, installment.remaining);
    if (take > 0) {
      result.push({ installmentId: installment.id, amount: take });
      remaining -= take;
    }
  }
  if (remaining) throw new Error('Returned credit exceeds the invoice balance');
  return result;
}

export const installmentStates = ['overdue', 'due_today', 'due_soon', 'upcoming', 'paid'] as const;
export type InstallmentState = (typeof installmentStates)[number];
export function installmentState(
  dueDate: string,
  remaining: number,
  today: string,
  dueSoonDays: number,
): InstallmentState {
  if (remaining <= 0) return 'paid';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'due_today';
  return daysBetween(today, dueDate) <= dueSoonDays ? 'due_soon' : 'upcoming';
}
export function paymentLabel(amount: number, remaining: number) {
  return remaining <= 0 ? 'Paid' : remaining < amount ? 'Partially paid' : 'Unpaid';
}

/** Per-unit driver discount multiplied by a quantity in thousandths, capped at the line subtotal. */
export function driverDiscount(perUnit: number, quantity: number, lineSubtotal = Infinity) {
  if (!perUnit) return 0;
  return Math.min(multiply(perUnit, quantity), lineSubtotal);
}

/** Unpaid scheduled amounts per calendar month, preserving which installments make up each total. */
export function monthlyDue<T extends { dueDate: string; remaining: number }>(installments: T[]) {
  const months = new Map<string, { month: string; amount: bigint; items: T[] }>();
  for (const i of installments) {
    if (i.remaining <= 0) continue;
    const month = i.dueDate.slice(0, 7);
    const entry = months.get(month) ?? { month, amount: 0n, items: [] };
    entry.amount += BigInt(i.remaining);
    entry.items.push(i);
    months.set(month, entry);
  }
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ month: m.month, amount: safeInteger(m.amount), items: m.items }));
}
