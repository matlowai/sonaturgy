import { create } from 'zustand';
import type { ServiceStatus, GPUConfig, AllModelInfo, ModelDownloadStatus } from '@/lib/types';

interface ServiceState {
  status: ServiceStatus;
  gpuConfig: GPUConfig | null;
  ditModels: string[];
  lmModels: string[];
  checkpoints: string[];
  modelInfo: AllModelInfo | null;
  downloadStatus: ModelDownloadStatus | null;
  downloadingModels: Set<string>;
  initializing: boolean;
  error: string | null;

  setStatus: (s: ServiceStatus) => void;
  setGPUConfig: (c: GPUConfig) => void;
  setDiTModels: (m: string[]) => void;
  setLMModels: (m: string[]) => void;
  setCheckpoints: (c: string[]) => void;
  setModelInfo: (info: AllModelInfo) => void;
  setDownloadStatus: (status: ModelDownloadStatus) => void;
  addDownloading: (name: string) => void;
  removeDownloading: (name: string) => void;
  setInitializing: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useServiceStore = create<ServiceState>((set) => ({
  status: {
    dit_initialized: false,
    llm_initialized: false,
    dit_model: null,
    lm_model: null,
    device: null,
    is_turbo: null,
  },
  gpuConfig: null,
  ditModels: [],
  lmModels: [],
  checkpoints: [],
  modelInfo: null,
  downloadStatus: null,
  downloadingModels: new Set<string>(),
  initializing: false,
  error: null,

  setStatus: (status) => set({ status }),
  setGPUConfig: (gpuConfig) => set({ gpuConfig }),
  setDiTModels: (ditModels) => set({ ditModels }),
  setLMModels: (lmModels) => set({ lmModels }),
  setCheckpoints: (checkpoints) => set({ checkpoints }),
  setModelInfo: (modelInfo) => set({ modelInfo }),
  setDownloadStatus: (downloadStatus) => set({ downloadStatus }),
  addDownloading: (name) => set((state) => {
    const next = new Set(state.downloadingModels);
    next.add(name);
    return { downloadingModels: next };
  }),
  removeDownloading: (name) => set((state) => {
    const next = new Set(state.downloadingModels);
    next.delete(name);
    return { downloadingModels: next };
  }),
  setInitializing: (initializing) => set({ initializing }),
  setError: (error) => set({ error }),
}));
