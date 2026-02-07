'use client';

import { useCallback, useEffect, useRef } from 'react';
import { GenerationPanel } from '@/components/generation/GenerationPanel';
import { ResultsPanel } from '@/components/results/ResultsPanel';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useResultsStore } from '@/stores/resultsStore';
import * as api from '@/lib/api';
import type { WSMessage, BatchEntry } from '@/lib/types';

export default function HomePage() {
  const results = useResultsStore();

  const onResult = useCallback((taskId: string, resultData: any) => {
    results.setGenerating(false);
    results.setProgress(1);
    results.setStatusMessage('Generation complete');
    if (resultData) {
      let batch: BatchEntry;

      if (resultData.stages && Array.isArray(resultData.stages)) {
        // Pipeline result: convert stage outputs to AudioResult format
        const audios = resultData.stages.map((s: any) => ({
          id: s.audio_id,
          key: `pipeline-stage${s.stage}-b${s.batch}`,
          sample_rate: 48000,
          params: {
            ...s.params,
            stage: s.stage,
            is_final: s.is_final,
            is_preview: s.is_preview,
          },
          codes: '',
        }));
        batch = {
          index: 0,
          audios,
          params: audios[0]?.params || { pipeline: true },
          taskId,
        };
      } else {
        // Normal generation result
        batch = {
          index: 0,
          audios: resultData.audios || [],
          params: resultData.audios?.[0]?.params || {},
          taskId,
          extra: resultData.extra || undefined,
        };
      }

      results.addBatch(batch);
    }
  }, [results]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsConnectedRef = useRef(false);

  // Stop polling when done
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const handleWSMessage = useCallback((msg: WSMessage) => {
    wsConnectedRef.current = true;
    stopPolling(); // WS works, no need to poll

    switch (msg.type) {
      case 'progress':
        results.setProgress(msg.progress || 0);
        if (msg.message) results.setStatusMessage(msg.message);
        break;

      case 'completed':
        onResult(msg.task_id, msg.result);
        break;

      case 'error':
        results.setGenerating(false);
        results.setStatusMessage(`Error: ${msg.error}`);
        break;

      case 'status':
        if (msg.status === 'running') {
          results.setGenerating(true);
          results.setStatusMessage('Generation running...');
        }
        break;
    }
  }, [results, stopPolling, onResult]);

  const { subscribe, client } = useWebSocket(handleWSMessage);

  // Polling fallback: if WebSocket doesn't deliver updates, poll the task endpoint
  const startPolling = useCallback((taskId: string) => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const resp = await api.getTaskStatus(taskId);
        if (!resp.success) return;
        const task = resp.data;

        if (task.status === 'running') {
          results.setProgress(task.progress || 0);
          if (task.message) results.setStatusMessage(task.message);
        } else if (task.status === 'completed') {
          stopPolling();
          onResult(taskId, task.result);
        } else if (task.status === 'error') {
          stopPolling();
          results.setGenerating(false);
          results.setStatusMessage(`Error: ${task.error || task.message || 'Unknown error'}`);
        }
      } catch {
        // ignore polling errors
      }
    }, 1500);
  }, [results, stopPolling, onResult]);

  // When currentTaskId changes, subscribe via WS and start polling fallback
  const currentTaskId = results.currentTaskId;
  const prevTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (currentTaskId && currentTaskId !== prevTaskIdRef.current) {
      prevTaskIdRef.current = currentTaskId;
      subscribe(currentTaskId);
      // Always start polling as a fallback; if WS delivers first, polling stops
      startPolling(currentTaskId);
    }
    if (!currentTaskId) {
      stopPolling();
    }
  }, [currentTaskId, subscribe, startPolling, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-[1400px] mx-auto">
      <div>
        <GenerationPanel />
      </div>
      <div>
        <ResultsPanel />
      </div>
    </div>
  );
}
