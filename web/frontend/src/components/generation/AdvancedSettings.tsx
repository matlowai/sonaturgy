'use client';

import { useState } from 'react';
import { useGenerationStore } from '@/stores/generationStore';
import { useServiceStore } from '@/stores/serviceStore';
import { useUIStore } from '@/stores/uiStore';
import { t } from '@/lib/i18n';
import { AUDIO_FORMATS, INFER_METHODS } from '@/lib/constants';
import { Tooltip } from '@/components/common/Tooltip';
import * as help from '@/lib/help-text';

export function AdvancedSettings() {
  const gen = useGenerationStore();
  const { status } = useServiceStore();
  const { language } = useUIStore();
  const [open, setOpen] = useState(false);

  const isTurbo = status.is_turbo;
  const isBase = status.is_turbo === false;

  return (
    <div className="card">
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <h3 className="section-title mb-0">{t(language, 'generation.advanced_settings')}</h3>
        <span className="text-sm">{open ? '\u25B2' : '\u25BC'}</span>
      </div>

      {open && (
        <div className="mt-3 space-y-4">
          {/* Resume from Latent */}
          {gen.initLatentId && (
            <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'var(--accent)', backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                  Resuming from latent
                </h4>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => gen.setFields({ initLatentId: null, tStart: 1.0 })}
                >
                  Clear
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                ID: <code className="text-xs">{gen.initLatentId}</code>
              </p>
              <div>
                <label className="label">
                  Denoise: {gen.tStart.toFixed(2)}
                  <Tooltip text="How much of the schedule to run. 1.0 = full denoise (ignores latent). Lower values preserve more of the original." />
                </label>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={gen.tStart}
                  onChange={(e) => gen.setField('tStart', parseFloat(e.target.value))}
                />
              </div>
              {gen.tStart >= 1.0 && (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  At 1.0, generation starts from noise. Lower the slider to resume from the stored latent.
                </p>
              )}
            </div>
          )}

          {/* DiT Settings */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>DiT Parameters</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="label">{t(language, 'generation.inference_steps_label')}: {gen.inferenceSteps}<Tooltip text={help.HELP_INFERENCE_STEPS} /></label>
                <input
                  type="range"
                  min={1} max={isTurbo ? 8 : 200} step={1}
                  value={gen.inferenceSteps}
                  onChange={(e) => gen.setField('inferenceSteps', parseInt(e.target.value))}
                />
              </div>

              {isBase && (
                <div>
                  <label className="label">{t(language, 'generation.guidance_scale_label')}: {gen.guidanceScale.toFixed(1)}<Tooltip text={help.HELP_GUIDANCE_SCALE} /></label>
                  <input
                    type="range"
                    min={1} max={15} step={0.5}
                    value={gen.guidanceScale}
                    onChange={(e) => gen.setField('guidanceScale', parseFloat(e.target.value))}
                  />
                </div>
              )}

              <div>
                <label className="label">{t(language, 'generation.shift_label')}: {gen.shift.toFixed(1)}<Tooltip text={help.HELP_SHIFT} /></label>
                <input
                  type="range"
                  min={1} max={5} step={0.1}
                  value={gen.shift}
                  onChange={(e) => gen.setField('shift', parseFloat(e.target.value))}
                />
              </div>

              <div>
                <label className="label">{t(language, 'generation.seed_label')}<Tooltip text={help.HELP_SEED} /></label>
                <input
                  type="number"
                  value={gen.seed}
                  onChange={(e) => gen.setField('seed', parseInt(e.target.value) || -1)}
                  className="w-full"
                />
              </div>

              <div className="flex items-center gap-2 self-end pb-2">
                <input
                  type="checkbox"
                  checked={gen.useRandomSeed}
                  onChange={(e) => gen.setField('useRandomSeed', e.target.checked)}
                  id="random-seed"
                />
                <label htmlFor="random-seed" className="text-xs cursor-pointer">
                  {t(language, 'generation.random_seed_label')}<Tooltip text={help.HELP_RANDOM_SEED} />
                </label>
              </div>

              <div>
                <label className="label">{t(language, 'generation.infer_method_label')}<Tooltip text={help.HELP_INFER_METHOD} /></label>
                <select
                  value={gen.inferMethod}
                  onChange={(e) => gen.setField('inferMethod', e.target.value)}
                  className="w-full"
                >
                  {INFER_METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                </select>
              </div>

              <div>
                <label className="label">{t(language, 'generation.audio_format_label')}<Tooltip text={help.HELP_AUDIO_FORMAT} /></label>
                <select
                  value={gen.audioFormat}
                  onChange={(e) => gen.setField('audioFormat', e.target.value)}
                  className="w-full"
                >
                  {AUDIO_FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                </select>
              </div>

              <div>
                <label className="label">{t(language, 'generation.custom_timesteps_label')}<Tooltip text={help.HELP_CUSTOM_TIMESTEPS} /></label>
                <input
                  type="text"
                  value={gen.customTimesteps}
                  onChange={(e) => gen.setField('customTimesteps', e.target.value)}
                  placeholder="0.97,0.76,0.615..."
                  className="w-full text-xs"
                />
              </div>

              <div>
                <label className="label">
                  Checkpoint Step{gen.checkpointStep !== null ? `: ${gen.checkpointStep}` : ''}
                  <Tooltip text="Snapshot the latent at this diffusion step for later resume. Leave empty for no checkpoint." />
                </label>
                <input
                  type="number"
                  value={gen.checkpointStep ?? ''}
                  onChange={(e) => gen.setField('checkpointStep', e.target.value === '' ? null : Math.min(Math.max(0, parseInt(e.target.value) || 0), gen.inferenceSteps - 1))}
                  placeholder="none"
                  min={0}
                  max={gen.inferenceSteps - 1}
                  className="w-full"
                />
              </div>
            </div>

            {/* Base model only settings */}
            {isBase && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={gen.useAdg} onChange={(e) => gen.setField('useAdg', e.target.checked)} id="use-adg" />
                  <label htmlFor="use-adg" className="text-xs cursor-pointer">{t(language, 'generation.use_adg_label')}<Tooltip text={help.HELP_USE_ADG} /></label>
                </div>
                <div>
                  <label className="label">{t(language, 'generation.cfg_interval_start')}: {gen.cfgIntervalStart.toFixed(2)}<Tooltip text={help.HELP_CFG_INTERVAL_START} /></label>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={gen.cfgIntervalStart}
                    onChange={(e) => gen.setField('cfgIntervalStart', parseFloat(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label">{t(language, 'generation.cfg_interval_end')}: {gen.cfgIntervalEnd.toFixed(2)}<Tooltip text={help.HELP_CFG_INTERVAL_END} /></label>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={gen.cfgIntervalEnd}
                    onChange={(e) => gen.setField('cfgIntervalEnd', parseFloat(e.target.value))}
                  />
                </div>
              </div>
            )}
          </div>

          {/* LM Settings */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {t(language, 'generation.lm_params_title')}
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="label">{t(language, 'generation.lm_temperature_label')}: {gen.lmTemperature.toFixed(2)}<Tooltip text={help.HELP_LM_TEMPERATURE} /></label>
                <input
                  type="range" min={0} max={2} step={0.05}
                  value={gen.lmTemperature}
                  onChange={(e) => gen.setField('lmTemperature', parseFloat(e.target.value))}
                />
              </div>
              <div>
                <label className="label">{t(language, 'generation.lm_cfg_scale_label')}: {gen.lmCfgScale.toFixed(1)}<Tooltip text={help.HELP_LM_CFG_SCALE} /></label>
                <input
                  type="range" min={1} max={3} step={0.1}
                  value={gen.lmCfgScale}
                  onChange={(e) => gen.setField('lmCfgScale', parseFloat(e.target.value))}
                />
              </div>
              <div>
                <label className="label">{t(language, 'generation.lm_top_k_label')}: {gen.lmTopK}<Tooltip text={help.HELP_LM_TOP_K} /></label>
                <input
                  type="range" min={0} max={100} step={1}
                  value={gen.lmTopK}
                  onChange={(e) => gen.setField('lmTopK', parseInt(e.target.value))}
                />
              </div>
              <div>
                <label className="label">{t(language, 'generation.lm_top_p_label')}: {gen.lmTopP.toFixed(2)}<Tooltip text={help.HELP_LM_TOP_P} /></label>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={gen.lmTopP}
                  onChange={(e) => gen.setField('lmTopP', parseFloat(e.target.value))}
                />
              </div>
              <div>
                <label className="label">{t(language, 'generation.lm_negative_prompt_label')}<Tooltip text={help.HELP_LM_NEGATIVE_PROMPT} /></label>
                <input
                  type="text"
                  value={gen.lmNegativePrompt}
                  onChange={(e) => gen.setField('lmNegativePrompt', e.target.value)}
                  className="w-full text-xs"
                />
              </div>
              <div>
                <label className="label">{t(language, 'generation.lm_batch_chunk_label')}: {gen.lmBatchChunkSize}<Tooltip text={help.HELP_LM_BATCH_CHUNK} /></label>
                <input
                  type="range" min={1} max={16} step={1}
                  value={gen.lmBatchChunkSize}
                  onChange={(e) => gen.setField('lmBatchChunkSize', parseInt(e.target.value))}
                />
              </div>
              <div>
                <label className="label">{t(language, 'generation.codes_strength_label')}: {gen.lmCodesStrength.toFixed(2)}<Tooltip text={help.HELP_LM_CODES_STRENGTH} /></label>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={gen.lmCodesStrength}
                  onChange={(e) => gen.setField('lmCodesStrength', parseFloat(e.target.value))}
                />
              </div>
            </div>

            {/* Checkboxes */}
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {[
                { key: 'thinking', label: t(language, 'generation.think_label'), tip: help.HELP_THINKING },
                { key: 'useCotMetas', label: t(language, 'generation.cot_metas_label'), tip: help.HELP_COT_METAS },
                { key: 'useCotCaption', label: t(language, 'generation.caption_rewrite_label'), tip: help.HELP_COT_CAPTION },
                { key: 'useCotLanguage', label: t(language, 'generation.cot_language_label'), tip: help.HELP_COT_LANGUAGE },
                { key: 'useConstrainedDecoding', label: 'Constrained Decoding', tip: help.HELP_CONSTRAINED_DECODING },
                { key: 'constrainedDecodingDebug', label: t(language, 'generation.constrained_debug_label'), tip: help.HELP_CONSTRAINED_DEBUG },
                { key: 'allowLmBatch', label: t(language, 'generation.parallel_thinking_label'), tip: help.HELP_PARALLEL_THINKING },
                { key: 'autoScore', label: t(language, 'generation.auto_score_label'), tip: help.HELP_AUTO_SCORE },
                { key: 'autoLrc', label: t(language, 'generation.auto_lrc_label'), tip: help.HELP_AUTO_LRC },
              ].map(({ key, label, tip }) => (
                <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(gen as any)[key]}
                    onChange={(e) => gen.setField(key, e.target.checked)}
                  />
                  {label}<Tooltip text={tip} />
                </label>
              ))}
            </div>

            <div>
              <label className="label">{t(language, 'generation.score_sensitivity_label')}: {gen.scoreScale.toFixed(1)}<Tooltip text={help.HELP_SCORE_SCALE} /></label>
              <input
                type="range" min={0.1} max={3} step={0.1}
                value={gen.scoreScale}
                onChange={(e) => gen.setField('scoreScale', parseFloat(e.target.value))}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
