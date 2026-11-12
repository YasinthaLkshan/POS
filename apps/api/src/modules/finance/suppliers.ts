import { supplierPaymentSchema, type Actor } from '@agripos/shared';
import type { Database } from '../../database/db';
import { command, audit, requirePermission } from '../../services/transactions';
import { assert } from '../../utils/errors';
import { cashMovement } from './cash';
export async function paySupplier(db: Database, actor: Actor, input: unknown) {
  requirePermission(actor, 'purchases.write');
  const p = supplierPaymentSchema.parse(input);
  return command(db, actor, p.operationId, 'supplier.payment', p, async (tx) => {
    const supplier = (
      await tx.query('SELECT id FROM suppliers WHERE shop_id=$1 AND id=$2 FOR UPDATE', [
        actor.shopId,
        p.supplierId,
      ])
    )[0];
    assert(supplier, 404, 'NOT_FOUND', 'Supplier not found');
    const balance = (
      await tx.query<{ balance: number }>(
        'SELECT COALESCE(SUM(amount),0)::bigint balance FROM supplier_ledger WHERE shop_id=$1 AND supplier_id=$2',
        [actor.shopId, p.supplierId],
      )
    )[0]!.balance;
    assert(
      p.payment.amount <= balance,
      409,
      'OVERPAYMENT',
      'Payment exceeds the received-goods balance',
    );
    await tx.query(
      "INSERT INTO supplier_ledger(shop_id,supplier_id,amount,type,reference_id,method,reference,actor_id) VALUES($1,$2,$3,'payment',$4,$5,$6,$7)",
      [
        actor.shopId,
        p.supplierId,
        -p.payment.amount,
        p.operationId,
        p.payment.method,
        p.payment.reference,
        actor.id,
      ],
    );
    if (p.payment.method === 'cash')
      await cashMovement(
        tx,
        actor,
        p.terminalId,
        -p.payment.amount,
        'supplier_payment',
        p.operationId,
        'Supplier payment',
      );
    await audit(tx, actor, 'supplier.payment', p.supplierId, p);
    return { id: p.operationId, balance: balance - p.payment.amount };
  });
}
