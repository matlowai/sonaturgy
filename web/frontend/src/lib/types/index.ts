// Service
export interface ServiceStatus {
  dit_initialized: boolean;
  llm_initialized: boolean;
  dit_model: string | null;
  lm_model: string | null;
  device: string | null;
  is_turbo: boolean | null;
}

export interface GPUConfig {
  tier: string;
  gpu_memory_gb: number;
  max_duration_with_lm: number;
  max_duration_without_lm: number;
  max_batch_size_with_lm: number;
  max_batch_size_without_lm: number;
  init_lm_default: boolean;
  available_lm_models: string[];
  lm_memory_gb: Record<string, number>;
}

export interface InitializeRequest {
  checkpoint?: string;
  config_path: string;
  device: string;
  init_llm: boolean;
  lm_model_path: string;
  backend: string;
  use_flash_attention: boolean;
  offload_to_cpu: boolean;
  offload_dit_to_cpu: boolean;
  compile_model: boolean;
  quantization: string | null;
}

// Generation
export interface GenerateRequest {
  caption: string;
  lyrics: string;
  instrumental: boolean;
  task_type: string;
  instruction: string;
  vocal_language: string;
  bpm: number | null;
  keyscale: string;
  timesignature: string;
  duration: number;
  reference_audio_id: string | null;
  src_audio_id: string | null;
  audio_codes: string;
  repainting_start: number;
  repainting_end: number;
  audio_cover_strength: number;
  inference_steps: number;
  guidance_scale: number;
  seed: number;
  use_adg: boolean;
  cfg_interval_start: number;
  cfg_interval_end: number;
  shift: number;
  infer_method: string;
  timesteps: number[] | null;
  thinking: boolean;
  lm_temperature: number;
  lm_cfg_scale: number;
  lm_top_k: number;
  lm_top_p: number;
  lm_negative_prompt: string;
  use_cot_metas: boolean;
  use_cot_caption: boolean;
  use_cot_language: boolean;
  use_constrained_decoding: boolean;
  batch_size: number;
  allow_lm_batch: boolean;
  use_random_seed: boolean;
  seeds: number[] | null;
  lm_batch_chunk_size: number;
  constrained_decoding_debug: boolean;
  audio_format: string;
  is_format_caption: boolean;
  auto_score: boolean;
  auto_lrc: boolean;
  score_scale: number;
  lm_codes_strength: number;
  // Latent resume
  init_latent_id: string | null;
  t_start: number;
  checkpoint_step: number | null;
  resume_sample_index: number | null;
}

export interface TaskStatus {
  task_id: string;
  status: "pending" | "running" | "completed" | "error";
  progress: number;
  message: string;
  result: GenerationResult | null;
  error?: string | null;
}

export interface AudioResult {
  id: string;
  key: string;
  sample_rate: number;
  params: Record<string, any>;
  codes: string;
  latentId?: string;
  latentCheckpointId?: string;
  checkpointStep?: number;
}

export interface GenerationResult {
  audios: AudioResult[];
  status_message: string;
  success: boolean;
  error: string | null;
  extra: {
    time_costs: Record<string, number>;
    lm_metadata: Record<string, any> | null;
  };
}

export interface CreateSampleRequest {
  query: string;
  instrumental: boolean;
  vocal_language: string | null;
  lm_temperature: number;
  lm_top_k: number;
  lm_top_p: number;
  use_constrained_decoding?: boolean;
  constrained_decoding_debug?: boolean;
  repetition_penalty?: number;
}

export interface CreateSampleResponse {
  caption: string;
  lyrics: string;
  bpm: number | null;
  duration: number | null;
  keyscale: string;
  language: string;
  timesignature: string;
  instrumental: boolean;
  status_message: string;
}

export interface FormatRequest {
  caption: string;
  lyrics: string;
  bpm?: number | null;
  duration?: number | null;
  keyscale?: string;
  timesignature?: string;
  lm_temperature: number;
  lm_top_k: number;
  lm_top_p: number;
  constrained_decoding_debug: boolean;
}

export interface FormatResponse {
  caption: string;
  lyrics: string;
  bpm: number | null;
  duration: number | null;
  keyscale: string;
  language: string;
  timesignature: string;
  status_message: string;
}

// Analysis (LLM preview)
export interface AnalyzeRequest {
  caption: string;
  lyrics: string;
  instrumental: boolean;
  vocal_language: string;
  bpm: number | null;
  keyscale: string;
  timesignature: string;
  duration: number;
  lm_temperature: number;
  lm_cfg_scale: number;
  lm_top_k: number;
  lm_top_p: number;
  lm_negative_prompt: string;
  use_cot_metas: boolean;
  use_cot_caption: boolean;
  use_cot_language: boolean;
  use_constrained_decoding: boolean;
}

export interface AnalyzeResponse {
  caption: string;
  bpm: number | null;
  keyscale: string;
  duration: number | null;
  language: string;
  timesignature: string;
  thinking_text: string;
  phase1_time: number;
}

// Model info
export interface ModelInfo {
  name: string;
  description: string;
  ready: boolean;
  steps?: number;
  cfg?: boolean;
  speed: string;
  quality: string;
  recommended?: boolean;
  params?: string;
  vram?: string;
}

export interface DownloadProgress {
  status: string;
  message: string;
  current_bytes?: number;
  total_bytes?: number;
  progress?: number;
}

export interface ModelDownloadStatus {
  main_ready: boolean;
  dit: Record<string, boolean>;
  lm: Record<string, boolean>;
  core: Record<string, boolean>;
  downloading?: Record<string, DownloadProgress>;
}

export interface AllModelInfo {
  dit: Record<string, ModelInfo>;
  lm: Record<string, ModelInfo>;
}

// LoRA
export interface LoRAStatus {
  loaded: boolean;
  enabled: boolean;
  path: string | null;
  scale: number;
}

// Training
export interface TrainingStatus {
  running: boolean;
  epoch: number;
  total_epochs: number;
  loss: number;
  progress: number;
  losses: number[];
}

// API Response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  error: string | null;
}

// WebSocket messages
export interface WSMessage {
  type: "status" | "progress" | "completed" | "error";
  task_id: string;
  status?: string;
  progress?: number;
  message?: string;
  result?: GenerationResult;
  error?: string;
  error_detail?: string;  // Full traceback when verbose errors enabled
}

// Pipeline Builder
export type PipelineStageType = 'generate' | 'refine' | 'cover' | 'repaint' | 'extract' | 'lego' | 'complete';

/** Canonical DiT diffusion parameters, shared between Custom and Pipeline modes. */
export interface StageParams {
  steps: number;
  shift: number;
  seed: number;
  infer_method: string;
  guidance_scale: number;
  use_adg: boolean;
  cfg_interval_start: number;
  cfg_interval_end: number;
  denoise: number;
  timesteps?: number[];
  checkpoint_step?: number;
  audio_cover_strength?: number;
}

export interface PipelineStageConfig extends StageParams {
  type: PipelineStageType;
  input_stage?: number;  // For refine: source latent stage index

  // Per-stage conditioning overrides (falls back to shared PipelineRequest values)
  caption?: string;
  lyrics?: string;

  // Audio source (for cover/repaint/extract/lego/complete — mutually exclusive)
  src_audio_id?: string;    // Uploaded audio UUID
  src_stage?: number;       // Previous stage index to use as source audio
  src_latent_id?: string;   // Stored latent UUID from latent_store

  // Cover-specific
  audio_code_hints?: string;

  // Repaint-specific
  repainting_start?: number;  // seconds
  repainting_end?: number;    // seconds (-1 = end of audio)

  // Extract/lego/complete-specific
  track_name?: string;
  complete_track_classes?: string[];

  // Stage-only params
  model?: string;
  scheduler?: string;
  preview: boolean;
}

export interface PipelineRequest {
  caption: string;
  lyrics: string;
  instrumental: boolean;
  vocal_language: string;
  bpm?: number;
  keyscale: string;
  timesignature: string;
  duration: number;
  batch_size: number;
  keep_in_vram?: boolean;  // Keep all models loaded (requires more VRAM)
  audio_format?: string;   // flac, wav, mp3
  mp3_bitrate?: number;    // 128, 192, 256, 320

  // LM settings (shared across all stages)
  thinking?: boolean;
  lm_temperature?: number;
  lm_cfg_scale?: number;
  lm_top_k?: number;
  lm_top_p?: number;
  lm_negative_prompt?: string;
  use_cot_metas?: boolean;
  use_cot_caption?: boolean;
  use_cot_language?: boolean;
  use_constrained_decoding?: boolean;

  stages: PipelineStageConfig[];
}

export interface PipelineStageResult {
  stage: number;
  batch: number;
  audio_id: string;
  is_final: boolean;
  is_preview: boolean;
}

export interface PipelineResult {
  stages: PipelineStageResult[];
  final_stage: number;
  time_costs: Record<string, number>;
  success: boolean;
}

// Latent Browser
export interface LatentRecord {
  id: string;
  shape: number[];
  dtype: string;
  model_variant: string;
  stage_type: string;
  is_checkpoint: boolean;
  checkpoint_step: number | null;
  total_steps: number;
  batch_size: number;
  created_at: number;
  pinned: boolean;
  pipeline_id?: string;
  stage_index?: number;
  params: Record<string, any>;
  lm_metadata?: Record<string, any> | null;
  // Derived fields from backend
  caption: string;
  duration?: number;
  task_type: string;
}

export interface LatentListResponse {
  latents: LatentRecord[];
  total: number;
}

// Batch management
export interface BatchEntry {
  index: number;
  audios: AudioResult[];
  params: Record<string, any>;
  taskId: string;
  extra?: {
    time_costs?: Record<string, number>;
    lm_metadata?: Record<string, any> | null;
  };
}
