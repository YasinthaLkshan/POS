/** Money is integer cents; quantities are thousandths of a base unit. */
export function safeInteger(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError('Amount exceeds safe integer range');
  return result;
}
export function decimalToInteger(value: string, scale = 2): number {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Enter a positive decimal number');
  const [whole = '0', fraction = ''] = value.split('.');
  if (fraction.length > scale) throw new Error(`Use at most ${scale} decimal places`);
  return safeInteger(
    BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0'),
  );
}
export function multiply(amount: number, quantity: number, divisor = 1000): number {
  if (
    ![amount, quantity, divisor].every(Number.isSafeInteger) ||
    amount < 0 ||
    quantity < 0 ||
    divisor <= 0
  )
    throw new Error('Invalid amount');
  return safeInteger(
    (BigInt(amount) * BigInt(quantity) + BigInt(Math.floor(divisor / 2))) / BigInt(divisor),
  );
}
export function lineTotals(price: number, quantity: number, discount: number, taxBps: number) {
  const subtotal = multiply(price, quantity);
  if (!Number.isSafeInteger(discount) || discount < 0 || discount > subtotal)
    throw new Error('Discount exceeds subtotal');
  if (!Number.isSafeInteger(taxBps) || taxBps < 0 || taxBps > 10000)
    throw new Error('Invalid tax rate');
  const net = subtotal - discount;
  const tax = multiply(net, taxBps, 10000);
  return { subtotal, discount, tax, total: safeInteger(BigInt(net) + BigInt(tax)) };
}
export function money(cents: number) {
  return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(cents / 100);
}
export function quantity(value: number) {
  return (value / 1000).toLocaleString('en-LK', { maximumFractionDigits: 3 });
}
export function allocateDiscount(amount: number, bases: number[]): number[] {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    bases.some((v) => !Number.isSafeInteger(v) || v < 0)
  )
    throw new Error('Invalid discount allocation');
  const total = bases.reduce((sum, v) => sum + BigInt(v), 0n);
  if (BigInt(amount) > total) throw new Error('Order discount exceeds subtotal');
  let cumulative = 0n,
    previous = 0n;
  return bases.map((base) => {
    cumulative += BigInt(base);
    const allocated = total === 0n ? 0n : (BigInt(amount) * cumulative) / total;
    const part = allocated - previous;
    previous = allocated;
    return safeInteger(part);
  });
}
