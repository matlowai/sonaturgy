import { create } from 'zustand';
import {
  loadLastGenerationConfig,
  saveLastGenerationConfig,
  GENERATION_SETTINGS_KEYS,
} from '@/lib/presets';
import type { GenerationConfigSnapshot } from '@/lib/presets';

type GenerationMode = 'simple' | 'custom' | 'pipeline';

interface GenerationState {
  mode: GenerationMode;

  // Simple mode
  simpleQuery: string;
  simpleInstrumental: boolean;
  simpleVocalLanguage: string;

  // Custom mode - text
  caption: string;
  lyrics: string;
  instrumental: boolean;
  isFormatCaption: boolean;

  // Task
  taskType: string;
  instruction: string;

  // Metadata
  vocalLanguage: string;
  bpm: string;
  keyscale: string;
  timesignature: string;
  duration: number;
  batchSize: number;

  // Audio references
  referenceAudioId: string | null;
  srcAudioId: string | null;
  audioCodes: string;
  trackName: string;
  completeTrackClasses: string[];

  // Repainting
  repaintingStart: number;
  repaintingEnd: number;
  audioCoverStrength: number;

  // Advanced DiT
  inferenceSteps: number;
  guidanceScale: number;
  seed: number;
  useRandomSeed: boolean;
  useAdg: boolean;
  cfgIntervalStart: number;
  cfgIntervalEnd: number;
  shift: number;
  inferMethod: string;
  customTimesteps: string;
  audioFormat: string;

  // LM params
  thinking: boolean;
  lmTemperature: number;
  lmCfgScale: number;
  lmTopK: number;
  lmTopP: number;
  lmNegativePrompt: string;
  useCotMetas: boolean;
  useCotCaption: boolean;
  useCotLanguage: boolean;
  useConstrainedDecoding: boolean;
  constrainedDecodingDebug: boolean;
  allowLmBatch: boolean;
  lmBatchChunkSize: number;
  lmCodesStrength: number;
  captionRewrite: boolean;

  // Auto features
  autoScore: boolean;
  autoLrc: boolean;
  scoreScale: number;
  autoGen: boolean;

  // Actions
  setMode: (mode: GenerationMode) => void;
  setField: (field: string, value: any) => void;
  setFields: (fields: Record<string, any>) => void;
  resetToDefaults: () => void;
}

const defaults = {
  mode: 'custom' as GenerationMode,
  simpleQuery: '',
  simpleInstrumental: false,
  simpleVocalLanguage: 'unknown',
  caption: '',
  lyrics: '',
  instrumental: false,
  isFormatCaption: false,
  taskType: 'text2music',
  instruction: 'Fill the audio semantic mask based on the given conditions:',
  vocalLanguage: 'unknown',
  bpm: '',
  keyscale: '',
  timesignature: '',
  duration: -1,
  batchSize: 2,
  referenceAudioId: null,
  srcAudioId: null,
  audioCodes: '',
  trackName: 'vocals',
  completeTrackClasses: [] as string[],
  repaintingStart: 0,
  repaintingEnd: -1,
  audioCoverStrength: 1.0,
  inferenceSteps: 8,
  guidanceScale: 7.0,
  seed: -1,
  useRandomSeed: true,
  useAdg: false,
  cfgIntervalStart: 0.0,
  cfgIntervalEnd: 1.0,
  shift: 1.0,
  inferMethod: 'ode',
  customTimesteps: '',
  audioFormat: 'flac',
  thinking: true,
  lmTemperature: 0.85,
  lmCfgScale: 2.0,
  lmTopK: 0,
  lmTopP: 0.9,
  lmNegativePrompt: 'NO USER INPUT',
  useCotMetas: true,
  useCotCaption: true,
  useCotLanguage: true,
  useConstrainedDecoding: true,
  constrainedDecodingDebug: false,
  allowLmBatch: false,
  lmBatchChunkSize: 8,
  lmCodesStrength: 1.0,
  captionRewrite: false,
  autoScore: false,
  autoLrc: false,
  scoreScale: 1.0,
  autoGen: false,
};

// Merge saved settings into defaults (settings-only fields, not creative content)
function getInitialState(): typeof defaults {
  const saved = loadLastGenerationConfig();
  if (!saved) return { ...defaults };
  const merged = { ...defaults };
  for (const key of GENERATION_SETTINGS_KEYS) {
    if (key in saved && saved[key] !== undefined) {
      (merged as any)[key] = saved[key];
    }
  }
  return merged;
}

// Extract settings snapshot from full state
function extractSettings(state: Record<string, any>): GenerationConfigSnapshot {
  const snapshot: Record<string, any> = {};
  for (const key of GENERATION_SETTINGS_KEYS) {
    snapshot[key] = state[key];
  }
  return snapshot as GenerationConfigSnapshot;
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  ...getInitialState(),
  setMode: (mode) => set({ mode }),
  setField: (field, value) => set({ [field]: value } as any),
  setFields: (fields) => set(fields as any),
  resetToDefaults: () => set(defaults),
}));

// Subscribe to persist settings on every state change
useGenerationStore.subscribe((state) => {
  saveLastGenerationConfig(extractSettings(state as any));
});
