import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import brandLogo from '../assets/dilshan-agro.jpeg';
import { useSession } from '../stores/session';
import { api } from '../services/api';
import { FormDialog } from '../components/FormDialog';
import { toast } from 'sonner';
import { OfflineMode } from '../components/OfflineMode';
const schema = z.object({
  username: z.string().min(3, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
});
export function Login() {
  const [error, setError] = useState(''),
    [setup, setSetup] = useState(false);
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
          <span className="brand-mark dilshan-logo">
            <img src={brandLogo} alt="Dilshan Agro" />
          </span>
          <span>
            Dilshan <span className="brand-light">Agro</span>
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
          <OfflineMode />
          <div className="login-links">
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
          description="Enter your Neon cloud connection once. AgriPOS saves your shop on this computer automatically, so the same username, password and features work without internet. For a new shop only, choose an initial administrator password."
          fields={[
            {
              name: 'databaseUrl',
              label: 'Neon cloud database URL',
              type: 'password',
              required: true,
              hint: 'Your cloud URL is protected by Windows secure storage. No local database setup is needed.',
            },
            {
              name: 'adminPassword',
              label: 'Initial admin password (new database)',
              type: 'password',
            },
            { name: 'shopName', label: 'Shop name (new database)' },
            { name: 'existingStaffId', label: 'Existing administrator staff ID (existing shop)' },
          ]}
          onClose={() => setSetup(false)}
          onSave={async (values) => {
            await window.desktop.configure({
              databaseUrl: values.databaseUrl!,
              ...(values.adminPassword ? { adminPassword: values.adminPassword } : {}),
              ...(values.shopName ? { shopName: values.shopName } : {}),
              ...(values.existingStaffId ? { existingStaffId: values.existingStaffId } : {}),
            });
            toast.success('Shop connection saved');
          }}
        />
      )}
    </div>
  );
}
