import { useState } from 'react';
import { decimalToInteger, money } from '@agripos/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Printer,
  Palette,
  ShieldCheck,
  DatabaseBackup,
  CalendarClock,
  Truck,
} from 'lucide-react';
import { api, useData } from '../services/api';
import { useAllowed, useSession } from '../stores/session';
import { FormDialog } from '../components/FormDialog';
import { PageHeading, QueryState } from '../components/common';
import { toast } from 'sonner';
import { shortcuts, shortcutKeys, defaultShortcuts } from '../services/shortcuts';
const when = (value: string | null) =>
  value ? new Date(value).toLocaleString('en-LK') : 'Not yet';
interface Settings {
  email: string;
  registration_number: string;
  tax_number: string;
  default_tax_bps: number;
  invoice_prefix: string;
  name: string;
  address: string;
  phone: string;
  receipt_footer: string;
  expiry_alert_days: number;
  require_cash_session: boolean;
  driver_installments: number;
  driver_credit_months: number;
  normal_credit_months: number;
  due_soon_days: number;
  next_invoice_number: number;
}
const settingsBody = (s: Settings) => ({
  name: s.name,
  address: s.address,
  phone: s.phone,
  receiptFooter: s.receipt_footer,
  expiryAlertDays: s.expiry_alert_days,
  requireCashSession: s.require_cash_session,
  email: s.email,
  registrationNumber: s.registration_number,
  taxNumber: s.tax_number,
  defaultTaxBps: s.default_tax_bps,
  invoicePrefix: s.invoice_prefix,
});
function DriverDiscountRules() {
  const rules = useData<
    {
      product_id: string;
      name: string;
      unit: string;
      selling_price: number;
      amount: number;
      family: string | null;
    }[]
  >('/driver-discounts');
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [filter, setFilter] = useState('');
  const cache = useQueryClient();
  const rows = (rules.data ?? []).filter((r) =>
    r.name.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className="panel settings-card full-span">
      <Truck />
      <h2>Lorry driver discounts</h2>
      <p className="muted">
        Discount per unit of each size, applied automatically only when the sale is for a lorry
        driver. Example: Rs. 10 per 25 kg bag gives Rs. 30 off three bags.
      </p>
      <input
        className="settings-search"
        aria-label="Filter driver discounts"
        placeholder="Filter products…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <QueryState query={rules}>
        <div className="table-scroll" style={{ maxHeight: 360 }}>
          <table className="compact-table">
            <thead>
              <tr>
                <th>Product / size</th>
                <th className="numeric">Price</th>
                <th className="numeric">Discount per unit (LKR)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const draft = drafts[r.product_id];
                return (
                  <tr key={r.product_id}>
                    <td>
                      {r.name}
                      <small className="block muted">per {r.unit}</small>
                    </td>
                    <td className="numeric">{money(r.selling_price)}</td>
                    <td className="numeric">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Driver discount for ${r.name}`}
                        value={draft ?? String(r.amount / 100)}
                        onChange={(e) => setDrafts({ ...drafts, [r.product_id]: e.target.value })}
                      />
                    </td>
                    <td className="numeric">
                      <button
                        className="btn secondary small"
                        disabled={draft === undefined}
                        onClick={async () => {
                          try {
                            await api('/driver-discounts', 'POST', {
                              productId: r.product_id,
                              amount: decimalToInteger(draft || '0'),
                            });
                            const next = { ...drafts };
                            delete next[r.product_id];
                            setDrafts(next);
                            await cache.invalidateQueries();
                            toast.success(`Driver discount saved for ${r.name}`);
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Unable to save');
                          }
                        }}
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div className="empty">No products found.</div>}
        </div>
      </QueryState>
    </section>
  );
}
export function Settings() {
  const [keys, setKeys] = useState(shortcuts()),
    [margin, setMargin] = useState(localStorage.getItem('agripos-margin') ?? '4');
  const query = useData<Settings>('/settings'),
    [edit, setEdit] = useState(false),
    [password, setPassword] = useState(false),
    [profile, setProfile] = useState(false),
    [printers, setPrinters] = useState<{ name: string; displayName: string }[] | null>(null);
  const [printer, setPrinter] = useState(localStorage.getItem('agripos-printer') ?? ''),
    [paper, setPaper] = useState(localStorage.getItem('agripos-paper') ?? '80mm');
  const allowed = useAllowed('settings.write'),
    canPrice = useAllowed('price.write'),
    { theme, setTheme, user, setUser } = useSession(),
    cache = useQueryClient();
  const [creditEdit, setCreditEdit] = useState(false);
  const backup = useQuery({
      queryKey: ['backup-status'],
      queryFn: () => window.desktop.backupStatus(),
      refetchInterval: 10000,
    }),
    [backingUp, setBackingUp] = useState(false);
  return (
    <>
      <PageHeading title="Settings" description="Make AgriPOS feel at home in your shop." />
      <div className="settings-grid">
        <section className="panel settings-card">
          <ShieldCheck />
          <h2>Your profile</h2>
          <p>{user?.name}</p>
          <p className="muted">Role: {user?.role}</p>
          <button className="btn secondary" onClick={() => setProfile(true)}>
            Edit your name
          </button>
        </section>
        <section className="panel settings-card">
          <DatabaseBackup />
          <h2>Backup and recovery</h2>
          {backup.data?.role === 'main' ? (
            <>
              <p>
                This is the main shop computer. Shop data is saved to a backup file every 30 minutes
                {backup.data.cloudConfigured ? ' and copied to the cloud when online' : ''}.
              </p>
              <p className="muted">
                Last backup on this computer: {when(backup.data.lastLocalAt)}
                <br />
                Last cloud copy:{' '}
                {backup.data.cloudConfigured
                  ? when(backup.data.lastCloudAt)
                  : 'Not configured. Add a Neon URL in Connect your shop.'}
              </p>
              {!backup.data.toolsFound && (
                <div className="alert danger">
                  PostgreSQL backup tools were not found on this computer.
                </div>
              )}
              {backup.data.lastError && (
                <div className="alert danger">Last backup failed: {backup.data.lastError}</div>
              )}
              <button
                className="btn"
                disabled={backup.data.running || backingUp}
                onClick={async () => {
                  setBackingUp(true);
                  try {
                    const result = await window.desktop.backupNow();
                    if (result.error) throw new Error(result.error.message);
                    toast.success('Backup completed');
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Backup failed');
                  } finally {
                    setBackingUp(false);
                    void backup.refetch();
                  }
                }}
              >
                {backup.data.running || backingUp ? 'Backing up…' : 'Back up now'}
              </button>
            </>
          ) : (
            <>
              <p>
                {backup.data?.role === 'till'
                  ? 'This till uses the shop database on the main computer. Backups run there.'
                  : 'Backups run on the main shop computer.'}
              </p>
              <p className="muted">
                Synchronize offline receipts before closing AgriPOS. Images and local receipts are
                stored in this computer’s application data folder; back it up while AgriPOS is
                closed.
              </p>
            </>
          )}
        </section>
        <section className="panel settings-card">
          <Building2 />
          <h2>Shop details</h2>
          <QueryState query={query}>
            <h3>{query.data?.name}</h3>
            <p>{query.data?.address || 'No address configured'}</p>
            <p>{query.data?.phone || 'No contact number configured'}</p>
            <p className="muted">Receipt footer: {query.data?.receipt_footer}</p>
            {allowed && (
              <div className="inline">
                <button className="btn secondary" onClick={() => setEdit(true)}>
                  Edit shop details
                </button>
                <button
                  className="btn secondary"
                  onClick={async () => {
                    try {
                      const result = await window.desktop.uploadShopLogo();
                      if (!result.cancelled) {
                        await cache.invalidateQueries();
                        toast.success('Shop logo saved on this computer');
                      }
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Logo upload failed');
                    }
                  }}
                >
                  Add shop logo here
                </button>
              </div>
            )}
          </QueryState>
        </section>
        <section className="panel settings-card">
          <CalendarClock />
          <h2>Credit and invoices</h2>
          <QueryState query={query}>
            <p className="muted">
              Driver credit: {query.data?.driver_installments} installment(s) over{' '}
              {query.data?.driver_credit_months} month(s)
              <br />
              Normal customer credit: due after {query.data?.normal_credit_months} month(s)
              <br />
              “Due soon” reminder: {query.data?.due_soon_days} day(s) before the due date
              <br />
              Next invoice: {query.data?.invoice_prefix}-
              {String(query.data?.next_invoice_number ?? 1).padStart(6, '0')}
            </p>
            {allowed && (
              <button className="btn secondary" onClick={() => setCreditEdit(true)}>
                Edit credit and invoice settings
              </button>
            )}
          </QueryState>
        </section>
        <section className="panel settings-card">
          <Palette />
          <h2>Appearance</h2>
          <p className="muted">Choose a comfortable workspace for your day.</p>
          <div className="segmented">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button key={t} className={theme === t ? 'selected' : ''} onClick={() => setTheme(t)}>
                {t}
              </button>
            ))}
          </div>
        </section>
        <section className="panel settings-card">
          <Printer />
          <h2>Receipt printing</h2>
          <p className="muted">
            Choose a system printer, or save receipts as PDF from sales history.
          </p>
          <button
            className="btn secondary"
            onClick={async () => {
              try {
                setPrinters(await window.desktop.printers());
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Unable to list printers');
              }
            }}
          >
            Find printers
          </button>
          {printers && (
            <label>
              Printer
              <select value={printer} onChange={(e) => setPrinter(e.target.value)}>
                <option value="">System default</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName || p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Paper size
            <select value={paper} onChange={(e) => setPaper(e.target.value)}>
              {['58mm', '80mm', 'A4'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            Receipt margin (mm)
            <input
              type="number"
              min="0"
              max="10"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
            />
          </label>
          <div className="inline wrap">
            <button
              className="btn"
              onClick={() => {
                const amount = Number(margin);
                if (!Number.isFinite(amount) || amount < 0 || amount > 10) {
                  toast.error('Receipt margin must be between 0 and 10 mm');
                  return;
                }
                localStorage.setItem('agripos-margin', String(amount));
                localStorage.setItem('agripos-printer', printer);
                localStorage.setItem('agripos-paper', paper);
                toast.success('Printer preferences saved');
              }}
            >
              Save printer preferences
            </button>
            {[false, true].map((pdf) => (
              <button
                key={String(pdf)}
                className="btn secondary"
                onClick={async () => {
                  try {
                    const result = await window.desktop.printTest({
                      printer,
                      paper: paper as '58mm' | '80mm' | 'A4',
                      marginMm: Number(margin),
                      pdf,
                    });
                    if (!result.cancelled) toast.success('Test receipt generated');
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Test receipt failed');
                  }
                }}
              >
                {pdf ? 'Save test PDF' : 'Print test receipt'}
              </button>
            ))}
          </div>
        </section>
        <section className="panel settings-card">
          <ShieldCheck />
          <h2>Your account</h2>
          <h3>{user?.name}</h3>
          <p className="muted">Role: {user?.role}</p>
          <button className="btn secondary" onClick={() => setPassword(true)}>
            Change password
          </button>
        </section>
        <section className="panel settings-card">
          <h2>Cashier shortcuts</h2>
          {Object.keys(defaultShortcuts).map((key) => (
            <label key={key} className="capitalize">
              {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
              <select
                value={keys[key as keyof typeof keys]}
                onChange={(e) => setKeys({ ...keys, [key]: e.target.value })}
              >
                {shortcutKeys.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          ))}
          <button
            className="btn secondary"
            onClick={() => {
              if (new Set(Object.values(keys)).size !== 5) {
                toast.error('Choose a different key for each action');
                return;
              }
              localStorage.setItem('agripos-shortcuts', JSON.stringify(keys));
              toast.success('Shortcuts saved');
            }}
          >
            Save shortcuts
          </button>
        </section>
        {canPrice && <DriverDiscountRules />}
      </div>
      {creditEdit && query.data && (
        <FormDialog
          title="Credit and invoice settings"
          description="New credit sales use these defaults. You can still change dates and installments for each sale."
          fields={[
            {
              name: 'driverInstallments',
              label: 'Driver installments per credit sale',
              type: 'number',
              min: 1,
              required: true,
            },
            {
              name: 'driverCreditMonths',
              label: 'Driver credit period (months)',
              type: 'number',
              min: 1,
              required: true,
            },
            {
              name: 'normalCreditMonths',
              label: 'Normal customer repayment period (months)',
              type: 'number',
              min: 1,
              required: true,
            },
            {
              name: 'dueSoonDays',
              label: 'Show “due soon” this many days before',
              type: 'number',
              min: 0,
              required: true,
            },
            {
              name: 'nextInvoiceNumber',
              label: `Next invoice number (${query.data.invoice_prefix}-…)`,
              type: 'number',
              min: query.data.next_invoice_number,
              required: true,
              hint: 'Can only move forward so invoice numbers are never reused.',
            },
          ]}
          initial={{
            driverInstallments: String(query.data.driver_installments),
            driverCreditMonths: String(query.data.driver_credit_months),
            normalCreditMonths: String(query.data.normal_credit_months),
            dueSoonDays: String(query.data.due_soon_days),
            nextInvoiceNumber: String(query.data.next_invoice_number),
          }}
          onClose={() => setCreditEdit(false)}
          onSave={async (v) => {
            await api('/settings', 'PATCH', {
              ...settingsBody(query.data!),
              driverInstallments: Number(v.driverInstallments),
              driverCreditMonths: Number(v.driverCreditMonths),
              normalCreditMonths: Number(v.normalCreditMonths),
              dueSoonDays: Number(v.dueSoonDays),
              nextInvoiceNumber: Number(v.nextInvoiceNumber),
            });
            await cache.invalidateQueries();
            toast.success('Credit settings saved');
          }}
        />
      )}
      {edit && query.data && (
        <FormDialog
          title="Shop details"
          fields={[
            { name: 'email', label: 'Shop email', type: 'email' },
            { name: 'registrationNumber', label: 'Business registration number' },
            { name: 'taxNumber', label: 'Tax identifier' },
            {
              name: 'defaultTaxBps',
              label: 'Default tax rate for new products (%)',
              type: 'number',
              min: 0,
              required: true,
            },
            {
              name: 'invoicePrefix',
              label: 'Invoice prefix (uppercase letters, numbers or hyphens)',
              required: true,
            },
            {
              name: 'requireCashSession',
              label: 'Require an open register for cash',
              type: 'select',
              required: true,
              options: [
                { value: 'true', label: 'Required' },
                { value: 'false', label: 'Optional' },
              ],
            },
            { name: 'name', label: 'Shop name', required: true },
            { name: 'phone', label: 'Phone' },
            { name: 'address', label: 'Address', type: 'textarea' },
            { name: 'receiptFooter', label: 'Receipt footer', type: 'textarea' },
            {
              name: 'expiryAlertDays',
              label: 'Expiry alert window (days)',
              type: 'number',
              required: true,
              min: 1,
            },
          ]}
          initial={{
            name: query.data.name,
            phone: query.data.phone,
            address: query.data.address,
            receiptFooter: query.data.receipt_footer,
            expiryAlertDays: String(query.data.expiry_alert_days),
            requireCashSession: String(query.data.require_cash_session),
            email: query.data.email,
            registrationNumber: query.data.registration_number,
            taxNumber: query.data.tax_number,
            defaultTaxBps: String(query.data.default_tax_bps / 100),
            invoicePrefix: query.data.invoice_prefix,
          }}
          onClose={() => setEdit(false)}
          onSave={async (v) => {
            await api('/settings', 'PATCH', {
              ...v,
              expiryAlertDays: Number(v.expiryAlertDays),
              requireCashSession: v.requireCashSession === 'true',
              defaultTaxBps: decimalToInteger(String(v.defaultTaxBps)),
            });
            await cache.invalidateQueries();
            toast.success('Shop settings saved');
          }}
        />
      )}
      {profile && user && (
        <FormDialog
          title="Edit your profile"
          fields={[{ name: 'name', label: 'Your name', required: true }]}
          initial={{ name: user.name }}
          onClose={() => setProfile(false)}
          onSave={async (v) => {
            const updated = await api<NonNullable<typeof user>>('/auth/me', 'PATCH', {
              name: v.name,
            });
            setUser(updated);
            await cache.invalidateQueries();
            toast.success('Profile updated');
          }}
        />
      )}
      {password && (
        <FormDialog
          title="Change password"
          description="Use at least 12 characters and a unique password."
          fields={[
            {
              name: 'currentPassword',
              label: 'Current password',
              type: 'password',
              required: true,
            },
            { name: 'newPassword', label: 'New password', type: 'password', required: true },
            { name: 'confirm', label: 'Confirm password', type: 'password', required: true },
          ]}
          onClose={() => setPassword(false)}
          onSave={async (v) => {
            if (v.newPassword !== v.confirm) throw new Error('Passwords do not match');
            const result = await window.desktop.changePassword({
              currentPassword: v.currentPassword!,
              newPassword: v.newPassword!,
            });
            if (result.error) throw new Error(result.error.message);
            setUser(null);
            toast.success('Password changed. Sign in again.');
          }}
        />
      )}
    </>
  );
}
