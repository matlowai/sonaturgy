'use client';

import { useState, useEffect, useCallback } from 'react';
import { useServiceStore } from '@/stores/serviceStore';
import { useUIStore } from '@/stores/uiStore';
import * as api from '@/lib/api';
import type { LoRAStatus } from '@/lib/types';

export function LoRAPanel() {
  const { status } = useServiceStore();
  const { addToast } = useUIStore();
  const [loraStatus, setLoraStatus] = useState<LoRAStatus>({ loaded: false, enabled: false, path: null, scale: 1.0 });
  const [loraPath, setLoraPath] = useState('');

  const fetchStatus = useCallback(async () => {
    if (!status.dit_initialized) return;
    try {
      const resp = await api.getLoRAStatus();
      if (resp.success) setLoraStatus(resp.data);
    } catch {}
  }, [status.dit_initialized]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleLoad = async () => {
    if (!loraPath.trim()) return;
    try {
      await api.loadLoRA(loraPath);
      await fetchStatus();
      addToast('LoRA loaded', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleUnload = async () => {
    try {
      await api.unloadLoRA();
      await fetchStatus();
      addToast('LoRA unloaded', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  if (!status.dit_initialized) return null;

  return (
    <div className="card space-y-2">
      <h2 className="section-title">LoRA</h2>

      <div className="flex items-center gap-2">
        <span className={`badge ${loraStatus.loaded ? 'badge-success' : 'badge-info'}`}>
          {loraStatus.loaded ? 'Loaded' : 'Not loaded'}
        </span>
        {loraStatus.loaded && (
          <span className={`badge ${loraStatus.enabled ? 'badge-success' : 'badge-warning'}`}>
            {loraStatus.enabled ? 'Enabled' : 'Disabled'}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={loraPath}
          onChange={(e) => setLoraPath(e.target.value)}
          placeholder="LoRA path..."
          className="flex-1 text-xs"
        />
        <button className="btn btn-primary btn-sm" onClick={handleLoad}>Load</button>
      </div>

      {loraStatus.loaded && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              className="btn btn-secondary btn-sm flex-1"
              onClick={async () => {
                await api.enableLoRA(!loraStatus.enabled);
                fetchStatus();
              }}
            >
              {loraStatus.enabled ? 'Disable' : 'Enable'}
            </button>
            <button className="btn btn-secondary btn-sm flex-1" onClick={handleUnload}>Unload</button>
          </div>

          <div>
            <label className="label">Scale: {loraStatus.scale.toFixed(2)}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={loraStatus.scale}
              onChange={async (e) => {
                const scale = parseFloat(e.target.value);
                await api.setLoRAScale(scale);
                fetchStatus();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
