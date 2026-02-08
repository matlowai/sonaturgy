import { create } from 'zustand';

/** Data returned by createSample, passed to all binding targets */
export interface LLMAssistResult {
  caption: string;
  lyrics: string;
  bpm: string;
  keyscale: string;
  timesignature: string;
  duration: number;
  vocalLanguage: string;
  instrumental: boolean;
}

/** Describes what opened the modal (for display title) */
export type LLMAssistTargetLabel =
  | { kind: 'custom' }
  | { kind: 'pipeline-shared' }
  | { kind: 'pipeline-stage'; stageIndex: number };

interface LLMAssistState {
  isOpen: boolean;
  targetLabel: LLMAssistTargetLabel | null;
  onApply: ((result: LLMAssistResult) => void) | null;

  open: (
    targetLabel: LLMAssistTargetLabel,
    onApply: (result: LLMAssistResult) => void,
  ) => void;
  close: () => void;
}

export const useLLMAssistStore = create<LLMAssistState>((set) => ({
  isOpen: false,
  targetLabel: null,
  onApply: null,

  open: (targetLabel, onApply) => set({ isOpen: true, targetLabel, onApply }),
  close: () => set({ isOpen: false, targetLabel: null, onApply: null }),
}));
