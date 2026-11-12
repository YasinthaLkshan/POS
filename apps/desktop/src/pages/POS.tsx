import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Minus, Trash2, ShoppingBasket, ArrowRight, Receipt } from 'lucide-react';
import {
  decimalToInteger,
  lineTotals,
  money,
  quantity,
  multiply,
  allocateDiscount,
  type SaleInput,
} from '@agripos/shared';
import {
  api,
  useData,
  useAllOptions,
  type Product,
  type Contact,
  type Category,
} from '../services/api';
import { useAllowed, useSession } from '../stores/session';
import { FormDialog } from '../components/FormDialog';
import { PageHeading, QueryState } from '../components/common';
import { toast } from 'sonner';
import { ProductImage } from '../components/ProductImage';
import { shortcuts } from '../services/shortcuts';
interface CartLine {
  product: Product;
  quantity: number;
  discount: number;
}
export function POS() {
  const [newSale, setNewSale] = useState(false);
  const [orderDiscount, setOrderDiscount] = useState(0);
  const offline = useSession((s) => s.user?.offline);
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [cart, setCart] = useState<CartLine[]>([]),
    [customer, setCustomer] = useState(''),
    [checkout, setCheckout] = useState(false);
  const [parkDialog, setParkDialog] = useState(false),
    [parkOperation, setParkOperation] = useState(''),
    [parkedId, setParkedId] = useState<string | undefined>();
  const parked = useData<{ id: string; label: string; status: string }[]>('/sales/park');
  const [operationId, setOperationId] = useState(''),
    [pending, setPending] = useState<SaleInput | null>(null),
    input = useRef<HTMLInputElement>(null),
    navigate = useNavigate(),
    cache = useQueryClient();
  const products = useData<{ items: Product[] }>(
      `/products?limit=100&search=${encodeURIComponent(search)}`,
    ),
    customers = useAllOptions<Contact>('/customers'),
    categories = useData<Category[]>('/categories');
  const canDiscount = useAllowed('discount.approve');
  const subtotal = cart.reduce((sum, l) => sum + multiply(l.product.selling_price, l.quantity), 0),
    netBase = cart.reduce(
      (sum, l) => sum + multiply(l.product.selling_price, l.quantity) - l.discount,
      0,
    ),
    effectiveOrderDiscount = Math.min(orderDiscount, netBase),
    allocated = allocateDiscount(
      effectiveOrderDiscount,
      cart.map((l) => multiply(l.product.selling_price, l.quantity) - l.discount),
    );
  const total = cart.reduce(
    (sum, l, i) =>
      sum +
      lineTotals(l.product.selling_price, l.quantity, l.discount + allocated[i]!, l.product.tax_bps)
        .total,
    0,
  );
  const tax = cart.reduce(
    (sum, l, i) =>
      sum +
      lineTotals(l.product.selling_price, l.quantity, l.discount + allocated[i]!, l.product.tax_bps)
        .tax,
    0,
  );
  function add(product: Product) {
    if (pending) return;
    setCart((previous) => {
      const found = previous.find((l) => l.product.id === product.id);
      if ((found?.quantity ?? 0) + 1000 > product.stock) {
        toast.error('Not enough stock in the current snapshot');
        return previous;
      }
      return found
        ? previous.map((l) =>
            l.product.id === product.id ? { ...l, quantity: l.quantity + 1000 } : l,
          )
        : [...previous, { product, quantity: 1000, discount: 0 }];
    });
  }
  function beginPayment() {
    if (!cart.length && !pending) return;
    setOperationId(pending?.operationId ?? crypto.randomUUID());
    setCheckout(true);
  }
  useEffect(() => {
    void window.desktop
      .pendingSales()
      .then((records) => {
        if (records[0]) setPending(records[0]);
      })
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : 'Unable to load pending checkout'),
      );
    const handler = (e: KeyboardEvent) => {
      const keys = shortcuts();
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === keys.search) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === keys.payment) {
        e.preventDefault();
        document.getElementById('checkout-button')?.click();
      }
      if (e.key === keys.newSale) {
        e.preventDefault();
        document.getElementById('new-sale-button')?.click();
      }
      if (e.key === keys.hold) {
        e.preventDefault();
        document.getElementById('park-button')?.click();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  return (
    <>
      <PageHeading
        title="Point of sale"
        eyebrow="LET’S MAKE IT A GOOD SALE"
        description={`Search, scan, and serve. ${shortcuts().search} search · ${shortcuts().payment} payment · ${shortcuts().newSale} new sale · ${shortcuts().hold} hold.`}
        action={
          <button className="btn secondary" onClick={() => navigate('/sales')}>
            <Receipt size={16} />
            Sales history
          </button>
        }
      />
      <div className="pos-layout">
        <section className="pos-catalog">
          <form
            className="pos-search search-field"
            onSubmit={(e) => {
              e.preventDefault();
              const matches = products.data?.items.filter(
                (p) => p.active && (p.barcode === search || p.sku === search),
              );
              if (matches?.length === 1) {
                add(matches[0]!);
                setSearch('');
              } else toast.info('Select a product from the results');
            }}
          >
            <Search size={20} />
            <input
              ref={input}
              aria-label="Search or scan barcode"
              placeholder="Search products or scan a barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>F2</kbd>
          </form>
          <div className="category-tabs">
            <button className={!category ? 'active' : ''} onClick={() => setCategory('')}>
              All products
            </button>
            {categories.data?.map((c) => (
              <button
                className={category === c.id ? 'active' : ''}
                key={c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          {!!parked.data?.length && (
            <div className="panel" style={{ padding: 12, marginBottom: 16 }}>
              <label>
                Resume parked sale
                <select
                  value=""
                  disabled={!!pending || cart.length > 0}
                  onChange={async (e) => {
                    const selected = e.target.value;
                    if (!selected) return;
                    try {
                      const saved = await api<{
                        customerId: string | null;
                        orderDiscount?: number;
                        lines: { productId: string; quantity: number; discount: number }[];
                      }>(`/sales/park/${selected}/resume`, 'POST', {});
                      const restored = await Promise.all(
                        saved.lines.map(async (l) => ({
                          product: await api<Product>(`/products/${l.productId}`),
                          quantity: l.quantity,
                          discount: l.discount,
                        })),
                      );
                      setCart(restored);
                      setCustomer(saved.customerId ?? '');
                      setOrderDiscount(saved.orderDiscount ?? 0);
                      setParkedId(selected);
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : 'Cannot resume sale');
                    }
                  }}
                >
                  <option value="">Select a parked sale…</option>
                  {parked.data.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <QueryState query={products}>
            <div className="product-grid">
              {products.data?.items
                .filter((p) => p.active && (!category || p.category_id === category))
                .map((p) => (
                  <button
                    className="product-tile"
                    key={p.id}
                    disabled={p.stock <= 0 || !!pending}
                    onClick={() => add(p)}
                  >
                    <div className={`tile-visual ${p.kind}`}>
                      <ProductImage id={p.id} available={!!p.image_path && !offline} />
                      <span className="tile-category">{p.category}</span>
                    </div>
                    <div className="tile-body">
                      <strong>{p.name}</strong>
                      <small>
                        {p.sku} · {p.unit}
                      </small>
                      <div>
                        <b>{money(p.selling_price)}</b>
                        <span className={p.stock <= p.minimum_stock ? 'error-text' : 'muted'}>
                          {quantity(p.stock)} left
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
            </div>
            {!products.data?.items.length && (
              <div className="panel empty">
                No products found. Add products and receive stock to begin selling.
              </div>
            )}
          </QueryState>
        </section>
        <section className="panel cart-panel">
          <div className="section-heading">
            <div>
              <h2>
                Current sale <span className="count-pill">{cart.length}</span>
              </h2>
              <p>New transaction</p>
            </div>
            <ShoppingBasket size={21} />
          </div>
          <div className="cart-customer">
            <label>
              Customer
              <select
                aria-label="Customer"
                value={customer}
                disabled={!!pending || offline}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">Walk-in customer</option>
                {customers.data?.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="cart-items">
            {cart.length ? (
              cart.map((l, index) => (
                <div className="cart-item" key={l.product.id}>
                  <div className="cart-item-title">
                    <strong>{l.product.name}</strong>
                    <button
                      className="icon-btn"
                      aria-label={`Remove ${l.product.name}`}
                      disabled={!!pending}
                      onClick={() => setCart(cart.filter((x) => x !== l))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <small>
                    {money(l.product.selling_price)} / {l.product.unit}
                  </small>
                  <div className="cart-item-bottom">
                    <div className="quantity-control">
                      <button
                        aria-label={`Decrease ${l.product.name}`}
                        disabled={!!pending || l.quantity <= 1000}
                        onClick={() =>
                          setCart(
                            cart.map((x) =>
                              x === l ? { ...x, quantity: x.quantity - 1000, discount: 0 } : x,
                            ),
                          )
                        }
                      >
                        <Minus size={12} />
                      </button>
                      <input
                        aria-label={`Quantity for ${l.product.name}`}
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={l.quantity / 1000}
                        disabled={!!pending}
                        onChange={(e) => {
                          try {
                            const q = decimalToInteger(e.target.value, 3);
                            if (q > 0)
                              setCart(
                                cart.map((x) => (x === l ? { ...x, quantity: q, discount: 0 } : x)),
                              );
                          } catch {
                            /* The existing valid quantity stays in the cart. */
                          }
                        }}
                      />
                      <button
                        aria-label={`Increase ${l.product.name}`}
                        disabled={!!pending}
                        onClick={() => add(l.product)}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <strong>
                      {money(
                        lineTotals(
                          l.product.selling_price,
                          l.quantity,
                          l.discount + allocated[index]!,
                          l.product.tax_bps,
                        ).total,
                      )}
                    </strong>
                  </div>
                  {canDiscount && (
                    <label className="line-discount">
                      Discount (LKR)
                      <input
                        aria-label={`Discount for ${l.product.name}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.discount / 100}
                        disabled={!!pending}
                        onChange={(e) => {
                          try {
                            const discount = decimalToInteger(e.target.value);
                            lineTotals(
                              l.product.selling_price,
                              l.quantity,
                              discount,
                              l.product.tax_bps,
                            );
                            setCart(cart.map((x) => (x === l ? { ...x, discount } : x)));
                          } catch {
                            toast.error('Discount must be between zero and the line subtotal');
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
              ))
            ) : (
              <div className="empty cart-empty">
                <ShoppingBasket size={38} />
                <h3>Ready when you are.</h3>
                <p>Add a product to start this sale.</p>
              </div>
            )}
          </div>
          <div className="cart-totals">
            <div>
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            {canDiscount && (
              <label>
                Order discount (LKR)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={!!pending}
                  value={effectiveOrderDiscount / 100}
                  onChange={(e) => {
                    try {
                      const amount = decimalToInteger(e.target.value);
                      allocateDiscount(amount, [netBase]);
                      setOrderDiscount(amount);
                    } catch {
                      toast.error('Order discount cannot exceed the net subtotal');
                    }
                  }}
                />
              </label>
            )}
            <button
              id="new-sale-button"
              className="btn secondary wide"
              disabled={!!pending || !cart.length}
              onClick={() => setNewSale(true)}
            >
              New sale / clear cart
            </button>
            {!offline && (
              <button
                className="btn secondary wide"
                id="park-button"
                disabled={!cart.length || !!pending}
                onClick={() => {
                  setParkOperation(crypto.randomUUID());
                  setParkDialog(true);
                }}
              >
                Park this sale
              </button>
            )}
            <div>
              <span>Items</span>
              <span>{cart.length}</span>
            </div>
            <div>
              <span>Included tax</span>
              <span>{money(tax)}</span>
            </div>
            <div className="grand-total">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
            <button
              id="checkout-button"
              className="btn wide"
              disabled={!cart.length && !pending}
              onClick={beginPayment}
            >
              {pending ? 'Retry payment submission' : 'Take payment'}
              <ArrowRight size={18} />
            </button>
            <small>Totals and availability are verified at checkout.</small>
          </div>
        </section>
      </div>
      {checkout && (
        <FormDialog
          title={pending ? 'Retry sale submission' : 'Complete payment'}
          description={
            pending
              ? 'The previous response was uncertain. Retry sends the identical transaction ID and payment details to prevent duplicate posting.'
              : `Total ${money(total)}. Record confirmed external payments only. Any unpaid balance needs a customer, due date and available credit.`
          }
          fields={
            pending
              ? []
              : offline
                ? [
                    {
                      name: 'cash',
                      label: 'Cash payment (LKR)',
                      type: 'number',
                      min: 0,
                      required: true,
                    },
                    {
                      name: 'cashTendered',
                      label: 'Cash received (LKR)',
                      type: 'number',
                      min: 0,
                      required: true,
                    },
                  ]
                : [
                    { name: 'cash', label: 'Cash payment (LKR)', type: 'number', min: 0 },
                    { name: 'cashTendered', label: 'Cash received (LKR)', type: 'number', min: 0 },
                    { name: 'card', label: 'Confirmed card amount (LKR)', type: 'number', min: 0 },
                    { name: 'cardReference', label: 'Card authorization reference' },
                    {
                      name: 'transfer',
                      label: 'Confirmed bank transfer (LKR)',
                      type: 'number',
                      min: 0,
                    },
                    { name: 'transferReference', label: 'Bank transfer reference' },
                    { name: 'dueDate', label: 'Credit due date (unpaid balance)', type: 'date' },
                  ]
          }
          initial={{
            cash: String(total / 100),
            cashTendered: String(total / 100),
            card: '0',
            transfer: '0',
          }}
          submitLabel={pending ? 'Retry identical transaction' : 'Confirm sale'}
          onClose={() => setCheckout(false)}
          onSave={async (v) => {
            const info = await window.desktop.info();
            const payload: SaleInput = pending ?? {
              operationId,
              terminalId: info.terminalId,
              customerId: customer || null,
              dueDate: v.dueDate || null,
              parkedId,
              orderDiscount: effectiveOrderDiscount,
              lines: cart.map((l) => ({
                productId: l.product.id,
                quantity: l.quantity,
                discount: l.discount,
              })),
              payments: (
                [
                  { method: 'cash', amount: decimalToInteger(v.cash || '0'), reference: '' },
                  {
                    method: 'card',
                    amount: decimalToInteger(v.card || '0'),
                    reference: v.cardReference ?? '',
                  },
                  {
                    method: 'transfer',
                    amount: decimalToInteger(v.transfer || '0'),
                    reference: v.transferReference ?? '',
                  },
                ] as SaleInput['payments']
              ).filter((p) => p.amount > 0),
              cashTendered: decimalToInteger(v.cashTendered || '0'),
            };
            // Freeze the request until an authoritative response; network retries reuse it byte-for-byte.
            setPending(payload);
            const result = await window.desktop.request<{ id: string; change: number }>({
              method: 'POST',
              path: '/sales',
              body: payload,
            });
            if (result.error) {
              const unresolved = await window.desktop.pendingSales();
              if (!unresolved.some((s) => s.operationId === payload.operationId)) setPending(null);
              throw new Error(result.error.message);
            }
            setPending(null);
            setCart([]);
            setOrderDiscount(0);
            setOrderDiscount(0);
            setParkedId(undefined);
            await cache.invalidateQueries();
            toast.success(`Sale completed · Change ${money(result.data!.change)}`);
            navigate(`/sales?id=${result.data!.id}`);
          }}
        />
      )}
      {parkDialog && (
        <FormDialog
          title="Park this sale"
          description="The cart will be stored for later. Stock and prices are checked again at checkout."
          fields={[{ name: 'label', label: 'Cart label / customer name', required: true }]}
          onClose={() => setParkDialog(false)}
          submitLabel="Park sale"
          onSave={async (v) => {
            await api(parkedId ? `/sales/park/${parkedId}/release` : '/sales/park', 'POST', {
              operationId: parkOperation,
              label: v.label,
              orderDiscount: effectiveOrderDiscount,
              customerId: customer || null,
              lines: cart.map((l) => ({
                productId: l.product.id,
                quantity: l.quantity,
                discount: l.discount,
              })),
            });
            setCart([]);
            setOrderDiscount(0);
            setParkedId(undefined);
            await cache.invalidateQueries();
          }}
        />
      )}
      {newSale && (
        <FormDialog
          title="Start a new sale"
          description="Clear the current unpaid cart? A resumed parked cart will be cancelled. No stock or payment has been posted."
          fields={[]}
          submitLabel="Clear cart"
          onClose={() => setNewSale(false)}
          onSave={async () => {
            if (parkedId)
              await api(`/sales/park/${parkedId}/cancel`, 'POST', {
                operationId: crypto.randomUUID(),
                label: 'Cancelled cart',
                customerId: customer || null,
                lines: cart.map((l) => ({
                  productId: l.product.id,
                  quantity: l.quantity,
                  discount: l.discount,
                })),
              });
            setCart([]);
            setOrderDiscount(0);
            setCustomer('');
            setParkedId(undefined);
            await cache.invalidateQueries();
          }}
        />
      )}
    </>
  );
}
