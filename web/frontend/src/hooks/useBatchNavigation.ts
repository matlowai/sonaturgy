'use client';
import { useCallback } from 'react';
import { useResultsStore } from '@/stores/resultsStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useUIStore } from '@/stores/uiStore';

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
    gen.setFields({
      caption: p.caption || '',
      lyrics: p.lyrics || '',
      instrumental: p.instrumental || false,
      taskType: p.task_type || 'text2music',
      vocalLanguage: p.vocal_language || 'unknown',
      bpm: p.bpm ? String(p.bpm) : '',
      keyscale: p.keyscale || '',
      timesignature: p.timesignature || '',
      duration: p.duration || -1,
      inferenceSteps: p.inference_steps || 8,
      guidanceScale: p.guidance_scale || 7.0,
      seed: p.seed || -1,
      shift: p.shift || 1.0,
    });
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
