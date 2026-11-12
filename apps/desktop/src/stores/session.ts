import { create } from 'zustand';
import type { Actor, Permission } from '@agripos/shared';
interface SessionState {
  user: (Actor & { permissions: Permission[]; offline?: boolean }) | null;
  setUser: (user: SessionState['user']) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: SessionState['theme']) => void;
}
const initialTheme = localStorage.getItem('agripos-theme');
export const useSession = create<SessionState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  theme: initialTheme === 'dark' || initialTheme === 'light' ? initialTheme : 'system',
  setTheme: (theme) => {
    localStorage.setItem('agripos-theme', theme);
    set({ theme });
  },
}));
export function useAllowed(permission: Permission) {
  return useSession((s) => s.user?.permissions.includes(permission) ?? false);
}
