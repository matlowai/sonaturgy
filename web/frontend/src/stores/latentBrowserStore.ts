import { create } from 'zustand';
import type { LatentRecord } from '@/lib/types';
import * as api from '@/lib/api';

interface LatentBrowserFilters {
  stage_type?: string;
  model_variant?: string;
  is_checkpoint?: boolean;
  pinned?: boolean;
  search?: string;
}

interface LatentBrowserState {
  isOpen: boolean;
  latents: LatentRecord[];
  total: number;
  filters: LatentBrowserFilters;
  loading: boolean;
  selectedId: string | null;
  /** Callback when user selects a latent for resume */
  onSelect: ((latent: LatentRecord) => void) | null;

  open: (onSelect?: (latent: LatentRecord) => void) => void;
  close: () => void;
  setFilters: (f: Partial<LatentBrowserFilters>) => void;
  clearFilters: () => void;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
  togglePin: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useLatentBrowserStore = create<LatentBrowserState>((set, get) => ({
  isOpen: false,
  latents: [],
  total: 0,
  filters: {},
  loading: false,
  selectedId: null,
  onSelect: null,

  open: (onSelect) => {
    set({ isOpen: true, onSelect: onSelect ?? null });
    get().refresh();
  },

  close: () => set({ isOpen: false, selectedId: null, onSelect: null }),

  setFilters: (f) => {
    set((s) => ({ filters: { ...s.filters, ...f } }));
    get().refresh();
  },

  clearFilters: () => {
    set({ filters: {} });
    get().refresh();
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const resp = await api.listLatents(get().filters);
      if (resp.success) {
        set({ latents: resp.data.latents, total: resp.data.total });
      }
    } catch {
      // ignore — toast handled by api layer if needed
    } finally {
      set({ loading: false });
    }
  },

  select: (id) => set({ selectedId: id }),

  togglePin: async (id) => {
    try {
      const resp = await api.pinLatent(id);
      if (resp.success) {
        set((s) => ({
          latents: s.latents.map((l) =>
            l.id === id ? { ...l, pinned: resp.data.pinned } : l
          ),
        }));
      }
    } catch {
      // ignore
    }
  },

  remove: async (id) => {
    try {
      const resp = await api.deleteLatent(id);
      if (resp.success) {
        set((s) => ({
          latents: s.latents.filter((l) => l.id !== id),
          total: s.total - 1,
          selectedId: s.selectedId === id ? null : s.selectedId,
        }));
      }
    } catch {
      // ignore
    }
  },
}));
