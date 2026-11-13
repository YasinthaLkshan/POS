import { reduceLatestFirst, refundSchema, safeInteger, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { command, requirePermission, audit } from '../../services/transactions';
import { AppError, assert } from '../../utils/errors';
import { cashMovement } from '../finance/cash';
// Cumulative integer apportionment ensures the final return absorbs every rounding cent.
const share = (amount: number, quantity: number, totalQuantity: number) =>
  safeInteger(
    (BigInt(amount) * BigInt(quantity) + BigInt(totalQuantity) / 2n) / BigInt(totalQuantity),
  );
export async function returnSale(db: Database, actor: Actor, saleId: string, input: unknown) {
  requirePermission(actor, 'refund.write');
  const p = refundSchema.parse(input);
  return command(db, actor, p.operationId, 'return', { saleId, ...p }, async (tx) => {
    const sale = (
      await tx.query<{ id: string; status: string; credit: number; customer_id: string | null }>(
        'SELECT * FROM sales WHERE shop_id=$1 AND id=$2 FOR UPDATE',
        [actor.shopId, saleId],
      )
    )[0];
    assert(sale, 404, 'NOT_FOUND', 'Sale not found');
    assert(sale.status === 'completed', 409, 'ALREADY_RETURNED', 'Sale was already fully returned');
    const lines = await tx.query<{
      id: string;
      product_id: string;
      quantity: number;
      returned: number;
      total: number;
      tax: number;
      cost: number;
    }>(
      `SELECT l.*,COALESCE((SELECT SUM(r.quantity) FROM return_lines r WHERE r.sale_line_id=l.id),0)::bigint returned FROM sale_lines l WHERE l.shop_id=$1 AND l.sale_id=$2 ORDER BY l.id`,
      [actor.shopId, saleId],
    );
    const requested =
      p.lines ??
      lines
        .filter((l) => l.quantity > l.returned)
        .map((l) => ({ lineId: l.id, quantity: l.quantity - l.returned }));
    assert(
      new Set(requested.map((l) => l.lineId)).size === requested.length,
      422,
      'DUPLICATE_LINE',
      'Combine duplicate return lines',
    );
    let total = 0,
      tax = 0,
      cost = 0;
    const results = requested.map((request) => {
      const line = lines.find((l) => l.id === request.lineId);
      assert(line, 404, 'NOT_FOUND', 'Returned line is not on this invoice');
      assert(
        request.quantity <= line.quantity - line.returned,
        409,
        'RETURN_QUANTITY',
        'Return quantity exceeds the unreturned invoice quantity',
      );
      const amount =
          share(line.total, line.returned + request.quantity, line.quantity) -
          share(line.total, line.returned, line.quantity),
        lineTax =
          share(line.tax, line.returned + request.quantity, line.quantity) -
          share(line.tax, line.returned, line.quantity);
      total += amount;
      tax += lineTax;
      return {
        line,
        quantity: request.quantity,
        total: amount,
        tax: lineTax,
        cost: 0,
        allocations: [] as { batchId: string; quantity: number }[],
      };
    });
    for (const result of results) {
      const batches = await tx.query<{
        batch_id: string;
        quantity: number;
        cost: number;
        returned: number;
      }>(
        `SELECT a.batch_id,SUM(a.quantity)::bigint quantity,SUM(a.cost)::bigint cost,COALESCE((SELECT SUM(ra.quantity) FROM return_allocations ra JOIN returns r ON r.id=ra.return_id WHERE r.sale_id=$2 AND ra.batch_id=a.batch_id),0)::bigint returned FROM sale_allocations a JOIN batches b ON b.id=a.batch_id WHERE a.shop_id=$1 AND a.sale_id=$2 AND b.product_id=$3 GROUP BY a.batch_id ORDER BY a.batch_id`,
        [actor.shopId, saleId, result.line.product_id],
      );
      let remaining = result.quantity;
      for (const b of batches) {
        const take = Math.min(remaining, b.quantity - b.returned);
        if (take <= 0) continue;
        result.allocations.push({ batchId: b.batch_id, quantity: take });
        if (p.restock)
          result.cost +=
            share(b.cost, b.returned + take, b.quantity) - share(b.cost, b.returned, b.quantity);
        remaining -= take;
        if (!remaining) break;
      }
      assert(
        remaining === 0,
        409,
        'ALLOCATION_REVIEW',
        'Original batch allocations require review',
      );
      cost += result.cost;
    }
    const outstanding = (
      await tx.query<{ due: number }>(
        `SELECT ($2::bigint-COALESCE((SELECT SUM(amount) FROM repayment_allocations WHERE sale_id=$1),0)-COALESCE((SELECT SUM(credit_amount) FROM returns WHERE sale_id=$1),0))::bigint due`,
        [saleId, sale.credit],
      )
    )[0]!.due;
    const creditAmount = Math.min(total, outstanding),
      refundAmount = total - creditAmount;
    assert(
      !refundAmount || p.refundMethod === 'cash' || p.reference.trim(),
      422,
      'PAYMENT_REFERENCE',
      'Enter the confirmed external refund reference',
    );
    await tx.query(
      'INSERT INTO returns(id,shop_id,sale_id,reason,restock,refund_amount,credit_amount,total_amount,tax,cost,refund_method,reference,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [
        p.operationId,
        actor.shopId,
        saleId,
        p.reason,
        p.restock,
        refundAmount,
        creditAmount,
        total,
        tax,
        cost,
        p.refundMethod,
        p.reference,
        actor.id,
      ],
    );
    for (const result of results) {
      await tx.query(
        'INSERT INTO return_lines(shop_id,return_id,sale_line_id,quantity,total,tax,cost) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          actor.shopId,
          p.operationId,
          result.line.id,
          result.quantity,
          result.total,
          result.tax,
          result.cost,
        ],
      );
      for (const b of result.allocations) {
        await tx.query(
          'INSERT INTO return_allocations(shop_id,return_id,batch_id,quantity) VALUES($1,$2,$3,$4)',
          [actor.shopId, p.operationId, b.batchId, b.quantity],
        );
        if (p.restock) {
          await tx.query('UPDATE batches SET quantity=quantity+$1 WHERE id=$2', [
            b.quantity,
            b.batchId,
          ]);
          await tx.query(
            "INSERT INTO inventory_movements(shop_id,batch_id,delta,type,reason,reference_id,actor_id) VALUES($1,$2,$3,'sale_return',$4,$5,$6)",
            [actor.shopId, b.batchId, b.quantity, p.reason, p.operationId, actor.id],
          );
        }
      }
    }
    if (creditAmount) {
      await tx.query(
        "INSERT INTO customer_ledger(shop_id,customer_id,sale_id,amount,type,reference,actor_id) VALUES($1,$2,$3,$4,'return',$5,$6)",
        [actor.shopId, sale.customer_id, saleId, -creditAmount, p.operationId, actor.id],
      );
      const open = await tx.query<{ id: string; seq: number; due_date: string; remaining: number }>(
        'SELECT id,seq,due_date::text due_date,remaining FROM installment_balances WHERE shop_id=$1 AND sale_id=$2 AND remaining>0',
        [actor.shopId, saleId],
      );
      let reductions;
      try {
        reductions = reduceLatestFirst(
          open.map((i) => ({ id: i.id, seq: i.seq, dueDate: i.due_date, remaining: i.remaining })),
          creditAmount,
        );
      } catch {
        throw new AppError(409, 'LEDGER_REVIEW', 'Installment balances require reconciliation');
      }
      for (const r of reductions)
        await tx.query(
          'INSERT INTO installment_reductions(shop_id,return_id,installment_id,amount) VALUES($1,$2,$3,$4)',
          [actor.shopId, p.operationId, r.installmentId, r.amount],
        );
    }
    if (refundAmount && p.refundMethod === 'cash')
      await cashMovement(tx, actor, p.terminalId, -refundAmount, 'refund', p.operationId, p.reason);
    if (
      lines.every(
        (l) =>
          l.returned + (requested.find((r) => r.lineId === l.id)?.quantity ?? 0) === l.quantity,
      )
    )
      await tx.query("UPDATE sales SET status='returned' WHERE id=$1", [saleId]);
    await audit(tx, actor, 'sale.return', saleId, { ...p, total, creditAmount, refundAmount });
    return { id: p.operationId, total, creditAmount, refundAmount };
  });
}
