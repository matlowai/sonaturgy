'use client';
import { useCallback } from 'react';
import { useGenerationStore } from '@/stores/generationStore';
import { useResultsStore } from '@/stores/resultsStore';
import { useServiceStore } from '@/stores/serviceStore';
import { useUIStore } from '@/stores/uiStore';
import * as api from '@/lib/api';
import type { GenerateRequest } from '@/lib/types';

export function useGeneration() {
  const gen = useGenerationStore();
  const results = useResultsStore();
  const service = useServiceStore();
  const ui = useUIStore();

  const buildRequest = useCallback((): GenerateRequest => {
    const timesteps = gen.customTimesteps
      ? gen.customTimesteps.split(',').map(Number).filter((n) => !isNaN(n))
      : null;

    return {
      caption: gen.caption,
      lyrics: gen.lyrics,
      instrumental: gen.instrumental,
      task_type: gen.taskType,
      instruction: gen.instruction,
      vocal_language: gen.vocalLanguage,
      bpm: gen.bpm ? parseInt(gen.bpm) : null,
      keyscale: gen.keyscale,
      timesignature: gen.timesignature,
      duration: gen.duration,
      reference_audio_id: gen.referenceAudioId,
      src_audio_id: gen.srcAudioId,
      audio_codes: gen.audioCodes,
      repainting_start: gen.repaintingStart,
      repainting_end: gen.repaintingEnd,
      audio_cover_strength: gen.audioCoverStrength,
      inference_steps: gen.inferenceSteps,
      guidance_scale: gen.guidanceScale,
      seed: gen.seed,
      use_adg: gen.useAdg,
      cfg_interval_start: gen.cfgIntervalStart,
      cfg_interval_end: gen.cfgIntervalEnd,
      shift: gen.shift,
      infer_method: gen.inferMethod,
      timesteps,
      thinking: gen.thinking,
      lm_temperature: gen.lmTemperature,
      lm_cfg_scale: gen.lmCfgScale,
      lm_top_k: gen.lmTopK,
      lm_top_p: gen.lmTopP,
      lm_negative_prompt: gen.lmNegativePrompt,
      use_cot_metas: gen.useCotMetas,
      use_cot_caption: gen.useCotCaption,
      use_cot_language: gen.useCotLanguage,
      use_constrained_decoding: gen.useConstrainedDecoding,
      batch_size: gen.batchSize,
      allow_lm_batch: gen.allowLmBatch,
      use_random_seed: gen.useRandomSeed,
      seeds: null,
      lm_batch_chunk_size: gen.lmBatchChunkSize,
      constrained_decoding_debug: gen.constrainedDecodingDebug,
      audio_format: gen.audioFormat,
      is_format_caption: gen.isFormatCaption,
      auto_score: gen.autoScore,
      auto_lrc: gen.autoLrc,
      score_scale: gen.scoreScale,
      lm_codes_strength: gen.lmCodesStrength,
    };
  }, [gen]);

  const generate = useCallback(async () => {
    if (!service.status.dit_initialized) {
      ui.addToast('Please initialize the service first', 'error');
      return null;
    }

    results.setGenerating(true);
    results.setProgress(0);
    results.setStatusMessage('Starting generation...');

    try {
      const req = buildRequest();
      const resp = await api.startGeneration(req);
      const taskId = resp.data.task_id;
      results.setCurrentTaskId(taskId);
      return taskId;
    } catch (err: any) {
      results.setGenerating(false);
      ui.addToast(err.message || 'Generation failed', 'error');
      return null;
    }
  }, [buildRequest, service.status.dit_initialized, results, ui]);

  const createSample = useCallback(async () => {
    if (!service.status.llm_initialized) {
      ui.addToast('LLM not initialized', 'error');
      return;
    }
    try {
      const resp = await api.createSample({
        query: gen.simpleQuery,
        instrumental: gen.simpleInstrumental,
        vocal_language: gen.simpleVocalLanguage === 'unknown' ? null : gen.simpleVocalLanguage,
        lm_temperature: gen.lmTemperature,
        lm_top_k: gen.lmTopK,
        lm_top_p: gen.lmTopP,
        constrained_decoding_debug: gen.constrainedDecodingDebug,
      });
      if (resp.success && resp.data) {
        const d = resp.data;
        gen.setFields({
          caption: d.caption || '',
          lyrics: d.lyrics || '',
          instrumental: d.instrumental || false,
          bpm: d.bpm ? String(d.bpm) : '',
          keyscale: d.keyscale || '',
          timesignature: d.timesignature || '',
          duration: d.duration || -1,
          vocalLanguage: d.language || 'unknown',
          isFormatCaption: true,
        });
        ui.addToast('Sample created', 'success');
      }
    } catch (err: any) {
      ui.addToast(err.message || 'Create sample failed', 'error');
    }
  }, [gen, service.status.llm_initialized, ui]);

  const formatCaption = useCallback(async () => {
    if (!service.status.llm_initialized) {
      ui.addToast('LLM not initialized', 'error');
      return;
    }
    try {
      const resp = await api.formatSample({
        caption: gen.caption,
        lyrics: gen.lyrics,
        bpm: gen.bpm ? parseInt(gen.bpm) : null,
        duration: gen.duration > 0 ? gen.duration : null,
        keyscale: gen.keyscale,
        timesignature: gen.timesignature,
        lm_temperature: gen.lmTemperature,
        lm_top_k: gen.lmTopK,
        lm_top_p: gen.lmTopP,
        constrained_decoding_debug: gen.constrainedDecodingDebug,
      });
      if (resp.success && resp.data) {
        const d = resp.data;
        gen.setFields({
          caption: d.caption || gen.caption,
          lyrics: d.lyrics || gen.lyrics,
          bpm: d.bpm ? String(d.bpm) : gen.bpm,
          keyscale: d.keyscale || gen.keyscale,
          timesignature: d.timesignature || gen.timesignature,
          duration: d.duration || gen.duration,
          vocalLanguage: d.language || gen.vocalLanguage,
          isFormatCaption: true,
        });
        ui.addToast('Caption formatted', 'success');
      }
    } catch (err: any) {
      ui.addToast(err.message || 'Format failed', 'error');
    }
  }, [gen, service.status.llm_initialized, ui]);

  return { generate, createSample, formatCaption, buildRequest };
}
