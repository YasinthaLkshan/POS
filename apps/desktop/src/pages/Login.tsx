import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sprout, ShieldCheck, ArrowRight } from 'lucide-react';
import { useSession } from '../stores/session';
import { api } from '../services/api';
import { FormDialog } from '../components/FormDialog';
import { toast } from 'sonner';
const schema = z.object({
  username: z.string().min(3, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});
export function Login() {
  const [error, setError] = useState(''),
    [setup, setSetup] = useState(false),
    [offline, setOffline] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const setUser = useSession((s) => s.setUser);
  return (
    <div className="login">
      <aside className="login-brand">
        <div className="brand">
          <span className="brand-mark">
            <Sprout />
          </span>
          <span>
            Agri<span className="brand-light">POS</span>
          </span>
        </div>
        <div>
          <span className="eyebrow">BUILT FOR YOUR BUSINESS</span>
          <h1>
            A better day
            <br />
            at your shop.
          </h1>
          <p>
            From the first seed to the final sale.
            <br />
            Your inventory, customers and business,
            <br />
            in one thoughtful workspace.
          </p>
        </div>
        <small>AGRICULTURAL RETAIL MANAGEMENT</small>
      </aside>
      <main className="login-main">
        <div className="login-card">
          <span className="eyebrow">WELCOME TO AGRIPOS</span>
          <h1>Let’s get to work.</h1>
          <p className="muted">Sign in with your shop’s staff account.</p>
          <form
            onSubmit={handleSubmit(async (input) => {
              setError('');
              try {
                const result = await window.desktop.login(input);
                if (result.error) {
                  if (result.error.code === 'SETUP_REQUIRED') setSetup(true);
                  throw new Error(result.error.message);
                }
                setUser(await api('/auth/me'));
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Sign in failed');
              }
            })}
          >
            <label>
              Username
              <input type="text" autoComplete="username" {...register('username')} />
              {errors.username && <small className="error-text">{errors.username.message}</small>}
            </label>
            <label>
              Password
              <input type="password" autoComplete="current-password" {...register('password')} />
              {errors.password && <small className="error-text">{errors.password.message}</small>}
            </label>
            {error && (
              <div className="alert danger" role="alert">
                {error}
              </div>
            )}
            <button className="btn wide" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="login-links">
            <button className="text-btn" onClick={() => setOffline(true)}>
              Unlock offline
            </button>
            <button className="text-btn" onClick={() => setSetup(true)}>
              Connect your shop
            </button>
          </div>
          <div className="secure-note">
            <ShieldCheck size={17} />
            Your session is protected by Windows secure storage.
          </div>
        </div>
      </main>
      {setup && (
        <FormDialog
          title="Connect your shop"
          description="The main shop computer keeps the shop database, so every till keeps working when the internet is down. Other tills connect to it over the shop network. For a new database, set an initial admin password; AgriPOS creates the tables automatically."
          fields={[
            {
              name: 'role',
              label: 'This computer is',
              type: 'select',
              required: true,
              options: [
                { value: 'main', label: 'The main shop computer' },
                { value: 'till', label: 'A till (uses the main computer)' },
              ],
            },
            {
              name: 'databaseUrl',
              label: 'Shop database URL',
              type: 'password',
              required: true,
              hint: 'Main computer: postgresql://agripos:PASSWORD@localhost:5432/agripos · Till: replace localhost with the main computer’s name or IP address.',
            },
            {
              name: 'backupUrl',
              label: 'Cloud backup URL (Neon, main computer only)',
              type: 'password',
              hint: 'Use an empty Neon database. It is replaced with a copy of the shop database every 30 minutes when online.',
            },
            {
              name: 'adminPassword',
              label: 'Initial admin password (new database)',
              type: 'password',
            },
            { name: 'shopName', label: 'Shop name (new database)' },
            { name: 'existingStaffId', label: 'Existing administrator staff ID (existing shop)' },
          ]}
          initial={{ role: 'main' }}
          onClose={() => setSetup(false)}
          onSave={async (values) => {
            if (values.backupUrl && values.role !== 'main')
              throw new Error('Only the main shop computer copies backups to the cloud');
            await window.desktop.configure({
              databaseUrl: values.databaseUrl!,
              role: values.role as 'main' | 'till',
              ...(values.backupUrl ? { backupUrl: values.backupUrl } : {}),
              ...(values.adminPassword ? { adminPassword: values.adminPassword } : {}),
              ...(values.shopName ? { shopName: values.shopName } : {}),
              ...(values.existingStaffId ? { existingStaffId: values.existingStaffId } : {}),
            });
            toast.success('Shop connection saved');
          }}
        />
      )}
      {offline && (
        <FormDialog
          title="Unlock offline checkout"
          description="Use the 8–12 digit PIN prepared during an online session. Authorization lasts 12 hours. Only cached products, cash sales and local receipts are available."
          fields={[{ name: 'pin', label: 'Offline PIN', type: 'password', required: true }]}
          onClose={() => setOffline(false)}
          onSave={async (v) => {
            const result = await window.desktop.unlockOffline(v.pin!);
            if (result.error) throw new Error(result.error.message);
            setUser(await api('/auth/me'));
            location.hash = '/pos';
          }}
        />
      )}
    </div>
  );
}
