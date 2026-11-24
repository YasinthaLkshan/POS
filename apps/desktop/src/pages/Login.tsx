import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ShieldCheck,
  ArrowRight,
  CircleCheck,
  CircleX,
  LoaderCircle,
  PauseCircle,
} from 'lucide-react';
import brandLogo from '../../resources/logo.jpeg';
import { useSession } from '../stores/session';
import { api } from '../services/api';
import { ShopConnectionDialog } from '../components/ShopConnectionDialog';
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
  const connection = useQuery({
    queryKey: ['shop-connection'],
    queryFn: () => window.desktop.backupStatus(),
    refetchInterval: 5000,
  });
  const offline = useQuery({
    queryKey: ['offline-status'],
    queryFn: () => window.desktop.offlineStatus(),
    refetchInterval: 5000,
  });
  const checkedSetup = useRef(false);
  const info = useQuery({ queryKey: ['connection-info'], queryFn: () => window.desktop.info() });
  useEffect(() => {
    if (info.data && !checkedSetup.current) {
      checkedSetup.current = true;
      if (!info.data.configured) setSetup(true);
    }
  }, [info.data]);
  const paused = offline.data?.workOffline;
  const connected = !!connection.data?.lastCloudAt && !connection.data?.lastError;
  const checking = connection.isPending || connection.data?.running;
  const StatusIcon = checking
    ? LoaderCircle
    : paused
      ? PauseCircle
      : connected
        ? CircleCheck
        : CircleX;
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
            <button
              type="button"
              className={`shop-connection-status ${connected && !paused ? 'connected' : ''}`}
              onClick={() => setSetup(true)}
            >
              <StatusIcon size={20} aria-hidden="true" />
              <span>
                <strong>
                  {checking
                    ? 'Checking shop connection'
                    : paused
                      ? 'Cloud sync paused'
                      : connected
                        ? 'Shop connected'
                        : connection.data?.cloudConfigured
                          ? 'Cloud disconnected'
                          : 'Connect your shop'}
                </strong>
                <small>
                  {connection.data?.cloudConfigured
                    ? 'Click to manage your connection'
                    : 'Set up this computer once to get started'}
                </small>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="secure-note">
            <ShieldCheck size={17} />
            Your session is protected by Windows secure storage.
          </div>
        </div>
      </main>
      {setup && (
        <ShopConnectionDialog
          onClose={() => setSetup(false)}
          onSaved={async () => {
            await connection.refetch();
          }}
        />
      )}
    </div>
  );
}
