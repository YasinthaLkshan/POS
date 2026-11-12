import { useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import type { Permission } from '@agripos/shared';
import { useAllowed, useSession } from '../stores/session';
import { api } from '../services/api';
import { Login } from '../pages/Login';
import { Shell } from '../layouts/Shell';
import { Dashboard } from '../pages/Dashboard';
import { Products } from '../pages/Products';
import { Contacts } from '../pages/Contacts';
import { Inventory } from '../pages/Inventory';
import { Purchases } from '../pages/Purchases';
import { POS } from '../pages/POS';
import { Sales } from '../pages/Sales';
import { Expenses, Reports, Staff } from '../pages/Business';
import { Settings } from '../pages/Settings';
import { CashSessions } from '../pages/CashSessions';
import { Sync } from '../pages/Sync';
import { Notifications } from '../pages/Notifications';
const cache = new QueryClient({ defaultOptions: { queries: { staleTime: 10000, retry: 1 } } });
function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  return useAllowed(permission) ? children : <Navigate to="/" replace />;
}
export function App() {
  const { user, setUser, theme } = useSession(),
    [starting, setStarting] = useState(true);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    void api<NonNullable<typeof user>>('/auth/me')
      .then(setUser)
      .catch(() => {
        /* Login is shown when there is no valid session. */
      })
      .finally(() => setStarting(false));
  }, [setUser]);
  return (
    <QueryClientProvider client={cache}>
      <HashRouter>
        <Toaster richColors position="bottom-right" />
        {starting ? (
          <div className="loading-app">Opening AgriPOS…</div>
        ) : !user ? (
          <Login />
        ) : (
          <Routes>
            <Route element={<Shell />}>
              <Route
                index
                element={user.offline ? <Navigate to="/pos" replace /> : <Dashboard />}
              />
              <Route
                path="sync"
                element={
                  <Guard permission="sales.write">
                    <Sync />
                  </Guard>
                }
              />
              <Route path="products" element={<Products />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="inventory" element={<Inventory />} />
              <Route
                path="pos"
                element={
                  <Guard permission="sales.write">
                    <POS />
                  </Guard>
                }
              />
              <Route
                path="sales"
                element={
                  <Guard permission="sales.write">
                    <Sales />
                  </Guard>
                }
              />
              <Route
                path="purchases"
                element={
                  <Guard permission="purchases.write">
                    <Purchases />
                  </Guard>
                }
              />
              <Route
                path="suppliers"
                element={
                  <Guard permission="purchases.write">
                    <Contacts key="suppliers" kind="suppliers" />
                  </Guard>
                }
              />
              <Route
                path="customers"
                element={
                  <Guard permission="customers.write">
                    <Contacts key="customers" kind="customers" />
                  </Guard>
                }
              />
              <Route
                path="credit"
                element={
                  <Guard permission="payments.write">
                    <Contacts key="credit" kind="customers" credit />
                  </Guard>
                }
              />
              <Route
                path="expenses"
                element={
                  <Guard permission="expenses.write">
                    <Expenses />
                  </Guard>
                }
              />
              <Route
                path="reports"
                element={
                  <Guard permission="reports.read">
                    <Reports />
                  </Guard>
                }
              />
              <Route
                path="staff"
                element={
                  <Guard permission="staff.manage">
                    <Staff />
                  </Guard>
                }
              />
              <Route path="settings" element={<Settings />} />
              <Route
                path="cash-sessions"
                element={
                  <Guard permission="sales.write">
                    <CashSessions />
                  </Guard>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        )}
      </HashRouter>
    </QueryClientProvider>
  );
}
