import type { PipelineStageConfig, PipelineStageType } from '@/lib/types';
import { TASK_INSTRUCTIONS } from '@/lib/constants';

// ── Task type mapping ───────────────────────────────────────────────

const CUSTOM_TO_PIPELINE_TYPE: Record<string, PipelineStageType> = {
  text2music: 'generate',
  cover: 'cover',
  repaint: 'repaint',
  extract: 'extract',
  lego: 'lego',
  complete: 'complete',
};

const PIPELINE_TO_CUSTOM_TYPE: Record<PipelineStageType, string> = {
  generate: 'text2music',
  refine: 'text2music', // refine has no custom equivalent
  cover: 'cover',
  repaint: 'repaint',
  extract: 'extract',
  lego: 'lego',
  complete: 'complete',
};

// ── mapParamsToFields (moved from useBatchNavigation) ───────────────

/** Map backend snake_case params to frontend camelCase store fields */
export function mapParamsToFields(p: Record<string, any>): Record<string, any> {
  return {
    // Switch to custom mode so restored fields are visible
    mode: 'custom',
    // Creative content
    caption: p.caption || '',
    lyrics: p.lyrics || '',
    instrumental: p.instrumental ?? false,
    taskType: p.task_type || 'text2music',
    vocalLanguage: p.vocal_language || 'unknown',
    bpm: p.bpm ? String(p.bpm) : '',
    keyscale: p.keyscale || '',
    timesignature: p.timesignature || '',
    duration: p.duration ?? -1,
    // DiT settings
    inferenceSteps: p.inference_steps ?? 8,
    guidanceScale: p.guidance_scale ?? 7.0,
    seed: p.seed ?? -1,
    shift: p.shift ?? 1.0,
    inferMethod: p.infer_method || 'ode',
    useAdg: p.use_adg ?? false,
    cfgIntervalStart: p.cfg_interval_start ?? 0.0,
    cfgIntervalEnd: p.cfg_interval_end ?? 1.0,
    audioCoverStrength: p.audio_cover_strength ?? 1.0,
    // LM settings
    thinking: p.thinking ?? true,
    lmTemperature: p.lm_temperature ?? 0.85,
    lmCfgScale: p.lm_cfg_scale ?? 2.0,
    lmTopK: p.lm_top_k ?? 0,
    lmTopP: p.lm_top_p ?? 0.9,
    lmNegativePrompt: p.lm_negative_prompt || 'NO USER INPUT',
    useCotMetas: p.use_cot_metas ?? true,
    useCotCaption: p.use_cot_caption ?? true,
    useCotLanguage: p.use_cot_language ?? true,
    useConstrainedDecoding: p.use_constrained_decoding ?? true,
    // Reset latent resume (these are set explicitly by AudioCard, not from params)
    initLatentId: null,
    tStart: 1.0,
    checkpointStep: null,
    resumeSampleIndex: null,
  };
}

// ── customToStage ───────────────────────────────────────────────────

interface CustomGenState {
  taskType: string;
  inferenceSteps: number;
  guidanceScale: number;
  seed: number;
  shift: number;
  inferMethod: string;
  useAdg: boolean;
  cfgIntervalStart: number;
  cfgIntervalEnd: number;
  audioCoverStrength: number;
  customTimesteps: string;
  checkpointStep: number | null;
  srcAudioId: string | null;
  initLatentId: string | null;
  repaintingStart: number;
  repaintingEnd: number;
  trackName: string;
  completeTrackClasses: string[];
  caption: string;
  lyrics: string;
}

/** Convert Custom mode generationStore state → PipelineStageConfig */
export function customToStage(gen: CustomGenState, model?: string): PipelineStageConfig {
  const type = CUSTOM_TO_PIPELINE_TYPE[gen.taskType] ?? 'generate';

  // Parse custom timesteps string → number[]
  let timesteps: number[] | undefined;
  if (gen.customTimesteps) {
    const parsed = gen.customTimesteps
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n));
    if (parsed.length > 0) timesteps = parsed;
  }

  const stage: PipelineStageConfig = {
    type,
    steps: gen.inferenceSteps,
    shift: gen.shift,
    seed: gen.seed,
    infer_method: gen.inferMethod,
    guidance_scale: gen.guidanceScale,
    use_adg: gen.useAdg,
    cfg_interval_start: gen.cfgIntervalStart,
    cfg_interval_end: gen.cfgIntervalEnd,
    denoise: 1.0,
    preview: true,
  };

  if (model) stage.model = model;
  if (timesteps) stage.timesteps = timesteps;
  if (gen.checkpointStep !== null) stage.checkpoint_step = gen.checkpointStep;

  // Audio source
  if (gen.srcAudioId) stage.src_audio_id = gen.srcAudioId;
  if (gen.initLatentId) stage.src_latent_id = gen.initLatentId;

  // Type-specific fields
  if (type === 'cover') {
    stage.audio_cover_strength = gen.audioCoverStrength;
  }
  if (type === 'repaint') {
    stage.repainting_start = gen.repaintingStart;
    stage.repainting_end = gen.repaintingEnd;
  }
  if (type === 'extract' || type === 'lego') {
    stage.track_name = gen.trackName;
  }
  if (type === 'complete') {
    stage.complete_track_classes = [...gen.completeTrackClasses];
  }

  // Per-stage caption/lyrics
  if (gen.caption) stage.caption = gen.caption;
  if (gen.lyrics) stage.lyrics = gen.lyrics;

  return stage;
}

// ── stageToCustom ───────────────────────────────────────────────────

interface PipelineConditioning {
  caption: string;
  lyrics: string;
  instrumental: boolean;
  vocalLanguage: string;
  bpm: string;
  keyscale: string;
  timesignature: string;
  duration: number;
}

/** Convert PipelineStageConfig → Custom mode fields dict (for gen.setFields()) */
export function stageToCustom(
  stage: PipelineStageConfig,
  conditioning?: PipelineConditioning,
): Record<string, any> {
  const taskType = PIPELINE_TO_CUSTOM_TYPE[stage.type] ?? 'text2music';

  // Build instruction from TASK_INSTRUCTIONS
  let instruction = TASK_INSTRUCTIONS[taskType] ?? TASK_INSTRUCTIONS.text2music;
  if (stage.track_name) {
    instruction = instruction.replace('{TRACK_NAME}', stage.track_name);
  }
  if (stage.complete_track_classes) {
    instruction = instruction.replace('{TRACK_CLASSES}', stage.complete_track_classes.join(', '));
  }

  // Serialize timesteps back to string
  const customTimesteps = stage.timesteps ? stage.timesteps.join(', ') : '';

  const fields: Record<string, any> = {
    mode: 'custom',
    taskType,
    instruction,
    // DiT params (snake_case → camelCase)
    inferenceSteps: stage.steps,
    shift: stage.shift,
    seed: stage.seed,
    inferMethod: stage.infer_method,
    guidanceScale: stage.guidance_scale,
    useAdg: stage.use_adg,
    cfgIntervalStart: stage.cfg_interval_start,
    cfgIntervalEnd: stage.cfg_interval_end,
    customTimesteps,
    // Audio source
    srcAudioId: stage.src_audio_id ?? null,
    audioCoverStrength: stage.audio_cover_strength ?? 1.0,
    repaintingStart: stage.repainting_start ?? 0,
    repaintingEnd: stage.repainting_end ?? -1,
    trackName: stage.track_name ?? 'vocals',
    completeTrackClasses: stage.complete_track_classes ?? [],
    // Latent resume
    initLatentId: stage.src_latent_id ?? null,
    tStart: 1.0,
    checkpointStep: stage.checkpoint_step ?? null,
    resumeSampleIndex: null,
  };

  // Caption/lyrics: stage override > pipeline conditioning
  const caption = stage.caption ?? conditioning?.caption ?? '';
  const lyrics = stage.lyrics ?? conditioning?.lyrics ?? '';
  fields.caption = caption;
  fields.lyrics = lyrics;

  // Metadata from pipeline conditioning
  if (conditioning) {
    fields.instrumental = conditioning.instrumental;
    fields.vocalLanguage = conditioning.vocalLanguage;
    fields.bpm = conditioning.bpm;
    fields.keyscale = conditioning.keyscale;
    fields.timesignature = conditioning.timesignature;
    fields.duration = conditioning.duration;
  }

  return fields;
}

// ── paramsToStage ───────────────────────────────────────────────────

/** Convert backend snake_case result params → PipelineStageConfig (for AudioCard → Pipeline) */
export function paramsToStage(
  params: Record<string, any>,
  latentId?: string,
): PipelineStageConfig {
  const type = CUSTOM_TO_PIPELINE_TYPE[params.task_type] ?? 'generate';

  const stage: PipelineStageConfig = {
    type,
    steps: params.inference_steps ?? 8,
    shift: params.shift ?? 1.0,
    seed: params.seed ?? -1,
    infer_method: params.infer_method ?? 'ode',
    guidance_scale: params.guidance_scale ?? 7.0,
    use_adg: params.use_adg ?? false,
    cfg_interval_start: params.cfg_interval_start ?? 0.0,
    cfg_interval_end: params.cfg_interval_end ?? 1.0,
    denoise: 1.0,
    preview: true,
  };

  if (latentId) stage.src_latent_id = latentId;
  if (params.src_audio_id) stage.src_audio_id = params.src_audio_id;

  // Type-specific
  if (type === 'cover') {
    stage.audio_cover_strength = params.audio_cover_strength ?? 1.0;
  }
  if (type === 'repaint') {
    stage.repainting_start = params.repainting_start ?? 0;
    stage.repainting_end = params.repainting_end ?? -1;
  }
  if (type === 'extract' || type === 'lego') {
    stage.track_name = params.track_name ?? 'vocals';
  }
  if (type === 'complete') {
    stage.complete_track_classes = params.complete_track_classes ?? [];
  }

  // Caption/lyrics as stage overrides
  if (params.caption) stage.caption = params.caption;
  if (params.lyrics) stage.lyrics = params.lyrics;

  return stage;
}
