'use client';

import { usePipelineStore, getDefaultStepsForModel, STAGE_DEFAULTS } from '@/stores/pipelineStore';
import { INFER_METHODS, TRACK_NAMES } from '@/lib/constants';
import { useState } from 'react';
import { EditableNumber } from '@/components/common/EditableNumber';
import { AutoTextarea } from '@/components/common/AutoTextarea';
import { AudioUpload } from '@/components/common/AudioUpload';
import { AudioSourceViewer } from '@/components/common/AudioSourceViewer';
import { Tooltip } from '@/components/common/Tooltip';
import * as help from '@/lib/help-text';
import type { PipelineStageConfig, PipelineStageType } from '@/lib/types';

// Available DiT models
const DIT_MODELS = [
  { value: 'acestep-v15-turbo', label: 'Turbo (8 steps, fast)' },
  { value: 'acestep-v15-turbo-shift1', label: 'Turbo Shift1 (creative)' },
  { value: 'acestep-v15-turbo-shift3', label: 'Turbo Shift3 (strong cond.)' },
  { value: 'acestep-v15-turbo-continuous', label: 'Turbo Continuous (flex shift)' },
  { value: 'acestep-v15-sft', label: 'SFT (50 steps, CFG)' },
  { value: 'acestep-v15-base', label: 'Base (50 steps, highest quality)' },
];

// Base-only model list (for extract/lego/complete)
const BASE_ONLY_MODELS = DIT_MODELS.filter((m) => !m.value.includes('turbo') && !m.value.includes('sft'));

// Stage types that need source audio
const AUDIO_STAGE_TYPES: PipelineStageType[] = ['cover', 'repaint', 'extract', 'lego', 'complete'];
const BASE_ONLY_TYPES: PipelineStageType[] = ['extract', 'lego', 'complete'];

// Labels for the type dropdown
const STAGE_TYPE_OPTIONS: { value: PipelineStageType; label: string }[] = [
  { value: 'generate', label: 'Generate from noise' },
  { value: 'refine', label: 'Refine latent' },
  { value: 'cover', label: 'Cover (restyle audio)' },
  { value: 'repaint', label: 'Repaint (edit region)' },
  { value: 'extract', label: 'Extract track (base only)' },
  { value: 'lego', label: 'Lego (add track, base only)' },
  { value: 'complete', label: 'Complete (add accompaniment, base only)' },
];

interface StageBlockProps {
  stage: PipelineStageConfig;
  index: number;
  totalStages: number;
}

export function StageBlock({ stage, index, totalStages }: StageBlockProps) {
  const { updateStage, removeStage } = usePipelineStore();

  const update = (field: string, value: any) => {
    updateStage(index, { [field]: value });
  };

  const handleModelChange = (newModel: string) => {
    const defaultSteps = getDefaultStepsForModel(newModel);
    updateStage(index, { model: newModel, steps: defaultSteps });
  };

  const handleTypeChange = (newType: PipelineStageType) => {
    // Get defaults for the new type and merge with existing stage
    const defaults = STAGE_DEFAULTS[newType];
    const updates: Partial<PipelineStageConfig> = {
      type: newType,
      model: defaults.model,
      steps: defaults.steps,
    };

    // Set type-specific defaults
    if (newType === 'refine') {
      updates.input_stage = Math.max(0, index - 1);
    }
    if (AUDIO_STAGE_TYPES.includes(newType) && stage.src_stage === undefined && !stage.src_audio_id) {
      updates.src_stage = index > 0 ? index - 1 : undefined;
    }
    if (newType === 'cover') {
      updates.audio_cover_strength = defaults.audio_cover_strength ?? 0.5;
    }
    if (newType === 'repaint') {
      updates.repainting_start = defaults.repainting_start ?? 0;
      updates.repainting_end = defaults.repainting_end ?? -1;
    }
    if (newType === 'extract' || newType === 'lego') {
      updates.track_name = defaults.track_name ?? 'vocals';
    }
    if (newType === 'complete') {
      updates.complete_track_classes = defaults.complete_track_classes ?? ['drums', 'bass', 'guitar'];
    }

    updateStage(index, updates);
  };

  const [showCaptionOverride, setShowCaptionOverride] = useState(
    Boolean(stage.caption || stage.lyrics)
  );

  const previousStages = Array.from({ length: index }, (_, i) => i);
  const needsAudio = AUDIO_STAGE_TYPES.includes(stage.type);
  const isBaseOnly = BASE_ONLY_TYPES.includes(stage.type);
  const modelList = isBaseOnly ? BASE_ONLY_MODELS : DIT_MODELS;

  // Audio source mode: 'upload' or 'stage'
  // Use !== undefined (not truthiness) because '' is a valid "upload selected but no file yet" state
  const audioSourceMode = stage.src_audio_id !== undefined ? 'upload' : 'stage';

  return (
    <div
      className="card border"
      style={{ borderColor: 'var(--border)', borderLeft: '3px solid var(--accent)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            {index + 1}
          </span>
          <select
            value={stage.type}
            onChange={(e) => handleTypeChange(e.target.value as PipelineStageType)}
            className="text-sm font-medium"
          >
            {STAGE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <Tooltip text={help.HELP_STAGE_TYPE} />
        </div>
        {totalStages > 1 && (
          <button
            className="text-xs px-2 py-1 rounded hover:opacity-70"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => removeStage(index)}
          >
            &times; Remove
          </button>
        )}
      </div>

      {/* Model selector */}
      <div className="mb-3">
        <label className="label">Model<Tooltip text={help.HELP_STAGE_MODEL} /></label>
        <select
          value={stage.model || 'acestep-v15-turbo'}
          onChange={(e) => handleModelChange(e.target.value)}
          className="w-full"
        >
          {modelList.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Per-stage caption/lyrics override (collapsible) */}
      <div className="mb-3">
        <div
          role="button"
          tabIndex={0}
          className="text-xs flex items-center gap-1 cursor-pointer"
          style={{ color: 'var(--text-secondary)' }}
          onClick={() => {
            if (showCaptionOverride) {
              // Collapsing — clear overrides
              updateStage(index, { caption: undefined, lyrics: undefined });
            }
            setShowCaptionOverride(!showCaptionOverride);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowCaptionOverride(!showCaptionOverride); } }}
        >
          <span style={{ fontSize: '0.6rem' }}>{showCaptionOverride ? '\u25BC' : '\u25B6'}</span>
          Stage Caption / Lyrics
          {(stage.caption || stage.lyrics) && (
            <span style={{ color: 'var(--accent)' }}>(overridden)</span>
          )}
          <Tooltip text={help.HELP_STAGE_CAPTION} />
        </div>
        {showCaptionOverride && (
          <div className="mt-2 space-y-2 p-3 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div>
              <label className="label">Caption override</label>
              <AutoTextarea
                persistKey={`stage-caption-${index}`}
                value={stage.caption || ''}
                onChange={(e) => update('caption', e.target.value || undefined)}
                placeholder="Leave empty to use shared caption"
                className="w-full text-sm"
                minRows={2}
                maxRows={6}
              />
            </div>
            <div>
              <label className="label">Lyrics override</label>
              <AutoTextarea
                persistKey={`stage-lyrics-${index}`}
                value={stage.lyrics || ''}
                onChange={(e) => update('lyrics', e.target.value || undefined)}
                placeholder="Leave empty to use shared lyrics"
                className="w-full text-sm"
                minRows={3}
                maxRows={8}
              />
            </div>
          </div>
        )}
      </div>

      {/* Refine: source stage selector */}
      {stage.type === 'refine' && previousStages.length > 0 && (
        <div className="mb-3">
          <label className="label">Input from:<Tooltip text={help.HELP_STAGE_INPUT} /></label>
          <select
            value={stage.input_stage ?? 0}
            onChange={(e) => update('input_stage', parseInt(e.target.value))}
            className="w-full"
          >
            {previousStages.map((i) => (
              <option key={i} value={i}>Stage {i + 1}</option>
            ))}
          </select>
        </div>
      )}

      {/* Audio source (for cover/repaint/extract/lego/complete) */}
      {needsAudio && (
        <div className="mb-3 p-3 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <label className="label">Source Audio<Tooltip text={help.HELP_SRC_AUDIO} /></label>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name={`src-mode-${index}`}
                checked={audioSourceMode === 'stage'}
                onChange={() => {
                  updateStage(index, {
                    src_audio_id: undefined,
                    src_stage: index > 0 ? index - 1 : 0,
                  });
                }}
              />
              From stage
            </label>
            <label className="text-xs flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name={`src-mode-${index}`}
                checked={audioSourceMode === 'upload'}
                onChange={() => {
                  updateStage(index, {
                    src_stage: undefined,
                    src_audio_id: stage.src_audio_id || '',
                  });
                }}
              />
              Upload file
            </label>
          </div>

          {audioSourceMode === 'stage' && previousStages.length > 0 ? (
            <select
              value={stage.src_stage ?? 0}
              onChange={(e) => update('src_stage', parseInt(e.target.value))}
              className="w-full"
            >
              {previousStages.map((i) => (
                <option key={i} value={i}>Stage {i + 1} output</option>
              ))}
            </select>
          ) : audioSourceMode === 'stage' && previousStages.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              No previous stages. Switch to upload or add a generate stage first.
            </p>
          ) : (
            <AudioUpload
              label=""
              audioId={stage.src_audio_id || null}
              onUpload={(id) => update('src_audio_id', id)}
              onClear={() => update('src_audio_id', undefined)}
            />
          )}

          {/* Waveform viewer for uploaded audio */}
          {audioSourceMode === 'upload' && stage.src_audio_id && (
            <AudioSourceViewer
              audioId={stage.src_audio_id}
              showRegion={stage.type === 'repaint'}
              regionStart={stage.repainting_start ?? 0}
              regionEnd={stage.repainting_end ?? -1}
              onRegionChange={(start, end) => {
                updateStage(index, { repainting_start: start, repainting_end: end });
              }}
            />
          )}
        </div>
      )}

      {/* Cover: strength slider */}
      {stage.type === 'cover' && (
        <div className="mb-3">
          <label className="label">
            Cover Strength:<Tooltip text={help.HELP_COVER_STRENGTH} />{' '}
            <EditableNumber
              value={stage.audio_cover_strength ?? 0.5}
              onChange={(v) => update('audio_cover_strength', v)}
              min={0}
              max={1}
              step={0.05}
              decimals={2}
            />
          </label>
          <input
            type="range"
            min={0} max={1} step={0.05}
            value={stage.audio_cover_strength ?? 0.5}
            onChange={(e) => update('audio_cover_strength', parseFloat(e.target.value))}
          />
        </div>
      )}

      {/* Repaint: start/end time */}
      {stage.type === 'repaint' && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">Start (s)<Tooltip text={help.HELP_REPAINT_START} /></label>
            <input
              type="number"
              value={stage.repainting_start ?? 0}
              onChange={(e) => update('repainting_start', parseFloat(e.target.value) || 0)}
              min={0}
              step={0.5}
              className="w-full"
            />
          </div>
          <div>
            <label className="label">End (s)<Tooltip text={help.HELP_REPAINT_END} /></label>
            <input
              type="number"
              value={stage.repainting_end ?? -1}
              onChange={(e) => update('repainting_end', parseFloat(e.target.value))}
              step={0.5}
              className="w-full"
              placeholder="-1 = end"
            />
          </div>
        </div>
      )}

      {/* Extract/Lego: track name selector */}
      {(stage.type === 'extract' || stage.type === 'lego') && (
        <div className="mb-3">
          <label className="label">Track<Tooltip text={help.HELP_TRACK_NAME} /></label>
          <select
            value={stage.track_name || 'vocals'}
            onChange={(e) => update('track_name', e.target.value)}
            className="w-full"
          >
            {TRACK_NAMES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      )}

      {/* Complete: track class multi-select */}
      {stage.type === 'complete' && (
        <div className="mb-3">
          <label className="label">Tracks to Add<Tooltip text={help.HELP_TRACK_NAME} /></label>
          <div className="flex flex-wrap gap-2">
            {TRACK_NAMES.map((t) => {
              const selected = stage.complete_track_classes?.includes(t) ?? false;
              return (
                <label key={t} className="text-xs flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => {
                      const current = stage.complete_track_classes || [];
                      const next = e.target.checked
                        ? [...current, t]
                        : current.filter((c) => c !== t);
                      update('complete_track_classes', next);
                    }}
                  />
                  {t}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Main params grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="label">
            Steps:<Tooltip text={help.HELP_INFERENCE_STEPS} />{' '}
            <EditableNumber
              value={stage.steps}
              onChange={(v) => update('steps', v)}
              min={1}
              step={1}
            />
          </label>
          <input
            type="range"
            min={1} max={100} step={1}
            value={Math.min(stage.steps, 100)}
            onChange={(e) => update('steps', parseInt(e.target.value))}
          />
        </div>

        <div>
          <label className="label">
            Shift:<Tooltip text={help.HELP_SHIFT} />{' '}
            <EditableNumber
              value={stage.shift}
              onChange={(v) => update('shift', v)}
              min={0.1}
              max={10}
              step={0.1}
              decimals={1}
            />
          </label>
          <input
            type="range"
            min={1} max={5} step={0.1}
            value={stage.shift}
            onChange={(e) => update('shift', parseFloat(e.target.value))}
          />
        </div>

        {stage.type === 'refine' && (
          <div>
            <label className="label">
              Denoise:<Tooltip text={help.HELP_STAGE_DENOISE} />{' '}
              <EditableNumber
                value={stage.denoise}
                onChange={(v) => update('denoise', v)}
                min={0.05}
                max={1.0}
                step={0.05}
                decimals={2}
              />
            </label>
            <input
              type="range"
              min={0.05} max={1.0} step={0.05}
              value={stage.denoise}
              onChange={(e) => update('denoise', parseFloat(e.target.value))}
            />
          </div>
        )}

        <div>
          <label className="label">Seed<Tooltip text={help.HELP_SEED} /></label>
          <input
            type="number"
            value={stage.seed}
            onChange={(e) => update('seed', parseInt(e.target.value) || -1)}
            className="w-full"
            placeholder="-1 = random"
          />
        </div>

        <div>
          <label className="label">Sampler<Tooltip text={help.HELP_INFER_METHOD} /></label>
          <select
            value={stage.infer_method}
            onChange={(e) => update('infer_method', e.target.value)}
            className="w-full"
          >
            {INFER_METHODS.map((m) => (
              <option key={m} value={m}>{m.toUpperCase()}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Scheduler<Tooltip text={help.HELP_STAGE_SCHEDULER} /></label>
          <select
            value={stage.scheduler || 'auto'}
            onChange={(e) => update('scheduler', e.target.value === 'auto' ? undefined : e.target.value)}
            className="w-full"
          >
            <option value="auto">Auto (model default)</option>
            <option value="linear">Linear</option>
            <option value="discrete">Discrete (turbo 8-step)</option>
            <option value="continuous">Continuous</option>
          </select>
        </div>

        <div>
          <label className="label">
            CFG:<Tooltip text={help.HELP_GUIDANCE_SCALE} />{' '}
            <EditableNumber
              value={stage.guidance_scale}
              onChange={(v) => update('guidance_scale', v)}
              min={1}
              max={30}
              step={0.5}
              decimals={1}
            />
          </label>
          <input
            type="range"
            min={1} max={15} step={0.5}
            value={stage.guidance_scale}
            onChange={(e) => update('guidance_scale', parseFloat(e.target.value))}
          />
        </div>
      </div>

      {/* Bottom row: preview + ADG */}
      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={stage.preview}
            onChange={(e) => update('preview', e.target.checked)}
            id={`preview-${index}`}
          />
          <label htmlFor={`preview-${index}`} className="text-xs cursor-pointer">
            Preview audio<Tooltip text={help.HELP_STAGE_PREVIEW} />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={stage.use_adg}
            onChange={(e) => update('use_adg', e.target.checked)}
            id={`adg-${index}`}
          />
          <label htmlFor={`adg-${index}`} className="text-xs cursor-pointer">
            ADG<Tooltip text={help.HELP_USE_ADG} />
          </label>
        </div>
      </div>
    </div>
  );
}
