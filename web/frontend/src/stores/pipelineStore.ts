import { create } from 'zustand';
import type { PipelineStageConfig, PipelineStageType } from '@/lib/types';

export interface PipelinePreset {
  name: string;
  description: string;
  stages: PipelineStageConfig[];
  builtIn?: boolean;
}

// ── localStorage helpers ────────────────────────────────────────────

const USER_PRESETS_KEY = 'pipeline-user-presets';

function loadUserPresets(): PipelinePreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(USER_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function persistUserPresets(presets: PipelinePreset[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // localStorage full or unavailable
  }
}

// ── Model defaults ───────────────────────────────────────────────────

// Default steps for each model type
export const MODEL_DEFAULT_STEPS: Record<string, number> = {
  'acestep-v15-base': 50,
  'acestep-v15-sft': 50,
  'acestep-v15-turbo': 8,
  'acestep-v15-turbo-shift1': 8,
  'acestep-v15-turbo-shift3': 8,
  'acestep-v15-turbo-continuous': 8,
};

export function getDefaultStepsForModel(model?: string): number {
  if (!model) return 8; // Default to turbo-like
  return MODEL_DEFAULT_STEPS[model] ?? 8;
}

export function isTurboModel(model?: string): boolean {
  if (!model) return true;
  return model.includes('turbo');
}

// ── Built-in presets ────────────────────────────────────────────────

export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    name: 'Base \u2192 Turbo',
    description: 'Base 50-step structure, Turbo 8-step refine at denoise 0.6',
    builtIn: true,
    stages: [
      {
        type: 'generate', model: 'acestep-v15-base', steps: 50, shift: 3.0, denoise: 1.0,
        seed: -1, infer_method: 'ode', guidance_scale: 1.0,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: false,
      },
      {
        type: 'refine', input_stage: 0, model: 'acestep-v15-turbo', steps: 8, shift: 3.0, denoise: 0.6,
        seed: -1, infer_method: 'ode', guidance_scale: 1.0,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: true,
      },
    ],
  },
  {
    name: 'SFT \u2192 Turbo',
    description: 'SFT 50-step with CFG, Turbo 8-step polish at denoise 0.4',
    builtIn: true,
    stages: [
      {
        type: 'generate', model: 'acestep-v15-sft', steps: 50, shift: 2.0, denoise: 1.0,
        seed: -1, infer_method: 'ode', guidance_scale: 3.0,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: false,
      },
      {
        type: 'refine', input_stage: 0, model: 'acestep-v15-turbo', steps: 8, shift: 3.0, denoise: 0.4,
        seed: -1, infer_method: 'ode', guidance_scale: 1.0,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: true,
      },
    ],
  },
  {
    name: '3-Stage Quality',
    description: 'Base structure \u2192 SFT detail \u2192 Turbo polish',
    builtIn: true,
    stages: [
      {
        type: 'generate', model: 'acestep-v15-base', steps: 50, shift: 3.0, denoise: 1.0,
        seed: -1, infer_method: 'ode', guidance_scale: 1.0,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: false,
      },
      {
        type: 'refine', input_stage: 0, model: 'acestep-v15-sft', steps: 32, shift: 2.0, denoise: 0.5,
        seed: -1, infer_method: 'ode', guidance_scale: 2.0,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: false,
      },
      {
        type: 'refine', input_stage: 1, model: 'acestep-v15-turbo', steps: 8, shift: 3.0, denoise: 0.3,
        seed: -1, infer_method: 'ode', guidance_scale: 1.0,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: true,
      },
    ],
  },
  {
    name: 'Cover + Polish',
    description: 'Cover uploaded audio, then refine with turbo',
    builtIn: true,
    stages: [
      {
        type: 'cover', model: 'acestep-v15-turbo', steps: 8, shift: 3.0, denoise: 1.0,
        seed: -1, infer_method: 'ode', guidance_scale: 1.0,
        audio_cover_strength: 0.5,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: false,
      },
      {
        type: 'refine', input_stage: 0, model: 'acestep-v15-turbo', steps: 8, shift: 3.0, denoise: 0.4,
        seed: -1, infer_method: 'ode', guidance_scale: 1.0,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: true,
      },
    ],
  },
  {
    name: 'Gen + Extract Vocals',
    description: 'Generate full song, then extract vocals',
    builtIn: true,
    stages: [
      {
        type: 'generate', model: 'acestep-v15-base', steps: 50, shift: 3.0, denoise: 1.0,
        seed: -1, infer_method: 'ode', guidance_scale: 1.0,
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: true,
      },
      {
        type: 'extract', model: 'acestep-v15-base', steps: 50, shift: 3.0, denoise: 1.0,
        seed: -1, infer_method: 'ode', guidance_scale: 1.0,
        src_stage: 0, track_name: 'vocals',
        use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
        preview: true,
      },
    ],
  },
];

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_GENERATE_STAGE: PipelineStageConfig = {
  type: 'generate', model: 'acestep-v15-turbo', steps: 8, shift: 3.0, denoise: 1.0,
  seed: -1, infer_method: 'ode', guidance_scale: 1.0,
  use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
  preview: false,
};

const DEFAULT_REFINE_STAGE: PipelineStageConfig = {
  type: 'refine', input_stage: 0, model: 'acestep-v15-turbo', steps: 8, shift: 3.0, denoise: 0.6,
  seed: -1, infer_method: 'ode', guidance_scale: 1.0,
  use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
  preview: true,
};

const DEFAULT_COVER_STAGE: PipelineStageConfig = {
  type: 'cover', model: 'acestep-v15-turbo', steps: 8, shift: 3.0, denoise: 1.0,
  seed: -1, infer_method: 'ode', guidance_scale: 1.0,
  audio_cover_strength: 0.5,
  use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
  preview: false,
};

const DEFAULT_REPAINT_STAGE: PipelineStageConfig = {
  type: 'repaint', model: 'acestep-v15-turbo', steps: 8, shift: 3.0, denoise: 1.0,
  seed: -1, infer_method: 'ode', guidance_scale: 1.0,
  repainting_start: 0, repainting_end: -1,
  use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
  preview: false,
};

const DEFAULT_EXTRACT_STAGE: PipelineStageConfig = {
  type: 'extract', model: 'acestep-v15-base', steps: 50, shift: 3.0, denoise: 1.0,
  seed: -1, infer_method: 'ode', guidance_scale: 1.0,
  track_name: 'vocals',
  use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
  preview: false,
};

const DEFAULT_LEGO_STAGE: PipelineStageConfig = {
  type: 'lego', model: 'acestep-v15-base', steps: 50, shift: 3.0, denoise: 1.0,
  seed: -1, infer_method: 'ode', guidance_scale: 1.0,
  track_name: 'vocals',
  use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
  preview: false,
};

const DEFAULT_COMPLETE_STAGE: PipelineStageConfig = {
  type: 'complete', model: 'acestep-v15-base', steps: 50, shift: 3.0, denoise: 1.0,
  seed: -1, infer_method: 'ode', guidance_scale: 1.0,
  complete_track_classes: ['drums', 'bass', 'guitar'],
  use_adg: false, cfg_interval_start: 0.0, cfg_interval_end: 1.0,
  preview: false,
};

const STAGE_DEFAULTS: Record<PipelineStageType, PipelineStageConfig> = {
  generate: DEFAULT_GENERATE_STAGE,
  refine: DEFAULT_REFINE_STAGE,
  cover: DEFAULT_COVER_STAGE,
  repaint: DEFAULT_REPAINT_STAGE,
  extract: DEFAULT_EXTRACT_STAGE,
  lego: DEFAULT_LEGO_STAGE,
  complete: DEFAULT_COMPLETE_STAGE,
};

export { STAGE_DEFAULTS };

// ── Store ───────────────────────────────────────────────────────────

interface PipelineState {
  // Shared conditioning
  caption: string;
  lyrics: string;
  instrumental: boolean;
  vocalLanguage: string;
  bpm: string;
  keyscale: string;
  timesignature: string;
  duration: number;
  batchSize: number;
  audioFormat: string;
  mp3Bitrate: number;

  // VRAM management
  keepInVram: boolean;

  // Stages
  stages: PipelineStageConfig[];
  activePreset: string | null;

  // User presets
  userPresets: PipelinePreset[];

  // Actions
  setField: (field: string, value: any) => void;
  addStage: (type?: PipelineStageType) => void;
  removeStage: (idx: number) => void;
  updateStage: (idx: number, updates: Partial<PipelineStageConfig>) => void;
  loadPreset: (preset: PipelinePreset) => void;
  resetStages: () => void;
  savePreset: (name: string) => void;
  deletePreset: (name: string) => void;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  caption: '',
  lyrics: '',
  instrumental: false,
  vocalLanguage: 'unknown',
  bpm: '',
  keyscale: '',
  timesignature: '',
  duration: -1,
  batchSize: 1,
  audioFormat: 'flac',
  mp3Bitrate: 320,

  keepInVram: false,

  stages: [{ ...DEFAULT_GENERATE_STAGE }, { ...DEFAULT_REFINE_STAGE }],
  activePreset: null,
  userPresets: loadUserPresets(),

  setField: (field, value) => set({ [field]: value } as any),

  addStage: (type) => set((s) => {
    const t = type || 'refine';
    const base = STAGE_DEFAULTS[t];
    const stage = { ...base };
    // Auto-set references to previous stage
    if (t === 'refine') {
      stage.input_stage = s.stages.length - 1;
    }
    if (['cover', 'repaint', 'extract', 'lego', 'complete'].includes(t) && stage.src_stage === undefined && !stage.src_audio_id) {
      stage.src_stage = s.stages.length - 1;
    }
    return { stages: [...s.stages, stage], activePreset: null };
  }),

  removeStage: (idx) => set((s) => {
    if (s.stages.length <= 1) return s;
    const next = s.stages.filter((_, i) => i !== idx);
    return {
      stages: next.map((stage) => {
        const updates: Partial<PipelineStageConfig> = {};
        // Fix input_stage references (refine)
        if (stage.input_stage !== undefined) {
          if (stage.input_stage === idx) updates.input_stage = Math.max(0, idx - 1);
          else if (stage.input_stage > idx) updates.input_stage = stage.input_stage - 1;
        }
        // Fix src_stage references (audio-requiring types)
        if (stage.src_stage !== undefined) {
          if (stage.src_stage === idx) updates.src_stage = Math.max(0, idx - 1);
          else if (stage.src_stage > idx) updates.src_stage = stage.src_stage - 1;
        }
        return Object.keys(updates).length > 0 ? { ...stage, ...updates } : stage;
      }),
      activePreset: null,
    };
  }),

  updateStage: (idx, updates) => set((s) => {
    const next = [...s.stages];
    next[idx] = { ...next[idx], ...updates };
    return { stages: next, activePreset: null };
  }),

  loadPreset: (preset) => set({
    stages: preset.stages.map((s) => ({ ...s })),
    activePreset: preset.name,
  }),

  resetStages: () => set({
    stages: [{ ...DEFAULT_GENERATE_STAGE }, { ...DEFAULT_REFINE_STAGE }],
    activePreset: null,
  }),

  savePreset: (name) => {
    const { stages, userPresets } = get();
    const stagesSummary = stages.map((s) => {
      if (s.type === 'refine') return `${s.steps}-step refine @ ${s.denoise}`;
      return `${s.steps}-step ${s.type}`;
    }).join(', ');

    const preset: PipelinePreset = {
      name,
      description: stagesSummary,
      stages: stages.map((s) => ({ ...s })),
    };

    // Replace existing preset with same name, or append
    const existing = userPresets.findIndex((p) => p.name === name);
    const next = [...userPresets];
    if (existing >= 0) {
      next[existing] = preset;
    } else {
      next.push(preset);
    }

    persistUserPresets(next);
    set({ userPresets: next, activePreset: name });
  },

  deletePreset: (name) => {
    const { userPresets, activePreset } = get();
    const next = userPresets.filter((p) => p.name !== name);
    persistUserPresets(next);
    set({
      userPresets: next,
      activePreset: activePreset === name ? null : activePreset,
    });
  },
}));
