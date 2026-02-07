// ── Project Presets — localStorage persistence for service config & generation settings ──

const LAST_SERVICE_CONFIG_KEY = 'project-last-service-config';
const LAST_GENERATION_CONFIG_KEY = 'project-last-generation-config';

// ── Service Config snapshot (Layer 1) ────────────────────────────────

export interface ServiceConfigSnapshot {
  configPath: string;
  device: string;
  flashAttn: boolean;
  offloadCpu: boolean;
  offloadDit: boolean;
  compileModel: boolean;
  quantization: boolean;
  lmModelPath: string;
  backend: string;
}

// ── Generation Config snapshot (Layer 2 — settings only) ─────────────

export interface GenerationConfigSnapshot {
  inferenceSteps: number;
  guidanceScale: number;
  shift: number;
  inferMethod: string;
  useAdg: boolean;
  cfgIntervalStart: number;
  cfgIntervalEnd: number;
  batchSize: number;
  duration: number;
  audioFormat: string;
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
  allowLmBatch: boolean;
  lmBatchChunkSize: number;
  lmCodesStrength: number;
  captionRewrite: boolean;
  audioCoverStrength: number;
  useRandomSeed: boolean;
  autoScore: boolean;
  autoLrc: boolean;
  scoreScale: number;
}

// Keys we extract from generationStore for persistence
export const GENERATION_SETTINGS_KEYS: (keyof GenerationConfigSnapshot)[] = [
  'inferenceSteps', 'guidanceScale', 'shift', 'inferMethod', 'useAdg',
  'cfgIntervalStart', 'cfgIntervalEnd', 'batchSize', 'duration', 'audioFormat',
  'thinking', 'lmTemperature', 'lmCfgScale', 'lmTopK', 'lmTopP', 'lmNegativePrompt',
  'useCotMetas', 'useCotCaption', 'useCotLanguage', 'useConstrainedDecoding',
  'allowLmBatch', 'lmBatchChunkSize', 'lmCodesStrength', 'captionRewrite',
  'audioCoverStrength', 'useRandomSeed', 'autoScore', 'autoLrc', 'scoreScale',
];

// ── localStorage helpers (same pattern as pipelineStore.ts) ──────────

function load<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function save(key: string, data: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable
  }
}

// ── Public API ───────────────────────────────────────────────────────

export function loadLastServiceConfig(): Partial<ServiceConfigSnapshot> | null {
  return load<Partial<ServiceConfigSnapshot>>(LAST_SERVICE_CONFIG_KEY);
}

export function saveLastServiceConfig(config: ServiceConfigSnapshot): void {
  save(LAST_SERVICE_CONFIG_KEY, config);
}

export function loadLastGenerationConfig(): Partial<GenerationConfigSnapshot> | null {
  return load<Partial<GenerationConfigSnapshot>>(LAST_GENERATION_CONFIG_KEY);
}

export function saveLastGenerationConfig(config: GenerationConfigSnapshot): void {
  save(LAST_GENERATION_CONFIG_KEY, config);
}

// ── Named Project Presets ────────────────────────────────────────────

const PROJECT_PRESETS_KEY = 'project-presets';

export interface ProjectPreset {
  name: string;
  description: string;
  serviceConfig: ServiceConfigSnapshot;
  generationConfig: Partial<GenerationConfigSnapshot>;
  builtIn?: boolean;
}

export const BUILT_IN_PRESETS: ProjectPreset[] = [
  {
    name: 'Fast Draft',
    description: 'Turbo, no LLM, 8 steps, batch 4',
    builtIn: true,
    serviceConfig: {
      configPath: 'acestep-v15-turbo', device: 'auto', flashAttn: false,
      offloadCpu: false, offloadDit: false, compileModel: false,
      quantization: false, lmModelPath: 'acestep-5Hz-lm-1.7B', backend: 'vllm',
    },
    generationConfig: {
      inferenceSteps: 8, guidanceScale: 7.0, shift: 1.0, batchSize: 4,
      thinking: false, inferMethod: 'ode',
    },
  },
  {
    name: 'Quality',
    description: 'Base, 1.7B LLM, 50 steps, thinking on',
    builtIn: true,
    serviceConfig: {
      configPath: 'acestep-v15-base', device: 'auto', flashAttn: false,
      offloadCpu: false, offloadDit: false, compileModel: false,
      quantization: false, lmModelPath: 'acestep-5Hz-lm-1.7B', backend: 'vllm',
    },
    generationConfig: {
      inferenceSteps: 50, guidanceScale: 1.0, shift: 2.0, batchSize: 1,
      thinking: true, inferMethod: 'ode', useCotMetas: true, useCotCaption: true,
    },
  },
  {
    name: 'SFT + CFG',
    description: 'SFT, 1.7B LLM, 50 steps, guidance 3.5, CFG 0.15-0.85',
    builtIn: true,
    serviceConfig: {
      configPath: 'acestep-v15-sft', device: 'auto', flashAttn: false,
      offloadCpu: false, offloadDit: false, compileModel: false,
      quantization: false, lmModelPath: 'acestep-5Hz-lm-1.7B', backend: 'vllm',
    },
    generationConfig: {
      inferenceSteps: 50, guidanceScale: 3.5, shift: 2.0, batchSize: 1,
      thinking: true, inferMethod: 'ode', useAdg: false,
      cfgIntervalStart: 0.15, cfgIntervalEnd: 0.85,
    },
  },
  {
    name: 'Cover Session',
    description: 'Turbo, no LLM, cover strength 0.5',
    builtIn: true,
    serviceConfig: {
      configPath: 'acestep-v15-turbo', device: 'auto', flashAttn: false,
      offloadCpu: false, offloadDit: false, compileModel: false,
      quantization: false, lmModelPath: 'acestep-5Hz-lm-1.7B', backend: 'vllm',
    },
    generationConfig: {
      inferenceSteps: 8, guidanceScale: 7.0, shift: 1.0, batchSize: 2,
      thinking: false, audioCoverStrength: 0.5, inferMethod: 'ode',
    },
  },
];

export function loadProjectPresets(): ProjectPreset[] {
  return load<ProjectPreset[]>(PROJECT_PRESETS_KEY) ?? [];
}

export function saveProjectPresets(presets: ProjectPreset[]): void {
  save(PROJECT_PRESETS_KEY, presets);
}
