'use client';

import { useCallback, useState, useRef } from 'react';
import { usePipelineStore, PIPELINE_PRESETS } from '@/stores/pipelineStore';
import { useResultsStore } from '@/stores/resultsStore';
import { useServiceStore } from '@/stores/serviceStore';
import { useUIStore } from '@/stores/uiStore';
import { StageBlock } from './StageBlock';
import { PromptLibrary } from './PromptLibrary';
import { AutoTextarea } from '@/components/common/AutoTextarea';
import { useLLMAssistStore } from '@/stores/llmAssistStore';
import { Spinner } from '@/components/common/Spinner';
import {
  VALID_LANGUAGES, LANGUAGE_NAMES, TIME_SIGNATURES,
  BPM_MIN, BPM_MAX, DURATION_MIN, DURATION_MAX,
} from '@/lib/constants';
import { Tooltip } from '@/components/common/Tooltip';
import * as help from '@/lib/help-text';
import * as api from '@/lib/api';
import type { PipelineRequest, PipelineStageConfig } from '@/lib/types';

export function PipelineMode() {
  const pipe = usePipelineStore();
  const results = useResultsStore();
  const { status } = useServiceStore();
  const { addToast } = useUIStore();
  const { open: openAssist } = useLLMAssistStore();
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lmOpen, setLmOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Import song from previously generated audio file
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const resp = await api.uploadAndExtractMetadata(file);
      if (!resp.success) {
        addToast('Failed to upload file', 'error');
        return;
      }

      const { has_metadata, metadata } = resp.data;

      if (!has_metadata || !metadata) {
        addToast('No ACE-Step metadata found in this file', 'info');
        return;
      }

      // Populate fields from metadata
      if (metadata.caption) pipe.setField('caption', metadata.caption);
      if (metadata.lyrics) pipe.setField('lyrics', metadata.lyrics);
      if (metadata.bpm) pipe.setField('bpm', String(metadata.bpm));
      if (metadata.keyscale) pipe.setField('keyscale', metadata.keyscale);
      if (metadata.timesignature) pipe.setField('timesignature', metadata.timesignature);
      if (metadata.duration) pipe.setField('duration', metadata.duration);
      if (metadata.vocal_language) pipe.setField('vocalLanguage', metadata.vocal_language);
      if (typeof metadata.instrumental === 'boolean') pipe.setField('instrumental', metadata.instrumental);

      // Populate stages if present
      if (metadata.stages && Array.isArray(metadata.stages) && metadata.stages.length > 0) {
        const stages: PipelineStageConfig[] = metadata.stages.map((s: any, idx: number) => ({
          type: s.type || 'generate',
          model: s.model,
          steps: s.steps || 8,
          shift: s.shift || 3.0,
          denoise: s.denoise || 1.0,
          seed: s.seed ?? -1,
          infer_method: s.infer_method || 'ode',
          guidance_scale: s.guidance_scale || 1.0,
          input_stage: s.input_stage,
          use_adg: s.use_adg || false,
          cfg_interval_start: s.cfg_interval_start || 0.0,
          cfg_interval_end: s.cfg_interval_end || 1.0,
          preview: idx === metadata.stages.length - 1,
        }));
        pipe.setField('stages', stages);
      }

      addToast('Imported settings from audio file', 'success');
    } catch (err: any) {
      addToast(err.message || 'Import failed', 'error');
    } finally {
      setImporting(false);
      // Reset file input
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  }, [pipe, addToast]);

  const handleRunPipeline = useCallback(async () => {
    if (!status.dit_initialized) {
      addToast('Please initialize the DiT service first', 'error');
      return;
    }

    if (pipe.stages.length === 0) {
      addToast('Add at least one stage', 'error');
      return;
    }

    // Pre-flight validation for audio-requiring stages
    const AUDIO_TYPES = ['cover', 'repaint', 'extract', 'lego', 'complete'];
    const BASE_ONLY = ['extract', 'lego', 'complete'];
    for (let i = 0; i < pipe.stages.length; i++) {
      const s = pipe.stages[i];
      if (AUDIO_TYPES.includes(s.type) && !s.src_audio_id && s.src_stage === undefined) {
        addToast(`Stage ${i + 1} (${s.type}): needs source audio`, 'error');
        return;
      }
      if (BASE_ONLY.includes(s.type) && s.model?.includes('turbo')) {
        addToast(`Stage ${i + 1} (${s.type}): requires base model`, 'error');
        return;
      }
      if ((s.type === 'extract' || s.type === 'lego') && !s.track_name) {
        addToast(`Stage ${i + 1} (${s.type}): needs a track name`, 'error');
        return;
      }
    }

    results.setGenerating(true);
    results.setProgress(0);
    results.setStatusMessage('Starting pipeline...');

    try {
      const req: PipelineRequest = {
        caption: pipe.caption,
        lyrics: pipe.lyrics,
        instrumental: pipe.instrumental,
        vocal_language: pipe.vocalLanguage,
        bpm: pipe.bpm ? parseInt(pipe.bpm) : undefined,
        keyscale: pipe.keyscale,
        timesignature: pipe.timesignature,
        duration: pipe.duration,
        batch_size: pipe.batchSize,
        keep_in_vram: pipe.keepInVram,
        audio_format: pipe.audioFormat,
        mp3_bitrate: pipe.mp3Bitrate,
        thinking: pipe.thinking,
        lm_temperature: pipe.lmTemperature,
        lm_cfg_scale: pipe.lmCfgScale,
        lm_top_k: pipe.lmTopK,
        lm_top_p: pipe.lmTopP,
        lm_negative_prompt: pipe.lmNegativePrompt,
        use_cot_metas: pipe.useCotMetas,
        use_cot_caption: pipe.useCotCaption,
        use_cot_language: pipe.useCotLanguage,
        use_constrained_decoding: pipe.useConstrainedDecoding,
        stages: pipe.stages,
      };

      const resp = await api.runPipeline(req);
      const taskId = resp.data.task_id;
      results.setCurrentTaskId(taskId);
    } catch (err: any) {
      results.setGenerating(false);
      addToast(err.message || 'Pipeline failed', 'error');
    }
  }, [pipe, results, status, addToast]);

  return (
    <div className="space-y-4">
      {/* Shared Conditioning */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="section-title mb-0">Conditioning</h3>
          {status.llm_initialized && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => openAssist(
                { kind: 'pipeline-shared' },
                (data) => {
                  pipe.setField('caption', data.caption);
                  pipe.setField('lyrics', data.lyrics);
                  pipe.setField('bpm', data.bpm);
                  pipe.setField('keyscale', data.keyscale);
                  pipe.setField('timesignature', data.timesignature);
                  pipe.setField('duration', data.duration);
                  pipe.setField('vocalLanguage', data.vocalLanguage);
                  pipe.setField('instrumental', data.instrumental);
                }
              )}
              style={{ color: 'var(--accent)' }}
            >
              AI Assist
            </button>
          )}
        </div>

        <div>
          <label className="label">Caption</label>
          <AutoTextarea
            persistKey="pipeline-caption"
            value={pipe.caption}
            onChange={(e) => pipe.setField('caption', e.target.value)}
            placeholder="Describe the music style, instruments, mood..."
            className="w-full"
            minRows={2}
          />
        </div>

        <div>
          <label className="label">Lyrics</label>
          <AutoTextarea
            persistKey="pipeline-lyrics"
            value={pipe.lyrics}
            onChange={(e) => pipe.setField('lyrics', e.target.value)}
            placeholder="[Verse 1]&#10;Your lyrics here..."
            className="w-full"
            minRows={3}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Language</label>
            <select
              value={pipe.vocalLanguage}
              onChange={(e) => pipe.setField('vocalLanguage', e.target.value)}
              className="w-full"
            >
              {VALID_LANGUAGES.map((l) => (
                <option key={l} value={l}>{LANGUAGE_NAMES[l] || l}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Duration (s)</label>
            <input
              type="number"
              value={pipe.duration === -1 ? '' : pipe.duration}
              onChange={(e) => pipe.setField('duration', e.target.value ? parseFloat(e.target.value) : -1)}
              placeholder="Auto"
              min={DURATION_MIN} max={DURATION_MAX}
              className="w-full"
            />
          </div>

          <div>
            <label className="label">BPM</label>
            <input
              type="number"
              value={pipe.bpm}
              onChange={(e) => pipe.setField('bpm', e.target.value)}
              placeholder="Auto"
              min={BPM_MIN} max={BPM_MAX}
              className="w-full"
            />
          </div>

          <div>
            <label className="label">Key</label>
            <input
              type="text"
              value={pipe.keyscale}
              onChange={(e) => pipe.setField('keyscale', e.target.value)}
              placeholder="e.g. C major"
              className="w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Time Sig</label>
            <select
              value={pipe.timesignature}
              onChange={(e) => pipe.setField('timesignature', e.target.value)}
              className="w-full"
            >
              <option value="">Auto</option>
              {TIME_SIGNATURES.map((ts) => (
                <option key={ts} value={ts}>{ts}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Batch Size</label>
            <input
              type="number"
              value={pipe.batchSize}
              onChange={(e) => pipe.setField('batchSize', Math.max(1, parseInt(e.target.value) || 1))}
              min={1} max={8}
              className="w-full"
            />
          </div>

          <div className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={pipe.instrumental}
              onChange={(e) => pipe.setField('instrumental', e.target.checked)}
              id="pipe-instrumental"
            />
            <label htmlFor="pipe-instrumental" className="text-xs cursor-pointer">
              Instrumental
            </label>
          </div>
        </div>

        {/* Audio Format & Quality */}
        <div className="grid grid-cols-3 gap-3 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <div>
            <label className="label">Format</label>
            <select
              value={pipe.audioFormat}
              onChange={(e) => pipe.setField('audioFormat', e.target.value)}
              className="w-full"
            >
              <option value="flac">FLAC (lossless)</option>
              <option value="wav">WAV (uncompressed)</option>
              <option value="mp3">MP3 (compressed)</option>
            </select>
          </div>

          {pipe.audioFormat === 'mp3' && (
            <div>
              <label className="label">MP3 Quality</label>
              <select
                value={pipe.mp3Bitrate}
                onChange={(e) => pipe.setField('mp3Bitrate', parseInt(e.target.value))}
                className="w-full"
              >
                <option value="320">320 kbps (best)</option>
                <option value="256">256 kbps</option>
                <option value="192">192 kbps</option>
                <option value="128">128 kbps (small)</option>
              </select>
            </div>
          )}

          <div className="flex items-center text-xs" style={{ color: 'var(--text-secondary)' }}>
            {(() => {
              const dur = pipe.duration > 0 ? pipe.duration : 30;
              const batch = pipe.batchSize;
              let sizePerFile = 0;

              if (pipe.audioFormat === 'flac') {
                sizePerFile = dur * 0.35; // ~350KB/s for 48kHz stereo FLAC
              } else if (pipe.audioFormat === 'wav') {
                sizePerFile = dur * 48000 * 2 * 2 / 1024 / 1024; // 48kHz, stereo, 16-bit
              } else if (pipe.audioFormat === 'mp3') {
                sizePerFile = dur * pipe.mp3Bitrate / 8 / 1024; // bitrate in kbps
              }

              const totalSize = sizePerFile * batch;
              const display = totalSize < 1 ? `${(totalSize * 1024).toFixed(0)} KB` : `${totalSize.toFixed(1)} MB`;

              return `~${display}${batch > 1 ? ` (${batch} files)` : ''}`;
            })()}
          </div>
        </div>

        {/* LM Settings (collapsible) */}
        <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="collapsible-header" onClick={() => setLmOpen(!lmOpen)}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">LM Settings</span>
              {pipe.thinking && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent)', color: 'white' }}>
                  Thinking
                </span>
              )}
            </div>
            <span className="text-sm">{lmOpen ? '\u25B2' : '\u25BC'}</span>
          </div>

          {lmOpen && (
            <div className="mt-3 space-y-3">
              {/* Thinking checkbox — most prominent */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={pipe.thinking}
                  onChange={(e) => pipe.setField('thinking', e.target.checked)}
                  id="pipe-thinking"
                />
                <label htmlFor="pipe-thinking" className="text-sm font-medium cursor-pointer">
                  Enable Thinking (CoT)<Tooltip text={help.HELP_THINKING} />
                </label>
              </div>

              {/* LM param sliders */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="label">Temperature: {pipe.lmTemperature.toFixed(2)}<Tooltip text={help.HELP_LM_TEMPERATURE} /></label>
                  <input
                    type="range" min={0} max={2} step={0.05}
                    value={pipe.lmTemperature}
                    onChange={(e) => pipe.setField('lmTemperature', parseFloat(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label">CFG Scale: {pipe.lmCfgScale.toFixed(1)}<Tooltip text={help.HELP_LM_CFG_SCALE} /></label>
                  <input
                    type="range" min={1} max={3} step={0.1}
                    value={pipe.lmCfgScale}
                    onChange={(e) => pipe.setField('lmCfgScale', parseFloat(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label">Top K: {pipe.lmTopK}<Tooltip text={help.HELP_LM_TOP_K} /></label>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={pipe.lmTopK}
                    onChange={(e) => pipe.setField('lmTopK', parseInt(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label">Top P: {pipe.lmTopP.toFixed(2)}<Tooltip text={help.HELP_LM_TOP_P} /></label>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={pipe.lmTopP}
                    onChange={(e) => pipe.setField('lmTopP', parseFloat(e.target.value))}
                  />
                </div>
              </div>

              {/* Negative prompt */}
              <div>
                <label className="label">LM Negative Prompt<Tooltip text={help.HELP_LM_NEGATIVE_PROMPT} /></label>
                <input
                  type="text"
                  value={pipe.lmNegativePrompt}
                  onChange={(e) => pipe.setField('lmNegativePrompt', e.target.value)}
                  className="w-full text-xs"
                />
              </div>

              {/* CoT checkboxes */}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {[
                  { key: 'useCotMetas', label: 'CoT Metas', tip: help.HELP_COT_METAS },
                  { key: 'useCotCaption', label: 'Caption Rewrite', tip: help.HELP_COT_CAPTION },
                  { key: 'useCotLanguage', label: 'CoT Language', tip: help.HELP_COT_LANGUAGE },
                  { key: 'useConstrainedDecoding', label: 'Constrained Decoding', tip: help.HELP_CONSTRAINED_DECODING },
                ].map(({ key, label, tip }) => (
                  <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(pipe as any)[key]}
                      onChange={(e) => pipe.setField(key, e.target.checked)}
                    />
                    {label}<Tooltip text={tip} />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stages */}
      <div className="space-y-2">
        {pipe.stages.map((stage, idx) => (
          <div key={idx}>
            <StageBlock stage={stage} index={idx} totalStages={pipe.stages.length} />
            {idx < pipe.stages.length - 1 && (
              <div className="flex justify-center py-1">
                <span className="text-lg" style={{ color: 'var(--text-secondary)' }}>
                  &#8595;
                </span>
              </div>
            )}
          </div>
        ))}

        <button
          className="btn btn-secondary w-full"
          onClick={() => pipe.addStage()}
        >
          + Add Stage
        </button>

        {/* VRAM Management */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <input
            type="checkbox"
            checked={pipe.keepInVram}
            onChange={(e) => pipe.setField('keepInVram', e.target.checked)}
            id="keep-in-vram"
          />
          <label htmlFor="keep-in-vram" className="text-xs cursor-pointer">
            Keep models in VRAM (faster, requires more GPU memory)
          </label>
        </div>
      </div>

      {/* Presets & Import */}
      <div className="card space-y-3">
        {/* Import & Library */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            ref={importInputRef}
            onChange={handleImport}
            accept=".flac,.wav"
            className="hidden"
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            title="Import settings from a previously generated audio file"
          >
            {importing ? <Spinner size="sm" /> : null}
            {importing ? 'Importing...' : 'Import Song'}
          </button>
          <PromptLibrary />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Browse saved prompts or import from audio
          </span>
        </div>

        {/* Built-in presets */}
        <div>
          <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
            Presets
          </h4>
          <div className="flex flex-wrap gap-2">
            {PIPELINE_PRESETS.map((preset) => (
              <button
                key={preset.name}
                className={`btn btn-sm ${pipe.activePreset === preset.name ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => pipe.loadPreset(preset)}
                title={preset.description}
              >
                {preset.name}
              </button>
            ))}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => pipe.resetStages()}
            >
              Reset
            </button>
          </div>
        </div>

        {/* User presets */}
        {pipe.userPresets.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              Saved
            </h4>
            <div className="flex flex-wrap gap-2">
              {pipe.userPresets.map((preset) => (
                <span key={preset.name} className="inline-flex items-center gap-1">
                  <button
                    className={`btn btn-sm ${pipe.activePreset === preset.name ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => pipe.loadPreset(preset)}
                    title={preset.description}
                  >
                    {preset.name}
                  </button>
                  <button
                    className="text-xs px-1 rounded hover:opacity-70"
                    style={{ color: 'var(--text-secondary)' }}
                    onClick={() => pipe.deletePreset(preset.name)}
                    title="Delete preset"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Save preset */}
        <div className="flex items-center gap-2">
          {showSaveInput ? (
            <>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Preset name"
                className="text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && saveName.trim()) {
                    pipe.savePreset(saveName.trim());
                    addToast(`Preset "${saveName.trim()}" saved`, 'success');
                    setSaveName('');
                    setShowSaveInput(false);
                  } else if (e.key === 'Escape') {
                    setShowSaveInput(false);
                    setSaveName('');
                  }
                }}
                autoFocus
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (saveName.trim()) {
                    pipe.savePreset(saveName.trim());
                    addToast(`Preset "${saveName.trim()}" saved`, 'success');
                    setSaveName('');
                    setShowSaveInput(false);
                  }
                }}
              >
                Save
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setShowSaveInput(false); setSaveName(''); }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowSaveInput(true)}
            >
              Save Current as Preset
            </button>
          )}
        </div>
      </div>

      {/* Run Pipeline Button */}
      <button
        className="btn btn-primary text-base px-8 py-3 w-full flex items-center justify-center gap-2"
        onClick={handleRunPipeline}
        disabled={results.generating}
      >
        {results.generating && <Spinner size="sm" />}
        {results.generating ? 'Running Pipeline...' : 'Run Pipeline'}
      </button>
    </div>
  );
}
