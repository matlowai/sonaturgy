'use client';
import { useCallback } from 'react';
import { useResultsStore } from '@/stores/resultsStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useUIStore } from '@/stores/uiStore';

import { mapParamsToFields } from '@/lib/stageConversion';
// Re-export for backward compat — canonical source is stageConversion.ts
export { mapParamsToFields };

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
