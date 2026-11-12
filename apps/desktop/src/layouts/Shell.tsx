import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingBasket,
  Package,
  Boxes,
  Truck,
  Users,
  Contact,
  Wallet,
  Receipt,
  ChartNoAxesCombined,
  ShieldCheck,
  Settings,
  Sprout,
  Search,
  Sun,
  Moon,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Cloud,
  AlertTriangle,
  Bell,
} from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../stores/session';
import { useData } from '../services/api';
import type { Permission } from '@agripos/shared';
import { toast } from 'sonner';
import type { Notification } from '../pages/Notifications';
const links: { path: string; label: string; icon: typeof Sprout; permission?: Permission }[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/pos', label: 'Point of sale', icon: ShoppingBasket, permission: 'sales.write' },
  { path: '/products', label: 'Products', icon: Package },
  { path: '/inventory', label: 'Inventory', icon: Boxes },
  { path: '/purchases', label: 'Purchases', icon: Truck, permission: 'purchases.write' },
  { path: '/suppliers', label: 'Suppliers', icon: Contact, permission: 'purchases.write' },
  { path: '/customers', label: 'Customers', icon: Users, permission: 'customers.write' },
  { path: '/credit', label: 'Credit management', icon: Wallet, permission: 'payments.write' },
  { path: '/expenses', label: 'Expenses', icon: Receipt, permission: 'expenses.write' },
  { path: '/reports', label: 'Reports', icon: ChartNoAxesCombined, permission: 'reports.read' },
  { path: '/staff', label: 'Staff & roles', icon: ShieldCheck, permission: 'staff.manage' },
  { path: '/settings', label: 'Settings', icon: Settings },
  { path: '/cash-sessions', label: 'Cash registers', icon: Wallet, permission: 'sales.write' },
  { path: '/sync', label: 'Offline & sync', icon: Cloud, permission: 'sales.write' },
];
export function Shell() {
  const { user, theme, setTheme, setUser } = useSession(),
    [collapsed, setCollapsed] = useState(false),
    [search, setSearch] = useState('');
  const navigate = useNavigate(),
    location = useLocation(),
    cache = useQueryClient();
  const shop = useData<{ name: string }>('/settings');
  const health = useData('/auth/me');
  const logo = useData<{ dataUrl: string | null }>('/settings/logo', !user?.offline);
  const notices = useData<Notification[]>('/notifications', !user?.offline);
  const syncState = useQuery({
    queryKey: ['offline-status'],
    queryFn: () => window.desktop.offlineStatus(),
    refetchInterval: 5000,
  });
  const pending = useQuery({
    queryKey: ['pending-checkouts'],
    queryFn: () => window.desktop.pendingSales(),
    refetchInterval: 10000,
    retry: 1,
  });
  const title = links.find((l) => l.path === location.pathname)?.label ?? 'Sales history';
  return (
    <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            {logo.data?.dataUrl ? (
              <img
                src={logo.data.dataUrl}
                alt="Shop logo"
                style={{ width: 30, height: 30, objectFit: 'contain' }}
              />
            ) : (
              <Sprout size={25} />
            )}
          </span>
          {!collapsed && (
            <span>
              Agri<span className="brand-light">POS</span>
            </span>
          )}
        </div>
        {!collapsed && (
          <div className="branch-label">
            <span className="status-dot" />
            {shop.data?.name ?? 'Your shop'}
            <small>RETAIL WORKSPACE</small>
          </div>
        )}
        <nav>
          {links
            .filter(
              (l) => !user?.offline || ['/pos', '/products', '/settings', '/sync'].includes(l.path),
            )
            .filter((l) => !l.permission || user?.permissions.includes(l.permission))
            .map(({ path, label, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                end={path === '/'}
                title={collapsed ? label : undefined}
              >
                <Icon size={19} />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <>
                <PanelLeftClose size={18} />
                Collapse sidebar
              </>
            )}
          </button>
          {!collapsed && <small>AgriPOS · v0.5.0</small>}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{title}</strong>
          </div>
          <form
            className="header-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/products?q=${encodeURIComponent(search)}`);
            }}
          >
            <Search size={16} />
            <input
              aria-label="Global product search"
              placeholder="Search products, SKUs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <div className={`connection ${health.error ? 'error-text' : ''}`}>
            {health.error ? <AlertTriangle size={15} /> : <Cloud size={15} />}
            <span>
              {user?.offline
                ? 'Offline snapshot'
                : health.error
                  ? 'Service unavailable'
                  : 'Connected'}
            </span>
          </div>
          {!!syncState.data?.operations.length && (
            <button
              className={`text-btn ${syncState.data.operations.some((o) => o.state === 'failed' || o.state === 'conflict') ? 'error-text' : ''}`}
              onClick={() => navigate('/sync')}
            >
              {syncState.data.operations.length} receipt(s) awaiting sync
            </button>
          )}
          <button
            className="icon-btn"
            title="Toggle theme"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <div className="profile">
            {!user?.offline && (
              <button
                className="icon-btn"
                aria-label="Notifications"
                title="Notifications"
                onClick={() => navigate('/notifications')}
              >
                <Bell size={19} />
                <span>{notices.data?.filter((n) => !n.read_at).length ?? 0}</span>
              </button>
            )}
            <span className="avatar">{user?.name.slice(0, 2).toUpperCase()}</span>
            <span>
              {user?.name}
              <small>{user?.role}</small>
            </span>
          </div>
          <button
            className="icon-btn"
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              try {
                await window.desktop.logout();
                cache.clear();
                setUser(null);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Sign out failed');
              }
            }}
          >
            <LogOut size={18} />
          </button>
        </header>
        <main className="page-content">
          {user?.offline && (
            <div className="alert warning">
              Offline cash checkout · Availability comes from the saved snapshot.{' '}
              <button className="text-btn" onClick={() => navigate('/sync')}>
                View synchronization
              </button>
            </div>
          )}
          {(pending.data?.length ?? 0) > 0 && (
            <div className="alert warning">
              {pending.data!.length} checkout submission(s) need a confirmed result.{' '}
              <button className="text-btn" onClick={() => navigate('/pos')}>
                Review pending checkout
              </button>
            </div>
          )}
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>Built for a growing business</span>
          <span>LKR · Sri Lanka</span>
        </footer>
      </div>
    </div>
  );
}
