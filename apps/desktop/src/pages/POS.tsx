import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingBasket,
  ArrowRight,
  Receipt,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import {
  addMonths,
  allocateDiscount,
  businessDate,
  decimalToInteger,
  defaultSchedule,
  driverDiscount,
  lineTotals,
  money,
  multiply,
  quantity,
  validateSchedule,
  type SaleInput,
  type ScheduleItem,
} from '@agripos/shared';
import {
  api,
  displayDate,
  useData,
  useDebounced,
  type Category,
  type Contact,
  type CreditProfileData,
  type Driver,
  type Product,
  type ShopSettings,
} from '../services/api';
import { useAllowed, useSession } from '../stores/session';
import { FormDialog } from '../components/FormDialog';
import { Modal } from '../components/Modal';
import { PageHeading, QueryState } from '../components/common';
import { toast } from 'sonner';
import { ProductImage } from '../components/ProductImage';
import { shortcuts } from '../services/shortcuts';

type Mode = 'walk_in' | 'driver' | 'credit';
interface CartLine {
  product: Product;
  quantity: number;
  discount: number;
}
type SelectedDriver = Pick<
  Driver,
  'id' | 'name' | 'driver_code' | 'factory' | 'lorry_number' | 'outstanding'
>;
const parseQuantity = (value: string, whole: boolean) =>
  whole ? decimalToInteger(value, 0) * 1000 : decimalToInteger(value, 3);
const centsOf = (value: string) => {
  try {
    return value.trim() ? decimalToInteger(value) : 0;
  } catch {
    return -1;
  }
};

export function POS() {
  const [params, setParams] = useSearchParams();
  const offline = useSession((s) => s.user?.offline);
  const [mode, setMode] = useState<Mode>(
    params.get('driver') || params.get('type') === 'driver'
      ? 'driver'
      : params.get('type') === 'credit'
        ? 'credit'
        : 'walk_in',
  );
  const [driver, setDriver] = useState<SelectedDriver | null>(null),
    [driverSearch, setDriverSearch] = useState('');
  const [newSale, setNewSale] = useState(false),
    [orderDiscount, setOrderDiscount] = useState(0);
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [cart, setCart] = useState<CartLine[]>([]),
    [checkout, setCheckout] = useState(false);
  const [parkDialog, setParkDialog] = useState(false),
    [parkOperation, setParkOperation] = useState(''),
    [parkedId, setParkedId] = useState<string | undefined>();
  const [pending, setPending] = useState<SaleInput | null>(null);
  const input = useRef<HTMLInputElement>(null),
    navigate = useNavigate(),
    cache = useQueryClient();
  const settings = useData<ShopSettings>('/settings');
  const parked = useData<{ id: string; label: string; status: string }[]>('/sales/park', !offline);
  const debouncedSearch = useDebounced(search, 150);
  const products = useData<{ items: Product[] }>(
    `/products?limit=100&search=${encodeURIComponent(debouncedSearch)}`,
  );
  const categories = useData<Category[]>('/categories');
  const debouncedDriver = useDebounced(driverSearch, 200);
  const drivers = useData<Driver[]>(
    `/drivers?limit=20&search=${encodeURIComponent(debouncedDriver)}`,
    mode === 'driver' && !driver && !offline,
  );
  const canDiscount = useAllowed('discount.approve');
  const driverParam = params.get('driver');
  useEffect(() => {
    if (!driverParam) return;
    api<CreditProfileData>(`/customers/${driverParam}/credit-profile`)
      .then(({ customer: c }) => {
        if (c.kind !== 'driver') return;
        setMode('driver');
        setDriver({
          id: c.id,
          name: c.name,
          driver_code: c.driver_code ?? '',
          factory: c.factory ?? '',
          lorry_number: c.lorry_number,
          outstanding: c.outstanding,
        });
      })
      .catch((e: Error) => toast.error(e.message));
  }, [driverParam]);
  const isDriverSale = mode === 'driver' && !!driver;
  const priced = cart.map((l) => {
    const subtotal = multiply(l.product.selling_price, l.quantity);
    const auto = isDriverSale
      ? driverDiscount(
          l.product.driver_discount ?? 0,
          l.quantity,
          Math.max(0, subtotal - l.discount),
        )
      : 0;
    return { ...l, subtotal, auto, base: subtotal - l.discount - auto };
  });
  const subtotal = priced.reduce((s, l) => s + l.subtotal, 0),
    autoTotal = priced.reduce((s, l) => s + l.auto, 0),
    manualTotal = priced.reduce((s, l) => s + l.discount, 0),
    netBase = priced.reduce((s, l) => s + l.base, 0),
    effectiveOrderDiscount = Math.min(orderDiscount, Math.max(0, netBase)),
    allocated = allocateDiscount(
      effectiveOrderDiscount,
      priced.map((l) => Math.max(0, l.base)),
    );
  const lineTotal = (index: number) => {
    const l = priced[index]!;
    return lineTotals(
      l.product.selling_price,
      l.quantity,
      l.discount + l.auto + allocated[index]!,
      l.product.tax_bps,
    );
  };
  const total = priced.reduce((s, _l, i) => s + lineTotal(i).total, 0),
    tax = priced.reduce((s, _l, i) => s + lineTotal(i).tax, 0);
  function add(product: Product) {
    if (pending) return;
    setCart((previous) => {
      const found = previous.find((l) => l.product.id === product.id);
      if ((found?.quantity ?? 0) + 1000 > product.stock) {
        toast.error(`Not enough stock: ${quantity(product.stock)} ${product.unit} available`);
        return previous;
      }
      return found
        ? previous.map((l) =>
            l.product.id === product.id ? { ...l, quantity: l.quantity + 1000 } : l,
          )
        : [...previous, { product, quantity: 1000, discount: 0 }];
    });
  }
  function setLineQuantity(line: CartLine, value: number) {
    if (value <= 0) return;
    if (value > line.product.stock) {
      toast.error(`Only ${quantity(line.product.stock)} ${line.product.unit} available`);
      return;
    }
    setCart(cart.map((x) => (x === line ? { ...x, quantity: value, discount: 0 } : x)));
  }
  function beginPayment() {
    if (!cart.length && !pending) return;
    if (mode === 'driver' && !driver && !pending) {
      toast.error('Select the lorry driver first');
      return;
    }
    setCheckout(true);
  }
  function switchMode(next: Mode) {
    if (pending) return;
    setMode(next);
    if (next !== 'driver') {
      setDriver(null);
      if (driverParam) setParams({});
    }
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
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; family: boolean; items: Product[] }>();
    for (const p of products.data?.items ?? []) {
      if (!p.active || (category && p.category_id !== category)) continue;
      const key = p.family_id ?? p.id;
      const group = map.get(key) ?? { key, family: !!p.family_id, items: [] };
      group.items.push(p);
      map.set(key, group);
    }
    return [...map.values()];
  }, [products.data, category]);
  const clearSale = () => {
    setCart([]);
    setOrderDiscount(0);
    setParkedId(undefined);
  };
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
              placeholder="Search products by name or SKU, or scan a barcode…"
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
                      if (saved.customerId) setParams({ driver: saved.customerId });
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
              {groups.map((g) => {
                const first = g.items[0]!;
                if (!g.family)
                  return (
                    <button
                      className="product-tile"
                      key={g.key}
                      disabled={first.stock <= 0 || !!pending}
                      onClick={() => add(first)}
                    >
                      <div className={`tile-visual ${first.kind}`}>
                        <ProductImage id={first.id} available={!!first.image_path && !offline} />
                        <span className="tile-category">{first.category}</span>
                      </div>
                      <div className="tile-body">
                        <strong>{first.name}</strong>
                        <small>
                          {first.sku} · {first.unit}
                        </small>
                        <div>
                          <b>{money(first.selling_price)}</b>
                          <span
                            className={first.stock <= first.minimum_stock ? 'error-text' : 'muted'}
                          >
                            {quantity(first.stock)} left
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                return (
                  <div className="product-tile family-tile" key={g.key}>
                    <div className="tile-body">
                      <span className="tile-category static">{first.category}</span>
                      <strong>{first.family}</strong>
                      <div className="variant-chips">
                        {g.items.map((v) => (
                          <button
                            key={v.id}
                            className="variant-chip"
                            disabled={v.stock <= 0 || !!pending}
                            aria-label={`Add ${v.name}`}
                            onClick={() => add(v)}
                          >
                            <span>{v.variant_label}</span>
                            <b>{money(v.selling_price)}</b>
                            <small className={v.stock <= v.minimum_stock ? 'error-text' : ''}>
                              {quantity(v.stock)} {v.unit}
                            </small>
                            {isDriverSale && v.driver_discount > 0 && (
                              <small className="discount-note">
                                −{money(v.driver_discount)} / {v.unit}
                              </small>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {!groups.length && (
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
            <div className="customer-switch" role="group" aria-label="Customer type">
              {(
                [
                  ['walk_in', 'Walk-in'],
                  ['driver', 'Lorry driver'],
                  ['credit', 'Credit customer'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={mode === value ? 'selected' : ''}
                  disabled={!!pending || (!!offline && value !== 'walk_in')}
                  onClick={() => switchMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === 'driver' &&
              (driver ? (
                <div className="selected-customer">
                  <Truck size={18} />
                  <div>
                    <strong>{driver.name}</strong>
                    <small>
                      {[driver.driver_code, driver.factory, driver.lorry_number]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                    {driver.outstanding > 0 && (
                      <small className="warning-text">
                        Outstanding {money(driver.outstanding)}
                      </small>
                    )}
                  </div>
                  <button
                    className="icon-btn"
                    aria-label="Change driver"
                    disabled={!!pending}
                    onClick={() => {
                      setDriver(null);
                      if (driverParam) setParams({});
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="driver-picker">
                  <div className="search-field">
                    <Search size={15} />
                    <input
                      autoFocus
                      aria-label="Find lorry driver"
                      placeholder="Driver name, factory or lorry number…"
                      value={driverSearch}
                      onChange={(e) => setDriverSearch(e.target.value)}
                    />
                  </div>
                  <div className="picker-results">
                    {drivers.data
                      ?.filter((d) => d.active)
                      .map((d) => (
                        <button
                          key={d.id}
                          onClick={() => {
                            setDriver(d);
                            setDriverSearch('');
                          }}
                        >
                          <span>
                            <strong>{d.name}</strong>
                            <small>
                              {d.driver_code} · {d.factory}
                              {d.lorry_number ? ` · ${d.lorry_number}` : ''}
                            </small>
                          </span>
                          {d.outstanding > 0 && <small>{money(d.outstanding)}</small>}
                        </button>
                      ))}
                    {drivers.data && !drivers.data.length && (
                      <small className="muted">
                        No matching drivers. Add drivers in Lorry drivers.
                      </small>
                    )}
                  </div>
                </div>
              ))}
            {mode === 'credit' && (
              <p className="muted small-note">
                <UserRound size={14} /> Enter the customer’s name and repayment date when taking
                payment.
              </p>
            )}
          </div>
          <div className="cart-items">
            {cart.length ? (
              priced.map((l, index) => (
                <div className="cart-item" key={l.product.id}>
                  <div className="cart-item-title">
                    <strong>{l.product.name}</strong>
                    <button
                      className="icon-btn"
                      aria-label={`Remove ${l.product.name}`}
                      disabled={!!pending}
                      onClick={() => setCart(cart.filter((x) => x.product.id !== l.product.id))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <small>
                    {money(l.product.selling_price)} / {l.product.unit} ·{' '}
                    {quantity(l.product.stock)} in stock
                  </small>
                  <div className="cart-item-bottom">
                    <div className="quantity-control">
                      <button
                        aria-label={`Decrease ${l.product.name}`}
                        disabled={!!pending || l.quantity <= 1000}
                        onClick={() => setLineQuantity(cart[index]!, l.quantity - 1000)}
                      >
                        <Minus size={12} />
                      </button>
                      <input
                        aria-label={`Quantity for ${l.product.name}`}
                        type="number"
                        min={l.product.whole_units ? '1' : '0.001'}
                        step={l.product.whole_units ? '1' : '0.001'}
                        value={l.quantity / 1000}
                        disabled={!!pending}
                        onChange={(e) => {
                          try {
                            setLineQuantity(
                              cart[index]!,
                              parseQuantity(e.target.value, l.product.whole_units),
                            );
                          } catch {
                            if (l.product.whole_units)
                              toast.error(`${l.product.name} is sold in whole ${l.product.unit}s`);
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
                    <strong>{money(lineTotal(index).total)}</strong>
                  </div>
                  {l.auto > 0 && (
                    <small className="discount-note">
                      Driver discount −{money(l.auto)} ({money(l.product.driver_discount)} ×{' '}
                      {quantity(l.quantity)})
                    </small>
                  )}
                  {canDiscount && (
                    <label className="line-discount">
                      Line discount (LKR)
                      <input
                        aria-label={`Discount for ${l.product.name}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.discount / 100}
                        disabled={!!pending}
                        onChange={(e) => {
                          try {
                            const discount = decimalToInteger(e.target.value || '0');
                            if (discount + l.auto > l.subtotal) throw new Error();
                            setCart(cart.map((x, i) => (i === index ? { ...x, discount } : x)));
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
            {autoTotal > 0 && (
              <div className="discount-row">
                <span>Driver discount</span>
                <span>−{money(autoTotal)}</span>
              </div>
            )}
            {manualTotal > 0 && (
              <div className="discount-row">
                <span>Line discounts</span>
                <span>−{money(manualTotal)}</span>
              </div>
            )}
            {canDiscount && (
              <label className="order-discount">
                Bill discount (LKR)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={!!pending}
                  value={effectiveOrderDiscount / 100}
                  onChange={(e) => {
                    try {
                      const amount = decimalToInteger(e.target.value || '0');
                      allocateDiscount(amount, [Math.max(0, netBase)]);
                      setOrderDiscount(amount);
                    } catch {
                      toast.error('Bill discount cannot exceed the amount payable');
                    }
                  }}
                />
              </label>
            )}
            {tax > 0 && (
              <div>
                <span>Included tax</span>
                <span>{money(tax)}</span>
              </div>
            )}
            <div>
              <span>Items</span>
              <span>{cart.length}</span>
            </div>
            <div className="grand-total">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
            <button
              id="checkout-button"
              className="btn wide checkout-btn"
              disabled={!cart.length && !pending}
              onClick={beginPayment}
            >
              {pending ? 'Retry payment submission' : 'Take payment'}
              <ArrowRight size={18} />
            </button>
            <div className="cart-actions">
              <button
                id="new-sale-button"
                className="btn secondary"
                disabled={!!pending || !cart.length}
                onClick={() => setNewSale(true)}
              >
                New sale / clear cart
              </button>
              {!offline && (
                <button
                  className="btn secondary"
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
            </div>
            <small>Totals and availability are verified at checkout.</small>
          </div>
        </section>
      </div>
      {checkout && pending && (
        <FormDialog
          title="Retry sale submission"
          description="The previous response was uncertain. Retry sends the identical transaction ID and payment details to prevent duplicate posting."
          fields={[]}
          submitLabel="Retry identical transaction"
          onClose={() => setCheckout(false)}
          onSave={async () => {
            const result = await window.desktop.request<{ id: string; change: number }>({
              method: 'POST',
              path: '/sales',
              body: pending,
            });
            if (result.error) {
              const unresolved = await window.desktop.pendingSales();
              if (!unresolved.some((s) => s.operationId === pending.operationId)) setPending(null);
              throw new Error(result.error.message);
            }
            setPending(null);
            clearSale();
            await cache.invalidateQueries();
            toast.success(`Sale completed · Change ${money(result.data!.change)}`);
            navigate(`/sales?id=${result.data!.id}`);
          }}
        />
      )}
      {checkout && !pending && (
        <CheckoutDialog
          total={total}
          mode={mode}
          driver={driver}
          offline={!!offline}
          settings={settings.data}
          onClose={() => setCheckout(false)}
          onSubmit={async (details) => {
            const info = await window.desktop.info();
            const payload: SaleInput = {
              operationId: crypto.randomUUID(),
              terminalId: info.terminalId,
              customerId: details.customerId,
              dueDate: details.dueDate ?? null,
              ...(parkedId ? { parkedId } : {}),
              orderDiscount: effectiveOrderDiscount,
              lines: cart.map((l) => ({
                productId: l.product.id,
                quantity: l.quantity,
                discount: l.discount,
              })),
              payments: details.payments,
              cashTendered: details.cashTendered,
              ...(details.creditCustomer ? { creditCustomer: details.creditCustomer } : {}),
              ...(details.schedule ? { schedule: details.schedule } : {}),
              ...(details.notes ? { notes: details.notes } : {}),
            };
            // Freeze the request until an authoritative response; network retries reuse it byte-for-byte.
            setPending(payload);
            const result = await window.desktop.request<{
              id: string;
              change: number;
              credit: number;
              invoiceNumber: string;
            }>({ method: 'POST', path: '/sales', body: payload });
            if (result.error) {
              const unresolved = await window.desktop.pendingSales();
              if (!unresolved.some((s) => s.operationId === payload.operationId)) setPending(null);
              throw new Error(result.error.message);
            }
            setPending(null);
            clearSale();
            await cache.invalidateQueries();
            toast.success(
              `Sale ${result.data!.invoiceNumber ?? ''} completed · Change ${money(result.data!.change)}${result.data!.credit ? ` · Credit ${money(result.data!.credit)}` : ''}`,
            );
            navigate(`/sales?id=${result.data!.id}`);
          }}
        />
      )}
      {parkDialog && (
        <FormDialog
          title="Park this sale"
          description="The cart will be stored for later. Stock and prices are checked again at checkout."
          fields={[{ name: 'label', label: 'Cart label / customer name', required: true }]}
          initial={{ label: driver?.name ?? '' }}
          onClose={() => setParkDialog(false)}
          submitLabel="Park sale"
          onSave={async (v) => {
            await api(parkedId ? `/sales/park/${parkedId}/release` : '/sales/park', 'POST', {
              operationId: parkOperation,
              label: v.label,
              orderDiscount: effectiveOrderDiscount,
              customerId: driver?.id ?? null,
              lines: cart.map((l) => ({
                productId: l.product.id,
                quantity: l.quantity,
                discount: l.discount,
              })),
            });
            clearSale();
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
                customerId: driver?.id ?? null,
                lines: cart.map((l) => ({
                  productId: l.product.id,
                  quantity: l.quantity,
                  discount: l.discount,
                })),
              });
            clearSale();
            await cache.invalidateQueries();
          }}
        />
      )}
    </>
  );
}

interface CheckoutDetails {
  customerId: string | null;
  dueDate?: string;
  payments: SaleInput['payments'];
  cashTendered: number;
  creditCustomer?: { name: string; phone?: string; notes?: string };
  schedule?: ScheduleItem[];
  notes?: string;
}

function CheckoutDialog({
  total,
  mode,
  driver,
  offline,
  settings,
  onClose,
  onSubmit,
}: {
  total: number;
  mode: Mode;
  driver: SelectedDriver | null;
  offline: boolean;
  settings?: ShopSettings;
  onClose: () => void;
  onSubmit: (details: CheckoutDetails) => Promise<void>;
}) {
  const today = businessDate();
  const [cash, setCash] = useState(String(total / 100)),
    [tenderedInput, setTendered] = useState<string | null>(null),
    [other, setOther] = useState(false),
    [card, setCard] = useState(''),
    [cardRef, setCardRef] = useState(''),
    [transfer, setTransfer] = useState(''),
    [transferRef, setTransferRef] = useState('');
  const [name, setName] = useState(''),
    [phone, setPhone] = useState(''),
    [notes, setNotes] = useState(''),
    [due, setDue] = useState(addMonths(today, settings?.normal_credit_months ?? 1)),
    [existing, setExisting] = useState<Contact | null>(null),
    [lookup, setLookup] = useState('');
  const [custom, setCustom] = useState<ScheduleItem[] | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const tendered = tenderedInput ?? cash;
  const cashCents = centsOf(cash),
    cardCents = other ? centsOf(card) : 0,
    transferCents = other ? centsOf(transfer) : 0,
    tenderedCents = centsOf(tendered);
  const credit =
    total - Math.max(0, cashCents) - Math.max(0, cardCents) - Math.max(0, transferCents);
  const debouncedLookup = useDebounced(lookup, 250);
  const matches = useData<(Contact & { kind: string })[]>(
    `/customers?kind=all&limit=8&search=${encodeURIComponent(debouncedLookup)}`,
    mode === 'credit' && debouncedLookup.trim().length >= 2 && !existing,
  );
  const defaultPlan = useMemo(
    () =>
      credit > 0
        ? defaultSchedule(
            credit,
            today,
            settings?.driver_installments ?? 2,
            settings?.driver_credit_months ?? 2,
          )
        : [],
    [credit, today, settings?.driver_installments, settings?.driver_credit_months],
  );
  const schedule = custom ?? defaultPlan;
  const problems: string[] = [];
  if ([cashCents, cardCents, transferCents, tenderedCents].some((n) => n < 0))
    problems.push('Enter amounts as numbers, for example 8000 or 8000.50');
  if (credit < 0)
    problems.push('Payments are more than the total; enter extra cash as cash received');
  if (cashCents > 0 && tenderedCents < cashCents)
    problems.push('Cash received must cover the cash paid');
  if (cardCents > 0 && !cardRef.trim()) problems.push('Enter the card authorization reference');
  if (transferCents > 0 && !transferRef.trim()) problems.push('Enter the bank transfer reference');
  if (credit > 0) {
    if (offline) problems.push('Offline sales must be paid in full with cash');
    else if (mode === 'walk_in')
      problems.push('To give credit, choose Lorry driver or Credit customer for this sale');
    else if (mode === 'driver') {
      const issue = validateSchedule(schedule, credit, today);
      if (issue) problems.push(issue);
    } else {
      if (!existing && !name.trim()) problems.push('Enter the credit customer’s name');
      if (!due || due < today) problems.push('Choose a repayment date from today onwards');
    }
  }
  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const payments = (
        [
          { method: 'cash', amount: Math.max(0, cashCents), reference: '' },
          { method: 'card', amount: cardCents, reference: cardRef.trim() },
          { method: 'transfer', amount: transferCents, reference: transferRef.trim() },
        ] as SaleInput['payments']
      ).filter((p) => p.amount > 0);
      const details: CheckoutDetails = {
        customerId:
          mode === 'driver'
            ? driver!.id
            : mode === 'credit' && existing && credit > 0
              ? existing.id
              : null,
        payments,
        cashTendered: cashCents > 0 ? tenderedCents : 0,
      };
      if (credit > 0 && mode === 'driver') details.schedule = schedule;
      if (credit > 0 && mode === 'credit') {
        details.dueDate = due;
        if (!existing)
          details.creditCustomer = {
            name: name.trim(),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          };
        else if (notes.trim()) details.notes = notes.trim();
      }
      await onSubmit(details);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete the sale');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Complete payment"
      description={
        mode === 'driver' && driver
          ? `Lorry driver ${driver.name} · ${driver.factory}`
          : mode === 'credit'
            ? 'Normal credit customer'
            : 'Walk-in customer'
      }
      busy={saving}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={saving || problems.length > 0}
            onClick={() => void submit()}
          >
            {saving ? 'Saving…' : 'Confirm sale'}
          </button>
        </>
      }
    >
      <div className="checkout-summary">
        <div>
          <span>Total payable</span>
          <strong>{money(total)}</strong>
        </div>
        <div>
          <span>Paid now</span>
          <strong>{money(Math.max(0, total - Math.max(0, credit)))}</strong>
        </div>
        <div className={credit > 0 ? 'credit' : ''}>
          <span>Credit</span>
          <strong>{money(Math.max(0, credit))}</strong>
        </div>
        {cashCents > 0 && tenderedCents > cashCents && (
          <div>
            <span>Change</span>
            <strong>{money(tenderedCents - cashCents)}</strong>
          </div>
        )}
      </div>
      <div className="form-grid">
        <label>
          Cash paid now (LKR)
          <input
            type="number"
            min="0"
            step="0.01"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
          />
          {!offline && mode !== 'walk_in' && (
            <small className="muted">Lower this amount to put the rest on credit.</small>
          )}
        </label>
        <label>
          Cash received (LKR)
          <input
            type="number"
            min="0"
            step="0.01"
            value={tendered}
            onChange={(e) => setTendered(e.target.value)}
          />
        </label>
      </div>
      {!offline && (
        <button type="button" className="text-btn spaced" onClick={() => setOther(!other)}>
          {other ? 'Hide card and bank transfer' : 'Add card or bank transfer payment'}
        </button>
      )}
      {other && (
        <div className="form-grid">
          <label>
            Confirmed card amount (LKR)
            <input
              type="number"
              min="0"
              step="0.01"
              value={card}
              onChange={(e) => setCard(e.target.value)}
            />
          </label>
          <label>
            Card authorization reference
            <input value={cardRef} onChange={(e) => setCardRef(e.target.value)} />
          </label>
          <label>
            Confirmed bank transfer (LKR)
            <input
              type="number"
              min="0"
              step="0.01"
              value={transfer}
              onChange={(e) => setTransfer(e.target.value)}
            />
          </label>
          <label>
            Bank transfer reference
            <input value={transferRef} onChange={(e) => setTransferRef(e.target.value)} />
          </label>
        </div>
      )}
      {credit > 0 && mode === 'driver' && (
        <section className="credit-box">
          <div className="inline spread">
            <h3>Installments for {money(credit)}</h3>
            {custom && (
              <button type="button" className="text-btn" onClick={() => setCustom(null)}>
                Reset to default
              </button>
            )}
          </div>
          <table className="compact-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Due date</th>
                <th className="numeric">Amount (LKR)</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((item, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <input
                      type="date"
                      aria-label={`Installment ${i + 1} due date`}
                      value={item.dueDate}
                      min={today}
                      onChange={(e) =>
                        setCustom(
                          schedule.map((s, j) => (j === i ? { ...s, dueDate: e.target.value } : s)),
                        )
                      }
                    />
                  </td>
                  <td className="numeric">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={`Installment ${i + 1} amount`}
                      value={item.amount / 100}
                      onChange={(e) => {
                        const amount = centsOf(e.target.value);
                        if (amount >= 0)
                          setCustom(schedule.map((s, j) => (j === i ? { ...s, amount } : s)));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="inline">
            <button
              type="button"
              className="btn secondary small"
              disabled={schedule.length >= 24}
              onClick={() =>
                setCustom([
                  ...schedule,
                  { dueDate: addMonths(schedule.at(-1)?.dueDate ?? today, 1), amount: 0 },
                ])
              }
            >
              Add installment
            </button>
            <button
              type="button"
              className="btn secondary small"
              disabled={schedule.length <= 1}
              onClick={() => setCustom(schedule.slice(0, -1))}
            >
              Remove last
            </button>
            <small className="muted">
              Total {money(schedule.reduce((s, i) => s + i.amount, 0))} of {money(credit)}
            </small>
          </div>
        </section>
      )}
      {credit > 0 && mode === 'credit' && (
        <section className="credit-box">
          <h3>Credit of {money(credit)}</h3>
          {existing ? (
            <div className="selected-customer">
              <UserRound size={18} />
              <div>
                <strong>{existing.name}</strong>
                <small>
                  {existing.phone || 'No phone'} · Owes {money(existing.balance ?? 0)}
                </small>
              </div>
              <button className="text-btn" type="button" onClick={() => setExisting(null)}>
                Use a new record
              </button>
            </div>
          ) : (
            <div className="form-grid">
              <label>
                Customer name *
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                Phone
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label className="full">
                Or add to an existing unpaid record
                <input
                  placeholder="Search by name or phone…"
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                />
              </label>
              {!!matches.data?.length && (
                <div className="picker-results full">
                  {matches.data
                    .filter((c) => c.kind !== 'driver')
                    .map((c) => (
                      <button type="button" key={c.id} onClick={() => setExisting(c)}>
                        <span>
                          <strong>{c.name}</strong>
                          <small>
                            {c.phone || 'No phone'} ·{' '}
                            {c.kind === 'walk_in' ? 'Credit record' : 'Customer'}
                          </small>
                        </span>
                        <small>{money(c.balance ?? 0)}</small>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
          <div className="form-grid">
            <label>
              Agreed repayment date *
              <input type="date" min={today} value={due} onChange={(e) => setDue(e.target.value)} />
              <small className="muted">
                Default: {displayDate(addMonths(today, settings?.normal_credit_months ?? 1))}
              </small>
            </label>
            <label>
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
        </section>
      )}
      {problems.length > 0 && (
        <div className="alert warning">
          {problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      )}
      {error && (
        <div role="alert" className="alert danger">
          {error}
        </div>
      )}
    </Modal>
  );
}
