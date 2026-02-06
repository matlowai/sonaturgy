import { create } from 'zustand';
import type { AudioResult, BatchEntry } from '@/lib/types';

interface ResultsState {
  batches: BatchEntry[];
  currentBatchIndex: number;
  currentTaskId: string | null;
  generating: boolean;
  progress: number;
  statusMessage: string;
  scores: Record<string, string>;
  lrcs: Record<string, string>;

  addBatch: (entry: BatchEntry) => void;
  setCurrentBatchIndex: (idx: number) => void;
  setCurrentTaskId: (id: string | null) => void;
  setGenerating: (v: boolean) => void;
  setProgress: (p: number) => void;
  setStatusMessage: (m: string) => void;
  setScore: (key: string, score: string) => void;
  setLrc: (key: string, lrc: string) => void;
  getCurrentBatch: () => BatchEntry | null;
  goNext: () => void;
  goPrev: () => void;
  clear: () => void;
}

export const useResultsStore = create<ResultsState>((set, get) => ({
  batches: [],
  currentBatchIndex: -1,
  currentTaskId: null,
  generating: false,
  progress: 0,
  statusMessage: '',
  scores: {},
  lrcs: {},

  addBatch: (entry) =>
    set((s) => ({
      batches: [...s.batches, { ...entry, index: s.batches.length }],
      currentBatchIndex: s.batches.length,
    })),
  setCurrentBatchIndex: (idx) => set({ currentBatchIndex: idx }),
  setCurrentTaskId: (id) => set({ currentTaskId: id }),
  setGenerating: (generating) => set({ generating }),
  setProgress: (progress) => set({ progress }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setScore: (key, score) =>
    set((s) => ({ scores: { ...s.scores, [key]: score } })),
  setLrc: (key, lrc) =>
    set((s) => ({ lrcs: { ...s.lrcs, [key]: lrc } })),
  getCurrentBatch: () => {
    const { batches, currentBatchIndex } = get();
    return batches[currentBatchIndex] ?? null;
  },
  goNext: () =>
    set((s) => ({
      currentBatchIndex: Math.min(s.currentBatchIndex + 1, s.batches.length - 1),
    })),
  goPrev: () =>
    set((s) => ({
      currentBatchIndex: Math.max(s.currentBatchIndex - 1, 0),
    })),
  clear: () =>
    set({ batches: [], currentBatchIndex: -1, scores: {}, lrcs: {} }),
}));
