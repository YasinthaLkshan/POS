import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Tags, Pencil, Layers, PackagePlus, Repeat, History, Package } from 'lucide-react';
import { Modal } from '../components/Modal';
import {
  ConvertStockDialog,
  FamilyDialog,
  ReceiveStockDialog,
  StockHistoryDialog,
} from '../components/StockDialogs';
import { money, quantity, decimalToInteger } from '@agripos/shared';
import {
  api,
  useData,
  useAllOptions,
  type Product,
  type Category,
  type Contact,
} from '../services/api';
import { useAllowed } from '../stores/session';
import { Table } from '../components/Table';
import { FormDialog, type Field } from '../components/FormDialog';
import { PageHeading, QueryState, Badge } from '../components/common';
import { toast } from 'sonner';
import { ProductImage } from '../components/ProductImage';
export function Products() {
  const shop = useData<{ default_tax_bps: number }>('/settings');
  const [params, setParams] = useSearchParams(),
    [page, setPage] = useState(1),
    [edit, setEdit] = useState<Product | 'new' | null>(null),
    [category, setCategory] = useState(false),
    [kind, setKind] = useState('other');
  const [family, setFamily] = useState<'new' | { id: string; name: string } | null>(null),
    [choose, setChoose] = useState(params.get('new') === '1'),
    [history, setHistory] = useState<Product | null>(null),
    [receiving, setReceiving] = useState<Product | null>(null),
    [converting, setConverting] = useState<Product | null>(null);
  const canInventory = useAllowed('inventory.write');
  const [importCsv, setImportCsv] = useState<{ text: string; operationId: string } | null>(null);
  const query = useData<{ items: Product[]; total: number }>(
      `/products?limit=100&page=${page}&search=${encodeURIComponent(params.get('q') ?? '')}`,
    ),
    categories = useData<Category[]>('/categories');
  const canPurchase = useAllowed('purchases.write'),
    suppliers = useAllOptions<Contact>('/suppliers', canPurchase),
    canWrite = useAllowed('catalog.write'),
    canPrice = useAllowed('price.write');
  const cache = useQueryClient();
  const saved = () => {
    void cache.invalidateQueries();
    toast.success('Saved successfully');
  };
  const fields: Field[] = [
    { name: 'name', label: 'Product name', required: true },
    { name: 'sku', label: 'SKU', required: true },
    { name: 'barcode', label: 'Barcode' },
    {
      name: 'categoryId',
      label: 'Category',
      type: 'select',
      required: true,
      options: categories.data?.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: 'supplierId',
      label: 'Supplier',
      type: 'select',
      options: suppliers.data?.map((s) => ({ value: s.id, label: s.name })),
    },
    {
      name: 'unit',
      label: 'Base sale unit',
      type: 'select',
      required: true,
      options: ['piece', 'packet', 'bag', 'kg', 'g', 'liter', 'ml', 'tray', 'pot'].map((v) => ({
        value: v,
        label: v,
      })),
    },
    {
      name: 'purchasePrice',
      label: 'Purchase price (LKR)',
      required: true,
      type: 'number',
      min: 0,
    },
    { name: 'sellingPrice', label: 'Selling price (LKR)', required: true, type: 'number', min: 0 },
    {
      name: 'taxBps',
      label: 'Tax rate (%)',
      type: 'number',
      min: 0,
      hint: 'Use your confirmed product tax classification.',
    },
    { name: 'minimumStock', label: 'Low-stock threshold', type: 'number', min: 0 },
    {
      name: 'wholeUnits',
      label: 'Quantities',
      type: 'select',
      required: true,
      options: [
        { value: 'true', label: 'Whole units only (pieces, bags, packets)' },
        { value: 'false', label: 'Allow decimals (loose kg, litres)' },
      ],
    },
    ...(edit && edit !== 'new' && edit.family_id
      ? [{ name: 'variantLabel', label: 'Size / variant label', required: true }]
      : []),
    { name: 'brand', label: 'Brand' },
    { name: 'subcategory', label: 'Subcategory' },
    { name: 'purchaseUnit', label: 'Purchase unit (e.g. carton)' },
    {
      name: 'purchaseFactor',
      label: 'Base units per purchase unit',
      type: 'number',
      min: 0.001,
      required: true,
    },
    { name: 'reorderQuantity', label: 'Reorder quantity (base units)', type: 'number', min: 0 },
    {
      name: 'active',
      label: 'Status',
      type: 'select',
      required: true,
      options: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Archived' },
      ],
    },
    { name: 'description', label: 'Description', type: 'textarea' },
  ];
  const specialized: Record<string, string[]> = {
    fertilizer: ['Manufacturer', 'Fertilizer type', 'Package size'],
    seed: ['Crop type', 'Seed variety', 'Packet weight', 'Germination information'],
    plant: ['Plant variety', 'Pot size', 'Stock condition', 'Nursery batch', 'Arrival date'],
    equipment: ['Model', 'Serial number', 'Warranty period', 'Warranty start', 'Warranty end'],
    other: [],
  };
  for (const label of specialized[kind] ?? []) fields.push({ name: `attribute_${label}`, label });
  const initial: Record<string, string> =
    edit && edit !== 'new'
      ? {
          name: edit.name,
          sku: edit.sku,
          barcode: edit.barcode ?? '',
          categoryId: edit.category_id,
          supplierId: edit.supplier_id ?? '',
          unit: edit.unit,
          purchasePrice: String((edit.purchase_price ?? 0) / 100),
          sellingPrice: String(edit.selling_price / 100),
          taxBps: String(edit.tax_bps / 100),
          minimumStock: String(edit.minimum_stock / 1000),
          brand: edit.brand,
          description: edit.description,
          active: String(edit.active),
          subcategory: edit.subcategory,
          purchaseUnit: edit.purchase_unit,
          purchaseFactor: String(edit.purchase_factor / 1000),
          reorderQuantity: String(edit.reorder_quantity / 1000),
          wholeUnits: String(edit.whole_units),
          variantLabel: edit.variant_label,
          ...Object.fromEntries(
            Object.entries(edit.attributes).map(([k, v]) => [`attribute_${k}`, v]),
          ),
        }
      : {
          unit: 'piece',
          purchasePrice: '0',
          sellingPrice: '0',
          taxBps: String((shop.data?.default_tax_bps ?? 0) / 100),
          minimumStock: '0',
          active: 'true',
          purchaseFactor: '1',
          reorderQuantity: '0',
          wholeUnits: 'true',
        };
  return (
    <>
      <PageHeading
        title="Products"
        description="A well-organized catalog. A smoother day at the counter."
        action={
          <div className="inline">
            {canWrite && canPrice && (
              <label className="btn secondary">
                Import CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (file.size > 200000) {
                      toast.error('CSV must be at most 200 KB');
                      return;
                    }
                    try {
                      setImportCsv({ text: await file.text(), operationId: crypto.randomUUID() });
                    } catch {
                      toast.error('Unable to read CSV');
                    }
                  }}
                />
              </label>
            )}
            {canWrite && (
              <button className="btn secondary" onClick={() => setCategory(true)}>
                <Tags size={16} />
                Add category
              </button>
            )}
            {canWrite && canPrice && (
              <button className="btn secondary" onClick={() => setFamily('new')}>
                <Layers size={16} />
                Add product with sizes
              </button>
            )}
            {canWrite && canPrice && (
              <button className="btn" onClick={() => setEdit('new')}>
                <Plus size={16} />
                Add product
              </button>
            )}
          </div>
        }
      />
      {importCsv && (
        <FormDialog
          title="Import products"
          description="Creates new products atomically; existing SKUs are not overwritten. Required CSV headers: name, sku, category, selling_price, purchase_price. Optional: barcode, unit, minimum_stock, tax_percent, brand, description. Use existing category names and decimal LKR prices. Maximum 200 rows."
          fields={[{ name: 'csv', label: 'Review CSV contents', type: 'textarea', required: true }]}
          initial={{ csv: importCsv.text }}
          submitLabel="Import products"
          onClose={() => setImportCsv(null)}
          onSave={async (v) => {
            const result = await api<{ imported: number }>('/products/import', 'POST', {
              operationId: importCsv.operationId,
              csv: v.csv,
            });
            saved();
            toast.success(`${result.imported} products imported`);
          }}
        />
      )}
      <div className="section-toolbar">
        <span className="muted">{query.data?.total ?? 0} products · prices in LKR</span>
        <label className="inline">
          New product details
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {['other', 'fertilizer', 'seed', 'plant', 'equipment'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>
      <QueryState query={query}>
        <Table
          rows={query.data?.items ?? []}
          searchText={(r) => `${r.name} ${r.sku} ${r.barcode ?? ''} ${r.category}`}
          columns={[
            {
              key: 'image',
              title: 'Image',
              value: (r) => (
                <div className="inline">
                  <ProductImage id={r.id} available={!!r.image_path} />
                  {canWrite && (
                    <button
                      className="text-btn"
                      onClick={async () => {
                        try {
                          const result = await window.desktop.uploadProductImage(r.id);
                          if (!result.cancelled) saved();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Image upload failed');
                        }
                      }}
                    >
                      Add image here
                    </button>
                  )}
                </div>
              ),
            },
            {
              key: 'name',
              title: 'Product',
              value: (r) => (
                <div className="product-cell">
                  <span className="product-symbol">{(r.family ?? r.name).slice(0, 1)}</span>
                  <div>
                    <strong>{r.family ?? r.name}</strong>
                    <small>
                      {r.family ? `${r.variant_label} · ` : ''}
                      {r.sku} · {r.unit}
                      {r.whole_units ? '' : ' (decimals)'}
                    </small>
                  </div>
                </div>
              ),
              sort: (r) => r.name,
            },
            {
              key: 'category',
              title: 'Category',
              value: (r) => r.category,
              sort: (r) => r.category,
            },
            {
              key: 'price',
              title: 'Selling price',
              value: (r) => money(r.selling_price),
              sort: (r) => r.selling_price,
            },
            {
              key: 'stock',
              title: 'Available stock',
              value: (r) => (
                <span className={r.stock <= r.minimum_stock ? 'error-text' : ''}>
                  {quantity(r.stock)} {r.unit}
                </span>
              ),
              sort: (r) => r.stock,
            },
            {
              key: 'status',
              title: 'Status',
              value: (r) => (
                <Badge
                  tone={!r.active ? 'neutral' : r.stock <= r.minimum_stock ? 'danger' : 'success'}
                >
                  {!r.active
                    ? 'Archived'
                    : r.stock === 0
                      ? 'Out of stock'
                      : r.stock <= r.minimum_stock
                        ? 'Low stock'
                        : 'In stock'}
                </Badge>
              ),
            },
            {
              key: 'driver',
              title: 'Driver discount',
              align: 'end',
              value: (r) => (r.driver_discount ? `${money(r.driver_discount)} / ${r.unit}` : '—'),
            },
            {
              key: 'actions',
              title: 'Actions',
              align: 'end',
              value: (r) => (
                <div className="row-actions">
                  {canInventory && (
                    <button
                      className="icon-btn"
                      title="Receive stock"
                      aria-label={`Receive stock for ${r.name}`}
                      onClick={() => setReceiving(r)}
                    >
                      <PackagePlus size={15} />
                    </button>
                  )}
                  {canInventory && r.family_id && (
                    <button
                      className="icon-btn"
                      title="Open bag / convert stock"
                      aria-label={`Convert stock for ${r.name}`}
                      disabled={r.stock <= 0}
                      onClick={() => setConverting(r)}
                    >
                      <Repeat size={15} />
                    </button>
                  )}
                  {canWrite && canPrice && r.family_id && (
                    <button
                      className="icon-btn"
                      title="Add another size"
                      aria-label={`Add a size to ${r.family}`}
                      onClick={() => setFamily({ id: r.family_id!, name: r.family! })}
                    >
                      <Layers size={15} />
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    title="Stock history"
                    aria-label={`Stock history for ${r.name}`}
                    onClick={() => setHistory(r)}
                  >
                    <History size={15} />
                  </button>
                  {canWrite && canPrice && (
                    <button
                      className="icon-btn"
                      aria-label={`Edit ${r.name}`}
                      onClick={() => {
                        setKind(r.kind);
                        setEdit(r);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </QueryState>
      {(query.data?.total ?? 0) > 100 && (
        <div className="inline">
          <button className="btn secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous 100
          </button>
          <button
            className="btn secondary"
            disabled={page * 100 >= (query.data?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            Next 100
          </button>
        </div>
      )}
      {edit && (
        <FormDialog
          title={edit === 'new' ? 'Add product' : 'Edit product'}
          fields={fields}
          initial={initial}
          onFieldChange={(name, value) => {
            if (name === 'categoryId')
              setKind(categories.data?.find((c) => c.id === value)?.kind ?? 'other');
          }}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            await api(
              edit === 'new' ? '/products' : `/products/${edit.id}`,
              edit === 'new' ? 'POST' : 'PATCH',
              {
                name: v.name,
                sku: v.sku,
                barcode: v.barcode || null,
                categoryId: v.categoryId,
                supplierId: v.supplierId || null,
                unit: v.unit,
                purchasePrice: decimalToInteger(v.purchasePrice!),
                sellingPrice: decimalToInteger(v.sellingPrice!),
                taxBps: decimalToInteger(v.taxBps || '0'),
                minimumStock: decimalToInteger(v.minimumStock || '0', 3),
                purchaseUnit: v.purchaseUnit || v.unit,
                purchaseFactor: decimalToInteger(v.purchaseFactor || '1', 3),
                reorderQuantity: decimalToInteger(v.reorderQuantity || '0', 3),
                subcategory: v.subcategory || '',
                brand: v.brand,
                description: v.description,
                active: v.active === 'true',
                wholeUnits: v.wholeUnits !== 'false',
                ...(edit !== 'new' && edit.family_id ? { variantLabel: v.variantLabel } : {}),
                attributes: Object.fromEntries(
                  Object.entries(v)
                    .filter(([k]) => k.startsWith('attribute_'))
                    .map(([k, value]) => [k.slice(10), value]),
                ),
              },
            );
            saved();
          }}
        />
      )}
      {choose && (
        <Modal
          title="What are you adding?"
          description="Products sold in several sizes keep separate stock and prices for each size."
          onClose={() => {
            setChoose(false);
            setParams({});
          }}
        >
          <div className="quick-actions">
            <button
              onClick={() => {
                setChoose(false);
                setParams({});
                setFamily('new');
              }}
            >
              <Layers size={18} />
              Product with sizes (fertilizer: loose, 25 kg, 50 kg)
            </button>
            <button
              onClick={() => {
                setChoose(false);
                setParams({});
                setEdit('new');
              }}
            >
              <Package size={18} />
              Single product (tool, plant, seed packet)
            </button>
          </div>
        </Modal>
      )}
      {family && categories.data && (
        <FamilyDialog
          categories={categories.data}
          family={family === 'new' ? undefined : family}
          onClose={() => setFamily(null)}
        />
      )}
      {history && <StockHistoryDialog product={history} onClose={() => setHistory(null)} />}
      {receiving && <ReceiveStockDialog product={receiving} onClose={() => setReceiving(null)} />}
      {converting && (
        <ConvertStockDialog product={converting} onClose={() => setConverting(null)} />
      )}
      {category && (
        <FormDialog
          title="Add category"
          fields={[
            { name: 'name', label: 'Category name', required: true },
            {
              name: 'kind',
              label: 'Product type',
              type: 'select',
              required: true,
              options: ['fertilizer', 'seed', 'plant', 'equipment', 'other'].map((v) => ({
                value: v,
                label: v,
              })),
            },
          ]}
          initial={{ kind: 'other' }}
          onClose={() => setCategory(false)}
          onSave={async (v) => {
            await api('/categories', 'POST', v);
            saved();
          }}
        />
      )}
    </>
  );
}
