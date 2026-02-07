'use client';
import { useCallback } from 'react';
import { useResultsStore } from '@/stores/resultsStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useUIStore } from '@/stores/uiStore';

/** Map backend snake_case params to frontend camelCase store fields */
export function mapParamsToFields(p: Record<string, any>): Record<string, any> {
  return {
    // Switch to custom mode so restored fields are visible
    mode: 'custom',
    // Creative content
    caption: p.caption || '',
    lyrics: p.lyrics || '',
    instrumental: p.instrumental ?? false,
    taskType: p.task_type || 'text2music',
    vocalLanguage: p.vocal_language || 'unknown',
    bpm: p.bpm ? String(p.bpm) : '',
    keyscale: p.keyscale || '',
    timesignature: p.timesignature || '',
    duration: p.duration ?? -1,
    // DiT settings
    inferenceSteps: p.inference_steps ?? 8,
    guidanceScale: p.guidance_scale ?? 7.0,
    seed: p.seed ?? -1,
    shift: p.shift ?? 1.0,
    inferMethod: p.infer_method || 'ode',
    useAdg: p.use_adg ?? false,
    cfgIntervalStart: p.cfg_interval_start ?? 0.0,
    cfgIntervalEnd: p.cfg_interval_end ?? 1.0,
    audioCoverStrength: p.audio_cover_strength ?? 1.0,
    // LM settings
    thinking: p.thinking ?? true,
    lmTemperature: p.lm_temperature ?? 0.85,
    lmCfgScale: p.lm_cfg_scale ?? 2.0,
    lmTopK: p.lm_top_k ?? 0,
    lmTopP: p.lm_top_p ?? 0.9,
    lmNegativePrompt: p.lm_negative_prompt || 'NO USER INPUT',
    useCotMetas: p.use_cot_metas ?? true,
    useCotCaption: p.use_cot_caption ?? true,
    useCotLanguage: p.use_cot_language ?? true,
    useConstrainedDecoding: p.use_constrained_decoding ?? true,
    // Reset latent resume (these are set explicitly by AudioCard, not from params)
    initLatentId: null,
    tStart: 1.0,
    checkpointStep: null,
    resumeSampleIndex: null,
  };
}

export function useBatchNavigation() {
  const results = useResultsStore();
  const gen = useGenerationStore();
  const ui = useUIStore();

  const goNext = useCallback(() => {
    if (results.currentBatchIndex < results.batches.length - 1) {
      results.goNext();
    } else {
      ui.addToast('No next batch available', 'info');
    }
  }, [results, ui]);

  const goPrev = useCallback(() => {
    if (results.currentBatchIndex > 0) {
      results.goPrev();
    } else {
      ui.addToast('Already at first batch', 'info');
    }
  }, [results, ui]);

  const restoreParams = useCallback(() => {
    const batch = results.getCurrentBatch();
    if (!batch || !batch.params) {
      ui.addToast('No batch data to restore', 'info');
      return;
    }
    const p = batch.params;
    gen.setFields(mapParamsToFields(p));
    ui.addToast(`Parameters restored from Batch ${results.currentBatchIndex + 1}`, 'success');
  }, [results, gen, ui]);

  return {
    goNext,
    goPrev,
    restoreParams,
    currentIndex: results.currentBatchIndex,
    totalBatches: results.batches.length,
    currentBatch: results.getCurrentBatch(),
  };
}
