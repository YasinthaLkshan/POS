import { z } from 'zod';
export const id = z.uuid();
export const cents = z.number().int().min(0).max(1_000_000_000);
export const qty = z.number().int().min(1).max(1_000_000_000);
export const text = z.string().trim().min(1).max(200);
export const date = z.iso.date();
export const categorySchema = z
  .object({
    name: text,
    kind: z.enum(['fertilizer', 'seed', 'plant', 'equipment', 'other']).default('other'),
  })
  .strict();
export const productSchema = z
  .object({
    name: text,
    sku: text,
    barcode: z.string().trim().max(100).nullable().default(null),
    categoryId: id,
    supplierId: id.nullable().default(null),
    brand: z.string().max(100).default(''),
    description: z.string().max(2000).default(''),
    unit: z
      .enum(['piece', 'packet', 'bag', 'kg', 'g', 'liter', 'ml', 'tray', 'pot'])
      .default('piece'),
    sellingPrice: cents,
    purchaseUnit: z.string().trim().min(1).max(30).optional(),
    purchaseFactor: qty.default(1000),
    reorderQuantity: cents.default(0),
    subcategory: z.string().max(100).default(''),
    purchasePrice: cents,
    taxBps: z.number().int().min(0).max(10000).default(0),
    minimumStock: cents.default(0),
    active: z.boolean().default(true),
    attributes: z.record(z.string().max(60), z.string().max(300)).default({}),
    familyId: id.nullable().optional(),
    variantLabel: z.string().trim().max(60).optional(),
    wholeUnits: z.boolean().optional(),
  })
  .strict();
export const units = ['piece', 'packet', 'bag', 'kg', 'g', 'liter', 'ml', 'tray', 'pot'] as const;
export const variantSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    sku: text,
    barcode: z.string().trim().max(100).nullable().default(null),
    unit: z.enum(units),
    wholeUnits: z.boolean(),
    sellingPrice: cents,
    purchasePrice: cents.default(0),
    minimumStock: cents.default(0),
    driverDiscount: cents.default(0),
    active: z.boolean().default(true),
  })
  .strict();
export const familySchema = z
  .object({
    name: text,
    categoryId: id,
    brand: z.string().trim().max(100).default(''),
    description: z.string().trim().max(2000).default(''),
    taxBps: z.number().int().min(0).max(10000).default(0),
    variants: z.array(variantSchema).min(1).max(20),
  })
  .strict();
export const familyUpdateSchema = familySchema.omit({ variants: true, taxBps: true });
export const driverDiscountSchema = z.object({ productId: id, amount: cents }).strict();
export const contactSchema = z
  .object({
    active: z.boolean().default(true),
    name: text,
    phone: z.string().max(30).default(''),
    email: z.union([z.email(), z.literal('')]).default(''),
    address: z.string().max(1000).default(''),
  })
  .strict();
export const customerSchema = contactSchema.extend({
  creditLimit: cents.default(0),
  creditEnabled: z.boolean().default(true),
});
export const factorySchema = z
  .object({
    name: text,
    address: z.string().trim().max(1000).default(''),
    phone: z.string().trim().max(30).default(''),
    notes: z.string().trim().max(1000).default(''),
    active: z.boolean().default(true),
  })
  .strict();
export const driverSchema = z
  .object({
    name: text,
    factoryId: id,
    lorryNumber: z.string().trim().max(30).default(''),
    phone: z.string().trim().max(30).default(''),
    address: z.string().trim().max(1000).default(''),
    notes: z.string().trim().max(1000).default(''),
    active: z.boolean().default(true),
    confirmDuplicate: z.boolean().optional(),
  })
  .strict();
export const customerKinds = ['registered', 'driver', 'walk_in'] as const;
export type CustomerKind = (typeof customerKinds)[number];
export const purchaseSchema = z
  .object({
    operationId: id.optional(),
    status: z.enum(['draft', 'ordered']).default('ordered'),
    supplierId: id,
    lines: z
      .array(
        z
          .object({
            productId: id,
            quantity: qty,
            unitCost: cents,
            unit: z.enum(['base', 'purchase']).default('base'),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const receiveSchema = z
  .object({
    operationId: id,
    invoiceNumber: z.string().max(120).optional(),
    dueDate: date.nullable().optional(),
    lines: z
      .array(
        z
          .object({
            lineId: id,
            quantity: qty,
            batchNumber: text,
            expiryDate: date.nullable().default(null),
            manufactureDate: date.nullable().default(null),
            supplierLot: z.string().max(120).default(''),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const paymentSchema = z
  .object({
    method: z.enum(['cash', 'card', 'transfer']),
    amount: cents.refine((n) => n > 0, 'Amount must be positive'),
    reference: z.string().max(120).default(''),
  })
  .strict()
  .refine(
    (p) => p.method === 'cash' || p.reference.trim().length > 0,
    'A confirmed external payment reference is required',
  );
export const saleSchema = z
  .object({
    operationId: id,
    terminalId: id,
    customerId: id.nullable().default(null),
    dueDate: date.nullable().default(null),
    parkedId: id.optional(),
    orderDiscount: cents.optional(),
    lines: z
      .array(z.object({ productId: id, quantity: qty, discount: cents.default(0) }).strict())
      .min(1)
      .max(100),
    payments: z.array(paymentSchema).max(10),
    cashTendered: cents.optional(),
    // Optional without defaults: older offline receipts must keep their original fingerprint.
    creditCustomer: z
      .object({
        name: text,
        phone: z.string().trim().max(30).optional(),
        notes: z.string().trim().max(500).optional(),
      })
      .strict()
      .optional(),
    schedule: z
      .array(
        z
          .object({ dueDate: date, amount: cents.refine((n) => n > 0, 'Amount must be positive') })
          .strict(),
      )
      .min(1)
      .max(24)
      .optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();
export const adjustmentSchema = z
  .object({
    operationId: id,
    batchId: id,
    delta: z
      .number()
      .int()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .refine((n) => n !== 0),
    reason: text,
    type: z.enum(['adjustment', 'damage', 'write_off']).default('adjustment'),
  })
  .strict();
export const stockReceiptSchema = z
  .object({
    operationId: id,
    productId: id,
    quantity: qty,
    unitCost: cents.optional(),
    supplierId: id.nullable().default(null),
    batchNumber: z.string().trim().max(120).default(''),
    expiryDate: date.nullable().default(null),
    notes: z.string().trim().max(500).default(''),
  })
  .strict();
export const conversionSchema = z
  .object({
    operationId: id,
    fromProductId: id,
    quantity: qty,
    toProductId: id,
    resultingQuantity: qty,
    reason: text,
  })
  .strict()
  .refine((c) => c.fromProductId !== c.toProductId, 'Choose two different variants');
export const allocationsSchema = z
  .array(
    z
      .object({ installmentId: id, amount: cents.refine((n) => n > 0, 'Amount must be positive') })
      .strict(),
  )
  .min(1)
  .max(200);
export const repaymentSchema = z
  .object({
    operationId: id,
    payment: paymentSchema,
    terminalId: id.optional(),
    allocations: allocationsSchema.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();
export const repaymentPreviewSchema = z
  .object({ amount: cents.refine((n) => n > 0), allocations: allocationsSchema.optional() })
  .strict();
export const expenseSchema = z
  .object({
    operationId: id,
    category: text,
    paidFrom: z.enum(['cash', 'bank']).default('bank'),
    terminalId: id.optional(),
    description: text,
    amount: cents.refine((n) => n > 0),
    date,
  })
  .strict();
export const refundSchema = z
  .object({
    operationId: id,
    reason: text,
    restock: z.boolean(),
    terminalId: id.optional(),
    refundMethod: z.enum(['cash', 'card', 'transfer']).default('cash'),
    reference: z.string().max(120).default(''),
    lines: z
      .array(z.object({ lineId: id, quantity: qty }).strict())
      .min(1)
      .max(100)
      .optional(),
  })
  .strict();
export const settingsSchema = z
  .object({
    email: z.union([z.email(), z.literal('')]).default(''),
    registrationNumber: z.string().max(100).default(''),
    taxNumber: z.string().max(100).default(''),
    defaultTaxBps: z.number().int().min(0).max(10000).default(0),
    invoicePrefix: z
      .string()
      .regex(/^[A-Z0-9-]{1,12}$/)
      .default('AGR'),
    name: text,
    address: z.string().max(1000),
    phone: z.string().max(30),
    receiptFooter: z.string().max(300),
    expiryAlertDays: z.number().int().min(1).max(365),
    requireCashSession: z.boolean().default(false),
    driverInstallments: z.number().int().min(1).max(12).optional(),
    driverCreditMonths: z.number().int().min(1).max(24).optional(),
    normalCreditMonths: z.number().int().min(1).max(12).optional(),
    dueSoonDays: z.number().int().min(0).max(60).optional(),
    nextInvoiceNumber: z.number().int().min(1).max(999999999).optional(),
  })
  .strict()
  .refine(
    (s) =>
      s.driverInstallments === undefined ||
      s.driverCreditMonths === undefined ||
      s.driverCreditMonths >= s.driverInstallments,
    { message: 'The driver credit period must be at least one month per installment' },
  );
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(200).default(''),
});
export type ProductInput = z.infer<typeof productSchema>;
export type SaleInput = z.infer<typeof saleSchema>;
