'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { useLatentBrowserStore } from '@/stores/latentBrowserStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useUIStore } from '@/stores/uiStore';
import { mapParamsToFields } from '@/lib/stageConversion';
import * as api from '@/lib/api';
import type { LatentRecord } from '@/lib/types';

function formatDate(ts: number) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(sec: number | undefined) {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatShape(shape: number[]) {
  if (shape.length >= 2) {
    const dur = shape[1] / 25;
    return `${formatDuration(dur)} (${shape.join('x')})`;
  }
  return shape.join('x');
}

const STAGE_TYPE_COLORS: Record<string, string> = {
  generate: 'bg-green-600/20 text-green-400',
  refine: 'bg-blue-600/20 text-blue-400',
  cover: 'bg-purple-600/20 text-purple-400',
  repaint: 'bg-yellow-600/20 text-yellow-400',
  extract: 'bg-cyan-600/20 text-cyan-400',
  lego: 'bg-orange-600/20 text-orange-400',
  complete: 'bg-pink-600/20 text-pink-400',
};

const STAGE_TYPES = ['generate', 'refine', 'cover', 'repaint', 'extract', 'lego', 'complete'];

export function LatentBrowserModal() {
  const {
    isOpen, latents, total, filters, loading, selectedId, onSelect,
    close, setFilters, clearFilters, refresh, select, togglePin, remove,
  } = useLatentBrowserStore();
  const gen = useGenerationStore();
  const addToast = useUIStore((s) => s.addToast);
  const searchRef = useRef<HTMLInputElement>(null);
  const [decodingId, setDecodingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) setTimeout(() => searchRef.current?.focus(), 100);
  }, [isOpen]);

  const handleSearch = useCallback((val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilters({ search: val || undefined });
    }, 300);
  }, [setFilters]);

  const handleUseForResume = useCallback((latent: LatentRecord) => {
    if (onSelect) {
      onSelect(latent);
    } else {
      // Default: set as resume latent in generation store
      gen.setFields({
        initLatentId: latent.id,
        tStart: 0.7,
        resumeSampleIndex: 0,
      });
      addToast(`Loaded latent ${latent.id.slice(0, 8)} for resume`, 'success');
    }
    close();
  }, [onSelect, gen, addToast, close]);

  const handleRestoreParams = useCallback((latent: LatentRecord) => {
    if (latent.params) {
      const fields = mapParamsToFields(latent.params);
      gen.setFields(fields);
      addToast('Params restored from latent', 'success');
    }
  }, [gen, addToast]);

  const handleDecode = useCallback(async (latentId: string) => {
    setDecodingId(latentId);
    try {
      const resp = await api.decodeLatent(latentId);
      if (resp.success) {
        const audioUrl = api.getAudioUrl(resp.data.audio_id);
        const audio = new Audio(audioUrl);
        audio.play();
        addToast('Playing decoded latent', 'info');
      }
    } catch (err: any) {
      addToast(err.message || 'Decode failed', 'error');
    } finally {
      setDecodingId(null);
    }
  }, [addToast]);

  const handleDelete = useCallback(async (id: string) => {
    await remove(id);
    addToast('Latent deleted', 'info');
  }, [remove, addToast]);

  const selectedLatent = selectedId ? latents.find((l) => l.id === selectedId) : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={close} />

      {/* Modal */}
      <div
        className="relative w-full max-w-4xl max-h-[85vh] mx-4 rounded-lg border flex flex-col"
        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Latent Browser
            </h2>
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              {total} stored
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="text-xs px-2 py-1 rounded hover:opacity-80"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            <button onClick={close} className="text-xl leading-none px-1" style={{ color: 'var(--text-secondary)' }}>
              &times;
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search caption/lyrics..."
            defaultValue={filters.search ?? ''}
            onChange={(e) => handleSearch(e.target.value)}
            className="flex-1 min-w-[200px] text-sm px-2 py-1 rounded border"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
          <select
            value={filters.stage_type ?? ''}
            onChange={(e) => setFilters({ stage_type: e.target.value || undefined })}
            className="text-xs px-2 py-1 rounded border"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="">All types</option>
            {STAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={filters.pinned === true}
              onChange={(e) => setFilters({ pinned: e.target.checked ? true : undefined })}
            />
            Pinned only
          </label>
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={filters.is_checkpoint === true}
              onChange={(e) => setFilters({ is_checkpoint: e.target.checked ? true : undefined })}
            />
            Checkpoints
          </label>
          {Object.values(filters).some(Boolean) && (
            <button
              onClick={clearFilters}
              className="text-xs px-2 py-1 rounded hover:opacity-80"
              style={{ color: 'var(--accent)' }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Content: list + detail */}
        <div className="flex flex-1 min-h-0">
          {/* List */}
          <div className="flex-1 overflow-y-auto" style={{ borderRight: selectedLatent ? '1px solid var(--border)' : 'none' }}>
            {latents.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {loading ? 'Loading...' : 'No latents found'}
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {latents.map((l) => (
                  <div
                    key={l.id}
                    onClick={() => select(l.id === selectedId ? null : l.id)}
                    className="px-3 py-2 cursor-pointer hover:opacity-90 transition-colors"
                    style={{
                      background: l.id === selectedId ? 'var(--bg-tertiary)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STAGE_TYPE_COLORS[l.stage_type] ?? 'bg-gray-600/20 text-gray-400'}`}
                        >
                          {l.stage_type}
                        </span>
                        {l.is_checkpoint && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-400 font-medium">
                            ckpt@{l.checkpoint_step}
                          </span>
                        )}
                        {l.pinned && (
                          <span className="text-[10px]" title="Pinned">&#128204;</span>
                        )}
                        <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                          {l.caption ? l.caption.slice(0, 80) : <em style={{ color: 'var(--text-secondary)' }}>no caption</em>}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {formatShape(l.shape)}
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {formatDate(l.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                        {l.model_variant}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                        {l.total_steps} steps
                      </span>
                      {l.lm_metadata?.bpm && (
                        <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {l.lm_metadata.bpm} BPM
                        </span>
                      )}
                      {l.lm_metadata?.keyscale && (
                        <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {l.lm_metadata.keyscale}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selectedLatent && (
            <div className="w-80 flex-shrink-0 overflow-y-auto p-3 space-y-3">
              {/* Caption */}
              {selectedLatent.caption ? (
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Caption</div>
                  <div className="text-xs max-h-24 overflow-y-auto leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                    {selectedLatent.caption}
                  </div>
                </div>
              ) : null}

              {/* Instruction */}
              {selectedLatent.params?.instruction ? (
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Instruction</div>
                  <div className="text-xs leading-relaxed font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {selectedLatent.params.instruction.slice(0, 120)}{selectedLatent.params.instruction.length > 120 ? '...' : ''}
                  </div>
                </div>
              ) : null}

              {/* Lyrics snippet */}
              {selectedLatent.params?.lyrics ? (
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Lyrics</div>
                  <div className="text-xs max-h-16 overflow-y-auto whitespace-pre-wrap leading-relaxed font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {selectedLatent.params.lyrics.slice(0, 200)}{selectedLatent.params.lyrics.length > 200 ? '...' : ''}
                  </div>
                </div>
              ) : null}

              {/* Core info */}
              <div className="space-y-1">
                <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Latent Info</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <DetailField label="ID" value={selectedLatent.id} />
                  <DetailField label="Type" value={selectedLatent.stage_type} />
                  <DetailField label="Model" value={selectedLatent.model_variant.replace('acestep-v15-', '')} />
                  <DetailField label="Duration" value={formatShape(selectedLatent.shape)} />
                  <DetailField label="Shape" value={selectedLatent.shape.join('x')} />
                  <DetailField label="Dtype" value={selectedLatent.dtype} />
                  <DetailField label="Created" value={formatDate(selectedLatent.created_at)} />
                  <DetailField label="Batch" value={`${selectedLatent.batch_size}`} />
                  {selectedLatent.is_checkpoint && (
                    <DetailField label="Checkpoint" value={`step ${selectedLatent.checkpoint_step}`} />
                  )}
                </div>
              </div>

              {/* Metadata from LLM */}
              {(selectedLatent.lm_metadata?.bpm || selectedLatent.lm_metadata?.keyscale || selectedLatent.params?.bpm || selectedLatent.params?.keyscale) && (
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Music Metadata</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {(selectedLatent.lm_metadata?.bpm ?? selectedLatent.params?.bpm) && (
                      <DetailField label="BPM" value={`${selectedLatent.lm_metadata?.bpm ?? selectedLatent.params?.bpm}`} />
                    )}
                    {(selectedLatent.lm_metadata?.keyscale ?? selectedLatent.params?.keyscale) && (
                      <DetailField label="Key" value={selectedLatent.lm_metadata?.keyscale ?? selectedLatent.params?.keyscale} />
                    )}
                    {(selectedLatent.lm_metadata?.timesignature ?? selectedLatent.params?.timesignature) && (
                      <DetailField label="Time Sig" value={selectedLatent.lm_metadata?.timesignature ?? selectedLatent.params?.timesignature} />
                    )}
                    {selectedLatent.params?.vocal_language && selectedLatent.params.vocal_language !== 'unknown' && (
                      <DetailField label="Language" value={selectedLatent.params.vocal_language} />
                    )}
                  </div>
                </div>
              )}

              {/* Generation settings */}
              {selectedLatent.params && Object.keys(selectedLatent.params).length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Generation Settings</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <DetailField label="Steps" value={`${selectedLatent.params.inference_steps ?? selectedLatent.total_steps}`} />
                    {selectedLatent.params.guidance_scale != null && (
                      <DetailField label="Guidance" value={`${selectedLatent.params.guidance_scale}`} />
                    )}
                    {selectedLatent.params.shift != null && (
                      <DetailField label="Shift" value={`${selectedLatent.params.shift}`} />
                    )}
                    {selectedLatent.params.seed != null && (
                      <DetailField label="Seed" value={`${selectedLatent.params.seed}`} />
                    )}
                    {selectedLatent.params.infer_method && (
                      <DetailField label="Method" value={selectedLatent.params.infer_method} />
                    )}
                    {selectedLatent.params.duration != null && selectedLatent.params.duration > 0 && (
                      <DetailField label="Req Duration" value={`${selectedLatent.params.duration}s`} />
                    )}
                    {selectedLatent.params.thinking != null && (
                      <DetailField label="Thinking" value={selectedLatent.params.thinking ? 'yes' : 'no'} />
                    )}
                    {selectedLatent.params.audio_cover_strength != null && selectedLatent.params.audio_cover_strength < 1.0 && (
                      <DetailField label="Cover Str" value={`${selectedLatent.params.audio_cover_strength}`} />
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => handleUseForResume(selectedLatent)}
                  className="w-full text-xs px-2 py-1.5 rounded font-medium text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  Use for Resume
                </button>
                <button
                  onClick={() => handleRestoreParams(selectedLatent)}
                  className="w-full text-xs px-2 py-1.5 rounded border hover:opacity-80"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  Restore Params
                </button>
                <button
                  onClick={() => handleDecode(selectedLatent.id)}
                  disabled={decodingId === selectedLatent.id}
                  className="w-full text-xs px-2 py-1.5 rounded border hover:opacity-80"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  {decodingId === selectedLatent.id ? 'Decoding...' : 'Decode & Play'}
                </button>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => togglePin(selectedLatent.id)}
                    className="flex-1 text-xs px-2 py-1.5 rounded border hover:opacity-80"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  >
                    {selectedLatent.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button
                    onClick={() => handleDelete(selectedLatent.id)}
                    className="flex-1 text-xs px-2 py-1.5 rounded border hover:opacity-80 text-red-400"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-[10px] font-mono truncate" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </>
  );
}
