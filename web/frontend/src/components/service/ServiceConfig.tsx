'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useServiceStore } from '@/stores/serviceStore';
import { useUIStore } from '@/stores/uiStore';
import { useService } from '@/hooks/useService';
import { t } from '@/lib/i18n';
import { Spinner } from '@/components/common/Spinner';
import * as api from '@/lib/api';
import type { ModelInfo } from '@/lib/types';

function DownloadBadge({ downloaded }: { downloaded: boolean | undefined }) {
  if (downloaded === undefined) return null;
  return (
    <span
      className="inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium ml-1.5"
      style={{
        backgroundColor: downloaded ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)',
        color: downloaded ? '#22c55e' : '#eab308',
      }}
    >
      {downloaded ? 'Ready' : 'Download needed'}
    </span>
  );
}

// Models that come from the main repo (not individually downloadable)
const MAIN_MODEL_COMPONENTS = new Set([
  'acestep-v15-turbo',
  'acestep-5Hz-lm-1.7B',
]);

function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function DownloadButton({
  modelName,
  ready,
}: {
  modelName: string;
  ready: boolean | undefined;
}) {
  const store = useServiceStore();
  const ui = useUIStore();
  const { fetchModels } = useService();
  const downloading = store.downloadingModels.has(modelName);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [progress, setProgress] = useState<{ pct: number; current: number; total: number } | null>(null);

  // Start polling model info when download begins
  useEffect(() => {
    if (!downloading) {
      if (pollRef.current) clearInterval(pollRef.current);
      setProgress(null);
      return;
    }
    const isMain = MAIN_MODEL_COMPONENTS.has(modelName);
    const dlKey = isMain ? '__main__' : modelName;
    pollRef.current = setInterval(async () => {
      try {
        const resp = await api.getModelDownloadStatus();
        if (!resp.success) return;
        const dl = resp.data.downloading?.[dlKey];
        // Update progress if available
        if (dl && dl.status === 'downloading' && dl.total_bytes > 0) {
          setProgress({ pct: dl.progress || 0, current: dl.current_bytes || 0, total: dl.total_bytes });
        }
        // Check if the model became ready on disk
        const ditReady = resp.data.dit?.[modelName];
        const lmReady = resp.data.lm?.[modelName];
        const coreReady = isMain && resp.data.main_ready;
        if (ditReady || lmReady || coreReady || (dl && dl.status === 'completed')) {
          store.removeDownloading(modelName);
          setProgress(null);
          ui.addToast(`${modelName} downloaded`, 'success');
          fetchModels();
        } else if (dl && dl.status === 'error') {
          store.removeDownloading(modelName);
          setProgress(null);
          ui.addToast(`Download failed: ${dl.message}`, 'error');
        }
      } catch {
        // ignore polling errors
      }
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [downloading, modelName, store, ui, fetchModels]);

  if (ready !== false) return null;

  const handleDownload = async () => {
    store.addDownloading(modelName);
    try {
      const isMain = MAIN_MODEL_COMPONENTS.has(modelName);
      const resp = isMain ? await api.downloadMainModel() : await api.downloadModel(modelName);
      if (!resp.success) {
        store.removeDownloading(modelName);
        ui.addToast(resp.error || 'Download request failed', 'error');
      }
    } catch (err: any) {
      store.removeDownloading(modelName);
      ui.addToast(err.message, 'error');
    }
  };

  const isDownloading = downloading || (MAIN_MODEL_COMPONENTS.has(modelName) && store.downloadingModels.has('__main__'));

  if (isDownloading) {
    return (
      <div className="inline-flex flex-col gap-0.5" style={{ minWidth: 140 }}>
        <div className="flex items-center gap-1 text-[10px] font-medium" style={{ color: '#3b82f6' }}>
          <Spinner size="sm" />
          {progress ? `${progress.pct.toFixed(0)}% — ${formatBytes(progress.current)} / ${formatBytes(progress.total)}` : 'Starting...'}
        </div>
        <div style={{
          height: 3,
          borderRadius: 2,
          backgroundColor: 'rgba(59,130,246,0.15)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progress?.pct ?? 0}%`,
            backgroundColor: '#3b82f6',
            borderRadius: 2,
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>
    );
  }

  return (
    <button
      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium cursor-pointer"
      style={{
        backgroundColor: 'rgba(59,130,246,0.15)',
        color: '#3b82f6',
        border: 'none',
      }}
      onClick={handleDownload}
      title={MAIN_MODEL_COMPONENTS.has(modelName)
        ? 'Downloads core components (turbo, 1.7B LM, VAE, text encoder)'
        : `Download ${modelName}`}
    >
      Download
    </button>
  );
}

function ModelDescription({ info }: { info: ModelInfo | undefined }) {
  if (!info) return null;
  return (
    <div className="text-xs mt-1 px-1" style={{ color: 'var(--text-secondary)' }}>
      {info.description}
      <div className="flex gap-3 mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
        <span>Speed: {info.speed}</span>
        <span>Quality: {info.quality}</span>
        {info.vram && <span>VRAM: {info.vram}</span>}
        {info.steps && <span>Steps: {info.steps}</span>}
      </div>
    </div>
  );
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className="text-[10px] px-2 py-1 rounded-full font-medium"
      style={{
        backgroundColor: active ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
        color: active ? '#22c55e' : '#9ca3af',
      }}
    >
      {label}: {active ? 'Active' : 'Off'}
    </span>
  );
}

function ComparisonModal({
  open,
  onClose,
  type,
  models,
}: {
  open: boolean;
  onClose: () => void;
  type: 'dit' | 'lm';
  models: Record<string, ModelInfo> | undefined;
}) {
  if (!open || !models) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="card max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="section-title mb-0">
            {type === 'dit' ? 'DiT Model Comparison' : 'Language Model Comparison'}
          </h3>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th className="text-left py-2 pr-3">Model</th>
              <th className="text-left py-2 pr-3">Speed</th>
              <th className="text-left py-2 pr-3">Quality</th>
              {type === 'dit' ? (
                <>
                  <th className="text-left py-2 pr-3">Steps</th>
                  <th className="text-left py-2 pr-3">CFG</th>
                </>
              ) : (
                <>
                  <th className="text-left py-2 pr-3">Params</th>
                  <th className="text-left py-2 pr-3">VRAM</th>
                </>
              )}
              <th className="text-left py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(models).map(([key, info]) => (
              <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                <td className="py-2 pr-3 font-medium whitespace-nowrap">
                  {info.name}
                  {info.recommended && (
                    <span className="text-[10px] ml-1 px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--primary)', color: '#fff' }}>
                      Rec
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">{info.speed}</td>
                <td className="py-2 pr-3">{info.quality}</td>
                {type === 'dit' ? (
                  <>
                    <td className="py-2 pr-3">{info.steps}</td>
                    <td className="py-2 pr-3">{info.cfg ? 'Yes' : 'No'}</td>
                  </>
                ) : (
                  <>
                    <td className="py-2 pr-3">{info.params}</td>
                    <td className="py-2 pr-3">{info.vram}</td>
                  </>
                )}
                <td className="py-2">{info.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ServiceConfig() {
  const store = useServiceStore();
  const { language } = useUIStore();
  const ui = useUIStore();
  const { initialize, fetchModels, fetchStatus } = useService();

  // DiT settings
  const [configPath, setConfigPath] = useState('acestep-v15-turbo');
  const [device, setDevice] = useState('auto');
  const [flashAttn, setFlashAttn] = useState(false);
  const [offloadCpu, setOffloadCpu] = useState(false);
  const [offloadDit, setOffloadDit] = useState(false);
  const [compileModel, setCompileModel] = useState(false);
  const [quantization, setQuantization] = useState(false);

  // LLM settings
  const [lmModelPath, setLmModelPath] = useState('acestep-5Hz-lm-1.7B');
  const [backend, setBackend] = useState('vllm');
  const [llmInitializing, setLlmInitializing] = useState(false);

  // Modals
  const [showDitCompare, setShowDitCompare] = useState(false);
  const [showLmCompare, setShowLmCompare] = useState(false);

  const ditInfo = store.modelInfo?.dit;
  const lmInfo = store.modelInfo?.lm;

  const handleInitDit = () => {
    initialize({
      config_path: configPath,
      device,
      init_llm: false,
      lm_model_path: lmModelPath,
      backend,
      use_flash_attention: flashAttn,
      offload_to_cpu: offloadCpu,
      offload_dit_to_cpu: offloadDit,
      compile_model: compileModel,
      quantization: quantization ? 'int8_weight_only' : null,
    });
  };

  const handleInitLlm = useCallback(async () => {
    setLlmInitializing(true);
    try {
      const resp = await api.initializeLLM({
        config_path: configPath,
        device,
        init_llm: true,
        lm_model_path: lmModelPath,
        backend,
        use_flash_attention: false,
        offload_to_cpu: offloadCpu,
        offload_dit_to_cpu: false,
        compile_model: false,
        quantization: null,
      });
      if (resp.success) {
        await fetchStatus();
        ui.addToast('LLM initialized', 'success');
      } else {
        ui.addToast(resp.error || 'LLM initialization failed', 'error');
      }
    } catch (err: any) {
      ui.addToast(err.message, 'error');
    } finally {
      setLlmInitializing(false);
    }
  }, [configPath, device, lmModelPath, backend, offloadCpu, fetchStatus, ui]);

  const handleInitBoth = () => {
    initialize({
      config_path: configPath,
      device,
      init_llm: true,
      lm_model_path: lmModelPath,
      backend,
      use_flash_attention: flashAttn,
      offload_to_cpu: offloadCpu,
      offload_dit_to_cpu: offloadDit,
      compile_model: compileModel,
      quantization: quantization ? 'int8_weight_only' : null,
    });
  };

  // Use model info keys (includes all models, ready or not) if available,
  // fall back to dit/lm endpoint lists, then hardcoded defaults
  const ditModelList = ditInfo ? Object.keys(ditInfo)
    : store.ditModels.length > 0 ? store.ditModels
    : ['acestep-v15-turbo', 'acestep-v15-turbo-shift1', 'acestep-v15-turbo-shift3', 'acestep-v15-turbo-continuous', 'acestep-v15-sft', 'acestep-v15-base'];

  const lmModelList = lmInfo ? Object.keys(lmInfo)
    : store.lmModels.length > 0 ? store.lmModels
    : ['acestep-5Hz-lm-0.6B', 'acestep-5Hz-lm-1.7B', 'acestep-5Hz-lm-4B'];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title mb-0">{t(language, 'service.title')}</h2>
          <button className="btn btn-secondary btn-sm" onClick={fetchModels}>Refresh</button>
        </div>

        {/* Status badges */}
        <div className="flex gap-2 flex-wrap">
          <StatusBadge active={store.status.dit_initialized} label="DiT" />
          <StatusBadge active={store.status.llm_initialized} label="LLM" />
          {store.status.device && store.status.device !== 'cpu' && (
            <span className="text-[10px] px-2 py-1 rounded-full font-medium" style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#6366f1' }}>
              {store.status.device.toUpperCase()}
            </span>
          )}
        </div>

        {/* GPU Info */}
        {store.gpuConfig && (
          <div className="text-xs space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
            <div>GPU: {store.gpuConfig.gpu_memory_gb.toFixed(1)} GB ({store.gpuConfig.tier})</div>
          </div>
        )}
      </div>

      {/* DiT Section */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">DiT Model (Audio Generation)</h3>
          <StatusBadge active={store.status.dit_initialized} label="DiT" />
        </div>

        <div>
          <div className="flex items-center gap-1">
            <label className="label mb-0">{t(language, 'service.model_path_label')}</label>
            <button
              className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
              style={{ color: 'var(--primary)', backgroundColor: 'transparent', border: '1px solid var(--primary)' }}
              onClick={() => setShowDitCompare(true)}
              title="Compare models"
            >?</button>
          </div>
          <select value={configPath} onChange={(e) => setConfigPath(e.target.value)} className="w-full">
            {ditModelList.map((m) => {
              const info = ditInfo?.[m];
              const label = info
                ? `${info.name}${info.recommended ? ' (Recommended)' : ''}${info.ready === false ? ' [Not Downloaded]' : ''}`
                : m;
              return <option key={m} value={m}>{label}</option>;
            })}
          </select>
          <ModelDescription info={ditInfo?.[configPath]} />
          <div className="flex items-center gap-1.5 mt-1">
            <DownloadBadge downloaded={ditInfo?.[configPath]?.ready} />
            <DownloadButton modelName={configPath} ready={ditInfo?.[configPath]?.ready} />
          </div>
        </div>

        <div>
          <label className="label">{t(language, 'service.device_label')}</label>
          <select value={device} onChange={(e) => setDevice(e.target.value)} className="w-full">
            <option value="auto">Auto</option>
            <option value="cuda">CUDA</option>
            <option value="cpu">CPU</option>
          </select>
        </div>

        {/* Performance options */}
        <details className="text-xs">
          <summary className="cursor-pointer font-medium" style={{ color: 'var(--text-secondary)' }}>Advanced Options</summary>
          <div className="space-y-1.5 mt-2 pl-1">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={flashAttn} onChange={(e) => setFlashAttn(e.target.checked)} id="flash-attn" />
              <label htmlFor="flash-attn" className="cursor-pointer">{t(language, 'service.flash_attention_label')}</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={offloadCpu} onChange={(e) => setOffloadCpu(e.target.checked)} id="offload-cpu" />
              <label htmlFor="offload-cpu" className="cursor-pointer">{t(language, 'service.offload_cpu_label')}</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={offloadDit} onChange={(e) => setOffloadDit(e.target.checked)} id="offload-dit" disabled={!offloadCpu} />
              <label htmlFor="offload-dit" className="cursor-pointer">{t(language, 'service.offload_dit_cpu_label')}</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={compileModel} onChange={(e) => setCompileModel(e.target.checked)} id="compile" />
              <label htmlFor="compile" className="cursor-pointer">{t(language, 'service.compile_model_label')}</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={quantization} onChange={(e) => setQuantization(e.target.checked)} id="quant" disabled={!compileModel} />
              <label htmlFor="quant" className="cursor-pointer">{t(language, 'service.quantization_label')}</label>
            </div>
          </div>
        </details>

        <button
          className="btn btn-primary w-full flex items-center justify-center gap-2"
          onClick={handleInitDit}
          disabled={store.initializing}
        >
          {store.initializing && <Spinner size="sm" />}
          {store.initializing ? 'Loading DiT...' : store.status.dit_initialized ? 'Reload DiT' : 'Launch DiT'}
        </button>
      </div>

      {/* LLM Section */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">LLM (Simple Mode / AI Assist)</h3>
          <StatusBadge active={store.status.llm_initialized} label="LLM" />
        </div>

        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Powers Simple Mode: describe what you want and the LLM generates captions, lyrics, and metadata automatically.
        </div>

        <div>
          <div className="flex items-center gap-1">
            <label className="label mb-0">{t(language, 'service.lm_model_path_label')}</label>
            <button
              className="text-xs px-1.5 py-0.5 rounded cursor-pointer"
              style={{ color: 'var(--primary)', backgroundColor: 'transparent', border: '1px solid var(--primary)' }}
              onClick={() => setShowLmCompare(true)}
              title="Compare LM models"
            >?</button>
          </div>
          <select value={lmModelPath} onChange={(e) => setLmModelPath(e.target.value)} className="w-full">
            {lmModelList.map((m) => {
              const info = lmInfo?.[m];
              const label = info
                ? `${info.name}${info.recommended ? ' (Recommended)' : ''}${info.ready === false ? ' [Not Downloaded]' : ''}`
                : m;
              return <option key={m} value={m}>{label}</option>;
            })}
          </select>
          <ModelDescription info={lmInfo?.[lmModelPath]} />
          <div className="flex items-center gap-1.5 mt-1">
            <DownloadBadge downloaded={lmInfo?.[lmModelPath]?.ready} />
            <DownloadButton modelName={lmModelPath} ready={lmInfo?.[lmModelPath]?.ready} />
          </div>
        </div>

        <div>
          <label className="label">{t(language, 'service.backend_label')}</label>
          <select value={backend} onChange={(e) => setBackend(e.target.value)} className="w-full">
            <option value="vllm">vllm (faster)</option>
            <option value="pt">PyTorch (more compatible)</option>
          </select>
        </div>

        <button
          className="btn btn-primary w-full flex items-center justify-center gap-2"
          onClick={handleInitLlm}
          disabled={llmInitializing}
        >
          {llmInitializing && <Spinner size="sm" />}
          {llmInitializing ? 'Loading LLM...' : store.status.llm_initialized ? 'Reload LLM' : 'Launch LLM'}
        </button>
      </div>

      {/* Quick launch both */}
      {!store.status.dit_initialized && !store.status.llm_initialized && (
        <button
          className="btn w-full flex items-center justify-center gap-2 text-sm"
          style={{ backgroundColor: 'var(--primary)', color: '#fff' }}
          onClick={handleInitBoth}
          disabled={store.initializing}
        >
          {store.initializing && <Spinner size="sm" />}
          {store.initializing ? 'Initializing...' : 'Launch Both (DiT + LLM)'}
        </button>
      )}

      {/* Core components warning */}
      {store.downloadStatus && (!store.downloadStatus.core.vae || !store.downloadStatus.core.text_encoder) && (
        <div className="card text-xs p-2 space-y-1.5" style={{ backgroundColor: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
          <div>Core components missing:</div>
          {!store.downloadStatus.core.vae && <div>VAE: Not downloaded</div>}
          {!store.downloadStatus.core.text_encoder && <div>Text Encoder: Not downloaded</div>}
          <DownloadButton modelName="acestep-v15-turbo" ready={false} />
        </div>
      )}

      {store.error && (
        <div className="card text-xs" style={{ color: 'var(--error)' }}>{store.error}</div>
      )}

      {/* Comparison modals */}
      <ComparisonModal open={showDitCompare} onClose={() => setShowDitCompare(false)} type="dit" models={ditInfo} />
      <ComparisonModal open={showLmCompare} onClose={() => setShowLmCompare(false)} type="lm" models={lmInfo} />
    </div>
  );
}
