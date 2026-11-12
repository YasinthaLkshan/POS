import { useState } from 'react';
import { decimalToInteger } from '@agripos/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Printer, Palette, ShieldCheck } from 'lucide-react';
import { api, useData } from '../services/api';
import { useAllowed, useSession } from '../stores/session';
import { FormDialog } from '../components/FormDialog';
import { PageHeading, QueryState } from '../components/common';
import { toast } from 'sonner';
import { shortcuts, shortcutKeys, defaultShortcuts } from '../services/shortcuts';
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
    { theme, setTheme, user, setUser } = useSession(),
    cache = useQueryClient();
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
          <h2>Backup and recovery</h2>
          <p>
            Cloud backups are managed by your shop administrator. Synchronize all offline receipts
            before closing AgriPOS for a local backup.
          </p>
          <p className="muted">
            Back up the complete application data folder while AgriPOS is closed. Encrypted data
            requires the original Windows account. See the deployment guide for restoration steps.
          </p>
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
              <button className="btn secondary" onClick={() => setEdit(true)}>
                Edit shop details
              </button>
            )}
            {allowed && (
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
          <button
            className="btn secondary"
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
          <div className="inline">
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
            <label key={key}>
              {key.replace(/([A-Z])/g, ' $1')}
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
      </div>
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
