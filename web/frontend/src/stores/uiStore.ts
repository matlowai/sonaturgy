import { create } from 'zustand';
import type { Language } from '@/lib/i18n';

interface UIState {
  language: Language;
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  toasts: Array<{ id: string; message: string; type: 'info' | 'success' | 'error' }>;

  setLanguage: (l: Language) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (v: boolean) => void;
  setTheme: (t: 'light' | 'dark') => void;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  language: 'en',
  sidebarOpen: true,
  theme: 'dark',
  toasts: [],

  setLanguage: (language) => set({ language }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setTheme: (theme) => set({ theme }),
  addToast: (message, type = 'info') =>
    set((s) => {
      const id = Date.now().toString(36);
      setTimeout(() => {
        set((s2) => ({ toasts: s2.toasts.filter((t) => t.id !== id) }));
      }, 5000);
      return { toasts: [...s.toasts, { id, message, type }] };
    }),
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
