'use client';
import { useCallback, useEffect } from 'react';
import { useServiceStore } from '@/stores/serviceStore';
import { useUIStore } from '@/stores/uiStore';
import * as api from '@/lib/api';
import type { InitializeRequest } from '@/lib/types';

export function useService() {
  const store = useServiceStore();
  const ui = useUIStore();

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await api.getServiceStatus();
      if (resp.success) store.setStatus(resp.data);
    } catch {}
  }, [store]);

  const fetchGPUConfig = useCallback(async () => {
    try {
      const resp = await api.getGPUConfig();
      if (resp.success) store.setGPUConfig(resp.data);
    } catch {}
  }, [store]);

  const fetchModels = useCallback(async () => {
    try {
      const [dit, lm, ckpt, info, dlStatus] = await Promise.all([
        api.getDiTModels(),
        api.getLMModels(),
        api.getCheckpoints(),
        api.getModelInfo(),
        api.getModelDownloadStatus(),
      ]);
      if (dit.success) store.setDiTModels(dit.data);
      if (lm.success) store.setLMModels(lm.data);
      if (ckpt.success) store.setCheckpoints(ckpt.data);
      if (info.success) store.setModelInfo(info.data);
      if (dlStatus.success) store.setDownloadStatus(dlStatus.data);
    } catch {}
  }, [store]);

  const initialize = useCallback(async (req: InitializeRequest) => {
    store.setInitializing(true);
    store.setError(null);
    try {
      const resp = await api.initializeService(req);
      if (resp.success) {
        await fetchStatus();
        // Refresh download status after init (models may have been auto-downloaded)
        try {
          const dlStatus = await api.getModelDownloadStatus();
          if (dlStatus.success) store.setDownloadStatus(dlStatus.data);
        } catch {}
        ui.addToast('Service initialized', 'success');
      } else {
        store.setError(resp.error || 'Init failed');
        ui.addToast(resp.error || 'Initialization failed', 'error');
      }
    } catch (err: any) {
      store.setError(err.message);
      ui.addToast(err.message, 'error');
    } finally {
      store.setInitializing(false);
    }
  }, [store, ui, fetchStatus]);

  useEffect(() => {
    fetchStatus();
    fetchGPUConfig();
    fetchModels();
  }, []);

  return { fetchStatus, fetchGPUConfig, fetchModels, initialize };
}
