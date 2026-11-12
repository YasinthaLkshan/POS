import { z } from 'zod';
import { id, cents, text, qty, paymentSchema, saleSchema } from './schemas';
export const cashOpenSchema = z
  .object({ operationId: id, terminalId: id, openingFloat: cents })
  .strict();
export const cashCloseSchema = z.object({ operationId: id, actualClose: cents }).strict();
export const cashMoveSchema = z
  .object({
    operationId: id,
    sessionId: id,
    amount: qty,
    direction: z.enum(['in', 'out']),
    reason: text,
  })
  .strict();
export const supplierPaymentSchema = z
  .object({ operationId: id, supplierId: id, payment: paymentSchema, terminalId: id.optional() })
  .strict();
export const stocktakeSchema = z
  .object({
    operationId: id,
    reason: text,
    lines: z
      .array(z.object({ batchId: id, expectedQuantity: cents, countedQuantity: cents }).strict())
      .min(1)
      .max(500),
  })
  .strict();
export const parkSchema = z
  .object({
    operationId: id,
    label: text,
    orderDiscount: cents.optional(),
    customerId: id.nullable().default(null),
    lines: saleSchema.shape.lines,
  })
  .strict();
