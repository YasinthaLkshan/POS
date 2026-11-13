import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { decimalToInteger, money, quantity, units } from '@agripos/shared';
import { toast } from 'sonner';
import {
  api,
  useAllOptions,
  useData,
  type Category,
  type Contact,
  type Product,
} from '../services/api';
import { FormDialog } from './FormDialog';
import { Modal } from './Modal';
import { QueryState } from './common';
import { useAllowed } from '../stores/session';

const parseQty = (value: string, whole: boolean) =>
  whole ? decimalToInteger(value, 0) * 1000 : decimalToInteger(value, 3);

export function ReceiveStockDialog({
  product,
  onClose,
}: {
  product?: Product;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [operationId] = useState(() => crypto.randomUUID());
  const canPurchase = useAllowed('purchases.write');
  const products = useAllOptions<Product>('/products', !product);
  const suppliers = useAllOptions<Contact>('/suppliers', canPurchase);
  const [selected, setSelected] = useState(product?.id ?? '');
  const current = product ?? products.data?.find((p) => p.id === selected);
  return (
    <FormDialog
      title={product ? `Receive stock · ${product.name}` : 'Receive stock'}
      description="Adds stock without a purchase order. Supplier balances are not changed; use Purchases to record a supplier invoice."
      fields={[
        ...(product
          ? []
          : [
              {
                name: 'productId',
                label: 'Product / variant',
                type: 'select' as const,
                required: true,
                options: products.data
                  ?.filter((p) => p.active)
                  .map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` })),
              },
            ]),
        {
          name: 'quantity',
          label: `Quantity received${current ? ` (${current.unit}${current.whole_units ? ', whole units' : ''})` : ''}`,
          type: 'number',
          min: 0,
          required: true,
        },
        { name: 'unitCost', label: 'Cost per unit (LKR)', type: 'number', min: 0 },
        ...(canPurchase
          ? [
              {
                name: 'supplierId',
                label: 'Supplier',
                type: 'select' as const,
                options: suppliers.data?.map((s) => ({ value: s.id, label: s.name })),
              },
            ]
          : []),
        { name: 'batchNumber', label: 'Batch / lot number' },
        { name: 'expiryDate', label: 'Expiry date (if any)', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      initial={{
        productId: selected,
        unitCost: current?.purchase_price !== undefined ? String(current.purchase_price / 100) : '',
      }}
      onFieldChange={(name, value) => name === 'productId' && setSelected(value)}
      submitLabel="Add stock"
      onClose={onClose}
      onSave={async (v) => {
        const target = product ?? products.data?.find((p) => p.id === v.productId);
        if (!target) throw new Error('Choose a product');
        let qty: number;
        try {
          qty = parseQty(v.quantity!, target.whole_units);
        } catch {
          throw new Error(
            target.whole_units
              ? `${target.name} is stocked in whole ${target.unit}s`
              : 'Enter a quantity with up to three decimals',
          );
        }
        await api('/inventory/receipts', 'POST', {
          operationId,
          productId: target.id,
          quantity: qty,
          ...(v.unitCost ? { unitCost: decimalToInteger(v.unitCost) } : {}),
          supplierId: v.supplierId || null,
          batchNumber: v.batchNumber ?? '',
          expiryDate: v.expiryDate || null,
          notes: v.notes ?? '',
        });
        await cache.invalidateQueries();
        toast.success(`Added ${quantity(qty)} ${target.unit} of ${target.name}`);
      }}
    />
  );
}

const sizeOf = (label: string) => Number(/(\d+(?:\.\d+)?)\s*kg/i.exec(label)?.[1] ?? 0);
export function ConvertStockDialog({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [operationId] = useState(() => crypto.randomUUID());
  const family = useData<{ items: Product[] }>(
    `/products?limit=100&search=${encodeURIComponent(product.family ?? product.name)}`,
  );
  const siblings = (family.data?.items ?? []).filter(
    (p) => p.family_id === product.family_id && p.id !== product.id,
  );
  const [target, setTarget] = useState('');
  const to = siblings.find((p) => p.id === target);
  const suggested =
    to && sizeOf(product.variant_label) && to.unit === 'kg'
      ? String(sizeOf(product.variant_label))
      : '';
  return (
    <FormDialog
      title={`Open / convert ${product.name}`}
      description={`Moves stock between variants of ${product.family}. Available: ${quantity(product.stock)} ${product.unit}. The cost moves with the stock.`}
      fields={[
        {
          name: 'toProductId',
          label: 'Convert into',
          type: 'select',
          required: true,
          options: siblings.map((p) => ({ value: p.id, label: `${p.variant_label} (${p.unit})` })),
        },
        {
          name: 'quantity',
          label: `How many ${product.unit} to open`,
          type: 'number',
          min: 0,
          required: true,
        },
        {
          name: 'resultingQuantity',
          label: `Resulting quantity${to ? ` (${to.unit})` : ''} per opened ${product.unit}`,
          type: 'number',
          min: 0,
          required: true,
          hint: suggested ? `Suggested from the size: ${suggested} ${to?.unit}` : undefined,
        },
        { name: 'reason', label: 'Reason', required: true },
      ]}
      initial={{ quantity: '1', reason: 'Opened for loose sales' }}
      onFieldChange={(name, value) => name === 'toProductId' && setTarget(value)}
      submitLabel="Convert stock"
      onClose={onClose}
      onSave={async (v) => {
        const destination = siblings.find((p) => p.id === v.toProductId);
        if (!destination) throw new Error('Choose the variant to convert into');
        const count = parseQty(v.quantity!, product.whole_units);
        const per = Number(v.resultingQuantity);
        if (!Number.isFinite(per) || per <= 0) throw new Error('Enter the resulting quantity');
        const total = Number(((per * count) / 1000).toFixed(3));
        const resulting = parseQty(String(total), destination.whole_units);
        await api('/inventory/conversions', 'POST', {
          operationId,
          fromProductId: product.id,
          quantity: count,
          toProductId: destination.id,
          resultingQuantity: resulting,
          reason: v.reason,
        });
        await cache.invalidateQueries();
        toast.success(
          `Converted ${quantity(count)} ${product.unit} into ${quantity(resulting)} ${destination.unit}`,
        );
      }}
    />
  );
}

const movementLabel: Record<string, string> = {
  purchase_receipt: 'Purchase received',
  stock_receipt: 'Stock received',
  sale: 'Sold',
  sale_return: 'Customer return',
  supplier_return: 'Returned to supplier',
  adjustment: 'Adjustment',
  damage: 'Damage',
  write_off: 'Write-off',
  conversion_in: 'Converted in',
  conversion_out: 'Opened / converted out',
};
export function StockHistoryDialog({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const history = useData<
    {
      id: string;
      created_at: string;
      type: string;
      delta: number;
      previous: number;
      balance: number;
      reason: string;
      batch_number: string;
      actor: string;
      invoice_number: string | null;
    }[]
  >(`/products/${product.id}/stock-history`);
  const totals = useMemo(() => {
    const rows = history.data ?? [];
    const sum = (types: string[]) =>
      rows.filter((r) => types.includes(r.type)).reduce((s, r) => s + r.delta, 0);
    return {
      added: sum(['purchase_receipt', 'stock_receipt', 'conversion_in']),
      sold: -sum(['sale']),
      returns: sum(['sale_return']),
      adjustments: sum(['adjustment', 'damage', 'write_off', 'supplier_return', 'conversion_out']),
    };
  }, [history.data]);
  return (
    <Modal
      title={`Stock history · ${product.name}`}
      description={`Current stock ${quantity(product.stock)} ${product.unit}`}
      wide
      onClose={onClose}
    >
      <QueryState query={history}>
        <div className="checkout-summary">
          <div>
            <span>Added</span>
            <strong>{quantity(totals.added)}</strong>
          </div>
          <div>
            <span>Sold</span>
            <strong>{quantity(totals.sold)}</strong>
          </div>
          <div>
            <span>Returns</span>
            <strong>{quantity(totals.returns)}</strong>
          </div>
          <div>
            <span>Adjustments</span>
            <strong>{quantity(totals.adjustments)}</strong>
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: '50vh' }}>
          <table className="compact-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Movement</th>
                <th className="numeric">Change</th>
                <th className="numeric">Before</th>
                <th className="numeric">After</th>
                <th>Reference</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((m) => (
                <tr key={m.id}>
                  <td>{new Date(m.created_at).toLocaleString('en-LK')}</td>
                  <td>
                    {movementLabel[m.type] ?? m.type}
                    <small className="block muted">{m.reason}</small>
                  </td>
                  <td className={`numeric strong ${m.delta < 0 ? 'error-text' : ''}`}>
                    {m.delta > 0 ? '+' : ''}
                    {quantity(m.delta)}
                  </td>
                  <td className="numeric">{quantity(m.previous)}</td>
                  <td className="numeric">{quantity(m.balance)}</td>
                  <td>{m.invoice_number ?? m.batch_number}</td>
                  <td>{m.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.data?.length && <div className="empty">No stock movements yet.</div>}
        </div>
      </QueryState>
    </Modal>
  );
}

interface VariantDraft {
  label: string;
  unit: (typeof units)[number];
  wholeUnits: boolean;
  sku: string;
  sellingPrice: string;
  purchasePrice: string;
  minimumStock: string;
  driverDiscount: string;
}
const presets: Record<string, Pick<VariantDraft, 'label' | 'unit' | 'wholeUnits'>> = {
  loose: { label: 'Loose', unit: 'kg', wholeUnits: false },
  bag25: { label: '25 kg bag', unit: 'bag', wholeUnits: true },
  bag50: { label: '50 kg bag', unit: 'bag', wholeUnits: true },
  custom: { label: '', unit: 'packet', wholeUnits: true },
};
const blank = (preset: keyof typeof presets, base: string): VariantDraft => ({
  ...presets[preset]!,
  sku:
    base && presets[preset]!.label
      ? `${base}-${presets[preset]!.label.replace(/\D+/g, '') || 'L'}`
      : '',
  sellingPrice: '',
  purchasePrice: '',
  minimumStock: '',
  driverDiscount: '',
});

/** Creates a product with sizes (for example fertilizer sold loose and in 25 kg and 50 kg bags). */
export function FamilyDialog({
  categories,
  family,
  onClose,
}: {
  categories: Category[];
  family?: { id: string; name: string };
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const canPrice = useAllowed('price.write');
  const [name, setName] = useState(''),
    [categoryId, setCategoryId] = useState(
      categories.find((c) => c.kind === 'fertilizer')?.id ?? '',
    ),
    [brand, setBrand] = useState(''),
    [description, setDescription] = useState(''),
    [tax, setTax] = useState('0'),
    [variants, setVariants] = useState<VariantDraft[]>(
      family ? [blank('custom', '')] : [blank('loose', ''), blank('bag25', ''), blank('bag50', '')],
    ),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const update = (i: number, patch: Partial<VariantDraft>) =>
    setVariants(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = variants.map((v) => {
        if (!v.label.trim() || !v.sku.trim() || !v.sellingPrice)
          throw new Error('Each size needs a label, SKU and selling price');
        return {
          label: v.label.trim(),
          sku: v.sku.trim(),
          unit: v.unit,
          wholeUnits: v.wholeUnits,
          sellingPrice: decimalToInteger(v.sellingPrice),
          purchasePrice: v.purchasePrice ? decimalToInteger(v.purchasePrice) : 0,
          minimumStock: v.minimumStock ? decimalToInteger(v.minimumStock, 3) : 0,
          driverDiscount: v.driverDiscount ? decimalToInteger(v.driverDiscount) : 0,
        };
      });
      if (family)
        for (const v of payload) await api(`/product-families/${family.id}/variants`, 'POST', v);
      else
        await api('/product-families', 'POST', {
          name: name.trim(),
          categoryId,
          brand,
          description,
          taxBps: decimalToInteger(tax || '0'),
          variants: payload,
        });
      await cache.invalidateQueries();
      toast.success(family ? 'Size added' : 'Product and sizes saved');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={family ? `Add size · ${family.name}` : 'Add product with sizes'}
      description="Each size has its own price, stock and SKU. Loose kilograms and sealed bags are stocked separately."
      wide
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={saving || !canPrice || (!family && (!name.trim() || !categoryId))}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {!family && (
        <div className="form-grid">
          <label>
            Product name *
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Urea"
            />
          </label>
          <label>
            Category *
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Brand
            <input value={brand} onChange={(e) => setBrand(e.target.value)} />
          </label>
          <label>
            Tax rate (%)
            <input
              type="number"
              min="0"
              step="0.01"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </label>
          <label className="full">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
      )}
      <div className="table-scroll">
        <table className="compact-table variant-table">
          <thead>
            <tr>
              <th>Size / label</th>
              <th>Sold by</th>
              <th>SKU</th>
              <th>Price (LKR)</th>
              <th>Cost (LKR)</th>
              <th>Reorder level</th>
              <th>Driver discount / unit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => (
              <tr key={i}>
                <td>
                  <input
                    aria-label={`Size ${i + 1} label`}
                    value={v.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Size ${i + 1} unit`}
                    value={`${v.unit}:${v.wholeUnits}`}
                    onChange={(e) => {
                      const [unit, whole] = e.target.value.split(':');
                      update(i, {
                        unit: unit as VariantDraft['unit'],
                        wholeUnits: whole === 'true',
                      });
                    }}
                  >
                    {units.map((u) => (
                      <option key={u} value={`${u}:${!['kg', 'g', 'liter', 'ml'].includes(u)}`}>
                        {u} {['kg', 'g', 'liter', 'ml'].includes(u) ? '(decimals)' : '(whole)'}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Size ${i + 1} SKU`}
                    value={v.sku}
                    onChange={(e) => update(i, { sku: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Size ${i + 1} price`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={v.sellingPrice}
                    onChange={(e) => update(i, { sellingPrice: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Size ${i + 1} cost`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={v.purchasePrice}
                    onChange={(e) => update(i, { purchasePrice: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Size ${i + 1} reorder level`}
                    type="number"
                    min="0"
                    step="0.001"
                    value={v.minimumStock}
                    onChange={(e) => update(i, { minimumStock: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`Size ${i + 1} driver discount`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={v.driverDiscount}
                    onChange={(e) => update(i, { driverDiscount: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    className="icon-btn"
                    aria-label="Remove size"
                    disabled={variants.length <= 1}
                    onClick={() => setVariants(variants.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="inline wrap">
        {(['loose', 'bag25', 'bag50', 'custom'] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            className="btn secondary small"
            disabled={variants.length >= 20}
            onClick={() => setVariants([...variants, blank(preset, '')])}
          >
            <Plus size={13} />
            {preset === 'custom' ? 'Other size' : presets[preset]!.label}
          </button>
        ))}
      </div>
      {!canPrice && <div className="alert warning">Only managers can set selling prices.</div>}
      {error && <div className="alert danger">{error}</div>}
      <p className="muted table-note">
        Example: loose {money(12000)} per kg, 25 kg bag {money(280000)}, 50 kg bag {money(540000)}.
        Driver discounts apply automatically only to lorry driver sales.
      </p>
    </Modal>
  );
}
